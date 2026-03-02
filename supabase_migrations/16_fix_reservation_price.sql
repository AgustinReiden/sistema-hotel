-- Migration 16: Fix Total Price Calculation on Reservations

BEGIN;

-- 1. Fix rpc_public_create_reservation
CREATE OR REPLACE FUNCTION public.rpc_public_create_reservation(
  p_room_id int,
  p_client_name text,
  p_check_in timestamptz,
  p_check_out timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_status public.reservation_status := 'pending';
  v_reservation_id uuid;
  v_client_name text;
  v_nights int;
  v_base_price numeric;
  v_total_price numeric;
BEGIN
  v_client_name := nullif(btrim(p_client_name), '');

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  IF p_check_in <= v_now THEN
    RAISE EXCEPTION 'La reserva pública debe ser para el futuro.' USING errcode = '22023';
  END IF;

  SELECT base_price INTO v_base_price FROM public.rooms WHERE id = p_room_id;
  v_nights := GREATEST(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400));
  v_total_price := v_nights * COALESCE(v_base_price, 0);

  INSERT INTO public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    total_price,
    updated_at
  )
  VALUES (
    p_room_id,
    v_client_name,
    v_status,
    p_check_in,
    null,
    p_check_out,
    v_total_price,
    v_now
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;


-- 2. Fix rpc_staff_create_reservation
CREATE OR REPLACE FUNCTION public.rpc_staff_create_reservation(
  p_room_id int,
  p_client_name text,
  p_check_in timestamptz,
  p_check_out timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_status public.reservation_status := 'pending';
  v_reservation_id uuid;
  v_client_name text;
  v_nights int;
  v_base_price numeric;
  v_total_price numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  v_client_name := nullif(btrim(p_client_name), '');

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  IF p_check_in <= v_now AND p_check_out > v_now THEN
    v_status := 'checked_in';
  END IF;

  SELECT base_price INTO v_base_price FROM public.rooms WHERE id = p_room_id;
  v_nights := GREATEST(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400));
  v_total_price := v_nights * COALESCE(v_base_price, 0);

  INSERT INTO public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    total_price,
    updated_at
  )
  VALUES (
    p_room_id,
    v_client_name,
    v_status,
    p_check_in,
    CASE WHEN v_status = 'checked_in' THEN v_now ELSE null END,
    p_check_out,
    v_total_price,
    v_now
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


-- 3. Fix rpc_staff_assign_walk_in
CREATE OR REPLACE FUNCTION public.rpc_staff_assign_walk_in(
  p_room_id int,
  p_client_name text,
  p_nights int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_checkout_time time := '10:00'::time;
  v_checkout_target timestamptz;
  v_reservation_id uuid;
  v_client_name text;
  v_base_price numeric;
  v_total_price numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  v_client_name := nullif(btrim(p_client_name), '');

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_nights IS NULL OR p_nights < 1 OR p_nights > 30 THEN
    RAISE EXCEPTION 'La cantidad de noches debe estar entre 1 y 30.' USING errcode = '22023';
  END IF;

  SELECT standard_check_out_time INTO v_checkout_time FROM public.hotel_settings ORDER BY id LIMIT 1;
  v_checkout_target := ((((v_now AT TIME ZONE 'UTC')::date + p_nights) + v_checkout_time) AT TIME ZONE 'UTC');

  SELECT base_price INTO v_base_price FROM public.rooms WHERE id = p_room_id;
  v_total_price := p_nights * COALESCE(v_base_price, 0);

  INSERT INTO public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    total_price,
    updated_at
  )
  VALUES (
    p_room_id,
    v_client_name,
    'checked_in',
    v_now,
    v_now,
    v_checkout_target,
    v_total_price,
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

-- 4. Update existing $0 reservations based on their rooms
UPDATE public.reservations r
SET total_price = GREATEST(1, ceil(extract(epoch from (check_out_target - check_in_target)) / 86400)) * (SELECT base_price FROM public.rooms ro WHERE ro.id = r.room_id)
WHERE total_price = 0;

COMMIT;
