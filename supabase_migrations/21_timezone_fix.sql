-- Migration 21: Fix timezone handling in RPCs
-- Problem: All RPCs use 'UTC' for date math, causing checkout/late-checkout
-- times to be 3 hours off for Argentina (UTC-3).
-- Solution: Add timezone column to hotel_settings and use it in all RPCs.

BEGIN;

-- 1. Add timezone column
ALTER TABLE public.hotel_settings
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Argentina/Tucuman';

-- 2. Fix rpc_public_create_reservation (no timezone math needed - dates come from client)
-- No changes needed: this RPC receives full timestamptz from the client.

-- 3. Fix rpc_staff_create_reservation (no timezone math needed - dates come from client)
-- No changes needed: this RPC receives full timestamptz from the client.

-- 4. Fix rpc_staff_assign_walk_in - uses timezone for checkout calculation
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
  v_tz text := 'America/Argentina/Tucuman';
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

  SELECT standard_check_out_time, timezone
  INTO v_checkout_time, v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  -- Use hotel timezone instead of UTC for date arithmetic
  v_checkout_target := ((((v_now AT TIME ZONE v_tz)::date + p_nights) + v_checkout_time) AT TIME ZONE v_tz);

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

-- 5. Fix rpc_staff_apply_late_checkout - uses timezone for late time calculation
CREATE OR REPLACE FUNCTION public.rpc_staff_apply_late_checkout(
  p_reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_room_id int;
  v_status public.reservation_status;
  v_current_checkout timestamptz;
  v_new_checkout timestamptz;
  v_late_time time := '18:00'::time;
  v_half_day_price numeric(10, 2) := 0;
  v_inserted_rows int := 0;
  v_tz text := 'America/Argentina/Tucuman';
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.room_id, r.status, r.check_out_target, coalesce(ro.half_day_price, 0)
  INTO v_room_id, v_status, v_current_checkout, v_half_day_price
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se puede aplicar medio dia sobre reservas checked_in.' USING errcode = '22023';
  END IF;

  SELECT late_check_out_time, timezone
  INTO v_late_time, v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  -- Use hotel timezone instead of UTC for date arithmetic
  v_new_checkout := ((((v_current_checkout AT TIME ZONE v_tz)::date) + v_late_time) AT TIME ZONE v_tz);
  IF v_new_checkout < v_current_checkout THEN
    v_new_checkout := v_current_checkout;
  END IF;

  UPDATE public.reservations
  SET check_out_target = v_new_checkout,
      updated_at = v_now
  WHERE id = p_reservation_id;

  IF v_half_day_price > 0 THEN
    INSERT INTO public.extra_charges (
      reservation_id,
      charge_type,
      amount,
      description
    )
    VALUES (
      p_reservation_id,
      'half_day',
      v_half_day_price,
      'Penalizacion por Check-out tardio (Medio Dia)'
    )
    ON CONFLICT (reservation_id, charge_type)
    DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'check_out_target', v_new_checkout,
    'half_day_amount', v_half_day_price,
    'half_day_charged', (v_inserted_rows > 0)
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'No se puede extender la reserva porque colisiona con otra reserva activa.' USING errcode = '23P01';
END;
$$;

COMMIT;
