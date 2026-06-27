-- Migration 61: Pasajeros de empresa (tabla separada) + fork persona/empresa en el alta
--
-- Refina el modelo de la migracion 59. Ahora hay DOS tipos de "humano que se hospeda":
--   * Huesped individual  -> tabla public.guests       (reserva tipo persona)
--   * Pasajero de empresa -> tabla public.company_passengers (reserva tipo empresa)
--
-- La reserva es PERSONA o EMPRESA:
--   - Persona: se busca/crea el huesped en guests; su descuento personal se aplica (si se
--     selecciono del padron). guest_id queda seteado; company_passenger_id NULL.
--   - Empresa: se elige la empresa (associated_clients), su descuento se aplica, y se carga el
--     pasajero real (nombre + DNI) que vive en company_passengers (dedup por DNI DENTRO de la
--     empresa). company_passenger_id queda seteado; guest_id NULL. NO se crea fila en guests.
--
-- En ambos casos client_* en reservations guarda al humano que duerme (huesped o pasajero).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tabla de pasajeros de empresa (empleados/pasajeros que viajan por una empresa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  associated_client_id uuid NOT NULL REFERENCES public.associated_clients(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  document_id text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_passengers_client_idx
  ON public.company_passengers (associated_client_id);
CREATE INDEX IF NOT EXISTS company_passengers_document_idx
  ON public.company_passengers (document_id);

ALTER TABLE public.company_passengers ENABLE ROW LEVEL SECURITY;

-- Staff (recepcion) lee para buscar/seleccionar el pasajero al cargar la reserva.
DROP POLICY IF EXISTS "Staff can read company_passengers" ON public.company_passengers;
CREATE POLICY "Staff can read company_passengers" ON public.company_passengers
  FOR SELECT TO authenticated USING (public.app_is_staff());

-- La escritura directa es de admin; el alta normal la hace el RPC (SECURITY DEFINER).
DROP POLICY IF EXISTS "Admin can write company_passengers" ON public.company_passengers;
CREATE POLICY "Admin can write company_passengers" ON public.company_passengers
  FOR ALL TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_passengers TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) reservations.company_passenger_id -> link al pasajero (reservas de empresa)
-- ---------------------------------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS company_passenger_id uuid
    REFERENCES public.company_passengers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reservations_company_passenger_id_idx
  ON public.reservations (company_passenger_id);

-- ---------------------------------------------------------------------------
-- 3) rpc_staff_create_reservation: fork persona/empresa
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_staff_create_reservation(integer, timestamptz, timestamptz, text, text, text, uuid, integer, text, text, text, text, text, date, text, text, text, uuid);

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
  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped/pasajero es obligatorio.' USING errcode = '22023';
  END IF;
  IF v_client_dni IS NULL THEN
    RAISE EXCEPTION 'El DNI o CUIT es obligatorio.' USING errcode = '22023';
  END IF;

  v_norm_dni := regexp_replace(upper(v_client_dni), '[^A-Z0-9]', '', 'g');

  IF p_associated_client_id IS NOT NULL THEN
    -- ===================== RESERVA DE EMPRESA =====================
    SELECT ac.discount_percent INTO v_associated_discount
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id AND ac.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa/Convenio no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;
    v_discount_percent := COALESCE(v_associated_discount, 0);

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
  ELSE
    -- ===================== RESERVA DE PERSONA =====================
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

COMMIT;
