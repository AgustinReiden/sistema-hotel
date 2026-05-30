-- Migration 51: Datos de pasajero en reservas a nombre de asociado
--
-- Permite registrar el pasajero real (nombre + DNI) al crear una reserva a nombre
-- de un asociado. Se guarda en reservations.notes ("Pasajero: <nombre> - DNI: <dni>").
-- Se re-crea rpc_staff_create_reservation (version vigente: migracion 44) con dos
-- parametros nuevos. Cambia la firma -> se elimina la version anterior (8 args).

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer);

CREATE OR REPLACE FUNCTION public.rpc_staff_create_reservation(
  p_room_id integer,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_client_name text DEFAULT NULL,
  p_client_dni text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT 1,
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
  v_guest_name text := nullif(btrim(p_guest_name), '');
  v_guest_dni text := nullif(btrim(p_guest_dni), '');
  v_notes text;
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

  -- Datos del pasajero real (cuando la reserva va a nombre de un asociado) -> notes.
  IF v_guest_name IS NOT NULL OR v_guest_dni IS NOT NULL THEN
    v_notes := 'Pasajero: ' || COALESCE(v_guest_name, '-') || ' - DNI: ' || COALESCE(v_guest_dni, '-');
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
    guest_count, notes, updated_at
  )
  VALUES (
    p_room_id, p_associated_client_id, v_client_name, v_client_dni, v_client_phone,
    v_status, p_check_in,
    CASE WHEN v_status = 'checked_in' THEN v_now ELSE NULL END,
    p_check_out,
    v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price,
    v_guest_count, v_notes, v_now
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

REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text) TO authenticated;

COMMIT;
