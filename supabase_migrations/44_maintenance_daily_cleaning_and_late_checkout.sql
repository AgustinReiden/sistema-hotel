-- Migration 44: limpieza diaria por uso real + late checkout sin bloquear la noche

BEGIN;

ALTER TABLE public.room_cleaning_log
  ADD COLUMN IF NOT EXISTS cleaning_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'room_cleaning_log_cleaning_type_check'
  ) THEN
    ALTER TABLE public.room_cleaning_log
      ADD CONSTRAINT room_cleaning_log_cleaning_type_check
      CHECK (
        cleaning_type IS NULL
        OR cleaning_type IN ('limpia_ocupada', 'limpia_vacia', 'limpia_repaso')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS room_cleaning_log_expected_daily_idx
  ON public.room_cleaning_log(room_id, cleaned_at DESC)
  WHERE cleaning_type IS NULL;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS late_check_out_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS reservations_late_check_out_until_idx
  ON public.reservations(late_check_out_until)
  WHERE late_check_out_until IS NOT NULL;

DROP FUNCTION IF EXISTS public.rpc_mark_room_clean(INT, TEXT);
DROP FUNCTION IF EXISTS public.rpc_mark_room_clean(INT, TEXT, TEXT);

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
  v_tz TEXT := 'America/Argentina/Tucuman';
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
  v_expected_cleaned_today BOOLEAN := FALSE;
  v_had_real_stay_at_cut BOOLEAN := FALSE;
  v_requires_cleaning BOOLEAN := FALSE;
  v_input_cleaning_type TEXT := NULLIF(BTRIM(p_cleaning_type), '');
  v_effective_cleaning_type TEXT := NULL;
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
     AND v_input_cleaning_type NOT IN ('limpia_ocupada', 'limpia_vacia', 'limpia_repaso') THEN
    RAISE EXCEPTION 'Tipo de limpieza invalido.' USING errcode = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.room_cleaning_log l
    WHERE l.room_id = p_room_id
      AND l.cleaned_at >= v_day_start
      AND l.cleaned_at < v_day_end
      AND l.cleaning_type IS NULL
  )
  INTO v_expected_cleaned_today;

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

  v_requires_cleaning :=
    v_current_status IN ('cleaning', 'maintenance')
    OR (v_had_real_stay_at_cut AND NOT v_expected_cleaned_today);

  IF NOT v_requires_cleaning AND v_input_cleaning_type IS NULL THEN
    RAISE EXCEPTION 'Debe indicar el tipo de limpieza.' USING errcode = '22023';
  END IF;

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
    cleaning_type
  )
  VALUES (
    p_room_id,
    v_user_id,
    v_cleaner_name,
    v_current_status::text,
    NULLIF(BTRIM(p_notes), ''),
    v_effective_cleaning_type
  )
  RETURNING id INTO v_cleaning_log_id;

  IF NOT v_requires_cleaning
     AND v_effective_cleaning_type IN ('limpia_ocupada', 'limpia_vacia') THEN
    INSERT INTO public.admin_alerts (
      kind,
      message,
      related_room_id,
      related_cleaning_log_id
    )
    VALUES (
      'cleaning_without_active_reservation',
      format(
        'Se registro %s en la Hab. %s sin reserva real activa la noche anterior. Limpio: %s.',
        replace(v_effective_cleaning_type, '_', ' '),
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
    'alert_generated', v_alert_generated,
    'cleaning_log_id', v_cleaning_log_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mark_room_clean(INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_mark_room_clean(INT, TEXT, TEXT) TO authenticated;

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
    active_res.client_name AS active_client,
    active_res.check_out_target AS active_check_out_target,
    active_res.late_check_out_until AS active_late_check_out_until,
    last_checkout.client_name AS last_checkout_client,
    last_checkout.actual_check_out AS last_checkout_at
  FROM public.rooms ro
  LEFT JOIN LATERAL (
    SELECT l.id IS NOT NULL AS expected_cleaned_today
    FROM public.room_cleaning_log l
    WHERE l.room_id = ro.id
      AND l.cleaned_at >= v_day_start
      AND l.cleaned_at < v_day_end
      AND l.cleaning_type IS NULL
    ORDER BY l.cleaned_at DESC
    LIMIT 1
  ) cleaned ON TRUE
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

CREATE OR REPLACE FUNCTION public.rpc_staff_apply_late_checkout(
  p_reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_room_id int;
  v_status public.reservation_status;
  v_current_checkout timestamptz;
  v_late_until timestamptz;
  v_late_time time := '18:00'::time;
  v_half_day_price numeric(10, 2) := 0;
  v_inserted_rows int := 0;
  v_tz text := 'America/Argentina/Tucuman';
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.room_id, r.status, r.check_out_target, COALESCE(ro.half_day_price, 0)
  INTO v_room_id, v_status, v_current_checkout, v_half_day_price
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se puede aplicar medio dia sobre reservas checked_in.' USING errcode = '22023';
  END IF;

  SELECT late_check_out_time, COALESCE(timezone, 'America/Argentina/Tucuman')
  INTO v_late_time, v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_late_until := ((((v_current_checkout AT TIME ZONE v_tz)::date) + v_late_time) AT TIME ZONE v_tz);
  IF v_late_until < v_current_checkout THEN
    v_late_until := v_current_checkout;
  END IF;

  IF v_half_day_price > 0 THEN
    INSERT INTO public.extra_charges (
      reservation_id,
      charge_type,
      amount,
      description
    )
    VALUES (
      p_reservation_id,
      'half_day',
      v_half_day_price,
      'Penalizacion por Check-out tardio (Medio Dia)'
    )
    ON CONFLICT (reservation_id, charge_type)
    DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  END IF;

  UPDATE public.reservations
  SET late_check_out_until = v_late_until,
      total_price = CASE
        WHEN v_inserted_rows > 0 THEN total_price + v_half_day_price
        ELSE total_price
      END,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'check_out_target', v_current_checkout,
    'late_check_out_until', v_late_until,
    'half_day_amount', v_half_day_price,
    'half_day_charged', (v_inserted_rows > 0)
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'No se puede aplicar late check-out.' USING errcode = '23P01';
END;
$$;

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
  v_room_status public.room_status;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT status
  INTO v_room_status
  FROM public.rooms
  WHERE id = p_room_id;

  IF v_room_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
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

  IF p_check_out <= v_now THEN
    RAISE EXCEPTION 'No se puede crear una reserva cuyas fechas ya pasaron.' USING errcode = '22023';
  END IF;

  IF p_check_in <= v_now AND p_check_out > v_now AND v_room_status = 'available' THEN
    v_status := 'checked_in';
  END IF;

  SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
  INTO v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price
  FROM public.app_calculate_reservation_pricing(
    p_room_id,
    p_check_in,
    p_check_out,
    p_associated_client_id
  ) AS pricing;

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
    UPDATE public.rooms
    SET status = 'occupied'
    WHERE id = p_room_id;
  END IF;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_apply_late_checkout(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_apply_late_checkout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer) TO authenticated;

COMMIT;
