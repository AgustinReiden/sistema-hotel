-- Migration 28: Cargos extras y cambio de habitacion
--
-- Dos RPCs nuevas que habilitan los modales correspondientes en el dashboard:
-- 1) rpc_add_extra_charge: minibar, danios, servicios extras. Suma al total_price
--    de la reserva en una transaccion.
-- 2) rpc_change_reservation_room: reasigna una reserva activa a otra habitacion.
--    Valida colision via el EXCLUDE constraint existente y ajusta los estados
--    de las habitaciones si la reserva estaba checked_in.

BEGIN;

-- =========================================================================
-- rpc_add_extra_charge
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_add_extra_charge(
  p_reservation_id UUID,
  p_charge_type TEXT,
  p_amount NUMERIC,
  p_description TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_status public.reservation_status;
  v_charge_type TEXT := LOWER(BTRIM(p_charge_type));
  v_description TEXT := NULLIF(BTRIM(p_description), '');
  v_charge_id INT;
  v_new_total NUMERIC;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto del cargo debe ser mayor a 0.' USING errcode = '22023';
  END IF;

  IF v_charge_type IS NULL OR v_charge_type = '' THEN
    RAISE EXCEPTION 'El tipo de cargo es obligatorio.' USING errcode = '22023';
  END IF;

  -- half_day es exclusivo de rpc_staff_apply_late_checkout.
  IF v_charge_type = 'half_day' THEN
    RAISE EXCEPTION 'El cargo medio dia se aplica automaticamente al extender checkout.' USING errcode = '22023';
  END IF;

  -- Bloqueamos la reserva para recalcular total_price en forma transaccional.
  SELECT status
  INTO v_status
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'No se pueden agregar cargos a una reserva finalizada o cancelada.' USING errcode = '22023';
  END IF;

  INSERT INTO public.extra_charges (reservation_id, charge_type, amount, description)
  VALUES (p_reservation_id, v_charge_type, p_amount, v_description)
  RETURNING id INTO v_charge_id;

  UPDATE public.reservations
  SET total_price = total_price + p_amount,
      updated_at = v_now
  WHERE id = p_reservation_id
  RETURNING total_price INTO v_new_total;

  RETURN jsonb_build_object(
    'charge_id', v_charge_id,
    'reservation_id', p_reservation_id,
    'charge_type', v_charge_type,
    'amount', p_amount,
    'new_total_price', v_new_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_add_extra_charge(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_add_extra_charge(UUID, TEXT, NUMERIC, TEXT) TO authenticated;

-- =========================================================================
-- rpc_change_reservation_room
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rpc_change_reservation_room(
  p_reservation_id UUID,
  p_new_room_id INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_old_room_id INT;
  v_status public.reservation_status;
  v_new_room_active BOOLEAN;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status
  INTO v_old_room_id, v_status
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_old_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede cambiar la habitacion de una reserva finalizada.' USING errcode = '22023';
  END IF;

  IF v_old_room_id = p_new_room_id THEN
    RAISE EXCEPTION 'La habitacion nueva es la misma que la actual.' USING errcode = '22023';
  END IF;

  SELECT is_active INTO v_new_room_active FROM public.rooms WHERE id = p_new_room_id;
  IF v_new_room_active IS NULL THEN
    RAISE EXCEPTION 'La habitacion nueva no existe.' USING errcode = 'P0002';
  END IF;
  IF v_new_room_active = FALSE THEN
    RAISE EXCEPTION 'La habitacion nueva esta inactiva.' USING errcode = '22023';
  END IF;

  -- El EXCLUDE constraint en reservations va a rechazar automaticamente si hay
  -- overlap con otra reserva activa en el rango de esta.
  UPDATE public.reservations
  SET room_id = p_new_room_id,
      updated_at = v_now
  WHERE id = p_reservation_id;

  IF v_status = 'checked_in' THEN
    UPDATE public.rooms SET status = 'cleaning'
    WHERE id = v_old_room_id AND status = 'occupied';

    UPDATE public.rooms SET status = 'occupied'
    WHERE id = p_new_room_id AND status = 'available';
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'old_room_id', v_old_room_id,
    'new_room_id', p_new_room_id,
    'status', v_status
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_change_reservation_room(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_change_reservation_room(UUID, INT) TO authenticated;

COMMIT;
