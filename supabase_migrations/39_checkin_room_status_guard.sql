-- Migration 39: Guarda de estado de habitación en check-in y walk-in
--
-- Defensa en profundidad: el UI ya oculta el botón de check-in cuando la
-- habitación está en `cleaning` o `maintenance`, pero los RPCs no validaban
-- el estado de la habitación antes de marcarla como `occupied`. Un request
-- directo podría saltarse el lock. Esta migración cierra ese bypass.

BEGIN;

-- 1) rpc_staff_checkin_reservation: rechaza si la habitación no está 'available'
CREATE OR REPLACE FUNCTION public.rpc_staff_checkin_reservation(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_room_id int;
  v_status public.reservation_status;
  v_room_status public.room_status;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status
  INTO v_room_id, v_status
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Solo se puede hacer check-in de reservas pendientes o confirmadas.' USING errcode = '22023';
  END IF;

  SELECT status INTO v_room_status FROM public.rooms WHERE id = v_room_id;

  IF v_room_status = 'cleaning' THEN
    RAISE EXCEPTION 'La habitacion todavia no fue habilitada por mantenimiento.' USING errcode = '22023';
  END IF;
  IF v_room_status = 'maintenance' THEN
    RAISE EXCEPTION 'La habitacion esta fuera de servicio por mantenimiento.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_in',
      actual_check_in = v_now,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms
  SET status = 'occupied'
  WHERE id = v_room_id;
END;
$$;

-- 2) rpc_staff_assign_walk_in: rechaza si la habitación está en cleaning/maintenance
-- (Requiere reemplazar — hace el INSERT después de validar.)
CREATE OR REPLACE FUNCTION public.rpc_staff_assign_walk_in(
  p_room_id integer,
  p_client_name text DEFAULT NULL,
  p_nights integer DEFAULT NULL,
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
  v_guest_count integer := GREATEST(1, COALESCE(p_guest_count, 1));
  v_room_status public.room_status;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_nights IS NULL OR p_nights < 1 OR p_nights > 30 THEN
    RAISE EXCEPTION 'La cantidad de noches debe estar entre 1 y 30.' USING errcode = '22023';
  END IF;

  SELECT status INTO v_room_status FROM public.rooms WHERE id = p_room_id;
  IF v_room_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_room_status = 'cleaning' THEN
    RAISE EXCEPTION 'La habitacion todavia no fue habilitada por mantenimiento.' USING errcode = '22023';
  END IF;
  IF v_room_status = 'maintenance' THEN
    RAISE EXCEPTION 'La habitacion esta fuera de servicio por mantenimiento.' USING errcode = '22023';
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
    guest_count,
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
    v_guest_count,
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
