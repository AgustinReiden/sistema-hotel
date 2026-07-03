-- Migration 66: Restaurar "piezas rendidas" en el check-out normal
--
-- Regresión: la migración 64 (cuenta corriente) reemplazó rpc_staff_checkout_reservation
-- y su UPDATE dejó de setear reservations.checkout_cash_shift_id (columna que agregó la
-- migración 59 para contar los check-outs por turno en la rendición de caja). Resultado:
-- el check-out normal dejó de contar piezas (getShiftSummary cuenta
-- reservations WHERE checkout_cash_shift_id = shiftId). La salida anticipada (mig 65) sí
-- la setea.
--
-- Fix: idéntica a la mig 64, pero:
--  1) se obtiene la caja abierta del hotel AL INICIO (no solo dentro de la rama de cobro),
--     así TODO check-out durante un turno abierto cuenta como pieza — incluidos los de
--     reservas ya pagadas (que no generan pago) y los de cuenta corriente.
--  2) el UPDATE vuelve a setear checkout_cash_shift_id = v_shift_id.
-- Deja el check-out consistente con rpc_staff_early_checkout.

BEGIN;

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
  v_assoc UUID;
  v_guest UUID;
  v_payment_amount NUMERIC := p_payment_amount;
  v_payment_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_shift_id UUID;
  v_payment_id UUID;
  v_movement_id UUID;
  v_cc_enabled BOOLEAN;
  v_charge NUMERIC;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, total_price, paid_amount, associated_client_id, guest_id
  INTO v_room_id, v_status, v_total_price, v_paid_amount, v_assoc, v_guest
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  -- Caja abierta del hotel: sirve para imputar el cobro Y para contar la pieza
  -- (check-out) del turno, sin importar el medio (incluye reservas ya pagas).
  v_shift_id := public.app_current_open_shift();

  IF v_payment_method = 'cuenta_corriente' THEN
    -- Cargar el saldo pendiente a la cuenta del cliente facturable (empresa o huésped).
    IF v_assoc IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.associated_clients WHERE id = v_assoc;
    ELSIF v_guest IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.guests WHERE id = v_guest;
    ELSE
      RAISE EXCEPTION 'La reserva no tiene un cliente al que cargar la cuenta corriente.' USING errcode = '22023';
    END IF;

    IF NOT COALESCE(v_cc_enabled, false) THEN
      RAISE EXCEPTION 'Este cliente no tiene cuenta corriente habilitada.' USING errcode = '22023';
    END IF;

    v_charge := round(v_total_price - v_paid_amount, 2);
    IF v_charge > 0 THEN
      INSERT INTO public.cuenta_corriente_movimientos (
        associated_client_id, guest_id, tipo, amount, reservation_id, created_by, created_at
      )
      VALUES (v_assoc, v_guest, 'cargo', v_charge, p_reservation_id, v_user_id, v_now)
      RETURNING id INTO v_movement_id;
    END IF;

    -- La reserva queda saldada en sus libros; la deuda real vive en la cuenta corriente.
    -- No se inserta pago en `payments` ni se toca la caja.
    v_paid_amount := v_total_price;

  ELSIF v_payment_amount IS NOT NULL THEN
    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
    END IF;
    IF v_payment_method IS NULL THEN
      RAISE EXCEPTION 'Debe indicar un metodo de pago.' USING errcode = '22023';
    END IF;
    IF v_paid_amount + v_payment_amount <> v_total_price THEN
      RAISE EXCEPTION 'Solo se puede cobrar el saldo exacto pendiente para finalizar el check-out.' USING errcode = '22023';
    END IF;

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
      checkout_cash_shift_id = v_shift_id,
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
    'payment_id', v_payment_id,
    'movement_id', v_movement_id,
    'cuenta_corriente', (v_payment_method = 'cuenta_corriente')
  );
END;
$$;

COMMIT;
