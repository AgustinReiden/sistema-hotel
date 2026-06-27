-- Migration 61: Walk-in (check-in directo) con fork persona/empresa
--
-- Aplica al rpc_staff_assign_walk_in el mismo modelo de la migracion 60:
--   - Persona: find-or-create del huesped en guests; descuento personal si se eligio del padron.
--   - Empresa: descuento de la empresa + find-or-create del pasajero en company_passengers.
-- client_* guarda al humano que duerme (huesped o pasajero). Se quita "Pasajero: ..." de notes.
-- Reemplaza la firma de la migracion 57 (p_guest_name/p_guest_dni) por p_guest_id +
-- p_company_passenger_id.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer, boolean, text, text, text, text, text, text, text, date, text, text, text, text);

CREATE OR REPLACE FUNCTION public.rpc_staff_assign_walk_in(
  p_room_id integer,
  p_client_name text DEFAULT NULL,
  p_nights integer DEFAULT NULL,
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT 1,
  p_half_day boolean DEFAULT false,
  p_guest_profession text DEFAULT NULL,
  p_guest_address text DEFAULT NULL,
  p_guest_locality text DEFAULT NULL,
  p_guest_nationality text DEFAULT NULL,
  p_guest_doc_type text DEFAULT NULL,
  p_guest_birth_date date DEFAULT NULL,
  p_guest_vehicle text DEFAULT NULL,
  p_client_dni text DEFAULT NULL,
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
  v_checkout_time time := '10:00'::time;
  v_tz text := 'UTC';
  v_checkin_target timestamptz;
  v_checkout_target timestamptz;
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
    -- ===================== EMPRESA =====================
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
    -- ===================== PERSONA =====================
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

  SELECT standard_check_out_time, COALESCE(timezone, 'UTC')
  INTO v_checkout_time, v_tz
  FROM public.hotel_settings ORDER BY id LIMIT 1;

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
    v_checkin_target := v_now;
    v_checkout_target := ((((v_now AT TIME ZONE v_tz)::date + p_nights) + v_checkout_time) AT TIME ZONE v_tz);

    SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
    INTO v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price
    FROM public.app_calculate_reservation_pricing(
      p_room_id, v_checkin_target, v_checkout_target, NULL, v_discount_percent
    ) AS pricing;
  END IF;

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
    'checked_in', v_checkin_target, v_now, v_checkout_target,
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
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer, boolean, text, text, text, text, text, date, text, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer, boolean, text, text, text, text, text, date, text, text, text, text, uuid, uuid) TO authenticated;

COMMIT;
