-- Migration 65: Salida anticipada (early checkout) — cobrar solo las noches dormidas
--
-- Problema: si un huesped reserva N noches y se va antes, el check-out normal
-- (rpc_staff_checkout_reservation) obliga a cerrar por el total original. Para
-- cobrar menos hay que pedirle a un admin que edite las fechas. El playero solo
-- no puede y termina cobrando de mas.
--
-- Esta RPC nueva permite que cualquier staff, en el mismo check-out, recalcule el
-- precio a las noches efectivamente dormidas (check-in -> dia de salida) y cierre
-- la reserva, todo atomico. Espeja rpc_staff_checkout_reservation (mig 64):
-- soporta cobro normal Y cierre a cuenta corriente. No toca el check-out normal.
--
-- Reglas de recalculo:
--   noches_a_cobrar = noches calendario (zona hotel) check-in -> hoy, minimo 1,
--                     nunca mas que las noches originales.
--   tarifa/noche    = base_total_price / noches_originales (preserva lo cotizado).
--   extras          = total_price - (base_total_price - discount_amount)  [se preservan]
--   nuevo_total     = (tarifa*noches - descuento) + extras
--
-- Sobrepago (nuevo_total < paid_amount): se bloquea. v1 no maneja reembolsos;
-- ese caso lo cierra un admin.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_staff_early_checkout(
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
  v_check_in TIMESTAMPTZ;
  v_check_out TIMESTAMPTZ;
  v_base_total NUMERIC;
  v_discount_percent NUMERIC;
  v_discount_amount NUMERIC;
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_assoc UUID;
  v_guest UUID;
  v_tz TEXT;
  v_checkin_date DATE;
  v_checkout_date DATE;
  v_departure_date DATE;
  v_original_nights INT;
  v_charged_nights INT;
  v_per_night NUMERIC;
  v_extras NUMERIC;
  v_new_base NUMERIC;
  v_new_discount NUMERIC;
  v_new_total NUMERIC;
  v_new_check_out TIMESTAMPTZ;
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

  SELECT room_id, status, check_in_target, check_out_target,
         base_total_price, discount_percent, discount_amount, total_price, paid_amount,
         associated_client_id, guest_id
  INTO v_room_id, v_status, v_check_in, v_check_out,
       v_base_total, v_discount_percent, v_discount_amount, v_total_price, v_paid_amount,
       v_assoc, v_guest
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  -- Zona horaria del hotel para contar noches por fecha calendario.
  SELECT COALESCE(timezone, 'America/Argentina/Tucuman') INTO v_tz
  FROM public.hotel_settings LIMIT 1;
  IF v_tz IS NULL OR BTRIM(v_tz) = '' THEN
    v_tz := 'America/Argentina/Tucuman';
  END IF;

  v_checkin_date   := (v_check_in  AT TIME ZONE v_tz)::date;
  v_checkout_date  := (v_check_out AT TIME ZONE v_tz)::date;
  v_departure_date := (v_now       AT TIME ZONE v_tz)::date;

  v_original_nights := GREATEST(1, (v_checkout_date - v_checkin_date));
  v_charged_nights  := GREATEST(1, (v_departure_date - v_checkin_date));

  IF v_charged_nights >= v_original_nights THEN
    -- No se va antes: no hay reduccion, se cierra por el total actual.
    v_charged_nights := v_original_nights;
    v_new_base := v_base_total;
    v_new_discount := v_discount_amount;
    v_new_total := v_total_price;
    v_new_check_out := v_check_out;
  ELSE
    v_per_night := v_base_total / v_original_nights;                 -- tarifa base cotizada por noche
    v_extras := v_total_price - (v_base_total - v_discount_amount);  -- minibar, danos, media estadia
    v_new_base := round((v_per_night * v_charged_nights)::numeric, 2);
    v_new_discount := round((v_new_base * COALESCE(v_discount_percent, 0) / 100)::numeric, 2);
    v_new_total := round(((v_new_base - v_new_discount) + v_extras)::numeric, 2);
    v_new_check_out := (v_departure_date + (v_check_out AT TIME ZONE v_tz)::time) AT TIME ZONE v_tz;
    IF v_new_check_out <= v_check_in THEN
      v_new_check_out := v_check_in + INTERVAL '1 day';
    END IF;
  END IF;

  -- Sobrepago: v1 no hace reembolsos; lo cierra un admin.
  IF v_new_total < v_paid_amount THEN
    RAISE EXCEPTION 'El huesped pago mas de lo que corresponde por las noches usadas. Esta salida anticipada la tiene que cerrar un administrador.'
      USING errcode = '22023';
  END IF;

  -- Caja abierta del hotel (para el cobro y para contar la pieza rendida).
  v_shift_id := public.app_current_open_shift();

  IF v_payment_method = 'cuenta_corriente' THEN
    -- Cargar el saldo (recalculado) a la cuenta del cliente facturable.
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

    v_charge := round(v_new_total - v_paid_amount, 2);
    IF v_charge > 0 THEN
      INSERT INTO public.cuenta_corriente_movimientos (
        associated_client_id, guest_id, tipo, amount, reservation_id, created_by, created_at
      )
      VALUES (v_assoc, v_guest, 'cargo', v_charge, p_reservation_id, v_user_id, v_now)
      RETURNING id INTO v_movement_id;
    END IF;

    v_paid_amount := v_new_total;

  ELSIF v_payment_amount IS NOT NULL THEN
    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
    END IF;
    IF v_payment_method IS NULL THEN
      RAISE EXCEPTION 'Debe indicar un metodo de pago.' USING errcode = '22023';
    END IF;
    IF v_paid_amount + v_payment_amount <> v_new_total THEN
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

  IF v_paid_amount < v_new_total THEN
    RAISE EXCEPTION 'No se puede realizar el check-out con saldo pendiente.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_out',
      actual_check_out = v_now,
      check_out_target = v_new_check_out,
      base_total_price = v_new_base,
      discount_amount = v_new_discount,
      total_price = v_new_total,
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
    'original_nights', v_original_nights,
    'charged_nights', v_charged_nights,
    'new_total_price', v_new_total,
    'paid_amount', v_paid_amount,
    'cash_shift_id', v_shift_id,
    'payment_id', v_payment_id,
    'movement_id', v_movement_id,
    'cuenta_corriente', (v_payment_method = 'cuenta_corriente')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_early_checkout(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_early_checkout(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

COMMIT;
