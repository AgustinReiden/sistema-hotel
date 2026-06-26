-- Migration 60: Walk-in (check-in directo) al flujo unico de huesped + empresa/convenio
--
-- Espeja en el walk-in el rediseno que la migracion 59 hizo en el alta de reserva. Antes el
-- walk-in (rpc_staff_assign_walk_in, vigente: migracion 57) forzaba elegir "Cliente ocasional"
-- vs "Empresa/Convenio", y en modo empresa guardaba a la empresa en client_* y al pasajero real
-- en notes ("Pasajero: ...").
--
-- Ahora, igual que rpc_staff_create_reservation:
-- 1) SIEMPRE recibe los datos de la persona (huesped) + p_guest_id opcional + p_associated_client_id
--    opcional. client_* = la persona; ya no se arma "Pasajero" en notes.
-- 2) Find-or-create del huesped en "guests" para que los walk-in tambien alimenten el padron /
--    autocompletado (enriquece datos faltantes sin pisar lo ya cargado).
-- 3) Precedencia de descuento empresa/convenio -> descuento personal del huesped (solo si se
--    eligio por p_guest_id) -> 0, usando el override p_discount_percent de la pricing (5to arg).
--
-- Se mantiene lo propio del walk-in: media estadia (siesta), guards de estado de la habitacion,
-- check-in inmediato (status checked_in + habitacion occupied) y el calculo por noches/siesta.
-- Como cambia la firma (se quitan p_guest_name/p_guest_dni, se agregan p_client_phone y
-- p_guest_id), se hace DROP de la version anterior antes del CREATE.

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
  p_client_phone text DEFAULT NULL,
  p_guest_id uuid DEFAULT NULL
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
  v_client_phone text := nullif(btrim(p_client_phone), '');
  v_norm_dni text;
  v_guest_id uuid := p_guest_id;
  v_guest_discount numeric := 0;
  v_associated_discount numeric;
  v_base_total_price numeric;
  v_discount_percent numeric;
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

  -- La persona (huesped) es obligatoria, exista o no una empresa/convenio.
  IF v_client_name IS NULL THEN
    v_client_name := nullif(btrim(coalesce(v_client_first, '') || ' ' || coalesce(v_client_last, '')), '');
  END IF;
  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;
  IF v_client_dni IS NULL THEN
    RAISE EXCEPTION 'El DNI o CUIT del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  -- Empresa/Convenio (opcional): valida y toma su descuento.
  IF p_associated_client_id IS NOT NULL THEN
    SELECT ac.discount_percent
    INTO v_associated_discount
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id
      AND ac.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa/Convenio no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;
  END IF;

  -- ----- Descuento personal: SOLO si el huesped se eligio explicitamente del padron -----
  -- (p_guest_id). Tipear un DNI que coincida no aplica descuento: asi la vista previa del modal
  -- y lo que se cobra son siempre identicos ("se aplica solo al seleccionarlo").
  IF v_guest_id IS NOT NULL THEN
    SELECT g.discount_percent INTO v_guest_discount FROM public.guests g WHERE g.id = v_guest_id;
    IF NOT FOUND THEN
      v_guest_id := NULL;   -- el id que vino no existe; se resolvera por DNI / se crea, sin descuento
      v_guest_discount := 0;
    END IF;
  END IF;

  -- ----- Link al padron (find-or-create) para autocompletado futuro; NO toca el descuento -----
  v_norm_dni := regexp_replace(upper(coalesce(v_client_dni, '')), '[^A-Z0-9]', '', 'g');

  IF v_guest_id IS NULL AND v_norm_dni <> '' THEN
    SELECT g.id
    INTO v_guest_id
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
    -- Enriquecer datos faltantes del padron sin pisar lo ya cargado.
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

  -- Precedencia de descuento: empresa/convenio -> descuento personal del huesped -> 0.
  IF p_associated_client_id IS NOT NULL THEN
    v_discount_percent := COALESCE(v_associated_discount, 0);
  ELSE
    v_discount_percent := COALESCE(v_guest_discount, 0);
  END IF;

  SELECT standard_check_out_time, COALESCE(timezone, 'UTC')
  INTO v_checkout_time, v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  IF p_half_day THEN
    v_checkin_target := (((v_now AT TIME ZONE v_tz)::date + time '12:00') AT TIME ZONE v_tz);
    v_checkout_target := (((v_now AT TIME ZONE v_tz)::date + time '17:00') AT TIME ZONE v_tz);

    SELECT half_day_price INTO v_half_day_price FROM public.rooms WHERE id = p_room_id;
    IF v_half_day_price IS NULL OR v_half_day_price <= 0 THEN
      RAISE EXCEPTION 'La habitacion no tiene precio de media estadia (siesta) configurado.' USING errcode = '22023';
    END IF;

    v_base_total_price := v_half_day_price;
    v_discount_percent := round(COALESCE(v_discount_percent, 0)::numeric, 2);
    v_discount_amount := round(v_base_total_price * v_discount_percent / 100, 2);
    v_final_total_price := v_base_total_price - v_discount_amount;
  ELSE
    v_checkin_target := v_now;
    v_checkout_target := ((((v_now AT TIME ZONE v_tz)::date + p_nights) + v_checkout_time) AT TIME ZONE v_tz);

    -- Pricing con override de descuento (precedencia ya resuelta arriba); igual que el create.
    SELECT
      pricing.base_total_price,
      pricing.discount_percent,
      pricing.discount_amount,
      pricing.final_total_price
    INTO
      v_base_total_price,
      v_discount_percent,
      v_discount_amount,
      v_final_total_price
    FROM public.app_calculate_reservation_pricing(
      p_room_id,
      v_checkin_target,
      v_checkout_target,
      NULL,
      v_discount_percent
    ) AS pricing;
  END IF;

  INSERT INTO public.reservations (
    room_id,
    associated_client_id,
    guest_id,
    client_name,
    client_first_name,
    client_last_name,
    client_dni,
    client_phone,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    base_total_price,
    discount_percent,
    discount_amount,
    total_price,
    guest_count,
    notes,
    guest_profession,
    guest_address,
    guest_locality,
    guest_nationality,
    guest_doc_type,
    guest_birth_date,
    guest_vehicle,
    updated_at
  )
  VALUES (
    p_room_id,
    p_associated_client_id,
    v_guest_id,
    v_client_name,
    v_client_first,
    v_client_last,
    v_client_dni,
    v_client_phone,
    'checked_in',
    v_checkin_target,
    v_now,
    v_checkout_target,
    v_base_total_price,
    v_discount_percent,
    v_discount_amount,
    v_final_total_price,
    v_guest_count,
    NULL,
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

  UPDATE public.rooms
  SET status = 'occupied'
  WHERE id = p_room_id;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer, boolean, text, text, text, text, text, date, text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_assign_walk_in(integer, text, integer, uuid, integer, boolean, text, text, text, text, text, date, text, text, text, text, text, uuid) TO authenticated;

COMMIT;
