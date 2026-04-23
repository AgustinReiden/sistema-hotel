-- Migration 42: Los RPCs de pago devuelven el payment_id para que el cliente
-- pueda abrir el recibo imprimible directo (/admin/recibo/<payment_id>).

BEGIN;

-- =========================================================================
-- rpc_register_payment: devuelve payment_id + new_paid_amount + cash_shift_id
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_register_payment(
  p_reservation_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_shift_id UUID;
  v_payment_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
  END IF;

  v_shift_id := public.app_current_open_shift();
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Debes abrir la caja antes de cobrar.' USING errcode = 'P0003';
  END IF;

  SELECT total_price, paid_amount
  INTO v_total_price, v_paid_amount
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_total_price IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_paid_amount + p_amount > v_total_price THEN
    RAISE EXCEPTION 'El pago excede el total estipulado de la reserva.' USING errcode = '22023';
  END IF;

  INSERT INTO public.payments (
    reservation_id, amount, payment_method, notes,
    created_at, created_by, cash_shift_id
  )
  VALUES (
    p_reservation_id, p_amount, p_payment_method, p_notes,
    v_now, v_user_id, v_shift_id
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.reservations
  SET paid_amount = v_paid_amount + p_amount, updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'payment_id', v_payment_id,
    'new_paid_amount', v_paid_amount + p_amount,
    'cash_shift_id', v_shift_id
  );
END;
$$;

-- =========================================================================
-- rpc_staff_checkout_reservation: también devuelve payment_id si hubo pago
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_staff_checkout_reservation(
  p_reservation_id UUID,
  p_payment_amount NUMERIC DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_room_id INT;
  v_status public.reservation_status;
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_payment_amount NUMERIC := p_payment_amount;
  v_payment_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_shift_id UUID;
  v_payment_id UUID;
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

    v_shift_id := public.app_current_open_shift();
    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Debes abrir la caja antes de cobrar.' USING errcode = 'P0003';
    END IF;

    INSERT INTO public.payments (
      reservation_id, amount, payment_method, notes,
      created_at, created_by, cash_shift_id
    )
    VALUES (
      p_reservation_id, v_payment_amount, v_payment_method,
      NULLIF(BTRIM(p_payment_notes), ''), v_now, v_user_id, v_shift_id
    )
    RETURNING id INTO v_payment_id;

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

  UPDATE public.rooms SET status = 'cleaning' WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now,
    'total_price', v_total_price,
    'paid_amount', v_paid_amount,
    'cash_shift_id', v_shift_id,
    'payment_id', v_payment_id
  );
END;
$$;

COMMIT;
