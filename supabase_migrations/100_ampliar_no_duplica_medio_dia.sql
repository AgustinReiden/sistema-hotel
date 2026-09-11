-- Migration 100: ampliar una noche deja de cobrar dos veces la misma tarde.
--
-- SINTOMA (hab. 15, JOSE BORJA, 09-09 al 11-09): la habitacion vale 50.000 la noche, se
-- cobraron 2 noches y el ticket dio 130.000 en vez de 100.000.
--
-- QUE PASABA. Recepcion tiene dos botones para el huesped que se queda de mas:
--
--   "Ampliar -> Medio dia"  rpc_staff_apply_late_checkout (mig 56): cobra
--                           rooms.half_day_price y corre late_check_out_until hasta las
--                           18:00 del dia de salida.
--   "Ampliar -> Noches"     rpc_extend_reservation (mig 76/96): mueve check_out_target
--                           un dia mas adelante y re-tarifa la base.
--
-- Usados los dos sobre la misma estadia -- primero el medio dia, y cuando el huesped se
-- queda a dormir, la noche -- la noche nueva incluye esa misma tarde. El medio dia queda
-- cobrado ARRIBA de una tarde que el huesped ya paga adentro de la noche.
-- rpc_extend_reservation lo arrastraba porque lo trataba como un recargo mas, igual que
-- el minibar o los daños, que si tienen que sobrevivir a la ampliacion:
--
--   recargos = total_price - (base congelada - descuento)   <- se lleva el medio dia
--   total    = base nueva - descuento + recargos            <- y lo vuelve a cobrar
--
-- Que la funcion ya sabia que el late-checkout dejaba de valer se ve en que limpia
-- late_check_out_until "para que el tablero no marque un falso Retraso Check-out".
-- Borraba el aviso y se quedaba con la plata.
--
-- EL ARREGLO: al ampliar noches, el cargo 'half_day' se borra y se descuenta de los
-- recargos que se preservan. Es el mismo criterio que la funcion ya aplicaba a
-- late_check_out_until, ahora tambien sobre el dinero. Los demas charge_type no se tocan.
--
-- POR QUE BORRAR Y NO SOLO DESCONTAR: el indice unico parcial
-- extra_charges_one_half_day_per_reservation permite UN medio dia por reserva. Hoy, si se
-- amplia y el huesped se vuelve a ir tarde el dia nuevo, el medio dia no se puede volver a
-- cobrar: el ON CONFLICT DO NOTHING de la mig 56 lo come en silencio y recepcion ve
-- "el medio dia ya estaba aplicado". Al borrar el cargo viejo -- que ya no corresponde --
-- la reserva vuelve a poder cobrarlo cuando de verdad corresponda.
--
-- EL GREATEST(0, ...) NO ES ADORNO: si el total ya no tenia el recargo adentro (un admin
-- edito las fechas con rpc_update_reservation, que recalcula el total de cero), restarlo
-- lo descontaria dos veces y la reserva saldria mas barata de lo que corresponde. Con el
-- piso en cero nunca se resta mas recargo del que habia.
--
-- QUE NO TOCA:
--   * Las reservas ya cerradas. Las tres que se cobraron con el medio dia duplicado se
--     listan en el PR para que las resuelva Agustin; una migracion no devuelve plata.
--   * La salida anticipada (rpc_staff_early_checkout, mig 71). Ahi el medio dia SI
--     corresponde: se cobran las noches dormidas y el medio dia cubre las horas pasadas
--     del check-out del ultimo dia. Es el caso de la reserva de GUSTAVO KRNACS, que quedo
--     bien cobrada.
--
-- Aplicar a PROD via select public.exec_ddl($mig100$ ... $mig100$) SIN ; final y SIN
-- BEGIN/COMMIT.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_extend_reservation(p_reservation_id uuid, p_extra_nights integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r public.reservations%ROWTYPE;
  v_existing_nights NUMERIC;
  v_net_base NUMERIC;
  v_surcharges NUMERIC;
  v_half_day NUMERIC;
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

  -- El medio dia de late-checkout cubre la tarde del dia de salida; la noche que se agrega
  -- incluye esa misma tarde. El cargo deja de corresponder, asi que se va con la plata y
  -- todo, no solo con el aviso (late_check_out_until, mas abajo). El indice unico parcial
  -- garantiza a lo sumo una fila, por eso el RETURNING ... INTO alcanza.
  DELETE FROM public.extra_charges
   WHERE reservation_id = p_reservation_id
     AND charge_type = 'half_day'
  RETURNING amount INTO v_half_day;
  v_half_day := COALESCE(v_half_day, 0);

  -- Recalcular preservando tarifa congelada + recargos (desde la mig 76 esta cuenta vive
  -- solo aca; data.ts:extendReservation nada mas llama a esta RPC):
  --  recargos = total_price - (base - descuento) - medio dia quitado;
  --  base nueva = base + noches_extra * (base/noches).
  -- Noches de calendario (mig 96): antes era round(horas/24), que en una reserva de
  -- 37 h daba 2 y partia la base congelada por el doble de noches que se cobraron.
  v_existing_nights := public.app_hotel_nights(v_r.check_in_target, v_r.check_out_target);
  v_net_base   := COALESCE(v_r.base_total_price, v_r.total_price) - COALESCE(v_r.discount_amount, 0);
  v_surcharges := GREATEST(0, round((v_r.total_price - v_net_base - v_half_day)::numeric, 2));
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

  RETURN jsonb_build_object(
    'ok', TRUE,
    'new_total', v_new_total,
    'check_out_target', v_new_out,
    -- Para que recepcion vea en pantalla que el medio dia se quito y por que.
    'half_day_removed', (v_half_day > 0),
    'half_day_amount', v_half_day
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_extend_reservation(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_extend_reservation(uuid, integer) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('100_ampliar_no_duplica_medio_dia.sql');
  END IF;
END $$;

COMMIT;
