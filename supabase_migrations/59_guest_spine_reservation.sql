-- Migration 59: Huesped como columna vertebral de la reserva + descuento por huesped
--
-- Rediseño del alta de reserva. Antes el modal forzaba elegir "Cliente ocasional" vs
-- "Asociado", mezclando 3 ejes (empresa/persona, con/sin descuento, recurrente/ocasional).
-- Ahora: la reserva SIEMPRE tiene un huesped (la persona que se hospeda) y, opcionalmente,
-- una Empresa/Convenio (lo que la tabla sigue llamando associated_clients) que aporta el
-- descuento y es la facturable.
--
-- Cambios:
-- 1) guests: agrega discount_percent (descuento personal) e is_active.
-- 2) reservations: agrega guest_id (link al padron). Las filas viejas quedan en NULL y el
--    directorio sigue funcionando con la deduplicacion por DNI/nombre que ya existe.
-- 3) app_calculate_reservation_pricing: nuevo parametro p_discount_percent (override). Si se
--    pasa, manda; si no, cae al descuento de la empresa/convenio (compatibilidad con walk-in).
-- 4) rpc_staff_create_reservation: nueva firma. SIEMPRE recibe los datos de la persona +
--    p_guest_id opcional + p_associated_client_id opcional. Hace find-or-create del huesped en
--    "guests" (para autocompletado futuro), resuelve la precedencia de descuento
--    (empresa -> huesped -> 0) y guarda client_* = persona (ya no la empresa; sin "Pasajero" en
--    notes). El descuento de la empresa, si esta adjunta, pisa al personal.
--
-- El walk-in (rpc_staff_assign_walk_in) NO se toca en esta migracion: sigue con su firma de la
-- migracion 57 y resuelve el descuento por la empresa (4 args), que la nueva pricing soporta.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Padron de huespedes: descuento personal + activo
-- ---------------------------------------------------------------------------
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (discount_percent >= 0 AND discount_percent <= 100),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2) reservations.guest_id -> link canonico al padron
-- ---------------------------------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reservations_guest_id_idx ON public.reservations (guest_id);

-- ---------------------------------------------------------------------------
-- 3) Pricing con override de descuento
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.app_calculate_reservation_pricing(
  p_room_id int,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_associated_client_id uuid DEFAULT NULL,
  p_discount_percent numeric DEFAULT NULL
)
RETURNS TABLE (
  base_total_price numeric,
  discount_percent numeric,
  discount_amount numeric,
  final_total_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Precedencia: override explicito -> descuento de la empresa/convenio -> 0.
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

  v_nights := GREATEST(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400));

  base_total_price := round((v_nights * COALESCE(v_room_base_price, 0))::numeric, 2);
  discount_percent := round(COALESCE(v_discount_percent, 0)::numeric, 2);
  discount_amount := round((base_total_price * discount_percent / 100)::numeric, 2);
  final_total_price := round((base_total_price - discount_amount)::numeric, 2);

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) rpc_staff_create_reservation: huesped siempre + empresa opcional
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text, text, text, text, text, text, date, text, text, text);

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
  p_guest_id uuid DEFAULT NULL
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
  v_guest_id uuid := p_guest_id;
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

  SELECT status
  INTO v_room_status
  FROM public.rooms
  WHERE id = p_room_id;

  IF v_room_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
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

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  IF p_check_out <= v_now THEN
    RAISE EXCEPTION 'No se puede crear una reserva cuyas fechas ya pasaron.' USING errcode = '22023';
  END IF;

  IF p_check_in <= v_now AND p_check_out > v_now AND v_room_status = 'available' THEN
    v_status := 'checked_in';
  END IF;

  SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
  INTO v_base_total_price, v_discount_percent, v_discount_amount, v_final_total_price
  FROM public.app_calculate_reservation_pricing(
    p_room_id,
    p_check_in,
    p_check_out,
    NULL,
    v_discount_percent
  ) AS pricing;

  INSERT INTO public.reservations (
    room_id, associated_client_id, guest_id,
    client_name, client_first_name, client_last_name, client_dni, client_phone,
    status, check_in_target, actual_check_in, check_out_target,
    base_total_price, discount_percent, discount_amount, total_price,
    guest_count, notes,
    guest_profession, guest_address, guest_locality, guest_nationality, guest_doc_type, guest_birth_date, guest_vehicle,
    updated_at
  )
  VALUES (
    p_room_id, p_associated_client_id, v_guest_id,
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
    UPDATE public.rooms
    SET status = 'occupied'
    WHERE id = p_room_id;
  END IF;

  RETURN v_reservation_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'La habitacion no esta disponible para ese rango horario.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text, text, text, text, date, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text, text, text, text, date, text, text, text, uuid) TO authenticated;

COMMIT;
