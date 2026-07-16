-- Migration 71: Guard de cierre de turno ("bloqueo con salida") + fixes de auditoría
--
-- Origen: auditoría del gerente (Excel HOTEL-AGUS). El cierre de caja no validaba
-- nada operativo: se podía cerrar el turno con habitaciones vencidas sin check-out.
--
-- 1) Guard de cierre con salida: no se puede cerrar la caja si hay reservas
--    checked_in con la salida vencida (late_check_out_until ?? check_out_target < now).
--    Cada una se resuelve con: ampliar la reserva / hacer el check-out / reportar el
--    conflicto al admin (genera admin_alert y desbloquea). Sin bypass para admin.
-- 2) Nota obligatoria si el arqueo no cuadra (mensaje fijo, sin monto ni dirección:
--    preserva el arqueo a ciegas).
-- 3) Caja abierta obligatoria para TODO check-out (antes solo si había cobro):
--    un check-out sin caja grababa checkout_cash_shift_id = NULL y la pieza no se
--    rendía en ningún turno.
-- 4) Cancelar una reserva checked_in deja la habitación en 'cleaning' (antes
--    'available', salteando la limpieza — toda salida de huésped pasa por limpieza).
-- 5) rpc_shift_checkout_export suma la columna shift_number (nº de cierre correlativo
--    para el import en el sistema de gestión).
--
-- Reemplaza (preservando TODO lo demás — ver mig 66 por la regresión de la 64):
--   rpc_close_cash_shift (base mig 59), rpc_staff_checkout_reservation (base mig 66),
--   rpc_staff_early_checkout (base mig 65), rpc_cancel_reservation (base mig 33),
--   rpc_shift_checkout_export (base mig 67).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) admin_alerts: referencias a reserva y turno + kind nuevo
--    'shift_close_overdue_reservation'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS related_reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_shift_id UUID REFERENCES public.cash_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS admin_alerts_overdue_conflict_idx
  ON public.admin_alerts(related_reservation_id)
  WHERE kind = 'shift_close_overdue_reservation' AND resolved_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) app_shift_close_blockers(): única fuente de verdad del guard.
--    Reservas checked_in con la salida vencida y SIN conflicto reportado abierto.
--    Semántica de "resuelto": la alerta desbloquea mientras esté sin resolver
--    (resolved_at IS NULL). Si el admin la resuelve sin arreglar la reserva,
--    el próximo cierre vuelve a bloquear → nuevo reporte → escalamiento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_shift_close_blockers()
RETURNS TABLE (
  reservation_id UUID,
  room_id INT,
  room_number TEXT,
  client_name TEXT,
  check_out_target TIMESTAMPTZ,
  late_check_out_until TIMESTAMPTZ,
  effective_deadline TIMESTAMPTZ,
  hours_overdue NUMERIC,
  balance_due NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.room_id,
    ro.room_number,
    r.client_name,
    r.check_out_target,
    r.late_check_out_until,
    COALESCE(r.late_check_out_until, r.check_out_target) AS effective_deadline,
    ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(r.late_check_out_until, r.check_out_target))) / 3600.0, 1) AS hours_overdue,
    GREATEST(0, r.total_price - r.paid_amount) AS balance_due
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.status = 'checked_in'
    AND COALESCE(r.late_check_out_until, r.check_out_target) < NOW()
    AND NOT EXISTS (
      SELECT 1
      FROM public.admin_alerts a
      WHERE a.kind = 'shift_close_overdue_reservation'
        AND a.related_reservation_id = r.id
        AND a.resolved_at IS NULL
    )
  ORDER BY COALESCE(r.late_check_out_until, r.check_out_target) ASC;
$$;

REVOKE ALL ON FUNCTION public.app_shift_close_blockers() FROM PUBLIC;
-- Sin GRANT: solo la llaman otras funciones SECURITY DEFINER.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_close_shift_blockers(): payload para la UI del modal de cierre.
--    Tiene que ser RPC (la policy SELECT de admin_alerts es admin-only y el
--    recepcionista necesita ver los bloqueos y el aviso de limpieza).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_close_shift_blockers()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blockers JSONB;
  v_occupied_alerts INT;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'reservation_id', b.reservation_id,
    'room_id', b.room_id,
    'room_number', b.room_number,
    'client_name', b.client_name,
    'effective_deadline', b.effective_deadline,
    'hours_overdue', b.hours_overdue,
    'balance_due', b.balance_due
  )), '[]'::jsonb)
  INTO v_blockers
  FROM public.app_shift_close_blockers() b;

  SELECT COUNT(*)::int
  INTO v_occupied_alerts
  FROM public.admin_alerts a
  WHERE a.kind = 'room_occupied_without_active_reservation'
    AND a.resolved_at IS NULL;

  RETURN jsonb_build_object(
    'blockers', v_blockers,
    'occupied_alerts_count', v_occupied_alerts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_close_shift_blockers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_shift_blockers() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_report_shift_close_conflict(): salida "reportar al admin".
--    Staff (no admin-only): en el handover forzado el recepcionista que llega
--    tiene que poder reportar — es la válvula de escape que garantiza que el
--    cierre nunca se traba. Idempotente por reserva mientras haya alerta abierta.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_report_shift_close_conflict(
  p_reservation_id UUID,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_status public.reservation_status;
  v_room_id INT;
  v_room_number TEXT;
  v_client_name TEXT;
  v_deadline TIMESTAMPTZ;
  v_reporter TEXT;
  v_existing_id BIGINT;
  v_alert_id BIGINT;
  v_shift_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_notes IS NULL THEN
    RAISE EXCEPTION 'Explica el conflicto en la nota para reportarlo al administrador.' USING errcode = '22023';
  END IF;

  SELECT r.status, r.room_id, ro.room_number, r.client_name,
         COALESCE(r.late_check_out_until, r.check_out_target)
  INTO v_status, v_room_id, v_room_number, v_client_name, v_deadline
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' OR v_deadline >= NOW() THEN
    RAISE EXCEPTION 'La reserva no tiene la salida vencida; no hay conflicto que reportar.' USING errcode = '22023';
  END IF;

  -- Idempotencia: si ya hay un conflicto abierto para esta reserva, no duplicar.
  SELECT a.id INTO v_existing_id
  FROM public.admin_alerts a
  WHERE a.kind = 'shift_close_overdue_reservation'
    AND a.related_reservation_id = p_reservation_id
    AND a.resolved_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'alert_id', v_existing_id,
      'reservation_id', p_reservation_id,
      'already_reported', TRUE
    );
  END IF;

  SELECT p.full_name INTO v_reporter FROM public.profiles p WHERE p.id = v_user_id;
  v_shift_id := public.app_current_open_shift();

  INSERT INTO public.admin_alerts (
    kind, message, related_room_id, related_reservation_id, related_shift_id
  )
  VALUES (
    'shift_close_overdue_reservation',
    format(
      'Cierre de caja bloqueado: Hab. %s, huesped %s, salida vencida el %s. Reportado por %s. Nota: %s',
      v_room_number,
      COALESCE(v_client_name, 'sin nombre'),
      to_char(v_deadline, 'DD/MM/YYYY HH24:MI'),
      COALESCE(v_reporter, 'desconocido'),
      v_notes
    ),
    v_room_id,
    p_reservation_id,
    v_shift_id
  )
  RETURNING id INTO v_alert_id;

  RETURN jsonb_build_object(
    'alert_id', v_alert_id,
    'reservation_id', p_reservation_id,
    'already_reported', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_report_shift_close_conflict(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_report_shift_close_conflict(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) rpc_close_cash_shift: base mig 59 + guard de vencidas (P0011) + nota
--    obligatoria con diferencia (P0012). Sin bypass para admin: el control
--    muere si el rol que audita puede saltearlo (el admin puede cancelar la
--    reserva como cuarta salida).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_close_cash_shift(
  p_shift_id UUID,
  p_actual_cash NUMERIC,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_status TEXT;
  v_cash_income NUMERIC;
  v_expected NUMERIC;
  v_discrepancy NUMERIC;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'El efectivo contado debe ser cero o mayor.' USING errcode = '22023';
  END IF;

  SELECT status
  INTO v_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Turno no encontrado.' USING errcode = 'P0002';
  END IF;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'El turno ya esta cerrado.' USING errcode = '22023';
  END IF;

  -- Guard: reservas con la salida vencida sin resolver bloquean el cierre.
  IF EXISTS (SELECT 1 FROM public.app_shift_close_blockers()) THEN
    RAISE EXCEPTION 'No se puede cerrar la caja: hay habitaciones con la salida vencida sin resolver. Amplia la reserva, hace el check-out o reporta el conflicto al administrador.'
      USING errcode = 'P0011';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_cash_income
  FROM public.payments
  WHERE cash_shift_id = p_shift_id
    AND payment_method = 'cash';

  v_expected := v_cash_income;
  v_discrepancy := p_actual_cash - v_expected;

  -- Nota obligatoria si el arqueo no cuadra. Mensaje fijo, sin monto ni
  -- dirección: el recepcionista no debe poder inferir el efectivo esperado.
  IF v_discrepancy <> 0 AND NULLIF(BTRIM(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'El efectivo declarado no coincide con el esperado. Agrega una nota explicando la diferencia para poder cerrar la caja.'
      USING errcode = 'P0012';
  END IF;

  UPDATE public.cash_shifts
  SET status = 'closed',
      closed_at = NOW(),
      closed_by = v_user_id,
      expected_cash = v_expected,
      actual_cash = p_actual_cash,
      discrepancy = v_discrepancy,
      notes = NULLIF(BTRIM(p_notes), '')
  WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'shift_id', p_shift_id,
    'cash_income', v_cash_income,
    'expected_cash', v_expected,
    'actual_cash', p_actual_cash,
    'discrepancy', v_discrepancy
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_close_cash_shift(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_cash_shift(UUID, NUMERIC, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) rpc_staff_checkout_reservation: copia exacta de mig 66 + caja abierta
--    obligatoria para TODO check-out (la pieza debe rendirse en algún turno).
--    Se elimina el check redundante de la rama de cobro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_staff_checkout_reservation(
  p_reservation_id UUID,
  p_payment_amount NUMERIC DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_room_id INT;
  v_status public.reservation_status;
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_assoc UUID;
  v_guest UUID;
  v_payment_amount NUMERIC := p_payment_amount;
  v_payment_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_shift_id UUID;
  v_payment_id UUID;
  v_movement_id UUID;
  v_cc_enabled BOOLEAN;
  v_charge NUMERIC;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, total_price, paid_amount, associated_client_id, guest_id
  INTO v_room_id, v_status, v_total_price, v_paid_amount, v_assoc, v_guest
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  -- Caja abierta del hotel: imputa el cobro Y cuenta la pieza (check-out) del
  -- turno. Obligatoria SIEMPRE: sin caja la pieza quedaba huérfana
  -- (checkout_cash_shift_id = NULL) y no se rendía en ningún turno.
  v_shift_id := public.app_current_open_shift();

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Debes abrir la caja antes de hacer un check-out.' USING errcode = 'P0003';
  END IF;

  IF v_payment_method = 'cuenta_corriente' THEN
    -- Cargar el saldo pendiente a la cuenta del cliente facturable (empresa o huésped).
    IF v_assoc IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.associated_clients WHERE id = v_assoc;
    ELSIF v_guest IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.guests WHERE id = v_guest;
    ELSE
      RAISE EXCEPTION 'La reserva no tiene un cliente al que cargar la cuenta corriente.' USING errcode = '22023';
    END IF;

    IF NOT COALESCE(v_cc_enabled, false) THEN
      RAISE EXCEPTION 'Este cliente no tiene cuenta corriente habilitada.' USING errcode = '22023';
    END IF;

    v_charge := round(v_total_price - v_paid_amount, 2);
    IF v_charge > 0 THEN
      INSERT INTO public.cuenta_corriente_movimientos (
        associated_client_id, guest_id, tipo, amount, reservation_id, created_by, created_at
      )
      VALUES (v_assoc, v_guest, 'cargo', v_charge, p_reservation_id, v_user_id, v_now)
      RETURNING id INTO v_movement_id;
    END IF;

    -- La reserva queda saldada en sus libros; la deuda real vive en la cuenta corriente.
    -- No se inserta pago en `payments` ni se toca la caja.
    v_paid_amount := v_total_price;

  ELSIF v_payment_amount IS NOT NULL THEN
    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
    END IF;
    IF v_payment_method IS NULL THEN
      RAISE EXCEPTION 'Debe indicar un metodo de pago.' USING errcode = '22023';
    END IF;
    IF v_paid_amount + v_payment_amount <> v_total_price THEN
      RAISE EXCEPTION 'Solo se puede cobrar el saldo exacto pendiente para finalizar el check-out.' USING errcode = '22023';
    END IF;

    INSERT INTO public.payments (
      reservation_id, amount, payment_method, notes,
      created_at, created_by, cash_shift_id
    )
    VALUES (
      p_reservation_id, v_payment_amount, v_payment_method,
      NULLIF(BTRIM(p_payment_notes), ''), v_now, v_user_id, v_shift_id
    )
    RETURNING id INTO v_payment_id;

    v_paid_amount := v_paid_amount + v_payment_amount;
  END IF;

  IF v_paid_amount < v_total_price THEN
    RAISE EXCEPTION 'No se puede realizar el check-out con saldo pendiente.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_out',
      actual_check_out = v_now,
      paid_amount = v_paid_amount,
      checkout_cash_shift_id = v_shift_id,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms SET status = 'cleaning' WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now,
    'total_price', v_total_price,
    'paid_amount', v_paid_amount,
    'cash_shift_id', v_shift_id,
    'payment_id', v_payment_id,
    'movement_id', v_movement_id,
    'cuenta_corriente', (v_payment_method = 'cuenta_corriente')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_checkout_reservation(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_checkout_reservation(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) rpc_staff_early_checkout: copia exacta de mig 65 + caja abierta
--    obligatoria para todo check-out (mismo motivo que arriba).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_staff_early_checkout(
  p_reservation_id UUID,
  p_payment_amount NUMERIC DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_room_id INT;
  v_status public.reservation_status;
  v_check_in TIMESTAMPTZ;
  v_check_out TIMESTAMPTZ;
  v_base_total NUMERIC;
  v_discount_percent NUMERIC;
  v_discount_amount NUMERIC;
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_assoc UUID;
  v_guest UUID;
  v_tz TEXT;
  v_checkin_date DATE;
  v_checkout_date DATE;
  v_departure_date DATE;
  v_original_nights INT;
  v_charged_nights INT;
  v_per_night NUMERIC;
  v_extras NUMERIC;
  v_new_base NUMERIC;
  v_new_discount NUMERIC;
  v_new_total NUMERIC;
  v_new_check_out TIMESTAMPTZ;
  v_payment_amount NUMERIC := p_payment_amount;
  v_payment_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_shift_id UUID;
  v_payment_id UUID;
  v_movement_id UUID;
  v_cc_enabled BOOLEAN;
  v_charge NUMERIC;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, check_in_target, check_out_target,
         base_total_price, discount_percent, discount_amount, total_price, paid_amount,
         associated_client_id, guest_id
  INTO v_room_id, v_status, v_check_in, v_check_out,
       v_base_total, v_discount_percent, v_discount_amount, v_total_price, v_paid_amount,
       v_assoc, v_guest
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  -- Zona horaria del hotel para contar noches por fecha calendario.
  SELECT COALESCE(timezone, 'America/Argentina/Tucuman') INTO v_tz
  FROM public.hotel_settings LIMIT 1;
  IF v_tz IS NULL OR BTRIM(v_tz) = '' THEN
    v_tz := 'America/Argentina/Tucuman';
  END IF;

  v_checkin_date   := (v_check_in  AT TIME ZONE v_tz)::date;
  v_checkout_date  := (v_check_out AT TIME ZONE v_tz)::date;
  v_departure_date := (v_now       AT TIME ZONE v_tz)::date;

  v_original_nights := GREATEST(1, (v_checkout_date - v_checkin_date));
  v_charged_nights  := GREATEST(1, (v_departure_date - v_checkin_date));

  IF v_charged_nights >= v_original_nights THEN
    -- No se va antes: no hay reduccion, se cierra por el total actual.
    v_charged_nights := v_original_nights;
    v_new_base := v_base_total;
    v_new_discount := v_discount_amount;
    v_new_total := v_total_price;
    v_new_check_out := v_check_out;
  ELSE
    v_per_night := v_base_total / v_original_nights;                 -- tarifa base cotizada por noche
    v_extras := v_total_price - (v_base_total - v_discount_amount);  -- minibar, danos, media estadia
    v_new_base := round((v_per_night * v_charged_nights)::numeric, 2);
    v_new_discount := round((v_new_base * COALESCE(v_discount_percent, 0) / 100)::numeric, 2);
    v_new_total := round(((v_new_base - v_new_discount) + v_extras)::numeric, 2);
    v_new_check_out := (v_departure_date + (v_check_out AT TIME ZONE v_tz)::time) AT TIME ZONE v_tz;
    IF v_new_check_out <= v_check_in THEN
      v_new_check_out := v_check_in + INTERVAL '1 day';
    END IF;
  END IF;

  -- Sobrepago: v1 no hace reembolsos; lo cierra un admin.
  IF v_new_total < v_paid_amount THEN
    RAISE EXCEPTION 'El huesped pago mas de lo que corresponde por las noches usadas. Esta salida anticipada la tiene que cerrar un administrador.'
      USING errcode = '22023';
  END IF;

  -- Caja abierta del hotel (para el cobro y para contar la pieza rendida).
  -- Obligatoria SIEMPRE: sin caja la pieza no se rendía en ningún turno.
  v_shift_id := public.app_current_open_shift();

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Debes abrir la caja antes de hacer un check-out.' USING errcode = 'P0003';
  END IF;

  IF v_payment_method = 'cuenta_corriente' THEN
    -- Cargar el saldo (recalculado) a la cuenta del cliente facturable.
    IF v_assoc IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.associated_clients WHERE id = v_assoc;
    ELSIF v_guest IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.guests WHERE id = v_guest;
    ELSE
      RAISE EXCEPTION 'La reserva no tiene un cliente al que cargar la cuenta corriente.' USING errcode = '22023';
    END IF;

    IF NOT COALESCE(v_cc_enabled, false) THEN
      RAISE EXCEPTION 'Este cliente no tiene cuenta corriente habilitada.' USING errcode = '22023';
    END IF;

    v_charge := round(v_new_total - v_paid_amount, 2);
    IF v_charge > 0 THEN
      INSERT INTO public.cuenta_corriente_movimientos (
        associated_client_id, guest_id, tipo, amount, reservation_id, created_by, created_at
      )
      VALUES (v_assoc, v_guest, 'cargo', v_charge, p_reservation_id, v_user_id, v_now)
      RETURNING id INTO v_movement_id;
    END IF;

    v_paid_amount := v_new_total;

  ELSIF v_payment_amount IS NOT NULL THEN
    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
    END IF;
    IF v_payment_method IS NULL THEN
      RAISE EXCEPTION 'Debe indicar un metodo de pago.' USING errcode = '22023';
    END IF;
    IF v_paid_amount + v_payment_amount <> v_new_total THEN
      RAISE EXCEPTION 'Solo se puede cobrar el saldo exacto pendiente para finalizar el check-out.' USING errcode = '22023';
    END IF;

    INSERT INTO public.payments (
      reservation_id, amount, payment_method, notes,
      created_at, created_by, cash_shift_id
    )
    VALUES (
      p_reservation_id, v_payment_amount, v_payment_method,
      NULLIF(BTRIM(p_payment_notes), ''), v_now, v_user_id, v_shift_id
    )
    RETURNING id INTO v_payment_id;

    v_paid_amount := v_paid_amount + v_payment_amount;
  END IF;

  IF v_paid_amount < v_new_total THEN
    RAISE EXCEPTION 'No se puede realizar el check-out con saldo pendiente.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_out',
      actual_check_out = v_now,
      check_out_target = v_new_check_out,
      base_total_price = v_new_base,
      discount_amount = v_new_discount,
      total_price = v_new_total,
      paid_amount = v_paid_amount,
      checkout_cash_shift_id = v_shift_id,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms SET status = 'cleaning' WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now,
    'original_nights', v_original_nights,
    'charged_nights', v_charged_nights,
    'new_total_price', v_new_total,
    'paid_amount', v_paid_amount,
    'cash_shift_id', v_shift_id,
    'payment_id', v_payment_id,
    'movement_id', v_movement_id,
    'cuenta_corriente', (v_payment_method = 'cuenta_corriente')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_early_checkout(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_early_checkout(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) rpc_cancel_reservation: copia exacta de mig 33, con un cambio: cancelar
--    una checked_in deja la habitación en 'cleaning' (toda salida de huésped
--    pasa por limpieza; antes iba directo a 'available').
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_cancel_reservation(
  p_reservation_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_room_id int;
  v_room_number text;
  v_room_type text;
  v_client_name text;
  v_client_dni text;
  v_client_phone text;
  v_status public.reservation_status;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_total_price numeric;
  v_paid_amount numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'El motivo de cancelacion es obligatorio.' USING errcode = '22023';
  END IF;

  SELECT
    r.room_id,
    ro.room_number,
    ro.room_type,
    r.client_name,
    r.client_dni,
    r.client_phone,
    r.status,
    r.check_in_target,
    r.check_out_target,
    r.total_price,
    r.paid_amount
  INTO
    v_room_id,
    v_room_number,
    v_room_type,
    v_client_name,
    v_client_dni,
    v_client_phone,
    v_status,
    v_check_in,
    v_check_out,
    v_total_price,
    v_paid_amount
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'La reserva ya se encuentra cancelada.' USING errcode = '22023';
  END IF;

  INSERT INTO public.reservation_cancellations (
    reservation_id,
    room_id,
    room_number,
    room_type,
    client_name,
    client_dni,
    client_phone,
    check_in_target,
    check_out_target,
    total_price,
    paid_amount,
    previous_status,
    reason,
    cancelled_at,
    cancelled_by
  )
  VALUES (
    p_reservation_id,
    v_room_id,
    v_room_number,
    v_room_type,
    v_client_name,
    v_client_dni,
    v_client_phone,
    v_check_in,
    v_check_out,
    v_total_price,
    v_paid_amount,
    v_status,
    v_reason,
    v_now,
    v_user_id
  );

  -- Al cancelar una estadía en curso la habitación pasa a limpieza, como
  -- cualquier otra salida de huésped (antes quedaba 'available' sin limpiar).
  IF v_status = 'checked_in' THEN
    UPDATE public.rooms
    SET status = 'cleaning'
    WHERE id = v_room_id AND status = 'occupied';
  END IF;

  -- Ajuste contable: solo para reservas aún no cerradas.
  -- Si ya estaba checked_out, preservamos total_price y paid_amount intactos
  -- (caja histórica cerrada, no se re-toca).
  IF v_status <> 'checked_out' AND v_total_price > v_paid_amount THEN
    v_total_price := v_paid_amount;
    UPDATE public.reservations
    SET status = 'cancelled',
        total_price = v_total_price,
        updated_at = v_now
    WHERE id = p_reservation_id;
  ELSE
    UPDATE public.reservations
    SET status = 'cancelled',
        updated_at = v_now
    WHERE id = p_reservation_id;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'status', 'cancelled',
    'previous_status', v_status,
    'reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_cancel_reservation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_reservation(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) rpc_shift_checkout_export: copia de mig 67 + columna shift_number
--    (nº de cierre correlativo, para validar el import en el sistema de
--    gestión). Cambia el return type → DROP previo obligatorio.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_shift_checkout_export(UUID);

CREATE OR REPLACE FUNCTION public.rpc_shift_checkout_export(p_shift_id UUID)
RETURNS TABLE (
  actual_check_out TIMESTAMPTZ,
  client_name TEXT,
  client_dni TEXT,
  total_price NUMERIC,
  payment_method TEXT,
  shift_number INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.actual_check_out,
    r.client_name,
    r.client_dni,
    r.total_price,
    COALESCE(
      pay.payment_method,                                                    -- (a) pago del check-out en ESTE turno
      CASE WHEN cc.reservation_id IS NOT NULL THEN 'cuenta_corriente' END,   -- (b) cargo a cuenta corriente
      hist.payment_method,                                                   -- (c) prepaga: medio del último pago real
      'sin_cobro'
    ) AS payment_method,
    s.shift_number
  FROM public.reservations r
  JOIN public.cash_shifts s ON s.id = p_shift_id
  LEFT JOIN LATERAL (
    SELECT p.payment_method
    FROM public.payments p
    WHERE p.reservation_id = r.id
      AND p.cash_shift_id = p_shift_id
    ORDER BY p.created_at DESC
    LIMIT 1
  ) pay ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.reservation_id
    FROM public.cuenta_corriente_movimientos m
    WHERE m.reservation_id = r.id
      AND m.tipo = 'cargo'
    ORDER BY m.created_at DESC
    LIMIT 1
  ) cc ON TRUE
  LEFT JOIN LATERAL (
    SELECT p.payment_method
    FROM public.payments p
    WHERE p.reservation_id = r.id
    ORDER BY p.created_at DESC
    LIMIT 1
  ) hist ON TRUE
  WHERE r.checkout_cash_shift_id = p_shift_id
    AND r.status = 'checked_out'
  ORDER BY r.actual_check_out;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_shift_checkout_export(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_shift_checkout_export(UUID) TO authenticated;

COMMIT;
