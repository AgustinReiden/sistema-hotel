-- Migration 67: categorías de limpieza (check-in diario / check-out / vacía / anomalía),
-- resultado "sin llave", y export fiscal de check-outs por turno.
--
-- Problema: hoy la limpieza post-checkout y la diaria de una ocupada se guardan igual
-- (cleaning_type = NULL), así que el admin no las distingue y, al limpiar todos los días
-- aunque haya huésped, saltan falsas alertas de "ocupada sin reserva". Además no hay forma
-- de registrar "no se pudo limpiar (sin llave)".
--
-- Solución:
--  1) room_cleaning_log gana cleaning_category (fuente de verdad) + outcome.
--  2) rpc_mark_room_clean auto-clasifica por contexto (no por el dropdown) y solo alerta
--     en la anomalía real (ocupada sin reserva activa ni estadía de la noche anterior).
--  3) rpc_mark_room_no_key registra "sin llave" (resuelto por hoy, no toca el status).
--  4) rpc_list_maintenance_rooms usa cleaning_category='checkin_daily' para "resuelto hoy"
--     y expone el resultado del día (para ver el "sin llave").
--  5) rpc_shift_checkout_export alimenta el CSV fiscal (1 fila por check-out del turno).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Esquema: cleaning_category + outcome + backfill + constraints + índice
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.room_cleaning_log
  ADD COLUMN IF NOT EXISTS cleaning_category TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'cleaned';

-- Backfill histórico por heurística (CASE total, no deja NULLs). El orden importa:
-- 'cleaning' → checkout; 'maintenance' → empty_maintenance; tipo ocupada explícito →
-- occupied_anomaly; 'occupied' → checkin_daily; type NULL restante → checkin_daily (overnight);
-- resto (limpia_vacia/limpia_repaso/limpieza_mantenimiento sobre vacía) → empty_maintenance.
UPDATE public.room_cleaning_log
SET cleaning_category = CASE
  WHEN previous_status = 'cleaning'                               THEN 'checkout'
  WHEN previous_status = 'maintenance'                            THEN 'empty_maintenance'
  WHEN cleaning_type IN ('habitacion_ocupada', 'limpia_ocupada')  THEN 'occupied_anomaly'
  WHEN previous_status = 'occupied'                               THEN 'checkin_daily'
  WHEN cleaning_type IS NULL                                      THEN 'checkin_daily'
  ELSE 'empty_maintenance'
END
WHERE cleaning_category IS NULL;

ALTER TABLE public.room_cleaning_log
  DROP CONSTRAINT IF EXISTS room_cleaning_log_category_check;
ALTER TABLE public.room_cleaning_log
  ADD CONSTRAINT room_cleaning_log_category_check
  CHECK (
    cleaning_category IS NULL
    OR cleaning_category IN ('checkout', 'checkin_daily', 'empty_maintenance', 'occupied_anomaly')
  );

ALTER TABLE public.room_cleaning_log
  DROP CONSTRAINT IF EXISTS room_cleaning_log_outcome_check;
ALTER TABLE public.room_cleaning_log
  ADD CONSTRAINT room_cleaning_log_outcome_check
  CHECK (outcome IN ('cleaned', 'not_cleaned_no_key'));

-- Índice para "resuelto hoy" (limpieza diaria de ocupadas, cualquier outcome).
CREATE INDEX IF NOT EXISTS room_cleaning_log_checkin_daily_idx
  ON public.room_cleaning_log(room_id, cleaned_at DESC)
  WHERE cleaning_category = 'checkin_daily';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) rpc_mark_room_clean: auto-clasifica por contexto; alerta solo en anomalía real
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mark_room_clean(
  p_room_id INT,
  p_notes TEXT DEFAULT NULL,
  p_cleaning_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_current_status public.room_status;
  v_cleaner_name TEXT;
  v_room_number TEXT;
  v_cleaning_log_id BIGINT;
  v_alert_generated BOOLEAN := FALSE;
  v_has_active_reservation BOOLEAN := FALSE;
  v_tz TEXT := 'America/Argentina/Tucuman';
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
  v_expected_cleaned_today BOOLEAN := FALSE;
  v_had_real_stay_at_cut BOOLEAN := FALSE;
  v_requires_cleaning BOOLEAN := FALSE;
  v_input_cleaning_type TEXT := NULLIF(BTRIM(p_cleaning_type), '');
  v_effective_cleaning_type TEXT := NULL;
  v_category TEXT;
BEGIN
  IF NOT (public.app_is_admin() OR public.app_is_maintenance()) THEN
    RAISE EXCEPTION 'Solo admin o mantenimiento pueden marcar una habitacion como limpia.' USING errcode = '42501';
  END IF;

  SELECT COALESCE(timezone, 'America/Argentina/Tucuman')
  INTO v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_day_start := (((v_now AT TIME ZONE v_tz)::date) AT TIME ZONE v_tz);
  v_day_end := ((((v_now AT TIME ZONE v_tz)::date + 1) AT TIME ZONE v_tz));

  SELECT r.status, r.room_number
  INTO v_current_status, v_room_number
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_input_cleaning_type IS NOT NULL
     AND v_input_cleaning_type NOT IN (
       'habitacion_ocupada',
       'limpieza_mantenimiento',
       'limpia_ocupada',
       'limpia_vacia',
       'limpia_repaso'
     ) THEN
    RAISE EXCEPTION 'Tipo de limpieza invalido.' USING errcode = '22023';
  END IF;

  -- ¿Ya se resolvió hoy la limpieza diaria de esta habitación?
  SELECT EXISTS (
    SELECT 1
    FROM public.room_cleaning_log l
    WHERE l.room_id = p_room_id
      AND l.cleaned_at >= v_day_start
      AND l.cleaned_at < v_day_end
      AND l.cleaning_category = 'checkin_daily'
  )
  INTO v_expected_cleaned_today;

  -- ¿Tuvo una estadía real la noche anterior (overnight)?
  SELECT EXISTS (
    SELECT 1
    FROM public.reservations res
    WHERE res.room_id = p_room_id
      AND res.status IN ('checked_in', 'checked_out')
      AND res.actual_check_in IS NOT NULL
      AND res.actual_check_in < v_day_start
      AND COALESCE(res.actual_check_out, 'infinity'::timestamptz) > v_day_start
  )
  INTO v_had_real_stay_at_cut;

  -- ¿Hay una reserva activa AHORA (ocupada de verdad)?
  SELECT EXISTS (
    SELECT 1
    FROM public.reservations res
    WHERE res.room_id = p_room_id
      AND res.status = 'checked_in'
      AND COALESCE(res.actual_check_in, res.check_in_target) <= v_now
      AND COALESCE(res.actual_check_out, 'infinity'::timestamptz) > v_now
  )
  INTO v_has_active_reservation;

  v_requires_cleaning :=
    v_current_status IN ('cleaning', 'maintenance')
    OR (v_had_real_stay_at_cut AND NOT v_expected_cleaned_today);

  -- Solo exigimos elegir tipo cuando la habitación está genuinamente vacía (sin estadía
  -- activa ni overnight) y no es una pendiente. Las ocupadas se clasifican solas (checkin_daily).
  IF NOT v_requires_cleaning
     AND NOT (v_had_real_stay_at_cut OR v_has_active_reservation)
     AND v_input_cleaning_type IS NULL THEN
    RAISE EXCEPTION 'Debe indicar el tipo de limpieza.' USING errcode = '22023';
  END IF;

  -- Clasificación por contexto (no por el dropdown).
  v_category := CASE
    WHEN v_current_status = 'cleaning'                        THEN 'checkout'
    WHEN v_current_status = 'maintenance'                     THEN 'empty_maintenance'
    WHEN v_had_real_stay_at_cut OR v_has_active_reservation   THEN 'checkin_daily'
    WHEN v_input_cleaning_type IN ('habitacion_ocupada', 'limpia_ocupada') THEN 'occupied_anomaly'
    ELSE 'empty_maintenance'
  END;

  -- cleaning_type se conserva por compatibilidad de lecturas históricas.
  IF v_requires_cleaning THEN
    v_effective_cleaning_type := NULL;
  ELSE
    v_effective_cleaning_type := v_input_cleaning_type;
  END IF;

  SELECT full_name
  INTO v_cleaner_name
  FROM public.profiles
  WHERE id = v_user_id;

  INSERT INTO public.room_cleaning_log (
    room_id,
    cleaned_by,
    cleaner_name,
    previous_status,
    notes,
    cleaning_type,
    cleaning_category,
    outcome
  )
  VALUES (
    p_room_id,
    v_user_id,
    v_cleaner_name,
    v_current_status::text,
    NULLIF(BTRIM(p_notes), ''),
    v_effective_cleaning_type,
    v_category,
    'cleaned'
  )
  RETURNING id INTO v_cleaning_log_id;

  -- Alerta SOLO en la anomalía real: se limpió una ocupada sin reserva activa ni overnight.
  IF v_category = 'occupied_anomaly' THEN
    INSERT INTO public.admin_alerts (
      kind,
      message,
      related_room_id,
      related_cleaning_log_id
    )
    VALUES (
      'room_occupied_without_active_reservation',
      format(
        'Se registro "Habitacion estaba ocupada" en la Hab. %s sin reserva activa que lo justifique. Limpio: %s.',
        v_room_number,
        COALESCE(v_cleaner_name, 'desconocido')
      ),
      p_room_id,
      v_cleaning_log_id
    );
    v_alert_generated := TRUE;
  END IF;

  IF v_current_status IN ('cleaning', 'maintenance') THEN
    UPDATE public.rooms
    SET status = 'available'
    WHERE id = p_room_id;
  END IF;

  RETURN jsonb_build_object(
    'room_id', p_room_id,
    'cleaned_by', v_user_id,
    'previous_status', v_current_status,
    'new_status', CASE
      WHEN v_current_status IN ('cleaning', 'maintenance') THEN 'available'
      ELSE v_current_status::text
    END,
    'requires_cleaning', v_requires_cleaning,
    'cleaning_type', v_effective_cleaning_type,
    'cleaning_category', v_category,
    'outcome', 'cleaned',
    'alert_generated', v_alert_generated,
    'cleaning_log_id', v_cleaning_log_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mark_room_clean(INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_mark_room_clean(INT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_mark_room_no_key: "no se pudo limpiar (sin llave)" → resuelto por hoy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mark_room_no_key(
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
  v_now TIMESTAMPTZ := NOW();
  v_current_status public.room_status;
  v_cleaner_name TEXT;
  v_room_number TEXT;
  v_cleaning_log_id BIGINT;
  v_tz TEXT := 'America/Argentina/Tucuman';
  v_day_start TIMESTAMPTZ;
  v_had_real_stay_at_cut BOOLEAN := FALSE;
  v_has_active_reservation BOOLEAN := FALSE;
BEGIN
  IF NOT (public.app_is_admin() OR public.app_is_maintenance()) THEN
    RAISE EXCEPTION 'Solo admin o mantenimiento pueden registrar la limpieza.' USING errcode = '42501';
  END IF;

  SELECT COALESCE(timezone, 'America/Argentina/Tucuman')
  INTO v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_day_start := (((v_now AT TIME ZONE v_tz)::date) AT TIME ZONE v_tz);

  SELECT r.status, r.room_number
  INTO v_current_status, v_room_number
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.reservations res
    WHERE res.room_id = p_room_id
      AND res.status IN ('checked_in', 'checked_out')
      AND res.actual_check_in IS NOT NULL
      AND res.actual_check_in < v_day_start
      AND COALESCE(res.actual_check_out, 'infinity'::timestamptz) > v_day_start
  )
  INTO v_had_real_stay_at_cut;

  SELECT EXISTS (
    SELECT 1
    FROM public.reservations res
    WHERE res.room_id = p_room_id
      AND res.status = 'checked_in'
      AND COALESCE(res.actual_check_in, res.check_in_target) <= v_now
      AND COALESCE(res.actual_check_out, 'infinity'::timestamptz) > v_now
  )
  INTO v_has_active_reservation;

  -- "Sin llave" solo aplica a la limpieza diaria de una habitación ocupada.
  IF NOT (v_had_real_stay_at_cut OR v_has_active_reservation) THEN
    RAISE EXCEPTION 'Solo aplica a habitaciones ocupadas: no hay estadia activa.' USING errcode = '22023';
  END IF;

  SELECT full_name
  INTO v_cleaner_name
  FROM public.profiles
  WHERE id = v_user_id;

  INSERT INTO public.room_cleaning_log (
    room_id,
    cleaned_by,
    cleaner_name,
    previous_status,
    notes,
    cleaning_type,
    cleaning_category,
    outcome
  )
  VALUES (
    p_room_id,
    v_user_id,
    v_cleaner_name,
    v_current_status::text,
    NULLIF(BTRIM(p_notes), ''),
    NULL,
    'checkin_daily',
    'not_cleaned_no_key'
  )
  RETURNING id INTO v_cleaning_log_id;

  RETURN jsonb_build_object(
    'room_id', p_room_id,
    'cleaning_category', 'checkin_daily',
    'outcome', 'not_cleaned_no_key',
    'cleaning_log_id', v_cleaning_log_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mark_room_no_key(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_mark_room_no_key(INT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_list_maintenance_rooms: "resuelto hoy" = checkin_daily; expone daily_outcome/notes
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_list_maintenance_rooms();

CREATE OR REPLACE FUNCTION public.rpc_list_maintenance_rooms()
RETURNS TABLE (
  id INT,
  category_id INT,
  room_number TEXT,
  room_type TEXT,
  status public.room_status,
  capacity INT,
  capacity_adults INT,
  capacity_children INT,
  beds_configuration TEXT,
  amenities JSONB,
  description TEXT,
  image_url TEXT,
  base_price NUMERIC,
  half_day_price NUMERIC,
  is_active BOOLEAN,
  requires_cleaning BOOLEAN,
  cleaning_required_reason TEXT,
  cleaned_today BOOLEAN,
  daily_outcome TEXT,
  daily_notes TEXT,
  active_client TEXT,
  active_check_out_target TIMESTAMPTZ,
  active_late_check_out_until TIMESTAMPTZ,
  last_checkout_client TEXT,
  last_checkout_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_tz TEXT := 'America/Argentina/Tucuman';
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
BEGIN
  IF NOT (public.app_is_admin() OR public.app_is_maintenance()) THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT COALESCE(timezone, 'America/Argentina/Tucuman')
  INTO v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_day_start := (((v_now AT TIME ZONE v_tz)::date) AT TIME ZONE v_tz);
  v_day_end := ((((v_now AT TIME ZONE v_tz)::date + 1) AT TIME ZONE v_tz));

  RETURN QUERY
  SELECT
    ro.id,
    ro.category_id,
    ro.room_number,
    ro.room_type,
    ro.status,
    ro.capacity,
    ro.capacity_adults,
    ro.capacity_children,
    ro.beds_configuration,
    ro.amenities,
    ro.description,
    ro.image_url,
    ro.base_price,
    ro.half_day_price,
    ro.is_active,
    CASE
      WHEN ro.status IN ('cleaning', 'maintenance') THEN TRUE
      WHEN overnight_res.id IS NOT NULL AND NOT COALESCE(cleaned.expected_cleaned_today, FALSE) THEN TRUE
      ELSE FALSE
    END AS requires_cleaning,
    CASE
      WHEN ro.status = 'maintenance' THEN 'status_maintenance'
      WHEN ro.status = 'cleaning' THEN 'status_cleaning'
      WHEN overnight_res.id IS NOT NULL AND NOT COALESCE(cleaned.expected_cleaned_today, FALSE) THEN 'overnight_stay'
      ELSE NULL
    END AS cleaning_required_reason,
    COALESCE(cleaned.expected_cleaned_today, FALSE) AS cleaned_today,
    today_daily.outcome AS daily_outcome,
    today_daily.notes AS daily_notes,
    active_res.client_name AS active_client,
    active_res.check_out_target AS active_check_out_target,
    active_res.late_check_out_until AS active_late_check_out_until,
    last_checkout.client_name AS last_checkout_client,
    last_checkout.actual_check_out AS last_checkout_at
  FROM public.rooms ro
  LEFT JOIN LATERAL (
    SELECT TRUE AS expected_cleaned_today
    FROM public.room_cleaning_log l
    WHERE l.room_id = ro.id
      AND l.cleaned_at >= v_day_start
      AND l.cleaned_at < v_day_end
      AND l.cleaning_category = 'checkin_daily'
    LIMIT 1
  ) cleaned ON TRUE
  LEFT JOIN LATERAL (
    SELECT l.outcome, l.notes
    FROM public.room_cleaning_log l
    WHERE l.room_id = ro.id
      AND l.cleaned_at >= v_day_start
      AND l.cleaned_at < v_day_end
      AND l.cleaning_category = 'checkin_daily'
    ORDER BY l.cleaned_at DESC
    LIMIT 1
  ) today_daily ON TRUE
  LEFT JOIN LATERAL (
    SELECT res.id, res.client_name, res.check_out_target, res.late_check_out_until
    FROM public.reservations res
    WHERE res.room_id = ro.id
      AND res.status IN ('checked_in', 'checked_out')
      AND res.actual_check_in IS NOT NULL
      AND res.actual_check_in < v_day_start
      AND COALESCE(res.actual_check_out, 'infinity'::timestamptz) > v_day_start
    ORDER BY res.actual_check_in DESC
    LIMIT 1
  ) overnight_res ON TRUE
  LEFT JOIN LATERAL (
    SELECT res.client_name, res.check_out_target, res.late_check_out_until
    FROM public.reservations res
    WHERE res.room_id = ro.id
      AND res.status = 'checked_in'
    ORDER BY res.actual_check_in DESC NULLS LAST, res.check_in_target DESC
    LIMIT 1
  ) active_res ON TRUE
  LEFT JOIN LATERAL (
    SELECT res.client_name, res.actual_check_out
    FROM public.reservations res
    WHERE res.room_id = ro.id
      AND res.status = 'checked_out'
    ORDER BY res.actual_check_out DESC NULLS LAST
    LIMIT 1
  ) last_checkout ON TRUE
  WHERE ro.is_active = TRUE
  ORDER BY ro.room_number;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_maintenance_rooms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_maintenance_rooms() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) rpc_shift_checkout_export: 1 fila por check-out del turno (CSV fiscal)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_shift_checkout_export(UUID);

CREATE OR REPLACE FUNCTION public.rpc_shift_checkout_export(p_shift_id UUID)
RETURNS TABLE (
  actual_check_out TIMESTAMPTZ,
  client_name TEXT,
  client_dni TEXT,
  total_price NUMERIC,
  payment_method TEXT
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
    ) AS payment_method
  FROM public.reservations r
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
