-- Migration 60: Salida anticipada (early checkout) — cobrar solo las noches dormidas
--
-- Problema: si un huesped reserva N noches y se va antes, el check-out normal
-- (rpc_staff_checkout_reservation) obliga a cobrar el total original (N noches).
-- Para cobrar menos, hoy un ADMIN tiene que editar las fechas (rpc_update_reservation,
-- admin-only), recalcular, y recien ahi recepcion cobra. El playero solo no puede.
--
-- Esta RPC nueva permite que CUALQUIER staff, en el mismo check-out, recalcule el
-- precio a las noches efectivamente dormidas (check-in -> dia de salida) y cierre la
-- reserva, todo atomico. No toca el check-out normal (queda igual).
--
-- Reglas de recalculo:
--   noches_a_cobrar = noches calendario (zona hotel) entre check-in y hoy, minimo 1.
--   tarifa/noche    = base_total_price / noches_originales (preserva lo cotizado).
--   nuevo_base      = tarifa/noche * noches_a_cobrar
--   nuevo_descuento = nuevo_base * discount_percent/100 (preserva el % del asociado)
--   extras          = total_price - (base_total_price - discount_amount)  [se preservan]
--   nuevo_total     = (nuevo_base - nuevo_descuento) + extras
--
-- Sobrepago (nuevo_total < paid_amount): se bloquea. v1 no maneja reembolsos; ese
-- caso lo cierra un admin.

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
  v_new_final NUMERIC;
  v_new_total NUMERIC;
  v_new_check_out TIMESTAMPTZ;
  v_payment_amount NUMERIC := p_payment_amount;
  v_payment_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_shift_id UUID;
  v_payment_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, check_in_target, check_out_target,
         base_total_price, discount_percent, discount_amount, total_price, paid_amount
  INTO v_room_id, v_status, v_check_in, v_check_out,
       v_base_total, v_discount_percent, v_discount_amount, v_total_price, v_paid_amount
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
    -- No se va antes: no hay reduccion, se cobra el total actual (checkout normal).
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
    v_new_final := v_new_base - v_new_discount;
    v_new_total := round((v_new_final + v_extras)::numeric, 2);
    -- Nueva salida planificada = dia de salida a la hora original de check_out_target.
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

  v_shift_id := public.app_current_open_shift();

  IF v_payment_amount IS NOT NULL THEN
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
    'payment_id', v_payment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_early_checkout(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_early_checkout(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

COMMIT;
