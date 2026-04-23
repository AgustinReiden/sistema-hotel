-- Migration 41: Fixes de reservas + sistema de alertas de mantenimiento
--
-- Cambios:
-- 1) rpc_staff_create_reservation:
--    - Default status = 'confirmed' (antes 'pending'). Staff no debería crear
--      reservas que vayan a la cola de solicitudes públicas.
--    - Rechaza si check_in es pasado Y check_out también es pasado (reserva
--      ya terminó, no tiene sentido crearla).
--    - Mantiene el auto-check-in si check_in <= now < check_out (huésped
--      ya está en la habitación).
-- 2) rpc_confirm_reservation:
--    - Valida que no haya overlap con otra reserva activa (el EXCLUDE
--      constraint protege inserts, pero reforzamos el chequeo explícito al
--      confirmar una pending).
-- 3) rpc_mark_room_clean:
--    - Ahora acepta también rooms `available`. Si el estado previo era
--      available, genera una alerta admin_alerts para auditoría (posible
--      limpieza fraudulenta sin check-out previo).
-- 4) Tabla `admin_alerts` + RPCs para listar y resolver.

BEGIN;

-- =========================================================================
-- 1) rpc_staff_create_reservation: status = 'confirmed' por defecto + guard pasado
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_staff_create_reservation(
  p_room_id integer,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_client_name text DEFAULT NULL,
  p_client_dni text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_status public.reservation_status := 'confirmed';
  v_reservation_id uuid;
  v_client_name text := nullif(btrim(p_client_name), '');
  v_client_dni text := nullif(btrim(p_client_dni), '');
  v_client_phone text := nullif(btrim(p_client_phone), '');
  v_associated_name text;
  v_associated_document text;
  v_associated_phone text;
  v_base_total_price numeric;
  v_discount_percent numeric;
  v_discount_amount numeric;
  v_final_total_price numeric;
  v_guest_count integer := GREATEST(1, COALESCE(p_guest_count, 1));
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_associated_client_id IS NOT NULL THEN
    IF v_client_name IS NOT NULL OR v_client_dni IS NOT NULL OR v_client_phone IS NOT NULL THEN
      RAISE EXCEPTION 'No se deben enviar datos manuales al seleccionar un asociado.' USING errcode = '22023';
    END IF;

    SELECT ac.display_name, ac.document_id, nullif(btrim(ac.phone), '')
    INTO v_associated_name, v_associated_document, v_associated_phone
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id AND ac.is_active = true;

    IF v_associated_name IS NULL THEN
      RAISE EXCEPTION 'Asociado no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;

    v_client_name := v_associated_name;
    v_client_dni := v_associated_document;
    v_client_phone := v_associated_phone;
  ELSE
    IF v_client_name IS NULL THEN
      RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
    END IF;
    IF v_client_dni IS NULL THEN
      RAISE EXCEPTION 'El DNI o CUIT es obligatorio.' USING errcode = '22023';
    END IF;
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  -- Rechazar si la estadía completa está en el pasado
  IF p_check_out <= v_now THEN
    RAISE EXCEPTION 'No se puede crear una reserva cuyas fechas ya pasaron.' USING errcode = '22023';
  END IF;

  -- Si el huésped ya debería estar en la habitación (check_in pasó y aún no terminó), checked_in directo
  IF p_check_in <= v_now AND p_check_out > v_now THEN
    v_status := 'checked_in';
  END IF;

  SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
  INTO v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price
  FROM public.app_calculate_reservation_pricing(p_room_id, p_check_in, p_check_out, p_associated_client_id) AS pricing;

  INSERT INTO public.reservations (
    room_id, associated_client_id, client_name, client_dni, client_phone,
    status, check_in_target, actual_check_in, check_out_target,
    base_total_price, discount_percent, discount_amount, total_price,
    guest_count, updated_at
  )
  VALUES (
    p_room_id, p_associated_client_id, v_client_name, v_client_dni, v_client_phone,
    v_status, p_check_in,
    CASE WHEN v_status = 'checked_in' THEN v_now ELSE NULL END,
    p_check_out,
    v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price,
    v_guest_count, v_now
  )
  RETURNING id INTO v_reservation_id;

  IF v_status = 'checked_in' THEN
    UPDATE public.rooms SET status = 'occupied' WHERE id = p_room_id;
  END IF;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

-- =========================================================================
-- 2) rpc_confirm_reservation: valida no-overlap al confirmar
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_confirm_reservation(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_reservation RECORD;
  v_conflicts int;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.id, r.room_id, r.client_name, r.client_phone, r.client_dni,
         r.status, r.check_in_target, r.check_out_target, r.total_price,
         ro.room_type, ro.room_number
  INTO v_reservation
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF v_reservation.id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_reservation.status <> 'pending' THEN
    RAISE EXCEPTION 'Solo se pueden confirmar reservas en estado pendiente.' USING errcode = '22023';
  END IF;

  -- Chequeo explícito de overlap con otras reservas activas en la misma habitación
  SELECT COUNT(*)
  INTO v_conflicts
  FROM public.reservations other
  WHERE other.id <> p_reservation_id
    AND other.room_id = v_reservation.room_id
    AND other.status IN ('confirmed', 'checked_in', 'pending')
    AND tstzrange(other.check_in_target, other.check_out_target, '[)')
        && tstzrange(v_reservation.check_in_target, v_reservation.check_out_target, '[)');

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'No se puede confirmar: la habitacion ya tiene otra reserva en esas fechas.' USING errcode = '23P01';
  END IF;

  UPDATE public.reservations
  SET status = 'confirmed', updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', v_reservation.id,
    'room_id', v_reservation.room_id,
    'client_name', v_reservation.client_name,
    'client_phone', v_reservation.client_phone,
    'client_dni', v_reservation.client_dni,
    'room_type', v_reservation.room_type,
    'room_number', v_reservation.room_number,
    'check_in_target', v_reservation.check_in_target,
    'check_out_target', v_reservation.check_out_target,
    'total_price', v_reservation.total_price,
    'status', 'confirmed'
  );
END;
$$;

-- =========================================================================
-- 3) Tabla admin_alerts + RLS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL, -- 'cleaning_without_checkout', etc.
  message TEXT NOT NULL,
  related_room_id INT REFERENCES public.rooms(id) ON DELETE SET NULL,
  related_cleaning_log_id BIGINT REFERENCES public.room_cleaning_log(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_notes TEXT
);

CREATE INDEX IF NOT EXISTS admin_alerts_unresolved_idx
  ON public.admin_alerts(created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin read admin_alerts" ON public.admin_alerts;
CREATE POLICY "Admin read admin_alerts"
  ON public.admin_alerts FOR SELECT TO authenticated
  USING (public.app_is_admin());

-- Los inserts los hace rpc_mark_room_clean (SECURITY DEFINER); no hace falta policy.

-- =========================================================================
-- 4) rpc_mark_room_clean: acepta también rooms 'available' y genera alerta
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_mark_room_clean(
  p_room_id INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_current_status public.room_status;
  v_cleaner_name TEXT;
  v_room_number TEXT;
  v_cleaning_log_id BIGINT;
  v_alert_generated BOOLEAN := FALSE;
BEGIN
  IF NOT (public.app_is_admin() OR public.app_is_maintenance()) THEN
    RAISE EXCEPTION 'Solo admin o mantenimiento pueden marcar una habitacion como limpia.' USING errcode = '42501';
  END IF;

  SELECT r.status, r.room_number
  INTO v_current_status, v_room_number
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;

  -- Sólo rechazamos estados inesperados. `available`, `cleaning`, `maintenance`
  -- son todos válidos. `occupied` sí se rechaza (hay un huésped adentro).
  IF v_current_status = 'occupied' THEN
    RAISE EXCEPTION 'No se puede marcar una habitacion ocupada como limpia.' USING errcode = '22023';
  END IF;

  SELECT full_name INTO v_cleaner_name
  FROM public.profiles WHERE id = v_user_id;

  INSERT INTO public.room_cleaning_log (room_id, cleaned_by, cleaner_name, previous_status, notes)
  VALUES (p_room_id, v_user_id, v_cleaner_name, v_current_status::text, NULLIF(BTRIM(p_notes), ''))
  RETURNING id INTO v_cleaning_log_id;

  -- Si la habitación ya estaba `available` (no había check-out previo),
  -- generamos una alerta de auditoría: el recepcionista podría no haber
  -- hecho el check-in/out en sistema (posible fraude o error de proceso).
  IF v_current_status = 'available' THEN
    INSERT INTO public.admin_alerts (kind, message, related_room_id, related_cleaning_log_id)
    VALUES (
      'cleaning_without_checkout',
      format('Se limpio la Hab. %s sin que haya tenido check-out previo. Cleaner: %s.',
             v_room_number, COALESCE(v_cleaner_name, 'desconocido')),
      p_room_id,
      v_cleaning_log_id
    );
    v_alert_generated := TRUE;
  END IF;

  UPDATE public.rooms SET status = 'available' WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'room_id', p_room_id,
    'cleaned_by', v_user_id,
    'previous_status', v_current_status,
    'new_status', 'available',
    'alert_generated', v_alert_generated,
    'cleaning_log_id', v_cleaning_log_id
  );
END;
$$;

-- =========================================================================
-- 5) RPCs para listar y resolver alertas (admin)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_list_admin_alerts(p_only_unresolved BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  id BIGINT,
  kind TEXT,
  message TEXT,
  related_room_id INT,
  related_room_number TEXT,
  related_cleaning_log_id BIGINT,
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
         a.related_cleaning_log_id, a.created_at, a.resolved_at,
         a.resolved_by, a.resolved_notes
  FROM public.admin_alerts a
  LEFT JOIN public.rooms r ON r.id = a.related_room_id
  WHERE (NOT p_only_unresolved) OR (a.resolved_at IS NULL)
  ORDER BY a.created_at DESC
  LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_resolve_admin_alert(
  p_alert_id BIGINT,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  UPDATE public.admin_alerts
  SET resolved_at = NOW(),
      resolved_by = auth.uid(),
      resolved_notes = NULLIF(BTRIM(p_notes), '')
  WHERE id = p_alert_id AND resolved_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_admin_alerts(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_resolve_admin_alert(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_admin_alerts(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_admin_alert(BIGINT, TEXT) TO authenticated;

COMMIT;
