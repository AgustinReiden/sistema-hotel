-- Migration 69: cambio de habitacion con re-tarifa + autorizacion de admin,
-- limpieza de late_check_out_until al mover el checkout, y correccion puntual Hab. 6.
--
-- Contexto:
--  * Ampliar/Editar movian check_out_target sin limpiar late_check_out_until, dejando
--    una falsa alarma "Retraso Check-out" (deadline viejo anterior al checkout real).
--  * El cambio de habitacion no re-tarifaba: el huesped quedaba pagando la tarifa vieja.
--    Ahora se aplica siempre la tarifa de la nueva habitacion (para no romper caja); si el
--    motivo es "habitacion defectuosa" se genera una alerta que el admin puede autorizar
--    (mantener la tarifa anterior) o rechazar.

BEGIN;

-- =========================================================================
-- 1) admin_alerts: soporte para solicitudes de tarifa con decision del admin
-- =========================================================================
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS related_reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL;
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS decision TEXT;
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS payload JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_alerts_decision_check'
  ) THEN
    ALTER TABLE public.admin_alerts
      ADD CONSTRAINT admin_alerts_decision_check
      CHECK (decision IS NULL OR decision IN ('authorized', 'rejected'));
  END IF;
END $$;

-- =========================================================================
-- 2) rpc_change_reservation_room: re-tarifa a la nueva habitacion + alerta
--    (cambia la firma: agrega p_reason, por eso se dropea la version 2-args)
-- =========================================================================
DROP FUNCTION IF EXISTS public.rpc_change_reservation_room(UUID, INT);

CREATE OR REPLACE FUNCTION public.rpc_change_reservation_room(
  p_reservation_id UUID,
  p_new_room_id INT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_old_room_id INT;
  v_status public.reservation_status;
  v_new_room_active BOOLEAN;
  v_check_in TIMESTAMPTZ;
  v_check_out TIMESTAMPTZ;
  v_associated_id UUID;
  v_old_base NUMERIC;
  v_old_discount_percent NUMERIC;
  v_old_discount_amount NUMERIC;
  v_old_total NUMERIC;
  v_surcharges NUMERIC;
  v_new_base NUMERIC;
  v_new_discount_percent NUMERIC;
  v_new_discount_amount NUMERIC;
  v_new_final NUMERIC;
  v_new_total NUMERIC;
  v_old_room_number TEXT;
  v_new_room_number TEXT;
  v_alert_created BOOLEAN := FALSE;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN ('room_defective', 'guest_request') THEN
    RAISE EXCEPTION 'Motivo de cambio invalido.' USING errcode = '22023';
  END IF;

  SELECT room_id, status, check_in_target, check_out_target, associated_client_id,
         base_total_price, discount_percent, discount_amount, total_price
  INTO v_old_room_id, v_status, v_check_in, v_check_out, v_associated_id,
       v_old_base, v_old_discount_percent, v_old_discount_amount, v_old_total
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_old_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede cambiar la habitacion de una reserva finalizada.' USING errcode = '22023';
  END IF;

  IF v_old_room_id = p_new_room_id THEN
    RAISE EXCEPTION 'La habitacion nueva es la misma que la actual.' USING errcode = '22023';
  END IF;

  SELECT is_active, room_number
  INTO v_new_room_active, v_new_room_number
  FROM public.rooms WHERE id = p_new_room_id;

  IF v_new_room_active IS NULL THEN
    RAISE EXCEPTION 'La habitacion nueva no existe.' USING errcode = 'P0002';
  END IF;
  IF v_new_room_active = FALSE THEN
    RAISE EXCEPTION 'La habitacion nueva esta inactiva.' USING errcode = '22023';
  END IF;

  SELECT room_number INTO v_old_room_number FROM public.rooms WHERE id = v_old_room_id;

  -- Recargos preservados: extras que no son base (minibar, medio dia, danos, etc.).
  v_surcharges := round((v_old_total - (v_old_base - v_old_discount_amount))::numeric, 2);
  IF v_surcharges < 0 THEN v_surcharges := 0; END IF;

  -- Tarifa de la nueva habitacion (rooms.base_price actual + descuento del asociado).
  SELECT pricing.base_total_price, pricing.discount_percent,
         pricing.discount_amount, pricing.final_total_price
  INTO v_new_base, v_new_discount_percent, v_new_discount_amount, v_new_final
  FROM public.app_calculate_reservation_pricing(
    p_new_room_id, v_check_in, v_check_out, v_associated_id
  ) AS pricing;

  v_new_total := round((v_new_final + v_surcharges)::numeric, 2);

  -- El EXCLUDE constraint en reservations rechaza automaticamente overlaps.
  UPDATE public.reservations
  SET room_id = p_new_room_id,
      base_total_price = v_new_base,
      discount_percent = v_new_discount_percent,
      discount_amount = v_new_discount_amount,
      total_price = v_new_total,
      updated_at = v_now
  WHERE id = p_reservation_id;

  IF v_status = 'checked_in' THEN
    UPDATE public.rooms SET status = 'cleaning'
    WHERE id = v_old_room_id AND status = 'occupied';

    UPDATE public.rooms SET status = 'occupied'
    WHERE id = p_new_room_id AND status = 'available';
  END IF;

  -- Habitacion defectuosa: pedir autorizacion al admin para mantener la tarifa anterior.
  IF p_reason = 'room_defective' THEN
    INSERT INTO public.admin_alerts (
      kind, message, related_room_id, related_reservation_id, payload
    )
    VALUES (
      'room_change_keep_old_tariff_request',
      format(
        'Cambio Hab. %s -> Hab. %s por habitacion defectuosa. Tarifa nueva $%s. Autorizar mantener tarifa anterior $%s?',
        COALESCE(v_old_room_number, '?'),
        COALESCE(v_new_room_number, '?'),
        round(v_new_total)::bigint,
        round(v_old_total)::bigint
      ),
      v_old_room_id,
      p_reservation_id,
      jsonb_build_object(
        'old_room_id', v_old_room_id,
        'old_base_total_price', v_old_base,
        'old_discount_percent', v_old_discount_percent,
        'old_discount_amount', v_old_discount_amount,
        'old_total_price', v_old_total,
        'new_room_id', p_new_room_id,
        'new_total_price', v_new_total
      )
    );
    v_alert_created := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'old_room_id', v_old_room_id,
    'new_room_id', p_new_room_id,
    'status', v_status,
    'reason', p_reason,
    'old_total', v_old_total,
    'new_total', v_new_total,
    'alert_created', v_alert_created
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_change_reservation_room(UUID, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_change_reservation_room(UUID, INT, TEXT) TO authenticated;

-- =========================================================================
-- 3) Autorizar / rechazar mantener la tarifa anterior (admin-only)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_authorize_old_tariff(p_alert_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_kind TEXT;
  v_resolved TIMESTAMPTZ;
  v_reservation_id UUID;
  v_payload JSONB;
  v_res_status public.reservation_status;
  v_curr_base NUMERIC;
  v_curr_discount NUMERIC;
  v_curr_total NUMERIC;
  v_curr_surcharges NUMERIC;
  v_old_base NUMERIC;
  v_old_discount_percent NUMERIC;
  v_old_discount_amount NUMERIC;
  v_new_total NUMERIC;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT kind, resolved_at, related_reservation_id, payload
  INTO v_kind, v_resolved, v_reservation_id, v_payload
  FROM public.admin_alerts
  WHERE id = p_alert_id
  FOR UPDATE;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Alerta no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_kind <> 'room_change_keep_old_tariff_request' THEN
    RAISE EXCEPTION 'La alerta no es una solicitud de tarifa.' USING errcode = '22023';
  END IF;
  IF v_resolved IS NOT NULL THEN
    RAISE EXCEPTION 'La alerta ya fue resuelta.' USING errcode = '22023';
  END IF;

  v_old_base := (v_payload->>'old_base_total_price')::numeric;
  v_old_discount_percent := (v_payload->>'old_discount_percent')::numeric;
  v_old_discount_amount := (v_payload->>'old_discount_amount')::numeric;

  SELECT status, base_total_price, discount_amount, total_price
  INTO v_res_status, v_curr_base, v_curr_discount, v_curr_total
  FROM public.reservations
  WHERE id = v_reservation_id
  FOR UPDATE;

  IF v_res_status IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_res_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'La reserva ya finalizo; no se puede cambiar la tarifa.' USING errcode = '22023';
  END IF;

  -- Recargos actuales (por si se agregaron extras despues del cambio).
  v_curr_surcharges := round((v_curr_total - (v_curr_base - v_curr_discount))::numeric, 2);
  IF v_curr_surcharges < 0 THEN v_curr_surcharges := 0; END IF;

  v_new_total := round(((v_old_base - v_old_discount_amount) + v_curr_surcharges)::numeric, 2);

  UPDATE public.reservations
  SET base_total_price = v_old_base,
      discount_percent = v_old_discount_percent,
      discount_amount = v_old_discount_amount,
      total_price = v_new_total,
      updated_at = v_now
  WHERE id = v_reservation_id;

  UPDATE public.admin_alerts
  SET decision = 'authorized',
      resolved_at = v_now,
      resolved_by = auth.uid()
  WHERE id = p_alert_id;

  RETURN jsonb_build_object(
    'alert_id', p_alert_id,
    'decision', 'authorized',
    'reservation_id', v_reservation_id,
    'total_price', v_new_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_reject_old_tariff(p_alert_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_kind TEXT;
  v_resolved TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT kind, resolved_at
  INTO v_kind, v_resolved
  FROM public.admin_alerts
  WHERE id = p_alert_id
  FOR UPDATE;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Alerta no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_kind <> 'room_change_keep_old_tariff_request' THEN
    RAISE EXCEPTION 'La alerta no es una solicitud de tarifa.' USING errcode = '22023';
  END IF;
  IF v_resolved IS NOT NULL THEN
    RAISE EXCEPTION 'La alerta ya fue resuelta.' USING errcode = '22023';
  END IF;

  UPDATE public.admin_alerts
  SET decision = 'rejected',
      resolved_at = v_now,
      resolved_by = auth.uid()
  WHERE id = p_alert_id;

  RETURN jsonb_build_object('alert_id', p_alert_id, 'decision', 'rejected');
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_authorize_old_tariff(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_reject_old_tariff(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_authorize_old_tariff(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reject_old_tariff(BIGINT) TO authenticated;

-- =========================================================================
-- 4) rpc_list_admin_alerts: exponer related_reservation_id, decision, payload
--    (cambia el RETURNS TABLE -> hay que dropear antes de recrear)
-- =========================================================================
DROP FUNCTION IF EXISTS public.rpc_list_admin_alerts(BOOLEAN);

CREATE OR REPLACE FUNCTION public.rpc_list_admin_alerts(p_only_unresolved BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  id BIGINT,
  kind TEXT,
  message TEXT,
  related_room_id INT,
  related_room_number TEXT,
  related_cleaning_log_id BIGINT,
  related_reservation_id UUID,
  decision TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolved_notes TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.kind, a.message, a.related_room_id, r.room_number,
         a.related_cleaning_log_id, a.related_reservation_id, a.decision, a.payload,
         a.created_at, a.resolved_at, a.resolved_by, a.resolved_notes
  FROM public.admin_alerts a
  LEFT JOIN public.rooms r ON r.id = a.related_room_id
  WHERE (NOT p_only_unresolved) OR (a.resolved_at IS NULL)
  ORDER BY a.created_at DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_admin_alerts(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_admin_alerts(BOOLEAN) TO authenticated;

-- =========================================================================
-- 5) rpc_update_reservation: limpiar late_check_out_until cuando cambian fechas
--    (recreado desde la migracion 52, misma firma; solo se agrega esa linea)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_update_reservation(
  p_reservation_id UUID,
  p_client_name TEXT,
  p_client_dni TEXT,
  p_client_phone TEXT,
  p_check_in TIMESTAMPTZ,
  p_check_out TIMESTAMPTZ,
  p_notes TEXT,
  p_override_total_price NUMERIC DEFAULT NULL,
  p_guest_count INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_room_id INT;
  v_status public.reservation_status;
  v_associated_id UUID;
  v_paid_amount NUMERIC;
  v_old_check_in TIMESTAMPTZ;
  v_old_check_out TIMESTAMPTZ;
  v_client_name TEXT := NULLIF(BTRIM(p_client_name), '');
  v_client_dni TEXT := NULLIF(BTRIM(p_client_dni), '');
  v_client_phone TEXT := NULLIF(BTRIM(p_client_phone), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_base_total NUMERIC;
  v_discount_percent NUMERIC;
  v_discount_amount NUMERIC;
  v_final_total NUMERIC;
  v_dates_changed BOOLEAN;
  v_is_admin BOOLEAN := public.app_is_admin();
  v_current_guest_count INTEGER;
  v_new_guest_count INTEGER;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  -- Solo un admin puede editar la reserva (el recepcionista no edita).
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Solo un admin puede editar la reserva.' USING errcode = '42501';
  END IF;

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Las fechas son obligatorias.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la de entrada.' USING errcode = '22023';
  END IF;

  SELECT room_id, status, associated_client_id, paid_amount, check_in_target, check_out_target, guest_count
  INTO v_room_id, v_status, v_associated_id, v_paid_amount, v_old_check_in, v_old_check_out, v_current_guest_count
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede editar una reserva finalizada o cancelada.' USING errcode = '22023';
  END IF;

  v_dates_changed := (p_check_in <> v_old_check_in) OR (p_check_out <> v_old_check_out);
  v_new_guest_count := COALESCE(p_guest_count, v_current_guest_count);
  IF v_new_guest_count < 1 THEN v_new_guest_count := 1; END IF;

  IF p_override_total_price IS NOT NULL THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Solo un admin puede sobreescribir el precio total.' USING errcode = '42501';
    END IF;
    IF p_override_total_price < 0 THEN
      RAISE EXCEPTION 'El precio total no puede ser negativo.' USING errcode = '22023';
    END IF;
    IF p_override_total_price < v_paid_amount THEN
      RAISE EXCEPTION 'El total no puede ser menor al monto ya pagado.' USING errcode = '22023';
    END IF;

    IF v_dates_changed THEN
      SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount
      INTO v_base_total, v_discount_percent, v_discount_amount
      FROM public.app_calculate_reservation_pricing(v_room_id, p_check_in, p_check_out, v_associated_id) AS pricing;
    ELSE
      SELECT base_total_price, discount_percent, discount_amount
      INTO v_base_total, v_discount_percent, v_discount_amount
      FROM public.reservations WHERE id = p_reservation_id;
    END IF;

    v_final_total := p_override_total_price;
  ELSIF v_dates_changed THEN
    SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
    INTO v_base_total, v_discount_percent, v_discount_amount, v_final_total
    FROM public.app_calculate_reservation_pricing(v_room_id, p_check_in, p_check_out, v_associated_id) AS pricing;

    IF v_final_total < v_paid_amount THEN
      RAISE EXCEPTION 'El nuevo total calculado es menor al monto ya pagado. Cancela y reemiti la reserva.' USING errcode = '22023';
    END IF;
  ELSE
    SELECT base_total_price, discount_percent, discount_amount, total_price
    INTO v_base_total, v_discount_percent, v_discount_amount, v_final_total
    FROM public.reservations WHERE id = p_reservation_id;
  END IF;

  UPDATE public.reservations
  SET client_name = v_client_name,
      client_dni = v_client_dni,
      client_phone = v_client_phone,
      notes = v_notes,
      check_in_target = p_check_in,
      check_out_target = p_check_out,
      base_total_price = v_base_total,
      discount_percent = v_discount_percent,
      discount_amount = v_discount_amount,
      total_price = v_final_total,
      guest_count = v_new_guest_count,
      -- Si se mueven las fechas, el late-checkout viejo deja de valer (evita falso "Retraso").
      late_check_out_until = CASE WHEN v_dates_changed THEN NULL ELSE late_check_out_until END,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'dates_changed', v_dates_changed,
    'price_overridden', (p_override_total_price IS NOT NULL),
    'base_total_price', v_base_total,
    'discount_percent', v_discount_percent,
    'discount_amount', v_discount_amount,
    'total_price', v_final_total,
    'guest_count', v_new_guest_count
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Las nuevas fechas se solapan con otra reserva activa en esta habitacion.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_update_reservation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_update_reservation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, INTEGER) TO authenticated;

-- =========================================================================
-- 6) Correccion puntual (una sola vez): reserva activa de la Hab. 6
--    Re-tarifar a 60.000/noche (rooms.base_price actual), quitar el medio dia,
--    y limpiar el late_check_out_until que dejaba el falso "Retraso Check-out".
--    Idempotente y acotada por id; paid_amount = 0 (sin conflicto con pagos).
-- =========================================================================
UPDATE public.reservations
SET base_total_price = 120000,   -- 2 noches x 60.000
    discount_percent = 0,
    discount_amount  = 0,
    total_price      = 120000,   -- sin medio dia
    late_check_out_until = NULL,
    updated_at = NOW()
WHERE id = '05e79c3e-82bd-4310-ad10-cba4666f6ec7';

DELETE FROM public.extra_charges
WHERE reservation_id = '05e79c3e-82bd-4310-ad10-cba4666f6ec7'
  AND charge_type = 'half_day';

COMMIT;
