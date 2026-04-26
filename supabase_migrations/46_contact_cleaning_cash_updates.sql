-- Migration 46: optional public contact fields + updated maintenance cleaning reasons.

BEGIN;

-- Contact fields can be hidden from the public landing by leaving them empty.
ALTER TABLE public.hotel_settings
  ALTER COLUMN contact_email DROP NOT NULL,
  ALTER COLUMN contact_email DROP DEFAULT,
  ALTER COLUMN contact_phone DROP NOT NULL,
  ALTER COLUMN contact_phone DROP DEFAULT,
  ALTER COLUMN address DROP NOT NULL,
  ALTER COLUMN address DROP DEFAULT;

UPDATE public.hotel_settings
SET
  contact_email = NULLIF(BTRIM(contact_email), ''),
  contact_phone = NULLIF(BTRIM(contact_phone), ''),
  contact_whatsapp_phone = NULLIF(BTRIM(contact_whatsapp_phone), ''),
  contact_fixed_phone = NULLIF(BTRIM(contact_fixed_phone), ''),
  contact_instagram = NULLIF(BTRIM(contact_instagram), ''),
  address = NULLIF(BTRIM(address), '');

-- Keep historical cleaning types valid, but allow the new active reasons.
ALTER TABLE public.room_cleaning_log
  DROP CONSTRAINT IF EXISTS room_cleaning_log_cleaning_type_check;

ALTER TABLE public.room_cleaning_log
  ADD CONSTRAINT room_cleaning_log_cleaning_type_check
  CHECK (
    cleaning_type IS NULL
    OR cleaning_type IN (
      'habitacion_ocupada',
      'limpieza_mantenimiento',
      'limpia_ocupada',
      'limpia_vacia',
      'limpia_repaso'
    )
  );

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
     AND v_effective_cleaning_type IN ('habitacion_ocupada', 'limpia_ocupada') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.reservations res
      WHERE res.room_id = p_room_id
        AND res.status = 'checked_in'
        AND COALESCE(res.actual_check_in, res.check_in_target) <= v_now
        AND COALESCE(res.actual_check_out, 'infinity'::timestamptz) > v_now
    )
    INTO v_has_active_reservation;

    IF NOT v_has_active_reservation THEN
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

COMMIT;
