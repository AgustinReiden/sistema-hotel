-- Migration 50: Media estadia (siesta 12-17) por walk-in + datos de pasajero
--
-- 1) Agrega el modo "media estadia" al check-in directo (walk-in): el huesped
--    ocupa la habitacion de 12:00 a 17:00 del dia y se cobra el precio de medio
--    dia (rooms.half_day_price), con el descuento del asociado si corresponde.
-- 2) Permite registrar el pasajero real (nombre + DNI) cuando la reserva va a
--    nombre de un asociado: se guarda en reservations.notes
--    ("Pasajero: <nombre> - DNI: <dni>").
--
-- Se re-crea rpc_staff_assign_walk_in (version vigente: migracion 39) con nuevos
-- parametros. Como cambia la firma, se elimina la version anterior (5 args).

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer);

CREATE OR REPLACE FUNCTION public.rpc_staff_assign_walk_in(
  p_room_id integer,
  p_client_name text DEFAULT NULL,
  p_nights integer DEFAULT NULL,
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT 1,
  p_half_day boolean DEFAULT false,
  p_guest_name text DEFAULT NULL,
  p_guest_dni text DEFAULT NULL
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
  v_checkin_target timestamptz;
  v_checkout_target timestamptz;
  v_reservation_id uuid;
  v_client_name text := nullif(btrim(p_client_name), '');
  v_client_dni text;
  v_client_phone text;
  v_associated_name text;
  v_associated_document text;
  v_associated_phone text;
  v_associated_discount numeric := 0;
  v_base_total_price numeric;
  v_discount_percent numeric;
  v_discount_amount numeric;
  v_final_total_price numeric;
  v_half_day_price numeric;
  v_guest_count integer := GREATEST(1, COALESCE(p_guest_count, 1));
  v_room_status public.room_status;
  v_guest_name text := nullif(btrim(p_guest_name), '');
  v_guest_dni text := nullif(btrim(p_guest_dni), '');
  v_notes text;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  -- Las noches solo aplican a la estadia normal (no a la media estadia/siesta).
  IF NOT p_half_day THEN
    IF p_nights IS NULL OR p_nights < 1 OR p_nights > 30 THEN
      RAISE EXCEPTION 'La cantidad de noches debe estar entre 1 y 30.' USING errcode = '22023';
    END IF;
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
      nullif(btrim(ac.phone), ''),
      ac.discount_percent
    INTO
      v_associated_name,
      v_associated_document,
      v_associated_phone,
      v_associated_discount
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

  -- Datos del pasajero real (cuando la reserva va a nombre de un asociado) -> notes.
  IF v_guest_name IS NOT NULL OR v_guest_dni IS NOT NULL THEN
    v_notes := 'Pasajero: ' || COALESCE(v_guest_name, '-') || ' - DNI: ' || COALESCE(v_guest_dni, '-');
  END IF;

  SELECT standard_check_out_time, COALESCE(timezone, 'UTC')
  INTO v_checkout_time, v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  IF p_half_day THEN
    -- Media estadia / siesta: 12:00 a 17:00 del dia, precio de medio dia.
    v_checkin_target := (((v_now AT TIME ZONE v_tz)::date + time '12:00') AT TIME ZONE v_tz);
    v_checkout_target := (((v_now AT TIME ZONE v_tz)::date + time '17:00') AT TIME ZONE v_tz);

    SELECT half_day_price INTO v_half_day_price FROM public.rooms WHERE id = p_room_id;
    IF v_half_day_price IS NULL OR v_half_day_price <= 0 THEN
      RAISE EXCEPTION 'La habitacion no tiene precio de media estadia (siesta) configurado.' USING errcode = '22023';
    END IF;

    v_base_total_price := v_half_day_price;
    v_discount_percent := COALESCE(v_associated_discount, 0);
    v_discount_amount := round(v_base_total_price * v_discount_percent / 100, 2);
    v_final_total_price := v_base_total_price - v_discount_amount;
  ELSE
    v_checkin_target := v_now;
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
      v_checkin_target,
      v_checkout_target,
      p_associated_client_id
    ) AS pricing;
  END IF;

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
    notes,
    updated_at
  )
  VALUES (
    p_room_id,
    p_associated_client_id,
    v_client_name,
    v_client_dni,
    v_client_phone,
    'checked_in',
    v_checkin_target,
    v_now,
    v_checkout_target,
    v_base_total_price,
    v_discount_percent,
    v_discount_amount,
    v_final_total_price,
    v_guest_count,
    v_notes,
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

REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer, boolean, text, text) TO authenticated;

COMMIT;
