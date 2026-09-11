-- Migration 101: editar fechas deja de borrar los recargos del total, y la regla del medio
-- dia pasa a vivir en un solo lugar.
--
-- HERMANO DEL BUG DE LA MIG 100, encontrado mirando esa. De las cuatro funciones que
-- re-tarifan una reserva, tres preservan los recargos (minibar, daños, medio dia) restando
-- la base neta del total:
--
--   rpc_extend_reservation      (mig 76/96/100)  recargos = total - (base - descuento)
--   rpc_change_reservation_room (mig 69)         idem
--   rpc_staff_early_checkout    (mig 71)         idem
--
-- La cuarta, rpc_update_reservation (editar la reserva), cuando cambian las fechas pisaba
-- el total con lo que devuelve app_calculate_reservation_pricing, que es base - descuento
-- y nada mas. Los recargos desaparecian del total y la fila seguia viva en extra_charges:
-- plata cargada que la reserva ya nunca iba a cobrar. Es el mismo agujero de conciliacion
-- que la mig 93 cerro del lado de los INSERT directos, ahora por el lado del UPDATE.
--
-- Hoy en PROD no paso nunca porque no hay un solo cargo de minibar ni de daños: los unicos
-- cinco extra_charges de la base son medios dias. **Es una bomba de tiempo, no un incendio.**
-- El dia que recepcion cargue un consumo y un admin corrija las fechas, el hotel cobra de
-- menos y nadie se entera: la pantalla dice "Reserva actualizada" con el total nuevo.
--
-- QUE CAMBIA:
--
-- 1) public.app_drop_subsumed_half_day(reserva, salida_vieja, salida_nueva) -> monto quitado.
--    La regla de la mig 100 ("si la salida se corre hacia adelante, la noche nueva se come
--    la tarde del medio dia, asi que el cargo deja de corresponder") deja de estar escrita
--    adentro de rpc_extend_reservation y pasa a ser una funcion sola, que ahora tambien usa
--    rpc_update_reservation. Es la misma leccion de la mig 96 con app_hotel_nights: no
--    alcanza con arreglar la cuenta en cada funcion, hay que dejar UNA.
--    Solo borra si la salida se corrio hacia adelante. Si se acorta la estadia el medio dia
--    sobrevive, que es lo que ya hace la salida anticipada (mig 71) y esta bien: ahi el
--    medio dia cubre las horas pasadas del check-out del ultimo dia.
--
-- 2) rpc_extend_reservation: el DELETE inline de la mig 100 pasa a ser la llamada al helper.
--    Mismo comportamiento, un solo lugar.
--
-- 3) rpc_update_reservation: con fechas cambiadas, suma los recargos preservados al total
--    recalculado, con el mismo idioma que las otras tres (total - base neta, piso en cero),
--    descontando antes el medio dia que el helper haya quitado.
--    Con precio override NO se toca el numero que tipeo el admin: el override es la ultima
--    palabra sobre el total y el campo viene precargado con el total actual, recargos
--    incluidos, asi que el admin esta viendo lo que decide. El medio dia subsumido se
--    quita igual, porque dejo de corresponder pase lo que pase con el total.
--    De paso se sacan dos SELECT redundantes: la fila ya viene leida con FOR UPDATE.
--
-- QUE NO CAMBIA: las otras tres funciones de re-tarifa (aparte del helper en extend), y
-- ninguna reserva guardada. Esta migracion es codigo, no datos.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig101$ ... $mig101$) SIN ;
-- final y SIN BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) El unico lugar donde se decide si el medio dia sigue correspondiendo.
--
--    Devuelve el monto que saco (0 si no saco nada), para que el llamador lo
--    descuente de los recargos que preserva y pueda avisarlo en pantalla.
--
--    NO se le da EXECUTE a authenticated a proposito: borra plata y solo tiene
--    sentido adentro de una re-tarifa. Los dos llamadores son SECURITY DEFINER
--    de postgres, asi que la ejecutan igual. Ojo con el idioma de GRANTs de este
--    repo: por el ALTER DEFAULT PRIVILEGES de Supabase toda funcion nace con un
--    grant EXPLICITO a authenticated, y "REVOKE ... FROM PUBLIC" no lo toca (ver
--    migs 85/86); por eso aca se revoca por rol.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_drop_subsumed_half_day(
  p_reservation_id uuid,
  p_old_checkout timestamptz,
  p_new_checkout timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_amount numeric;
BEGIN
  -- La salida no se corrio hacia adelante: la tarde del medio dia sigue sin estar
  -- paga por ninguna noche, el cargo se queda.
  IF p_old_checkout IS NULL OR p_new_checkout IS NULL OR p_new_checkout <= p_old_checkout THEN
    RETURN 0;
  END IF;

  -- El indice unico parcial extra_charges_one_half_day_per_reservation garantiza a lo
  -- sumo una fila, por eso el RETURNING ... INTO alcanza.
  DELETE FROM public.extra_charges
   WHERE reservation_id = p_reservation_id
     AND charge_type = 'half_day'
  RETURNING amount INTO v_amount;

  RETURN COALESCE(v_amount, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.app_drop_subsumed_half_day(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_drop_subsumed_half_day(uuid, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.app_drop_subsumed_half_day(uuid, timestamptz, timestamptz) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Ampliar: misma logica de la mig 100, ahora desde el helper.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Ampliar siempre corre la salida hacia adelante, asi que el medio dia (si hay) siempre
  -- queda subsumido; el helper igual lo decide por fecha, para que la regla sea una sola.
  v_half_day := public.app_drop_subsumed_half_day(p_reservation_id, v_r.check_out_target, v_new_out);

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Editar la reserva: los recargos dejan de evaporarse al cambiar las fechas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_update_reservation(
  p_reservation_id uuid,
  p_client_name text,
  p_client_dni text,
  p_client_phone text,
  p_check_in timestamp with time zone,
  p_check_out timestamp with time zone,
  p_notes text,
  p_override_total_price numeric DEFAULT NULL::numeric,
  p_guest_count integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_room_id INT;
  v_status public.reservation_status;
  v_associated_id UUID;
  v_paid_amount NUMERIC;
  v_old_check_in TIMESTAMPTZ;
  v_old_check_out TIMESTAMPTZ;
  v_old_base NUMERIC;
  v_old_discount_percent NUMERIC;
  v_old_discount_amount NUMERIC;
  v_old_total NUMERIC;
  v_client_name TEXT := NULLIF(BTRIM(p_client_name), '');
  v_client_dni TEXT := NULLIF(BTRIM(p_client_dni), '');
  v_client_phone TEXT := NULLIF(BTRIM(p_client_phone), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_base_total NUMERIC;
  v_discount_percent NUMERIC;
  v_discount_amount NUMERIC;
  v_final_total NUMERIC;
  v_half_day NUMERIC := 0;
  v_surcharges NUMERIC := 0;
  v_dates_changed BOOLEAN;
  v_is_admin BOOLEAN := public.app_is_admin();
  v_current_guest_count INTEGER;
  v_new_guest_count INTEGER;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Las fechas son obligatorias.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la de entrada.' USING errcode = '22023';
  END IF;

  SELECT room_id, status, associated_client_id, paid_amount, check_in_target, check_out_target,
         guest_count, base_total_price, discount_percent, discount_amount, total_price
  INTO v_room_id, v_status, v_associated_id, v_paid_amount, v_old_check_in, v_old_check_out,
       v_current_guest_count, v_old_base, v_old_discount_percent, v_old_discount_amount, v_old_total
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede editar una reserva finalizada o cancelada.' USING errcode = '22023';
  END IF;

  IF v_status = 'checked_in' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Despues del check-in solo se puede ampliar, cambiar de habitacion o hacer check-out.' USING errcode = '42501';
  END IF;

  v_dates_changed := (p_check_in <> v_old_check_in) OR (p_check_out <> v_old_check_out);
  v_new_guest_count := COALESCE(p_guest_count, v_current_guest_count);
  IF v_new_guest_count < 1 THEN v_new_guest_count := 1; END IF;

  IF v_dates_changed THEN
    -- Si la salida se corrio hacia adelante, la noche nueva se come la tarde del medio dia
    -- (misma regla que al ampliar, mig 100). El helper decide y devuelve lo que saco.
    v_half_day := public.app_drop_subsumed_half_day(p_reservation_id, v_old_check_out, p_check_out);

    -- Recargos que sobreviven a la re-tarifa: minibar, daños, y el medio dia si no quedo
    -- subsumido. Mismo idioma que rpc_extend_reservation, rpc_change_reservation_room y
    -- rpc_staff_early_checkout: lo que el total tenia arriba de la base neta. Antes esta
    -- linea no existia y los recargos se perdian del total.
    v_surcharges := GREATEST(
      0,
      round((v_old_total - (COALESCE(v_old_base, v_old_total) - COALESCE(v_old_discount_amount, 0)) - v_half_day)::numeric, 2)
    );
  END IF;

  IF p_override_total_price IS NOT NULL THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Solo un admin puede sobreescribir el precio total.' USING errcode = '42501';
    END IF;
    IF p_override_total_price < 0 THEN
      RAISE EXCEPTION 'El precio total no puede ser negativo.' USING errcode = '22023';
    END IF;
    IF p_override_total_price < v_paid_amount THEN
      RAISE EXCEPTION 'El total no puede ser menor al monto ya pagado.' USING errcode = '22023';
    END IF;

    IF v_dates_changed THEN
      SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount
      INTO v_base_total, v_discount_percent, v_discount_amount
      FROM public.app_calculate_reservation_pricing(v_room_id, p_check_in, p_check_out, v_associated_id) AS pricing;
    ELSE
      v_base_total := v_old_base;
      v_discount_percent := v_old_discount_percent;
      v_discount_amount := v_old_discount_amount;
    END IF;

    -- El override es la ultima palabra: el campo viene precargado con el total actual
    -- (recargos incluidos), asi que el admin decide viendo el numero completo.
    v_final_total := p_override_total_price;
  ELSIF v_dates_changed THEN
    SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
    INTO v_base_total, v_discount_percent, v_discount_amount, v_final_total
    FROM public.app_calculate_reservation_pricing(v_room_id, p_check_in, p_check_out, v_associated_id) AS pricing;

    v_final_total := round((v_final_total + v_surcharges)::numeric, 2);

    IF v_final_total < v_paid_amount THEN
      RAISE EXCEPTION 'El nuevo total calculado es menor al monto ya pagado. Cancela y reemiti la reserva.' USING errcode = '22023';
    END IF;
  ELSE
    v_base_total := v_old_base;
    v_discount_percent := v_old_discount_percent;
    v_discount_amount := v_old_discount_amount;
    v_final_total := v_old_total;
  END IF;

  UPDATE public.reservations
  SET client_name = v_client_name,
      client_dni = v_client_dni,
      client_phone = v_client_phone,
      notes = v_notes,
      check_in_target = p_check_in,
      check_out_target = p_check_out,
      base_total_price = v_base_total,
      discount_percent = v_discount_percent,
      discount_amount = v_discount_amount,
      total_price = v_final_total,
      guest_count = v_new_guest_count,
      late_check_out_until = CASE WHEN v_dates_changed THEN NULL ELSE late_check_out_until END,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'dates_changed', v_dates_changed,
    'price_overridden', (p_override_total_price IS NOT NULL),
    'base_total_price', v_base_total,
    'discount_percent', v_discount_percent,
    'discount_amount', v_discount_amount,
    'total_price', v_final_total,
    'guest_count', v_new_guest_count,
    -- Para avisarlo en pantalla, igual que al ampliar.
    'half_day_removed', (v_half_day > 0),
    'half_day_amount', v_half_day
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Las nuevas fechas se solapan con otra reserva activa en esta habitacion.' USING errcode = '23P01';
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_update_reservation(uuid, text, text, text, timestamptz, timestamptz, text, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_update_reservation(uuid, text, text, text, timestamptz, timestamptz, text, numeric, integer) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('101_editar_fechas_no_borra_los_recargos.sql');
  END IF;
END $$;

COMMIT;
