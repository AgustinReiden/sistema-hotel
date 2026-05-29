-- Migración 49 — Hardening de seguridad/calidad (no crítico)

-- ── M4: quitar políticas RLS duplicadas de lectura pública (quedan las "Public read ...") ──
DROP POLICY IF EXISTS "Anyone can read hotel settings" ON public.hotel_settings;
DROP POLICY IF EXISTS "Anyone can read available rooms" ON public.rooms;

-- ── M3: default de moneda correcto (la fila real ya está en ARS) ──
ALTER TABLE public.hotel_settings ALTER COLUMN currency SET DEFAULT 'ARS';

-- ── M1: anti-abuso en la reserva pública ──
-- Tope de estadía (30 días) y anticipación (1 año) + chequeo de capacidad, para que un
-- anónimo no pueda bloquear el calendario con reservas 'pending' desmedidas.
-- El resto del cuerpo se reproduce tal cual la versión actual (precio calculado en
-- servidor, estado forzado a 'pending', anti-overlap por EXCLUDE).
CREATE OR REPLACE FUNCTION public.rpc_public_create_reservation(
  p_room_id integer,
  p_client_name text,
  p_check_in timestamp with time zone,
  p_check_out timestamp with time zone,
  p_client_phone text DEFAULT NULL::text,
  p_client_dni text DEFAULT NULL::text,
  p_guest_count integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_capacity int;
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

  IF p_check_out - p_check_in > interval '30 days' THEN
    RAISE EXCEPTION 'La estadia no puede superar los 30 dias.' USING errcode = '22023';
  END IF;

  IF p_check_in > v_now + interval '365 days' THEN
    RAISE EXCEPTION 'La reserva no puede ser con mas de un año de anticipacion.' USING errcode = '22023';
  END IF;

  SELECT capacity INTO v_capacity FROM public.rooms WHERE id = p_room_id;
  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'La habitacion no existe.' USING errcode = '22023';
  END IF;
  IF v_guest_count > v_capacity THEN
    RAISE EXCEPTION 'La cantidad de huespedes supera la capacidad de la habitacion.' USING errcode = '22023';
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
