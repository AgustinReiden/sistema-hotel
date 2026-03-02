-- Migration 12: Financial Fixes (Transactional Payments & Non-Destructive Canvas)

BEGIN;

-- 1. Crear RPC transaccional para pagos
CREATE OR REPLACE FUNCTION public.rpc_register_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid := auth.uid();
  v_total_price numeric;
  v_paid_amount numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser numérico y mayor a 0.' USING errcode = '22023';
  END IF;

  -- Bloquear fila para evitar condiciones de carrera (pagos dobles simultáneos)
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
    reservation_id,
    amount,
    payment_method,
    notes,
    created_at,
    created_by
  ) VALUES (
    p_reservation_id,
    p_amount,
    p_payment_method,
    p_notes,
    v_now,
    v_user_id
  );

  UPDATE public.reservations
  SET paid_amount = v_paid_amount + p_amount,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'new_paid_amount', v_paid_amount + p_amount
  );
END;
$$;

-- 2. Crear RPC transaccional para cancelaciones sin destruir pagos
CREATE OR REPLACE FUNCTION public.rpc_cancel_reservation(
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
  v_total_price numeric;
  v_paid_amount numeric;
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

  IF v_status = 'cancelled' THEN
     RAISE EXCEPTION 'La reserva ya encuentra cancelada.' USING errcode = '22023';
  END IF;

  IF v_status IN ('checked_in', 'pending', 'confirmed') THEN
      UPDATE public.rooms
      SET status = 'available'
      WHERE id = v_room_id AND status = 'occupied';
  END IF;

  -- Ajuste contable para no dejar deudas pendientes abstractas (el precio total se ajusta al monto pagado si no hay devolución)
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
    'status', 'cancelled'
  );
END;
$$;

-- Permisos
REVOKE ALL ON FUNCTION public.rpc_register_payment(uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancel_reservation(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_register_payment(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_reservation(uuid) TO authenticated;

COMMIT;
