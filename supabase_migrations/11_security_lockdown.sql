-- Migration 11: Security Lockdown & RPC Separation (Fases 0 y 1)

BEGIN;

-- 1. Eliminar políticas inseguras antiguas (si aún existen)
DROP POLICY IF EXISTS "Auth read reservations" ON public.reservations;
DROP POLICY IF EXISTS "Auth insert reservations" ON public.reservations;
DROP POLICY IF EXISTS "Auth update reservations" ON public.reservations;

DROP POLICY IF EXISTS "Auth read extra_charges" ON public.extra_charges;
DROP POLICY IF EXISTS "Auth insert extra_charges" ON public.extra_charges;

DROP POLICY IF EXISTS "Auth read rooms" ON public.rooms;
DROP POLICY IF EXISTS "Auth update rooms" ON public.rooms;

DROP POLICY IF EXISTS "Auth read hotel_settings" ON public.hotel_settings;

DROP POLICY IF EXISTS "Staff can view all payments" ON public.payments;
DROP POLICY IF EXISTS "Staff can insert payments" ON public.payments;

-- 2. Asegurar que RLS esté activo en todas las tablas transaccionales
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extra_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_settings ENABLE ROW LEVEL SECURITY;

-- 3. Políticas para Rooms y Settings (Públicas para lectura, Staff para escritura)
-- Habitaciones: Anon/Auth pueden leer (necesario para landing page)
CREATE POLICY "Anyone can read available rooms" 
ON public.rooms FOR SELECT 
USING (true);

-- Settings: Anon/Auth pueden leer (necesario para landing page)
CREATE POLICY "Anyone can read hotel settings" 
ON public.hotel_settings FOR SELECT 
USING (true);

-- 4. Políticas para Payments (Solo Staff)
CREATE POLICY "Staff can select payments" 
ON public.payments FOR SELECT TO authenticated
USING (public.app_is_staff());

CREATE POLICY "Staff can insert payments" 
ON public.payments FOR INSERT TO authenticated
WITH CHECK (public.app_is_staff());

CREATE POLICY "Staff can update payments" 
ON public.payments FOR UPDATE TO authenticated
USING (public.app_is_staff())
WITH CHECK (public.app_is_staff());

-- 5. Revocar ejecución pública de las RPCs antiguas
REVOKE ALL ON FUNCTION public.rpc_create_reservation(int, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_assign_walk_in(int, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_checkout_reservation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_apply_late_checkout(uuid) FROM PUBLIC;

DROP FUNCTION IF EXISTS public.rpc_create_reservation(int, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_assign_walk_in(int, text, int);
DROP FUNCTION IF EXISTS public.rpc_checkout_reservation(uuid);
DROP FUNCTION IF EXISTS public.rpc_apply_late_checkout(uuid);

-- 6. Crear rpc_public_create_reservation (Pública)
CREATE OR REPLACE FUNCTION public.rpc_public_create_reservation(
  p_room_id int,
  p_client_name text,
  p_check_in timestamptz,
  p_check_out timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER -- Se ejecuta con permisos del creador para saltar RLS en lectura/escritura interna
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_status public.reservation_status := 'pending';
  v_reservation_id uuid;
  v_client_name text;
BEGIN
  v_client_name := nullif(btrim(p_client_name), '');

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  -- Para reservas públicas, no permitimos check-in en el pasado, siempre entran como pending
  IF p_check_in <= v_now THEN
    RAISE EXCEPTION 'La reserva pública debe ser para el futuro.' USING errcode = '22023';
  END IF;

  INSERT INTO public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    updated_at
  )
  VALUES (
    p_room_id,
    v_client_name,
    v_status,
    p_check_in,
    null,
    p_check_out,
    v_now
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

-- Permitir a anon y auth ejecutar la reserva pública
GRANT EXECUTE ON FUNCTION public.rpc_public_create_reservation TO anon, authenticated;


-- 7. Crear rpc_staff_create_reservation (Staff Only)
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

  INSERT INTO public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    updated_at
  )
  VALUES (
    p_room_id,
    v_client_name,
    v_status,
    p_check_in,
    CASE WHEN v_status = 'checked_in' THEN v_now ELSE null END,
    p_check_out,
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


-- 8. Crear rpc_staff_assign_walk_in
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

  SELECT standard_check_out_time
  INTO v_checkout_time
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_checkout_target := ((((v_now AT TIME ZONE 'UTC')::date + p_nights) + v_checkout_time) AT TIME ZONE 'UTC');

  INSERT INTO public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    updated_at
  )
  VALUES (
    p_room_id,
    v_client_name,
    'checked_in',
    v_now,
    v_now,
    v_checkout_target,
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


-- 9. Crear rpc_staff_checkout_reservation
CREATE OR REPLACE FUNCTION public.rpc_staff_checkout_reservation(
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

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_out',
      actual_check_out = v_now,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms
  SET status = 'cleaning'
  WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now
  );
END;
$$;


-- 10. Crear rpc_staff_apply_late_checkout
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

  SELECT late_check_out_time
  INTO v_late_time
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_new_checkout := ((((v_current_checkout AT TIME ZONE 'UTC')::date) + v_late_time) AT TIME ZONE 'UTC');
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

-- Otorgar permisos a staff
REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(int, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(int, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_staff_checkout_reservation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_staff_apply_late_checkout(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(int, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(int, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_checkout_reservation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_apply_late_checkout(uuid) TO authenticated;

COMMIT;
