-- Migration 115: El walk-in de madrugada puede cargarse como la noche de anoche.
--
-- LO QUE PASO. El 21/09 a las 00:30 llego a la hab. 6 el pasajero de una reserva de
-- JUFEC para la noche del 20. Recepcion no le pudo hacer el check-in: la tarjeta
-- mostraba la reserva que entraba el 21 a las 14:00 (eso se arregla en la app, en
-- findPendingArrival). Pero aunque hubiera querido cargarlo como walk-in, tampoco
-- podia: esta funcion clavaba la entrada en now() y contaba las noches desde HOY, asi
-- que un walk-in de 1 noche a las 00:30 salia MANANA a las 10:00. Eso ocupa la noche
-- del 21, que ya estaba vendida, y la base lo rechazaba con un mensaje que no decia
-- contra que reserva chocaba.
--
-- LO QUE HACEN LOS PASAJEROS DE MADRUGADA. Medido en PROD: casi todos los que entran
-- entre las 00:00 y las 06:00 se van esa misma manana. La salida de manana a las 10:00
-- era ficcion, y ademas bloqueaba la pieza para la noche siguiente.
--
-- LA REGLA. Antes de la hora de salida estandar, la noche de ayer todavia no termino.
-- El formulario del walk-in pregunta que noche se esta vendiendo y viene marcada la de
-- anoche. Con p_last_night:
--   - la entrada nominal es AYER a la hora estandar de check-in, igual que una reserva
--     de anoche que hace el check-in a las 00:30;
--   - actual_check_in es now(): el pasajero esta en el mostrador, no es un uso viejo;
--   - las noches se cuentan desde esa entrada, asi que 1 noche sale HOY a las 10:00.
-- La tarifa sigue saliendo de app_calculate_reservation_pricing / app_hotel_nights
-- (mig 96): no hay una segunda cuenta de noches.
--
-- POR QUE UN FLAG Y NO REUSAR p_check_in_date. La fecha retroactiva (mig 105) es para
-- regularizar un uso que YA PASO: pone actual_check_in en la entrada nominal porque la
-- hora real no se sabe. Aca la hora real se sabe (es ahora). Y la fecha la decide la
-- base con su reloj y su zona, no el navegador del empleado. La base vuelve a exigir
-- que sea de madrugada: pasada la hora de salida, la noche de anoche ya termino.
--
-- EL CHOQUE AHORA DICE CONTRA QUIEN. Si el rango pisa otra reserva activa, el error
-- nombra esa reserva y sus fechas, en vez de un generico que no deja entender que pasa.
--
-- APLICAR A PROD con select public.exec_ddl($MIG$ ... $MIG$) SIN ; final y SIN
-- BEGIN/COMMIT. El DROP + CREATE va en UNA SOLA llamada: partido en dos, el hotel se
-- queda sin poder cargar walk-ins entre una y otra. Verificar despues:
--   select proname, pronargs from pg_proc where proname = 'rpc_staff_assign_walk_in';
-- tiene que devolver UNA sola fila, con 20. Si devuelve dos, quedo un overload y
-- PostgREST elige mal. Los comentarios de adentro de la funcion van sin comillas (el
-- conector MCP se traba con comillas en comentarios, y viajan a prosrc).
--
-- Compatible hacia atras: el parametro nuevo tiene default, asi que la app vieja sigue
-- andando igual contra esta funcion hasta que se despliegue la nueva.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid, date);

CREATE FUNCTION public.rpc_staff_assign_walk_in(
  p_room_id integer,
  p_client_name text DEFAULT NULL::text,
  p_nights integer DEFAULT NULL::integer,
  p_associated_client_id uuid DEFAULT NULL::uuid,
  p_guest_count integer DEFAULT 1,
  p_half_day boolean DEFAULT false,
  p_guest_profession text DEFAULT NULL::text,
  p_guest_address text DEFAULT NULL::text,
  p_guest_locality text DEFAULT NULL::text,
  p_guest_nationality text DEFAULT NULL::text,
  p_guest_doc_type text DEFAULT NULL::text,
  p_guest_birth_date date DEFAULT NULL::date,
  p_guest_vehicle text DEFAULT NULL::text,
  p_client_dni text DEFAULT NULL::text,
  p_client_first_name text DEFAULT NULL::text,
  p_client_last_name text DEFAULT NULL::text,
  p_guest_id uuid DEFAULT NULL::uuid,
  p_company_passenger_id uuid DEFAULT NULL::uuid,
  p_check_in_date date DEFAULT NULL::date,
  p_last_night boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_checkout_time time := '10:00'::time;
  v_checkin_time time := '14:00'::time;
  v_today date;
  v_tz text := 'UTC';
  v_checkin_target timestamptz;
  v_checkout_target timestamptz;
  v_actual_check_in timestamptz;
  v_reservation_id uuid;
  v_client_first text := nullif(btrim(p_client_first_name), '');
  v_client_last text := nullif(btrim(p_client_last_name), '');
  v_client_name text := nullif(btrim(p_client_name), '');
  v_client_dni text := nullif(btrim(p_client_dni), '');
  v_norm_dni text;
  v_guest_id uuid := NULL;
  v_company_passenger_id uuid := NULL;
  v_guest_discount numeric := 0;
  v_associated_discount numeric;
  v_base_total_price numeric;
  v_discount_percent numeric := 0;
  v_discount_amount numeric;
  v_final_total_price numeric;
  v_half_day_price numeric;
  v_guest_count integer := GREATEST(1, COALESCE(p_guest_count, 1));
  v_room_status public.room_status;
  v_conflict_name text;
  v_conflict_in timestamptz;
  v_conflict_out timestamptz;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF NOT p_half_day THEN
    IF p_nights IS NULL OR p_nights < 1 OR p_nights > 30 THEN
      RAISE EXCEPTION 'La cantidad de noches debe estar entre 1 y 30.' USING errcode = '22023';
    END IF;
  END IF;

  -- Una siesta retroactiva no significa nada. El resto de los guards de la fecha
  -- necesitan la zona del hotel, asi que van mas abajo, con hotel_settings a mano.
  IF p_check_in_date IS NOT NULL AND p_half_day THEN
    RAISE EXCEPTION 'El medio dia no admite fecha de entrada retroactiva.' USING errcode = '22023';
  END IF;

  -- La noche de anoche es una noche: no se combina con la siesta, y tampoco con una
  -- fecha retroactiva, que es otra forma de decir desde cuando se cobra.
  IF p_last_night AND p_half_day THEN
    RAISE EXCEPTION 'El medio dia no se puede cargar como la noche de anoche.' USING errcode = '22023';
  END IF;
  IF p_last_night AND p_check_in_date IS NOT NULL THEN
    RAISE EXCEPTION 'Elegi la noche de anoche o una fecha de entrada, no las dos.' USING errcode = '22023';
  END IF;

  SELECT status INTO v_room_status FROM public.rooms WHERE id = p_room_id;
  IF v_room_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_room_status = 'cleaning' THEN
    RAISE EXCEPTION 'La habitacion todavia no fue habilitada por mantenimiento.' USING errcode = '22023';
  END IF;
  IF v_room_status = 'maintenance' THEN
    RAISE EXCEPTION 'La habitacion esta fuera de servicio por mantenimiento.' USING errcode = '22023';
  END IF;

  IF v_client_name IS NULL THEN
    v_client_name := nullif(btrim(coalesce(v_client_first, '') || ' ' || coalesce(v_client_last, '')), '');
  END IF;
  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped/pasajero es obligatorio.' USING errcode = '22023';
  END IF;
  IF v_client_dni IS NULL THEN
    RAISE EXCEPTION 'El DNI o CUIT es obligatorio.' USING errcode = '22023';
  END IF;

  v_norm_dni := regexp_replace(upper(v_client_dni), '[^A-Z0-9]', '', 'g');

  IF p_associated_client_id IS NOT NULL THEN
    SELECT ac.discount_percent INTO v_associated_discount
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id AND ac.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa/Convenio no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;
    v_discount_percent := COALESCE(v_associated_discount, 0);

    v_company_passenger_id := p_company_passenger_id;
    IF v_company_passenger_id IS NOT NULL THEN
      PERFORM 1 FROM public.company_passengers
      WHERE id = v_company_passenger_id AND associated_client_id = p_associated_client_id;
      IF NOT FOUND THEN
        v_company_passenger_id := NULL;
      END IF;
    END IF;

    IF v_company_passenger_id IS NULL AND v_norm_dni <> '' THEN
      SELECT cp.id INTO v_company_passenger_id
      FROM public.company_passengers cp
      WHERE cp.associated_client_id = p_associated_client_id
        AND regexp_replace(upper(coalesce(cp.document_id, '')), '[^A-Z0-9]', '', 'g') = v_norm_dni
      ORDER BY cp.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_company_passenger_id IS NULL THEN
      INSERT INTO public.company_passengers (associated_client_id, full_name, document_id)
      VALUES (p_associated_client_id, v_client_name, v_client_dni)
      RETURNING id INTO v_company_passenger_id;
    ELSE
      UPDATE public.company_passengers cp SET
        full_name = v_client_name,
        document_id = COALESCE(cp.document_id, v_client_dni),
        updated_at = v_now
      WHERE cp.id = v_company_passenger_id;
    END IF;
  ELSE
    v_guest_id := p_guest_id;
    IF v_guest_id IS NOT NULL THEN
      SELECT g.discount_percent INTO v_guest_discount FROM public.guests g WHERE g.id = v_guest_id;
      IF NOT FOUND THEN
        v_guest_id := NULL;
        v_guest_discount := 0;
      END IF;
    END IF;

    IF v_guest_id IS NULL AND v_norm_dni <> '' THEN
      SELECT g.id INTO v_guest_id
      FROM public.guests g
      WHERE regexp_replace(upper(coalesce(g.document_id, '')), '[^A-Z0-9]', '', 'g') = v_norm_dni
      ORDER BY g.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_guest_id IS NULL THEN
      INSERT INTO public.guests (
        full_name, first_name, last_name, document_type, document_id,
        address, locality, nationality, profession
      )
      VALUES (
        v_client_name, v_client_first, v_client_last,
        nullif(btrim(p_guest_doc_type), ''), v_client_dni,
        nullif(btrim(p_guest_address), ''), nullif(btrim(p_guest_locality), ''),
        nullif(btrim(p_guest_nationality), ''), nullif(btrim(p_guest_profession), '')
      )
      RETURNING id INTO v_guest_id;
    ELSE
      UPDATE public.guests g SET
        first_name = COALESCE(g.first_name, v_client_first),
        last_name = COALESCE(g.last_name, v_client_last),
        document_id = COALESCE(g.document_id, v_client_dni),
        document_type = COALESCE(g.document_type, nullif(btrim(p_guest_doc_type), '')),
        address = COALESCE(g.address, nullif(btrim(p_guest_address), '')),
        locality = COALESCE(g.locality, nullif(btrim(p_guest_locality), '')),
        nationality = COALESCE(g.nationality, nullif(btrim(p_guest_nationality), '')),
        profession = COALESCE(g.profession, nullif(btrim(p_guest_profession), '')),
        updated_at = v_now
      WHERE g.id = v_guest_id;
    END IF;

    v_discount_percent := COALESCE(v_guest_discount, 0);
  END IF;

  SELECT standard_check_out_time, standard_check_in_time, COALESCE(timezone, 'UTC')
  INTO v_checkout_time, v_checkin_time, v_tz
  FROM public.hotel_settings ORDER BY id LIMIT 1;

  -- Guards de la entrada retroactiva, ya con la zona del hotel resuelta. Es una
  -- puerta para regularizar un uso que YA PASO, no para inventar estadias: ni al
  -- futuro, ni mas de una semana para atras.
  IF p_check_in_date IS NOT NULL THEN
    v_today := (v_now AT TIME ZONE v_tz)::date;
    IF p_check_in_date > v_today THEN
      RAISE EXCEPTION 'La fecha de entrada no puede ser futura.' USING errcode = '22023';
    END IF;
    IF p_check_in_date < v_today - 7 THEN
      RAISE EXCEPTION 'La fecha de entrada no puede ser de hace mas de 7 dias.' USING errcode = '22023';
    END IF;
  END IF;

  -- La noche de anoche sigue corriendo solo hasta la hora de salida estandar. Lo
  -- decide el reloj de la base, no el del navegador: pasada esa hora, la noche de
  -- ayer ya termino y lo que se vende es la de hoy.
  IF p_last_night AND (v_now AT TIME ZONE v_tz)::time >= v_checkout_time THEN
    RAISE EXCEPTION 'Ya pasaron las %: la noche de anoche termino. Cargalo como una noche de hoy.',
      to_char(v_checkout_time, 'HH24:MI')
      USING errcode = '22023';
  END IF;

  IF p_half_day THEN
    v_checkin_target := (((v_now AT TIME ZONE v_tz)::date + time '12:00') AT TIME ZONE v_tz);
    v_checkout_target := (((v_now AT TIME ZONE v_tz)::date + time '17:00') AT TIME ZONE v_tz);

    SELECT half_day_price INTO v_half_day_price FROM public.rooms WHERE id = p_room_id;
    IF v_half_day_price IS NULL OR v_half_day_price <= 0 THEN
      RAISE EXCEPTION 'La habitacion no tiene precio de media estadia (siesta) configurado.' USING errcode = '22023';
    END IF;

    v_base_total_price := v_half_day_price;
    v_discount_percent := round(v_discount_percent, 2);
    v_discount_amount := round(v_base_total_price * v_discount_percent / 100, 2);
    v_final_total_price := v_base_total_price - v_discount_amount;
  ELSE
    -- Con fecha retroactiva, la entrada es esa fecha a la hora estandar de check-in
    -- del hotel. La noche de anoche es lo mismo con la fecha de AYER, que pone la
    -- base: queda igual que una reserva de anoche que hace el check-in de madrugada.
    -- Sin ninguna de las dos, todo sigue exactamente como antes: now().
    v_checkin_target := CASE
      WHEN p_last_night THEN ((((v_now AT TIME ZONE v_tz)::date - 1) + v_checkin_time) AT TIME ZONE v_tz)
      WHEN p_check_in_date IS NULL THEN v_now
      ELSE ((p_check_in_date + v_checkin_time) AT TIME ZONE v_tz)
    END;
    -- Las noches se cuentan desde la entrada REAL, no desde hoy: si no, regularizar
    -- el uso de anoche con 1 noche daria una salida manana y el sistema creeria que
    -- el pasajero sigue adentro.
    v_checkout_target := ((((v_checkin_target AT TIME ZONE v_tz)::date + p_nights) + v_checkout_time) AT TIME ZONE v_tz);

    -- La tarifa sale del unico lugar que sabe tarifar, que ademas cuenta las noches
    -- con app_hotel_nights (mig 96). No hay una segunda cuenta de noches aca.
    SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
    INTO v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price
    FROM public.app_calculate_reservation_pricing(
      p_room_id, v_checkin_target, v_checkout_target, NULL, v_discount_percent
    ) AS pricing;
  END IF;

  -- actual_check_in acompana a la entrada retroactiva, pero NO al medio dia: ahi
  -- check_in_target son las 12:00 nominales y el ingreso real sigue siendo ahora.
  -- Sin esto, el guard del cierre de caja y el log de limpieza contarian historias
  -- distintas sobre la misma noche. La noche de anoche NO es retroactiva: el pasajero
  -- esta en el mostrador, asi que su ingreso real es ahora (p_check_in_date va NULL).
  v_actual_check_in := CASE
    WHEN p_check_in_date IS NULL OR p_half_day THEN v_now
    ELSE v_checkin_target
  END;

  INSERT INTO public.reservations (
    room_id, associated_client_id, guest_id, company_passenger_id,
    client_name, client_first_name, client_last_name, client_dni, client_phone,
    status, check_in_target, actual_check_in, check_out_target,
    base_total_price, discount_percent, discount_amount, total_price,
    guest_count, notes,
    guest_profession, guest_address, guest_locality, guest_nationality, guest_doc_type, guest_birth_date, guest_vehicle,
    updated_at
  )
  VALUES (
    p_room_id, p_associated_client_id, v_guest_id, v_company_passenger_id,
    v_client_name, v_client_first, v_client_last, v_client_dni, NULL,
    'checked_in', v_checkin_target, v_actual_check_in, v_checkout_target,
    v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price,
    v_guest_count, NULL,
    nullif(btrim(p_guest_profession), ''),
    nullif(btrim(p_guest_address), ''),
    nullif(btrim(p_guest_locality), ''),
    nullif(btrim(p_guest_nationality), ''),
    nullif(btrim(p_guest_doc_type), ''),
    p_guest_birth_date,
    nullif(btrim(p_guest_vehicle), ''),
    v_now
  )
  RETURNING id INTO v_reservation_id;

  UPDATE public.rooms SET status = 'occupied' WHERE id = p_room_id;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    -- Decir contra quien choca. Sin esto recepcion solo leia que el rango no estaba
    -- disponible y no tenia como saber que reserva lo ocupaba.
    SELECT r.client_name, r.check_in_target, r.check_out_target
    INTO v_conflict_name, v_conflict_in, v_conflict_out
    FROM public.reservations r
    WHERE r.room_id = p_room_id
      AND r.status IN ('pending', 'confirmed', 'checked_in')
      AND tstzrange(r.check_in_target, r.check_out_target, '[)')
          && tstzrange(v_checkin_target, v_checkout_target, '[)')
    ORDER BY r.check_in_target
    LIMIT 1;

    IF v_conflict_name IS NOT NULL THEN
      RAISE EXCEPTION 'La habitacion ya tiene una reserva en esas fechas: % (del % al %).',
        v_conflict_name,
        to_char(v_conflict_in AT TIME ZONE v_tz, 'DD/MM HH24:MI'),
        to_char(v_conflict_out AT TIME ZONE v_tz, 'DD/MM HH24:MI')
        USING errcode = '23P01';
    END IF;
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid, date, boolean) TO service_role;

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('115_walk_in_de_madrugada_es_la_noche_de_anoche.sql');
  END IF;
END
$do$;

COMMIT;
