-- Migration 34: Cantidad de pasajeros por reserva
--
-- Agrega columna opcional guest_count en reservations (default 1) y la expone
-- en los RPCs de creación / walk-in / update.
-- No afecta el precio.

BEGIN;

-- 1) Columna
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS guest_count INT NOT NULL DEFAULT 1 CHECK (guest_count >= 1);

-- 2) rpc_staff_create_reservation: agrega p_guest_count
DROP FUNCTION IF EXISTS public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid);

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
  v_status public.reservation_status := 'pending';
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
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_associated_client_id IS NOT NULL THEN
    IF v_client_name IS NOT NULL OR v_client_dni IS NOT NULL OR v_client_phone IS NOT NULL THEN
      RAISE EXCEPTION 'No se deben enviar datos manuales al seleccionar un asociado.' USING errcode = '22023';
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
    IF v_client_dni IS NULL THEN
      RAISE EXCEPTION 'El DNI o CUIT es obligatorio.' USING errcode = '22023';
    END IF;
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  IF p_check_in <= v_now AND p_check_out > v_now THEN
    v_status := 'checked_in';
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
    v_status,
    p_check_in,
    CASE WHEN v_status = 'checked_in' THEN v_now ELSE null END,
    p_check_out,
    v_base_total_price,
    v_discount_percent,
    v_discount_amount,
    v_final_total_price,
    v_guest_count,
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

REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer) TO authenticated;

-- 3) rpc_staff_assign_walk_in: agrega p_guest_count
DROP FUNCTION IF EXISTS public.rpc_staff_assign_walk_in(integer, text, integer, uuid);

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

REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer) TO authenticated;

-- 4) rpc_update_reservation: agrega p_guest_count
DROP FUNCTION IF EXISTS public.rpc_update_reservation(uuid, text, text, text, timestamptz, timestamptz, text, numeric);

CREATE OR REPLACE FUNCTION public.rpc_update_reservation(
  p_reservation_id UUID,
  p_client_name TEXT,
  p_client_dni TEXT,
  p_client_phone TEXT,
  p_check_in TIMESTAMPTZ,
  p_check_out TIMESTAMPTZ,
  p_notes TEXT,
  p_override_total_price NUMERIC DEFAULT NULL,
  p_guest_count INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_room_id INT;
  v_status public.reservation_status;
  v_associated_id UUID;
  v_paid_amount NUMERIC;
  v_old_check_in TIMESTAMPTZ;
  v_old_check_out TIMESTAMPTZ;
  v_client_name TEXT := NULLIF(BTRIM(p_client_name), '');
  v_client_dni TEXT := NULLIF(BTRIM(p_client_dni), '');
  v_client_phone TEXT := NULLIF(BTRIM(p_client_phone), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_base_total NUMERIC;
  v_discount_percent NUMERIC;
  v_discount_amount NUMERIC;
  v_final_total NUMERIC;
  v_dates_changed BOOLEAN;
  v_is_admin BOOLEAN := public.app_is_admin();
  v_current_guest_count INTEGER;
  v_new_guest_count INTEGER;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Las fechas son obligatorias.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la de entrada.' USING errcode = '22023';
  END IF;

  SELECT room_id, status, associated_client_id, paid_amount, check_in_target, check_out_target, guest_count
  INTO v_room_id, v_status, v_associated_id, v_paid_amount, v_old_check_in, v_old_check_out, v_current_guest_count
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede editar una reserva finalizada o cancelada.' USING errcode = '22023';
  END IF;

  v_dates_changed := (p_check_in <> v_old_check_in) OR (p_check_out <> v_old_check_out);
  v_new_guest_count := COALESCE(p_guest_count, v_current_guest_count);
  IF v_new_guest_count < 1 THEN v_new_guest_count := 1; END IF;

  IF p_override_total_price IS NOT NULL THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Solo un admin puede sobreescribir el precio total.' USING errcode = '42501';
    END IF;
    IF p_override_total_price < 0 THEN
      RAISE EXCEPTION 'El precio total no puede ser negativo.' USING errcode = '22023';
    END IF;
    IF p_override_total_price < v_paid_amount THEN
      RAISE EXCEPTION 'El total no puede ser menor al monto ya pagado.' USING errcode = '22023';
    END IF;

    IF v_dates_changed THEN
      SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount
      INTO v_base_total, v_discount_percent, v_discount_amount
      FROM public.app_calculate_reservation_pricing(v_room_id, p_check_in, p_check_out, v_associated_id) AS pricing;
    ELSE
      SELECT base_total_price, discount_percent, discount_amount
      INTO v_base_total, v_discount_percent, v_discount_amount
      FROM public.reservations WHERE id = p_reservation_id;
    END IF;

    v_final_total := p_override_total_price;
  ELSIF v_dates_changed THEN
    SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
    INTO v_base_total, v_discount_percent, v_discount_amount, v_final_total
    FROM public.app_calculate_reservation_pricing(v_room_id, p_check_in, p_check_out, v_associated_id) AS pricing;

    IF v_final_total < v_paid_amount THEN
      RAISE EXCEPTION 'El nuevo total calculado es menor al monto ya pagado. Cancela y reemiti la reserva.' USING errcode = '22023';
    END IF;
  ELSE
    SELECT base_total_price, discount_percent, discount_amount, total_price
    INTO v_base_total, v_discount_percent, v_discount_amount, v_final_total
    FROM public.reservations WHERE id = p_reservation_id;
  END IF;

  UPDATE public.reservations
  SET client_name = v_client_name,
      client_dni = v_client_dni,
      client_phone = v_client_phone,
      notes = v_notes,
      check_in_target = p_check_in,
      check_out_target = p_check_out,
      base_total_price = v_base_total,
      discount_percent = v_discount_percent,
      discount_amount = v_discount_amount,
      total_price = v_final_total,
      guest_count = v_new_guest_count,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'dates_changed', v_dates_changed,
    'price_overridden', (p_override_total_price IS NOT NULL),
    'base_total_price', v_base_total,
    'discount_percent', v_discount_percent,
    'discount_amount', v_discount_amount,
    'total_price', v_final_total,
    'guest_count', v_new_guest_count
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Las nuevas fechas se solapan con otra reserva activa en esta habitacion.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_update_reservation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_update_reservation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC, INTEGER) TO authenticated;

COMMIT;
