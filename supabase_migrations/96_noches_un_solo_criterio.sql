-- Migration 96: un solo criterio para contar noches, en un solo lugar.
--
-- Despues de la 95 el sistema seguia teniendo TRES respuestas para la misma pregunta
-- ("cuantas noches tiene esta reserva"), cada una escrita a mano en su funcion:
--
--   1) app_calculate_reservation_pricing (mig 95): dias de calendario en la zona del
--      hotel. Es la que congela el precio al crear la reserva y al re-tarifar.
--   2) rpc_staff_early_checkout (mig 71): dias de calendario tambien, pero con la
--      cuenta escrita por segunda vez.
--   3) rpc_extend_reservation (mig 76): round(horas / 24). Quedo afuera de la 95.
--
-- La 1 y la 3 coinciden solo cuando la hora de salida es menor que la de entrada. El
-- picker de Nueva reserva deja elegir cualquier hora, asi que no siempre pasa:
--
--   entrada 09:00, salida 22:00 del dia siguiente = 37 h
--     calendario     -> 1 noche  (asi se congelo el precio: se cobro 1 noche)
--     round(37/24)   -> 2 noches (asi lo lee "Ampliar")
--
--   Ampliar esa reserva divide la base congelada por 2 cuando se cobro 1: la tarifa por
--   noche sale a la mitad y la noche agregada se cobra a mitad de precio. Al reves de la
--   95, que cobraba una noche de mas, esta cobra de menos; el problema de fondo es el
--   mismo: cada funcion contaba por su cuenta.
--
-- EL CRITERIO, uno solo para todo el sistema: una noche es una noche de CALENDARIO en la
-- zona del hotel, con minimo 1. Del 9 al 10 es una noche, se entre a las 6 de la manana o
-- a las 11 de la noche. Es lo que ya entiende cualquier hotelero, y lo que ya hacian la
-- salida anticipada, el walk-in (fecha + p_nights) y countHotelNights en el front.
--
-- EL ARREGLO DE FONDO: la cuenta deja de estar copiada en cada funcion y pasa a vivir en
-- public.app_hotel_nights(entrada, salida). Las tres la llaman. Que sea una sola funcion
-- es lo que evita que dentro de seis meses vuelvan a separarse.
--
-- QUE CAMBIA DE RESULTADO: solo rpc_extend_reservation. Las otras dos ya contaban
-- calendario y siguen dando exactamente lo mismo; lo unico que cambia en ellas es de
-- donde sale la cuenta. De paso el fallback de zona horaria de
-- app_calculate_reservation_pricing pasa de 'UTC' a 'America/Argentina/Tucuman', que es
-- el que ya usaban la 71 y src/lib/time.ts. En PROD hotel_settings.timezone esta seteado
-- en 'America/Argentina/Tucuman', asi que ningun fallback se usa hoy.
--
-- QUE NO SE TOCA: las reservas ya congeladas. La 95 ya corrigio la unica abierta que
-- estaba mal; las tres cerradas y cobradas que quedaron con una noche de mas se listan en
-- el PR para que las resuelva Agustin, no una migracion.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig96$ ... $mig96$) SIN ;
-- final y SIN BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) app_hotel_nights: el unico lugar donde se cuentan noches.
--
--    Noches de CALENDARIO en la zona del hotel, minimo 1. El minimo cubre la
--    estadia que entra y sale el mismo dia (la siesta / media estadia no pasa por
--    aca: va por rooms.half_day_price).
--
--    El fallback 'America/Argentina/Tucuman' es el mismo de src/lib/time.ts y de la
--    mig 71; ademas cubre el caso de hotel_settings vacio, donde un subselect suelto
--    habria devuelto NULL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_hotel_nights(
  p_in timestamptz,
  p_out timestamptz
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT GREATEST(1, (
    (p_out AT TIME ZONE s.tz)::date - (p_in AT TIME ZONE s.tz)::date
  ))
  FROM (
    SELECT COALESCE(
      (SELECT NULLIF(BTRIM(timezone), '') FROM public.hotel_settings ORDER BY id LIMIT 1),
      'America/Argentina/Tucuman'
    ) AS tz
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.app_hotel_nights(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_hotel_nights(timestamptz, timestamptz) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) app_calculate_reservation_pricing: copia de la mig 95 (la ultima que la define),
--    con la cuenta de noches delegada al helper. Mismo resultado que hoy.
--    Se conserva la validacion de salida posterior a la entrada.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_calculate_reservation_pricing(
  p_room_id integer,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_associated_client_id uuid DEFAULT NULL,
  p_discount_percent numeric DEFAULT NULL
)
RETURNS TABLE(
  base_total_price numeric,
  discount_percent numeric,
  discount_amount numeric,
  final_total_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF p_discount_percent IS NOT NULL THEN
    v_discount_percent := p_discount_percent;
  ELSIF p_associated_client_id IS NOT NULL THEN
    SELECT ac.discount_percent
    INTO v_discount_percent
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id
      AND ac.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa/Convenio no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;
  ELSE
    v_discount_percent := 0;
  END IF;

  -- Noches de CALENDARIO en la zona del hotel (mig 95), ahora desde el unico lugar
  -- donde vive la cuenta.
  v_nights := public.app_hotel_nights(p_check_in, p_check_out);

  base_total_price := round((v_nights * COALESCE(v_room_base_price, 0))::numeric, 2);
  discount_percent := round(COALESCE(v_discount_percent, 0)::numeric, 2);
  discount_amount := round((base_total_price * discount_percent / 100)::numeric, 2);
  final_total_price := round((base_total_price - discount_amount)::numeric, 2);

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid, numeric) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_extend_reservation: copia de la mig 76 (la ultima que la define), con la
--    cuenta de noches delegada al helper. ES LA UNICA QUE CAMBIA DE RESULTADO:
--    antes leia round(horas/24) y podia partir la base congelada por una noche mas
--    de las que se cobraron, dejando la noche agregada a mitad de precio.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_extend_reservation(
  p_reservation_id UUID,
  p_extra_nights INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.reservations%ROWTYPE;
  v_existing_nights NUMERIC;
  v_net_base NUMERIC;
  v_surcharges NUMERIC;
  v_nightly_base NUMERIC;
  v_new_base NUMERIC;
  v_new_discount NUMERIC;
  v_new_total NUMERIC;
  v_new_out TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_extra_nights IS NULL OR p_extra_nights <= 0 THEN
    RAISE EXCEPTION 'Debe agregar al menos 1 noche.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_r FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  -- Guard de estado (la UI solo ofrece "Ampliar" en reservas activas; no dependemos del render).
  IF v_r.status NOT IN ('confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'Solo se puede ampliar una reserva activa (confirmada o en estadía).'
      USING errcode = 'P0001';
  END IF;

  v_new_out := v_r.check_out_target + make_interval(days => p_extra_nights);

  -- Solapamiento con otra reserva activa en la misma habitación sobre el tramo agregado
  -- (misma semántica que el constraint reservations_no_active_overlap).
  IF EXISTS (
    SELECT 1 FROM public.reservations o
    WHERE o.room_id = v_r.room_id
      AND o.id <> v_r.id
      AND o.status IN ('pending', 'confirmed', 'checked_in')
      AND o.check_in_target < v_new_out
      AND o.check_out_target > v_r.check_out_target
  ) THEN
    RAISE EXCEPTION 'No se puede ampliar la reserva porque la habitación ya está comprometida para esas fechas.'
      USING errcode = 'P0001';
  END IF;

  -- Recalcular preservando tarifa congelada + recargos (espeja data.ts:1735-1753):
  --  recargos = total_price - (base - descuento);  base nueva = base + noches_extra * (base/noches).
  -- Noches de calendario (mig 96): antes era round(horas/24), que en una reserva de
  -- 37 h daba 2 y partia la base congelada por el doble de noches que se cobraron.
  v_existing_nights := public.app_hotel_nights(v_r.check_in_target, v_r.check_out_target);
  v_net_base   := COALESCE(v_r.base_total_price, v_r.total_price) - COALESCE(v_r.discount_amount, 0);
  v_surcharges := GREATEST(0, round((v_r.total_price - v_net_base)::numeric, 2));
  v_nightly_base := COALESCE(v_r.base_total_price, v_r.total_price) / v_existing_nights;
  v_new_base   := COALESCE(v_r.base_total_price, v_r.total_price) + p_extra_nights * v_nightly_base;
  v_new_discount := round((v_new_base * COALESCE(v_r.discount_percent, 0) / 100)::numeric, 2);
  v_new_total  := v_new_base - v_new_discount + v_surcharges;

  BEGIN
    UPDATE public.reservations
    SET check_out_target = v_new_out,
        base_total_price = v_new_base,
        discount_percent = COALESCE(v_r.discount_percent, 0),
        discount_amount  = v_new_discount,
        total_price      = v_new_total,
        -- Ampliar mueve el checkout hacia adelante: un late-checkout viejo deja de valer,
        -- si no el tablero marca un falso "Retraso Check-out".
        late_check_out_until = NULL,
        updated_at = NOW()
    WHERE id = p_reservation_id;
  EXCEPTION WHEN exclusion_violation THEN
    -- Carrera con el constraint anti-solapamiento: mensaje claro en vez del error crudo.
    RAISE EXCEPTION 'No se puede ampliar: la habitación quedó comprometida para esas fechas.'
      USING errcode = 'P0001';
  END;

  RETURN jsonb_build_object('ok', TRUE, 'new_total', v_new_total, 'check_out_target', v_new_out);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_extend_reservation(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_extend_reservation(UUID, INT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_staff_early_checkout: copia de la mig 71 (la ultima que la define; la 89 la
--    menciona pero no la redefine), con la cuenta de noches delegada al helper.
--    Ya contaba calendario, asi que da exactamente lo mismo: se toca igual para que
--    no quede una segunda copia de la cuenta que pueda volver a divergir.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Zona horaria del hotel. Las noches ya las cuenta app_hotel_nights; esto queda
  -- para armar la nueva fecha de salida con la hora original en hora local.
  SELECT COALESCE(timezone, 'America/Argentina/Tucuman') INTO v_tz
  FROM public.hotel_settings LIMIT 1;
  IF v_tz IS NULL OR BTRIM(v_tz) = '' THEN
    v_tz := 'America/Argentina/Tucuman';
  END IF;

  v_departure_date := (v_now AT TIME ZONE v_tz)::date;

  -- Noches de calendario desde el unico lugar donde vive la cuenta (mig 96). La
  -- cuenta es la misma que tenia escrita a mano; se saca de aca para que no pueda
  -- volver a separarse de la que usa el alta.
  v_original_nights := public.app_hotel_nights(v_check_in, v_check_out);
  v_charged_nights  := public.app_hotel_nights(v_check_in, v_now);

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
  -- Obligatoria SIEMPRE: sin caja la pieza no se rendía en ningún turno.
  v_shift_id := public.app_current_open_shift();

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Debes abrir la caja antes de hacer un check-out.' USING errcode = 'P0003';
  END IF;

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

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('96_noches_un_solo_criterio.sql');
  END IF;
END $$;

COMMIT;
