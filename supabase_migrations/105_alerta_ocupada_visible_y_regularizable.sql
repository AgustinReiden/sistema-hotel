-- Migration 105: La alerta de "habitacion ocupada sin reserva" se ve en recepcion
-- y se puede regularizar cargando la estadia.
--
-- EL PROBLEMA, MEDIDO. En PROD hay 19 alertas de este tipo. Las 19 estan resueltas,
-- NINGUNA termino en una estadia cargada y NINGUNA tiene nota de por que se cerro.
-- Varias se resolvieron 18 dias despues, en tanda. O sea: la pieza se uso, no se
-- cobro, y el aviso se limpio de un saque sin que quede rastro de nada.
--
-- POR QUE NO SE VE. admin_alerts tiene RLS admin-only (mig 41). El recepcionista
-- -que es el que esta en el mostrador cuando la mucama avisa- no puede leer la
-- tabla: lo unico que ve es un contador anonimo dentro del cierre de caja.
--
-- COMO SE ABRE SIN ABRIR LA TABLA. No se toca la policy. Se expone una ventana
-- SECURITY DEFINER con app_is_staff() que devuelve UN SOLO kind y SOLO lo no
-- resuelto. El precedente exacto es rpc_close_shift_blockers() (mig 71), que
-- existe por esta misma razon.
--
-- REGULARIZAR, NO FACTURAR SOLO. La planilla del gerente pide que el sistema genere
-- el check-in, el check-out y la factura automaticamente. No se hace: PROD emite
-- comprobantes AFIP reales (PV 8), y un tilde mal puesto de la mucama terminaria en
-- una factura real que despues hay que anular con nota de credito. Lo que se hace es
-- dejar la estadia cargada en un clic, con quien la cargo; el cobro y la decision de
-- facturar siguen el camino de siempre (check-out).
--
-- POR QUE EL WALK-IN NECESITA FECHA RETROACTIVA. La mucama avisa a la manana por una
-- pieza que se uso ANOCHE. Hoy rpc_staff_assign_walk_in clava el check-in en now(),
-- asi que la salida calculada queda un dia para adelante y el sistema cree que el
-- tipo sigue alojado. Se agrega p_check_in_date.
--
-- ES UNA FECHA (date) Y NO UN timestamptz A PROPOSITO. La hora de entrada sale de
-- hotel_settings.standard_check_in_time, que esta funcion ya lee, y la conversion a
-- UTC la hace Postgres con AT TIME ZONE. Si viajara un timestamp armado en el
-- navegador, la zona la resolveria la maquina del empleado: el mismo bug de zona
-- que ya se corrigio en el listado de facturacion. Ademas achica la superficie:
-- con una fecha no se puede mandar una hora rara.
--
-- NO ALCANZABA "cargar y despues editar las fechas": rpc_update_reservation le
-- prohibe al recepcionista editar una reserva ya checked_in (mig 70), asi que ese
-- camino solo funcionaria para el admin.
--
-- APLICAR A PROD por secciones via select public.exec_ddl($MIG$ ... $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT.
-- OJO: la SECCION 2 (DROP + CREATE de rpc_staff_assign_walk_in) va en UNA SOLA
-- llamada a exec_ddl. Partida en dos, el hotel se queda sin poder cargar walk-ins
-- entre una y otra. Verificar despues:
--   select proname, pronargs from pg_proc where proname = 'rpc_staff_assign_walk_in';
-- tiene que devolver UNA sola fila, con 19. Si devuelve dos, quedo un overload y
-- PostgREST elige mal.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCION 1) La ventana de staff sobre las alertas de ocupacion.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_room_occupancy_alerts()
RETURNS TABLE (
  alert_id bigint,
  room_id integer,
  room_number text,
  message text,
  created_at timestamptz,
  detected_at timestamptz,
  reported_by_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.related_room_id, r.room_number, a.message, a.created_at,
         -- Cuando la mucama lo vio, que no es cuando alguien lo mira: es la fecha
         -- que hay que precargar en la estadia.
         COALESCE(l.cleaned_at, a.created_at),
         l.cleaner_name
  FROM public.admin_alerts a
  LEFT JOIN public.rooms r ON r.id = a.related_room_id
  LEFT JOIN public.room_cleaning_log l ON l.id = a.related_cleaning_log_id
  WHERE a.kind = 'room_occupied_without_active_reservation'
    AND a.resolved_at IS NULL
  ORDER BY a.created_at DESC
  LIMIT 50;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_list_room_occupancy_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_room_occupancy_alerts() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCION 2) Walk-in con entrada retroactiva. DROP + CREATE EN UNA SOLA SECCION.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid);

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
  p_check_in_date date DEFAULT NULL::date
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
    -- del hotel. Sin ella, todo sigue exactamente como antes: now().
    v_checkin_target := CASE
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
  -- distintas sobre la misma noche.
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
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(
  integer, text, integer, uuid, integer, boolean, text, text, text, text,
  text, date, text, text, text, text, uuid, uuid, date) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCION 3) Cerrar la alerta cargando la estadia.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_regularize_occupied_room(
  p_alert_id bigint,
  p_reservation_id uuid,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kind text;
  v_room_id integer;
  v_resolved timestamptz;
  v_res_room_id integer;
  v_res_status public.reservation_status;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT a.kind, a.related_room_id, a.resolved_at
  INTO v_kind, v_room_id, v_resolved
  FROM public.admin_alerts a
  WHERE a.id = p_alert_id
  FOR UPDATE;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Aviso no encontrado.' USING errcode = 'P0002';
  END IF;

  IF v_kind <> 'room_occupied_without_active_reservation' THEN
    RAISE EXCEPTION 'Este aviso no se regulariza cargando una estadia.' USING errcode = '22023';
  END IF;

  -- IDEMPOTENTE A PROPOSITO. El front hace dos llamadas seguidas (cargar la estadia
  -- y cerrar el aviso). Si la segunda falla por red, el reintento tiene que ser
  -- seguro: la plata ya esta cargada y volver a explotar aca no arregla nada.
  IF v_resolved IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  SELECT r.room_id, r.status INTO v_res_room_id, v_res_status
  FROM public.reservations r WHERE r.id = p_reservation_id;

  IF v_res_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_res_status <> 'checked_in' THEN
    RAISE EXCEPTION 'La estadia tiene que estar con el huesped adentro para cerrar el aviso.' USING errcode = '22023';
  END IF;
  -- Que la estadia sea de ESTA pieza es lo unico que hace que el aviso quede
  -- explicado. Sin esta validacion, cerrar el aviso seria apuntar a cualquier cosa.
  IF v_room_id IS NOT NULL AND v_res_room_id <> v_room_id THEN
    RAISE EXCEPTION 'Esa estadia es de otra habitacion.' USING errcode = '22023';
  END IF;

  UPDATE public.admin_alerts
  SET resolved_at = NOW(),
      resolved_by = auth.uid(),
      resolved_notes = NULLIF(BTRIM(p_notes), ''),
      decision = 'regularizada',
      related_reservation_id = p_reservation_id
  WHERE id = p_alert_id AND resolved_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'already', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_regularize_occupied_room(bigint, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_regularize_occupied_room(bigint, uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCION 4) Cerrar el aviso SIN cargar la estadia exige explicar por que.
-- ─────────────────────────────────────────────────────────────────────────────
-- Sigue siendo admin-only: el recepcionista puede regularizar (que genera plata)
-- pero no puede hacer desaparecer el aviso. Y el admin que lo cierra sin cobrar
-- tiene que dejar dicho por que, porque hoy las 19 alertas de PROD se cerraron
-- con resolved_notes en NULL y no hay forma de saber que paso en ninguna.
CREATE OR REPLACE FUNCTION public.rpc_resolve_admin_alert(p_alert_id bigint, p_notes text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kind text;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT a.kind INTO v_kind
  FROM public.admin_alerts a
  WHERE a.id = p_alert_id AND a.resolved_at IS NULL;

  IF v_kind = 'room_occupied_without_active_reservation'
     AND NULLIF(BTRIM(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Explica por que se cierra el aviso sin cargar la estadia.' USING errcode = '22023';
  END IF;

  UPDATE public.admin_alerts
  SET resolved_at = NOW(),
      resolved_by = auth.uid(),
      resolved_notes = NULLIF(BTRIM(p_notes), '')
  WHERE id = p_alert_id AND resolved_at IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_resolve_admin_alert(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_admin_alert(bigint, text) TO authenticated;

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('105_alerta_ocupada_visible_y_regularizable.sql');
  END IF;
END $do$;

COMMIT;
