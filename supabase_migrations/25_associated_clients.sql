BEGIN;

CREATE TABLE IF NOT EXISTS public.associated_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  document_id TEXT NOT NULL CHECK (btrim(document_id) <> ''),
  phone TEXT,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS associated_clients_document_id_idx
  ON public.associated_clients (document_id);

CREATE INDEX IF NOT EXISTS associated_clients_active_name_idx
  ON public.associated_clients (is_active, display_name);

ALTER TABLE public.associated_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read associated clients" ON public.associated_clients;
DROP POLICY IF EXISTS "Admin can insert associated clients" ON public.associated_clients;
DROP POLICY IF EXISTS "Admin can update associated clients" ON public.associated_clients;

CREATE POLICY "Staff can read associated clients"
ON public.associated_clients
FOR SELECT
TO authenticated
USING (public.app_is_staff());

CREATE POLICY "Admin can insert associated clients"
ON public.associated_clients
FOR INSERT
TO authenticated
WITH CHECK (public.app_is_admin());

CREATE POLICY "Admin can update associated clients"
ON public.associated_clients
FOR UPDATE
TO authenticated
USING (public.app_is_admin())
WITH CHECK (public.app_is_admin());

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS associated_client_id UUID REFERENCES public.associated_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_total_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;

UPDATE public.reservations
SET
  base_total_price = COALESCE(NULLIF(base_total_price, 0), total_price),
  discount_percent = COALESCE(discount_percent, 0),
  discount_amount = COALESCE(discount_amount, 0)
WHERE
  base_total_price = 0
  OR discount_percent IS NULL
  OR discount_amount IS NULL;

CREATE INDEX IF NOT EXISTS reservations_associated_client_id_idx
  ON public.reservations (associated_client_id);

CREATE OR REPLACE FUNCTION public.app_calculate_reservation_pricing(
  p_room_id int,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_associated_client_id uuid DEFAULT NULL
)
RETURNS TABLE (
  base_total_price numeric,
  discount_percent numeric,
  discount_amount numeric,
  final_total_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_base_price numeric := 0;
  v_nights int := 1;
  v_discount_percent numeric := 0;
BEGIN
  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  SELECT base_price
  INTO v_room_base_price
  FROM public.rooms
  WHERE id = p_room_id;

  IF v_room_base_price IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;

  IF p_associated_client_id IS NOT NULL THEN
    SELECT ac.discount_percent
    INTO v_discount_percent
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id
      AND ac.is_active = true;

    IF v_discount_percent IS NULL THEN
      RAISE EXCEPTION 'Asociado no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;
  END IF;

  v_nights := GREATEST(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400));

  base_total_price := round((v_nights * COALESCE(v_room_base_price, 0))::numeric, 2);
  discount_percent := round(COALESCE(v_discount_percent, 0)::numeric, 2);
  discount_amount := round((base_total_price * discount_percent / 100)::numeric, 2);
  final_total_price := round((base_total_price - discount_amount)::numeric, 2);

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.rpc_staff_create_reservation(int, text, timestamptz, timestamptz, text, text);

CREATE OR REPLACE FUNCTION public.rpc_staff_create_reservation(
  p_room_id int,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_client_name text DEFAULT NULL,
  p_client_dni text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_associated_client_id uuid DEFAULT NULL
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

DROP FUNCTION IF EXISTS public.rpc_staff_assign_walk_in(int, text, int);

CREATE OR REPLACE FUNCTION public.rpc_staff_assign_walk_in(
  p_room_id int,
  p_client_name text DEFAULT NULL,
  p_nights int DEFAULT NULL,
  p_associated_client_id uuid DEFAULT NULL
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

  SELECT standard_check_out_time
  INTO v_checkout_time
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_checkout_target := ((((v_now AT TIME ZONE 'UTC')::date + p_nights) + v_checkout_time) AT TIME ZONE 'UTC');

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

DROP FUNCTION IF EXISTS public.rpc_staff_checkout_reservation(uuid, numeric, text, text);

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

    IF v_paid_amount + v_payment_amount <> v_total_price THEN
      RAISE EXCEPTION 'Solo se puede cobrar el saldo exacto pendiente para finalizar el check-out.' USING errcode = '22023';
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

REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(int, timestamptz, timestamptz, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(int, text, int, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_staff_checkout_reservation(uuid, numeric, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(int, timestamptz, timestamptz, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(int, text, int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_checkout_reservation(uuid, numeric, text, text) TO authenticated;

COMMIT;
