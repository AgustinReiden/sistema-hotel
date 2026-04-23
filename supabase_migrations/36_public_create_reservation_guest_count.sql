-- Migration 36: Soporta guest_count también en el RPC público
--
-- El public booking también debe poder enviar la cantidad de pasajeros.
-- Hay dos sobrecargas de rpc_public_create_reservation — reemplazamos la de
-- 6 args (con phone + dni) porque es la que usa el código actual, y dropeamos
-- la de 4 args que queda inútil con la nueva firma.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_public_create_reservation(int, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_public_create_reservation(int, text, timestamptz, timestamptz, text, text);

CREATE OR REPLACE FUNCTION public.rpc_public_create_reservation(
  p_room_id int,
  p_client_name text,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_client_phone text DEFAULT NULL,
  p_client_dni text DEFAULT NULL,
  p_guest_count int DEFAULT 1
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
  v_client_name text := nullif(btrim(p_client_name), '');
  v_client_phone text := nullif(btrim(p_client_phone), '');
  v_client_dni text := nullif(btrim(p_client_dni), '');
  v_base_total_price numeric;
  v_discount_percent numeric;
  v_discount_amount numeric;
  v_final_total_price numeric;
  v_guest_count int := GREATEST(1, COALESCE(p_guest_count, 1));
BEGIN
  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  IF p_check_in <= v_now THEN
    RAISE EXCEPTION 'La reserva publica debe ser para el futuro.' USING errcode = '22023';
  END IF;

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
    p_check_in,
    p_check_out,
    NULL
  ) AS pricing;

  INSERT INTO public.reservations (
    room_id,
    client_name,
    client_phone,
    client_dni,
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
    v_client_name,
    v_client_phone,
    v_client_dni,
    v_status,
    p_check_in,
    NULL,
    p_check_out,
    v_base_total_price,
    v_discount_percent,
    v_discount_amount,
    v_final_total_price,
    v_guest_count,
    v_now
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_public_create_reservation(int, text, timestamptz, timestamptz, text, text, int) TO anon, authenticated;

COMMIT;
