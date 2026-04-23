-- Migration 31: Timezone hardening en RPCs que calculan fechas
--
-- rpc_staff_apply_late_checkout ya usa hotel_settings.timezone (migración previa).
-- rpc_staff_assign_walk_in todavía usa AT TIME ZONE 'UTC' para calcular la fecha
-- de checkout, lo que provoca desfase si el walk-in se hace cerca de medianoche
-- UTC (por ejemplo 21:05 local = 00:05 UTC del día siguiente).
--
-- Esta migración reemplaza esa función para leer hotel_settings.timezone y
-- hacer la aritmética de fechas en zona local.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_staff_assign_walk_in(
  p_room_id integer,
  p_client_name text DEFAULT NULL::text,
  p_nights integer DEFAULT NULL::integer,
  p_associated_client_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_checkout_time time := '10:00'::time;
  v_tz text := 'UTC';
  v_checkout_target timestamptz;
  v_reservation_id uuid;
  v_client_name text := nullif(btrim(p_client_name), '');
  v_client_dni text;
  v_client_phone text;
  v_associated_name text;
  v_associated_document text;
  v_associated_phone text;
  v_base_total_price numeric;
  v_discount_percent numeric;
  v_discount_amount numeric;
  v_final_total_price numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_nights IS NULL OR p_nights < 1 OR p_nights > 30 THEN
    RAISE EXCEPTION 'La cantidad de noches debe estar entre 1 y 30.' USING errcode = '22023';
  END IF;

  IF p_associated_client_id IS NOT NULL THEN
    IF v_client_name IS NOT NULL THEN
      RAISE EXCEPTION 'No se debe enviar nombre manual al seleccionar un asociado.' USING errcode = '22023';
    END IF;

    SELECT
      ac.display_name,
      ac.document_id,
      nullif(btrim(ac.phone), '')
    INTO
      v_associated_name,
      v_associated_document,
      v_associated_phone
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id
      AND ac.is_active = true;

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
  END IF;

  SELECT standard_check_out_time, COALESCE(timezone, 'UTC')
  INTO v_checkout_time, v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  -- Usamos la timezone del hotel para el aritmético de fechas.
  -- p.ej. walk-in un martes 21:05 (00:05 UTC miercoles) con 1 noche:
  --   (v_now AT TIME ZONE v_tz)::date = martes local
  --   + 1 noche = miercoles local
  --   + checkout_time (p.ej. 10:00) = miercoles 10:00 local
  v_checkout_target := ((((v_now AT TIME ZONE v_tz)::date + p_nights) + v_checkout_time) AT TIME ZONE v_tz);

  SELECT
    pricing.base_total_price,
    pricing.discount_percent,
    pricing.discount_amount,
    pricing.final_total_price
  INTO
    v_base_total_price,
    v_discount_percent,
    v_discount_amount,
    v_final_total_price
  FROM public.app_calculate_reservation_pricing(
    p_room_id,
    v_now,
    v_checkout_target,
    p_associated_client_id
  ) AS pricing;

  INSERT INTO public.reservations (
    room_id,
    associated_client_id,
    client_name,
    client_dni,
    client_phone,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    base_total_price,
    discount_percent,
    discount_amount,
    total_price,
    updated_at
  )
  VALUES (
    p_room_id,
    p_associated_client_id,
    v_client_name,
    v_client_dni,
    v_client_phone,
    'checked_in',
    v_now,
    v_now,
    v_checkout_target,
    v_base_total_price,
    v_discount_percent,
    v_discount_amount,
    v_final_total_price,
    v_now
  )
  RETURNING id INTO v_reservation_id;

  UPDATE public.rooms
  SET status = 'occupied'
  WHERE id = p_room_id;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

COMMIT;
