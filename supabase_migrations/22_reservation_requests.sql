-- Migration 22: Reservation Requests - Phone, DNI, WhatsApp notification & Confirm RPC

BEGIN;

-- 1. Agregar columnas de contacto a reservations
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS client_phone TEXT,
  ADD COLUMN IF NOT EXISTS client_dni TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_notified BOOLEAN DEFAULT false;

-- 2. Actualizar rpc_public_create_reservation para aceptar phone y dni
CREATE OR REPLACE FUNCTION public.rpc_public_create_reservation(
  p_room_id int,
  p_client_name text,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_client_phone text DEFAULT NULL,
  p_client_dni text DEFAULT NULL
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
    client_phone,
    client_dni,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    total_price,
    whatsapp_notified,
    updated_at
  )
  VALUES (
    p_room_id,
    v_client_name,
    nullif(btrim(p_client_phone), ''),
    nullif(btrim(p_client_dni), ''),
    v_status,
    p_check_in,
    null,
    p_check_out,
    v_total_price,
    false,
    v_now
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

-- Mantener permisos públicos
GRANT EXECUTE ON FUNCTION public.rpc_public_create_reservation(int, text, timestamptz, timestamptz, text, text) TO anon, authenticated;

-- 3. Crear RPC para confirmar reserva (staff)
CREATE OR REPLACE FUNCTION public.rpc_confirm_reservation(
  p_reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_reservation RECORD;
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

  UPDATE public.reservations
  SET status = 'confirmed',
      updated_at = v_now
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

REVOKE ALL ON FUNCTION public.rpc_confirm_reservation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_reservation(uuid) TO authenticated;

COMMIT;
