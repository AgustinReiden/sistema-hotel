-- Migration 88: la reserva de empresa NO pide el pasajero; se carga en el check-in
--
-- Contexto real del hotel: una empresa (ej. JUFEC) reserva para dentro de dos semanas
-- y todavia no sabe a que preventista manda, porque rotan. Hasta ahora el alta exigia
-- nombre + DNI del pasajero, asi que recepcion inventaba un nombre o cargaba el de otro
-- empleado, y ese dato quedaba pegado a la estadia (libro de pasajeros, comprobantes).
--
-- Modelo nuevo:
--   * Alta de reserva de EMPRESA -> solo la empresa. client_name queda con el nombre de
--     la empresa, client_dni NULL y company_passenger_id NULL ("pasajero a definir").
--   * Check-in -> ahi se carga quien entra de verdad: find-or-create en company_passengers
--     (dedup por DNI dentro de la empresa, igual que en el alta) y se pisan los client_*
--     de la reserva con el pasajero real.
--   * Reserva de PERSONA -> sin cambios: nombre, apellido y DNI siguen siendo obligatorios
--     en el alta, porque ahi si se sabe quien viene.
--   * Walk-in (check-in directo) -> sin cambios: es un check-in, ya pide el pasajero.
--
-- Las guardas de la migracion 87 (estadia vencida, entrada futura, habitacion ocupada) y
-- las de la 39 (limpieza / mantenimiento) se conservan tal cual.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($MIG$ ... $MIG$) SIN ; final

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) rpc_staff_create_reservation: el pasajero es OPCIONAL en la reserva de empresa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_staff_create_reservation(
  p_room_id integer,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_client_name text DEFAULT NULL,
  p_client_dni text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT 1,
  p_guest_profession text DEFAULT NULL,
  p_guest_address text DEFAULT NULL,
  p_guest_locality text DEFAULT NULL,
  p_guest_nationality text DEFAULT NULL,
  p_guest_doc_type text DEFAULT NULL,
  p_guest_birth_date date DEFAULT NULL,
  p_guest_vehicle text DEFAULT NULL,
  p_client_first_name text DEFAULT NULL,
  p_client_last_name text DEFAULT NULL,
  p_guest_id uuid DEFAULT NULL,
  p_company_passenger_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_status public.reservation_status := 'confirmed';
  v_reservation_id uuid;
  v_client_first text := nullif(btrim(p_client_first_name), '');
  v_client_last text := nullif(btrim(p_client_last_name), '');
  v_client_name text := nullif(btrim(p_client_name), '');
  v_client_dni text := nullif(btrim(p_client_dni), '');
  v_client_phone text := nullif(btrim(p_client_phone), '');
  v_norm_dni text;
  v_guest_id uuid := NULL;
  v_company_passenger_id uuid := NULL;
  v_company_name text;
  v_guest_discount numeric := 0;
  v_associated_discount numeric;
  v_base_total_price numeric;
  v_discount_percent numeric;
  v_discount_amount numeric;
  v_final_total_price numeric;
  v_guest_count integer := GREATEST(1, COALESCE(p_guest_count, 1));
  v_room_status public.room_status;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT status INTO v_room_status FROM public.rooms WHERE id = p_room_id;
  IF v_room_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;

  -- Nombre del humano que se hospeda (huesped o pasajero): de client_name o compuesto.
  IF v_client_name IS NULL THEN
    v_client_name := nullif(btrim(coalesce(v_client_first, '') || ' ' || coalesce(v_client_last, '')), '');
  END IF;

  v_norm_dni := regexp_replace(upper(coalesce(v_client_dni, '')), '[^A-Z0-9]', '', 'g');

  IF p_associated_client_id IS NOT NULL THEN
    -- ===================== RESERVA DE EMPRESA =====================
    SELECT ac.discount_percent, ac.display_name
    INTO v_associated_discount, v_company_name
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id AND ac.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa/Convenio no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;
    v_discount_percent := COALESCE(v_associated_discount, 0);

    IF v_client_name IS NULL AND v_client_dni IS NULL THEN
      -- Pasajero a definir: la reserva queda a nombre de la empresa y el humano real
      -- se carga en el check-in (rpc_staff_checkin_reservation).
      v_client_name := v_company_name;
      v_client_first := NULL;
      v_client_last := NULL;
      v_client_phone := NULL;
      v_company_passenger_id := NULL;
    ELSIF v_client_name IS NULL OR v_client_dni IS NULL THEN
      RAISE EXCEPTION 'Para cargar el pasajero hacen falta el nombre y el DNI.' USING errcode = '22023';
    ELSE
      -- Find-or-create del pasajero DENTRO de la empresa (dedup por DNI por empresa).
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
        INSERT INTO public.company_passengers (associated_client_id, full_name, document_id, phone)
        VALUES (p_associated_client_id, v_client_name, v_client_dni, v_client_phone)
        RETURNING id INTO v_company_passenger_id;
      ELSE
        UPDATE public.company_passengers cp SET
          full_name = v_client_name,
          document_id = COALESCE(cp.document_id, v_client_dni),
          phone = COALESCE(cp.phone, v_client_phone),
          updated_at = v_now
        WHERE cp.id = v_company_passenger_id;
      END IF;
    END IF;
  ELSE
    -- ===================== RESERVA DE PERSONA =====================
    -- Aca si se sabe quien viene: nombre y DNI siguen siendo obligatorios.
    IF v_client_name IS NULL THEN
      RAISE EXCEPTION 'El nombre del huesped/pasajero es obligatorio.' USING errcode = '22023';
    END IF;
    IF v_client_dni IS NULL THEN
      RAISE EXCEPTION 'El DNI o CUIT es obligatorio.' USING errcode = '22023';
    END IF;

    -- Descuento personal: SOLO si el huesped se eligio del padron (p_guest_id).
    v_guest_id := p_guest_id;
    IF v_guest_id IS NOT NULL THEN
      SELECT g.discount_percent INTO v_guest_discount FROM public.guests g WHERE g.id = v_guest_id;
      IF NOT FOUND THEN
        v_guest_id := NULL;
        v_guest_discount := 0;
      END IF;
    END IF;

    -- Link al padron (find-or-create) para autocompletado futuro.
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
        address, locality, nationality, profession, phone
      )
      VALUES (
        v_client_name, v_client_first, v_client_last,
        nullif(btrim(p_guest_doc_type), ''), v_client_dni,
        nullif(btrim(p_guest_address), ''), nullif(btrim(p_guest_locality), ''),
        nullif(btrim(p_guest_nationality), ''), nullif(btrim(p_guest_profession), ''),
        v_client_phone
      )
      RETURNING id INTO v_guest_id;
    ELSE
      UPDATE public.guests g SET
        first_name = COALESCE(g.first_name, v_client_first),
        last_name = COALESCE(g.last_name, v_client_last),
        document_id = COALESCE(g.document_id, v_client_dni),
        document_type = COALESCE(g.document_type, nullif(btrim(p_guest_doc_type), '')),
        phone = COALESCE(g.phone, v_client_phone),
        address = COALESCE(g.address, nullif(btrim(p_guest_address), '')),
        locality = COALESCE(g.locality, nullif(btrim(p_guest_locality), '')),
        nationality = COALESCE(g.nationality, nullif(btrim(p_guest_nationality), '')),
        profession = COALESCE(g.profession, nullif(btrim(p_guest_profession), '')),
        updated_at = v_now
      WHERE g.id = v_guest_id;
    END IF;

    v_discount_percent := COALESCE(v_guest_discount, 0);
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;
  IF p_check_out <= v_now THEN
    RAISE EXCEPTION 'No se puede crear una reserva cuyas fechas ya pasaron.' USING errcode = '22023';
  END IF;
  IF p_check_in <= v_now AND p_check_out > v_now AND v_room_status = 'available' THEN
    v_status := 'checked_in';
  END IF;

  -- Empresa sin pasajero cargado: la reserva NO entra sola aunque la fecha ya haya
  -- empezado. Queda como llegada pendiente y el check-in es el que pide quien entra,
  -- para no ocupar la habitacion con la estadia a nombre de la empresa.
  IF v_status = 'checked_in' AND p_associated_client_id IS NOT NULL AND v_company_passenger_id IS NULL THEN
    v_status := 'confirmed';
  END IF;

  SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
  INTO v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price
  FROM public.app_calculate_reservation_pricing(
    p_room_id, p_check_in, p_check_out, NULL, v_discount_percent
  ) AS pricing;

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
    v_client_name, v_client_first, v_client_last, v_client_dni, v_client_phone,
    v_status, p_check_in,
    CASE WHEN v_status = 'checked_in' THEN v_now ELSE NULL END,
    p_check_out,
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

  IF v_status = 'checked_in' THEN
    UPDATE public.rooms SET status = 'occupied' WHERE id = p_room_id;
  END IF;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text, text, text, text, date, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text, text, text, text, date, text, text, text, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) rpc_staff_checkin_reservation: el check-in carga al pasajero de la empresa
-- ---------------------------------------------------------------------------
-- La firma vieja (solo p_reservation_id) se borra para que PostgREST no quede con
-- dos sobrecargas del mismo nombre.
DROP FUNCTION IF EXISTS public.rpc_staff_checkin_reservation(uuid);

CREATE OR REPLACE FUNCTION public.rpc_staff_checkin_reservation(
  p_reservation_id uuid,
  p_passenger_name text DEFAULT NULL,
  p_passenger_dni text DEFAULT NULL,
  p_passenger_phone text DEFAULT NULL,
  p_company_passenger_id uuid DEFAULT NULL,
  p_guest_profession text DEFAULT NULL,
  p_guest_address text DEFAULT NULL,
  p_guest_locality text DEFAULT NULL,
  p_guest_nationality text DEFAULT NULL,
  p_guest_doc_type text DEFAULT NULL,
  p_guest_birth_date date DEFAULT NULL,
  p_guest_vehicle text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_room_id int;
  v_status public.reservation_status;
  v_check_in_target timestamptz;
  v_check_out_target timestamptz;
  v_room_status public.room_status;
  v_tz text := 'UTC';
  v_associated_client_id uuid;
  v_current_passenger_id uuid;
  -- Pasajero que entra: quedan en NULL si el check-in no trae datos nuevos (reserva de
  -- persona, o reserva de empresa que ya tenia el pasajero cargado).
  v_name text := nullif(btrim(p_passenger_name), '');
  v_dni text := nullif(btrim(p_passenger_dni), '');
  v_phone text := nullif(btrim(p_passenger_phone), '');
  v_norm_dni text;
  v_passenger_id uuid := NULL;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, check_in_target, check_out_target, associated_client_id, company_passenger_id
  INTO v_room_id, v_status, v_check_in_target, v_check_out_target, v_associated_client_id, v_current_passenger_id
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Solo se puede hacer check-in de reservas pendientes o confirmadas.' USING errcode = '22023';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  -- La estadía ya terminó: el pasajero nunca llegó. Corresponde cancelarla o
  -- cargar una reserva nueva, no revivir la vieja.
  IF v_check_out_target <= v_now THEN
    RAISE EXCEPTION 'La reserva ya vencio: la salida estaba prevista para el %.',
      to_char(v_check_out_target AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI')
      USING errcode = '22023';
  END IF;

  -- Entrada de un día posterior: no se adelanta el check-in. Se compara por día
  -- del hotel para que una llegada temprana (antes del horario estándar) entre.
  IF (v_check_in_target AT TIME ZONE v_tz)::date > (v_now AT TIME ZONE v_tz)::date THEN
    RAISE EXCEPTION 'La entrada de esta reserva es el %. No se puede adelantar el check-in.',
      to_char(v_check_in_target AT TIME ZONE v_tz, 'DD/MM/YYYY')
      USING errcode = '22023';
  END IF;

  SELECT status INTO v_room_status FROM public.rooms WHERE id = v_room_id;

  IF v_room_status = 'cleaning' THEN
    RAISE EXCEPTION 'La habitacion todavia no fue habilitada por mantenimiento.' USING errcode = '22023';
  END IF;
  IF v_room_status = 'maintenance' THEN
    RAISE EXCEPTION 'La habitacion esta fuera de servicio por mantenimiento.' USING errcode = '22023';
  END IF;

  -- Ocupada por otra estadía en curso: primero el check-out del anterior.
  IF EXISTS (
    SELECT 1
    FROM public.reservations r
    WHERE r.room_id = v_room_id
      AND r.status = 'checked_in'
      AND r.id <> p_reservation_id
  ) THEN
    RAISE EXCEPTION 'La habitacion esta ocupada por otro huesped. Hace el check-out anterior primero.' USING errcode = '22023';
  END IF;

  -- ── Quien entra de verdad (solo reservas de empresa) ──────────────────────
  IF v_associated_client_id IS NOT NULL THEN
    IF v_name IS NULL OR v_dni IS NULL THEN
      -- Sin datos nuevos: solo pasa si la reserva ya traia el pasajero cargado.
      v_name := NULL;
      v_dni := NULL;
      v_phone := NULL;
      IF v_current_passenger_id IS NULL THEN
        RAISE EXCEPTION 'Carga el nombre y el DNI del pasajero que se hospeda.' USING errcode = '22023';
      END IF;
    ELSE
      -- Find-or-create dentro de la empresa (dedup por DNI, igual que en el alta).
      v_norm_dni := regexp_replace(upper(v_dni), '[^A-Z0-9]', '', 'g');
      v_passenger_id := p_company_passenger_id;

      IF v_passenger_id IS NOT NULL THEN
        PERFORM 1 FROM public.company_passengers
        WHERE id = v_passenger_id AND associated_client_id = v_associated_client_id;
        IF NOT FOUND THEN
          v_passenger_id := NULL;
        END IF;
      END IF;

      IF v_passenger_id IS NULL AND v_norm_dni <> '' THEN
        SELECT cp.id INTO v_passenger_id
        FROM public.company_passengers cp
        WHERE cp.associated_client_id = v_associated_client_id
          AND regexp_replace(upper(coalesce(cp.document_id, '')), '[^A-Z0-9]', '', 'g') = v_norm_dni
        ORDER BY cp.updated_at DESC
        LIMIT 1;
      END IF;

      IF v_passenger_id IS NULL THEN
        INSERT INTO public.company_passengers (associated_client_id, full_name, document_id, phone)
        VALUES (v_associated_client_id, v_name, v_dni, v_phone)
        RETURNING id INTO v_passenger_id;
      ELSE
        UPDATE public.company_passengers cp SET
          full_name = v_name,
          document_id = COALESCE(cp.document_id, v_dni),
          phone = COALESCE(cp.phone, v_phone),
          updated_at = v_now
        WHERE cp.id = v_passenger_id;
      END IF;
    END IF;
  ELSE
    -- Reserva de persona: el huesped ya se cargo en el alta, no se pisa nada.
    v_name := NULL;
    v_dni := NULL;
    v_phone := NULL;
  END IF;

  UPDATE public.reservations
  SET status = 'checked_in',
      actual_check_in = v_now,
      company_passenger_id = COALESCE(v_passenger_id, company_passenger_id),
      client_name = COALESCE(v_name, client_name),
      client_dni = COALESCE(v_dni, client_dni),
      client_phone = COALESCE(v_phone, client_phone),
      guest_profession = COALESCE(nullif(btrim(p_guest_profession), ''), guest_profession),
      guest_address = COALESCE(nullif(btrim(p_guest_address), ''), guest_address),
      guest_locality = COALESCE(nullif(btrim(p_guest_locality), ''), guest_locality),
      guest_nationality = COALESCE(nullif(btrim(p_guest_nationality), ''), guest_nationality),
      guest_doc_type = COALESCE(nullif(btrim(p_guest_doc_type), ''), guest_doc_type),
      guest_birth_date = COALESCE(p_guest_birth_date, guest_birth_date),
      guest_vehicle = COALESCE(nullif(btrim(p_guest_vehicle), ''), guest_vehicle),
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms
  SET status = 'occupied'
  WHERE id = v_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_checkin_reservation(uuid, text, text, text, uuid, text, text, text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_checkin_reservation(uuid, text, text, text, uuid, text, text, text, text, text, date, text) TO authenticated;

COMMIT;
