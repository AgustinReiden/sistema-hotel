BEGIN;

CREATE TABLE IF NOT EXISTS public.reservation_cancellations (
  id BIGSERIAL PRIMARY KEY,
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  room_id INT NOT NULL,
  room_number TEXT NOT NULL,
  room_type TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_dni TEXT,
  client_phone TEXT,
  check_in_target TIMESTAMPTZ NOT NULL,
  check_out_target TIMESTAMPTZ NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  previous_status public.reservation_status NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reservation_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read reservation cancellations" ON public.reservation_cancellations;
DROP POLICY IF EXISTS "Staff can insert reservation cancellations" ON public.reservation_cancellations;

CREATE POLICY "Staff can read reservation cancellations"
ON public.reservation_cancellations
FOR SELECT
TO authenticated
USING (public.app_is_staff());

CREATE POLICY "Staff can insert reservation cancellations"
ON public.reservation_cancellations
FOR INSERT
TO authenticated
WITH CHECK (public.app_is_staff());

CREATE INDEX IF NOT EXISTS reservation_cancellations_reservation_id_idx
  ON public.reservation_cancellations (reservation_id);

CREATE INDEX IF NOT EXISTS reservation_cancellations_cancelled_at_idx
  ON public.reservation_cancellations (cancelled_at DESC);

DROP FUNCTION IF EXISTS public.rpc_staff_create_reservation(int, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.rpc_staff_create_reservation(
  p_room_id int,
  p_client_name text,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_client_dni text,
  p_client_phone text DEFAULT NULL
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
  v_client_dni text;
  v_client_phone text;
  v_nights int;
  v_base_price numeric;
  v_total_price numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  v_client_name := nullif(btrim(p_client_name), '');
  v_client_dni := nullif(btrim(p_client_dni), '');
  v_client_phone := nullif(btrim(p_client_phone), '');

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF v_client_dni IS NULL THEN
    RAISE EXCEPTION 'El DNI o CUIT es obligatorio.' USING errcode = '22023';
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
    client_dni,
    client_phone,
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
    v_client_dni,
    v_client_phone,
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

DROP FUNCTION IF EXISTS public.rpc_cancel_reservation(uuid);

CREATE OR REPLACE FUNCTION public.rpc_cancel_reservation(
  p_reservation_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_room_id int;
  v_room_number text;
  v_room_type text;
  v_client_name text;
  v_client_dni text;
  v_client_phone text;
  v_status public.reservation_status;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_total_price numeric;
  v_paid_amount numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'El motivo de cancelacion es obligatorio.' USING errcode = '22023';
  END IF;

  SELECT
    r.room_id,
    ro.room_number,
    ro.room_type,
    r.client_name,
    r.client_dni,
    r.client_phone,
    r.status,
    r.check_in_target,
    r.check_out_target,
    r.total_price,
    r.paid_amount
  INTO
    v_room_id,
    v_room_number,
    v_room_type,
    v_client_name,
    v_client_dni,
    v_client_phone,
    v_status,
    v_check_in,
    v_check_out,
    v_total_price,
    v_paid_amount
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'La reserva ya se encuentra cancelada.' USING errcode = '22023';
  END IF;

  INSERT INTO public.reservation_cancellations (
    reservation_id,
    room_id,
    room_number,
    room_type,
    client_name,
    client_dni,
    client_phone,
    check_in_target,
    check_out_target,
    total_price,
    paid_amount,
    previous_status,
    reason,
    cancelled_at,
    cancelled_by
  )
  VALUES (
    p_reservation_id,
    v_room_id,
    v_room_number,
    v_room_type,
    v_client_name,
    v_client_dni,
    v_client_phone,
    v_check_in,
    v_check_out,
    v_total_price,
    v_paid_amount,
    v_status,
    v_reason,
    v_now,
    v_user_id
  );

  IF v_status = 'checked_in' THEN
    UPDATE public.rooms
    SET status = 'available'
    WHERE id = v_room_id AND status = 'occupied';
  END IF;

  IF v_total_price > v_paid_amount THEN
    v_total_price := v_paid_amount;
  END IF;

  UPDATE public.reservations
  SET status = 'cancelled',
      total_price = v_total_price,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'status', 'cancelled',
    'reason', v_reason
  );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_staff_checkout_reservation(uuid);

CREATE OR REPLACE FUNCTION public.rpc_staff_checkout_reservation(
  p_reservation_id uuid,
  p_payment_amount numeric DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid := auth.uid();
  v_room_id int;
  v_status public.reservation_status;
  v_total_price numeric;
  v_paid_amount numeric;
  v_payment_amount numeric := p_payment_amount;
  v_payment_method text := nullif(btrim(p_payment_method), '');
  v_is_admin boolean := public.app_is_admin();
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, total_price, paid_amount
  INTO v_room_id, v_status, v_total_price, v_paid_amount
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  IF v_payment_amount IS NOT NULL THEN
    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
    END IF;

    IF v_payment_method IS NULL THEN
      RAISE EXCEPTION 'Debe indicar un metodo de pago.' USING errcode = '22023';
    END IF;

    IF v_is_admin THEN
      v_total_price := v_paid_amount + v_payment_amount;
    ELSIF v_paid_amount + v_payment_amount <> v_total_price THEN
      RAISE EXCEPTION 'El recepcionista solo puede cobrar el saldo exacto para finalizar el check-out.' USING errcode = '22023';
    END IF;

    INSERT INTO public.payments (
      reservation_id,
      amount,
      payment_method,
      notes,
      created_at,
      created_by
    ) VALUES (
      p_reservation_id,
      v_payment_amount,
      v_payment_method,
      nullif(btrim(p_payment_notes), ''),
      v_now,
      v_user_id
    );

    v_paid_amount := v_paid_amount + v_payment_amount;
  END IF;

  IF v_paid_amount < v_total_price THEN
    RAISE EXCEPTION 'No se puede realizar el check-out con saldo pendiente.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_out',
      actual_check_out = v_now,
      total_price = v_total_price,
      paid_amount = v_paid_amount,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms
  SET status = 'cleaning'
  WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now,
    'total_price', v_total_price,
    'paid_amount', v_paid_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(int, text, timestamptz, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancel_reservation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_staff_checkout_reservation(uuid, numeric, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(int, text, timestamptz, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_reservation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_checkout_reservation(uuid, numeric, text, text) TO authenticated;

COMMIT;
