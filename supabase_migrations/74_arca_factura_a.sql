-- Migration 74: Factura A (Responsables Inscriptos / Monotributo con CUIT)
--
-- El sistema ya emite Factura B a consumidor final (DNI). Esta migración habilita
-- emitir Factura A (CbteTipo 1, DocTipo 80/CUIT, IVA discriminado) desde el MISMO
-- flujo de facturación (prompt post-checkout + /admin/fiscal). El tipo A/B se
-- decide por comprobante (parámetro del RPC), no por config global.
--
-- Cambios de negocio:
--  - El tipo (A/B) y los datos del receptor A (CUIT, condición IVA, razón social)
--    llegan como parámetros a rpc_create_invoice_draft. Default = B (flujo actual).
--  - Se QUITA la exclusión "reserva de empresa" (associated_client_id): una empresa
--    que paga en el check-out ahora se puede facturar A.
--  - Se MANTIENEN las exclusiones de cuenta corriente y vale blanco (fuera de alcance).
--  - condicion_iva nueva en associated_clients (carga manual; autocompleta al emitir A).
--  - El re-snapshot del receptor en begin_invoice_emission pasa a ser condicional por
--    doc_tipo (para A no re-lee el DNI de la reserva, que rompería con el CUIT de 11).
--
-- El invoices_number_uq ya es por (environment, pto_vta, cbte_tipo, cbte_nro): A y B
-- numeran por secuencias independientes sin cambios.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ ... $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT (ver reference-supabase-mcp). Verificar después con SELECTs.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) associated_clients: condición frente al IVA + domicilio del receptor (para
--    Factura A). Nullables: los asociados viejos quedan sin definir; el modal los
--    pide/confirma al emitir A y se guardan en la ficha para la próxima.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.associated_clients
  ADD COLUMN IF NOT EXISTS condicion_iva TEXT
  CHECK (condicion_iva IS NULL OR condicion_iva IN
    ('responsable_inscripto', 'monotributo', 'consumidor_final'));

ALTER TABLE public.associated_clients
  ADD COLUMN IF NOT EXISTS domicilio TEXT;

-- Domicilio del receptor en el comprobante (Factura A). La reserva puede estar a
-- nombre de una persona y facturarse a otra empresa (otra razón social + domicilio).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS receptor_domicilio TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) app_is_valid_cuit: dígito verificador (módulo 11). Espeja isValidCuit
--    (src/lib/arca/amounts.ts) para validar el CUIT del receptor en el draft A.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_is_valid_cuit(p_cuit TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d TEXT;
  weights INT[] := ARRAY[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  s INT := 0;
  i INT;
  m INT;
  chk INT;
BEGIN
  d := regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g');
  IF length(d) <> 11 THEN
    RETURN FALSE;
  END IF;
  FOR i IN 1..10 LOOP
    s := s + weights[i] * (substr(d, i, 1))::int;
  END LOOP;
  m := 11 - (s % 11);
  chk := CASE WHEN m = 11 THEN 0 WHEN m = 10 THEN 9 ELSE m END;
  RETURN chk = (substr(d, 11, 1))::int;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_create_invoice_draft: firma nueva (A/B + datos de receptor A).
--    La aridad cambia → DROP de la versión (uuid) para no dejar overloads ambiguos.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_create_invoice_draft(uuid);

CREATE OR REPLACE FUNCTION public.rpc_create_invoice_draft(
  p_reservation_id UUID,
  p_tipo           TEXT DEFAULT 'B',   -- 'A' | 'B'
  p_cuit           TEXT DEFAULT NULL,  -- solo A
  p_condicion_iva  TEXT DEFAULT NULL,  -- solo A: 'responsable_inscripto' | 'monotributo'
  p_razon_social   TEXT DEFAULT NULL,  -- solo A
  p_domicilio      TEXT DEFAULT NULL   -- solo A (domicilio del receptor)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r RECORD;
  v_ac public.associated_clients%ROWTYPE;
  v_s public.fiscal_settings%ROWTYPE;
  v_tz TEXT;
  v_digits TEXT;
  v_neto NUMERIC;
  v_iva NUMERIC;
  v_existing public.invoices%ROWTYPE;
  v_invoice_id UUID;
  -- receptor resuelto según el tipo
  v_tipo TEXT;
  v_cbte_tipo INT;
  v_doc_tipo INT;
  v_doc_nro TEXT;
  v_cond_id INT;
  v_cond_txt TEXT;
  v_receptor TEXT;
  v_domicilio TEXT;
  v_cuit TEXT;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  v_tipo := upper(COALESCE(NULLIF(BTRIM(p_tipo), ''), 'B'));
  IF v_tipo NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'Tipo de comprobante invalido (A o B).' USING errcode = '22023';
  END IF;

  SELECT r.id, r.status, r.total_price, r.client_name, r.client_dni,
         r.associated_client_id, r.checkout_cash_shift_id,
         r.check_in_target, r.actual_check_in, r.actual_check_out
  INTO v_r
  FROM public.reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_r.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Solo se facturan reservas con check-out realizado.' USING errcode = '22023';
  END IF;

  -- Exclusiones que se mantienen (la empresa YA NO se excluye por sí sola):
  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos m
    WHERE m.reservation_id = p_reservation_id AND m.tipo = 'cargo'
  ) THEN
    RAISE EXCEPTION 'Reserva cerrada a cuenta corriente: se factura al saldar la cuenta.' USING errcode = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.reservation_id = p_reservation_id AND p.payment_method = 'vale_blanco'
  ) THEN
    RAISE EXCEPTION 'Cerrada con vale blanco (consumo interno): no se factura.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_s FROM public.fiscal_settings WHERE id = 1;
  IF NOT COALESCE(v_s.enabled, FALSE) THEN
    RAISE EXCEPTION 'La facturacion electronica no esta configurada o habilitada.' USING errcode = 'P0025';
  END IF;

  IF NOT public.app_is_admin()
     AND v_r.checkout_cash_shift_id IS DISTINCT FROM public.app_current_open_shift() THEN
    RAISE EXCEPTION 'Solo podes facturar check-outs de tu turno abierto. Pedile al administrador.' USING errcode = 'P0023';
  END IF;

  -- Reusar una factura existente no-descartada (idempotencia / reimpresión).
  SELECT * INTO v_existing FROM public.invoices
  WHERE reservation_id = p_reservation_id AND status <> 'discarded';
  IF FOUND THEN
    IF v_existing.status = 'authorized' THEN
      RETURN jsonb_build_object(
        'invoice_id', v_existing.id,
        'status', 'authorized',
        'already_authorized', TRUE,
        'reused', TRUE
      );
    END IF;
    RETURN jsonb_build_object('invoice_id', v_existing.id, 'status', v_existing.status, 'reused', TRUE);
  END IF;

  -- Asociado (si la reserva es de empresa/convenio): prefills y backfill.
  IF v_r.associated_client_id IS NOT NULL THEN
    SELECT * INTO v_ac FROM public.associated_clients WHERE id = v_r.associated_client_id;
  END IF;

  v_neto := round(v_r.total_price / (1 + v_s.iva_pct / 100), 2);
  v_iva := v_r.total_price - v_neto;

  IF v_tipo = 'A' THEN
    -- Receptor Responsable Inscripto / Monotributo con CUIT.
    v_cuit := regexp_replace(COALESCE(NULLIF(BTRIM(p_cuit), ''), v_ac.document_id, ''), '\D', '', 'g');
    IF NOT public.app_is_valid_cuit(v_cuit) THEN
      RAISE EXCEPTION 'El CUIT del receptor no es valido (11 digitos con digito verificador). Corregilo y reintenta.' USING errcode = 'P0022';
    END IF;

    v_cond_txt := COALESCE(NULLIF(BTRIM(p_condicion_iva), ''), v_ac.condicion_iva);
    v_cond_id := CASE v_cond_txt
                   WHEN 'responsable_inscripto' THEN 1
                   WHEN 'monotributo' THEN 6
                   ELSE NULL
                 END;
    IF v_cond_id IS NULL THEN
      RAISE EXCEPTION 'Falta o es invalida la condicion de IVA del receptor para Factura A (Responsable Inscripto o Monotributo).' USING errcode = 'P0022';
    END IF;

    -- La reserva puede estar a nombre de una persona y facturarse a otra empresa:
    -- razón social y domicilio del receptor son independientes del huésped.
    v_receptor := COALESCE(NULLIF(BTRIM(p_razon_social), ''), v_ac.display_name, v_r.client_name);
    v_domicilio := COALESCE(NULLIF(BTRIM(p_domicilio), ''), v_ac.domicilio);
    v_cbte_tipo := 1;
    v_doc_tipo := 80;
    v_doc_nro := v_cuit;

    -- "Queda guardado": completar condición IVA y domicilio de la ficha si estaban
    -- vacíos (no pisa valores cargados por el admin).
    IF v_r.associated_client_id IS NOT NULL THEN
      UPDATE public.associated_clients
      SET condicion_iva = COALESCE(condicion_iva, v_cond_txt),
          domicilio = COALESCE(domicilio, v_domicilio),
          updated_at = NOW()
      WHERE id = v_r.associated_client_id;
    END IF;
  ELSE
    -- Factura B a consumidor final con DNI (flujo actual).
    v_digits := regexp_replace(COALESCE(v_r.client_dni, ''), '\D', '', 'g');
    IF length(v_digits) NOT IN (7, 8) THEN
      RAISE EXCEPTION 'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.' USING errcode = 'P0022';
    END IF;
    v_cbte_tipo := 6;
    v_doc_tipo := 96;
    v_doc_nro := v_digits;
    v_cond_id := 5;
    v_receptor := v_r.client_name;
    v_domicilio := NULL;
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  INSERT INTO public.invoices (
    reservation_id, status, environment, pto_vta, cbte_tipo, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre, receptor_domicilio,
    imp_total, imp_neto, imp_iva, iva_id,
    fch_serv_desde, fch_serv_hasta,
    cash_shift_id, created_by
  )
  VALUES (
    p_reservation_id, 'pending', v_s.environment, v_s.punto_venta, v_cbte_tipo, v_s.concepto,
    v_doc_tipo, v_doc_nro::bigint, v_cond_id, v_receptor, v_domicilio,
    v_r.total_price, v_neto, v_iva, 5,
    (COALESCE(v_r.actual_check_in, v_r.check_in_target) AT TIME ZONE v_tz)::date,
    (COALESCE(v_r.actual_check_out, NOW()) AT TIME ZONE v_tz)::date,
    v_r.checkout_cash_shift_id, auth.uid()
  )
  RETURNING id INTO v_invoice_id;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id, 'status', 'pending', 'reused', FALSE, 'cbte_tipo', v_cbte_tipo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_begin_invoice_emission: re-snapshot del receptor CONDICIONAL por doc_tipo.
--    B (96): re-lee el DNI de la reserva (permite "corregir DNI y reintentar").
--    A (80): el receptor se fijó en el draft (CUIT de 11) → NO re-leer de la reserva.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_begin_invoice_emission(
  p_invoice_id UUID,
  p_cbte_nro BIGINT,
  p_internal_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i public.invoices%ROWTYPE;
  v_s public.fiscal_settings%ROWTYPE;
  v_r RECORD;
  v_tz TEXT;
  v_digits TEXT;
  v_today DATE;
  v_doc_nro BIGINT;
  v_receptor TEXT;
BEGIN
  IF NOT public.app_is_staff() OR NOT public.app_check_fiscal_key(p_internal_key) THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT * INTO v_i FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_i.status = 'authorized' THEN
    RAISE EXCEPTION 'La factura ya fue emitida.' USING errcode = 'P0020';
  END IF;
  -- processing "fresco" no es re-emitible (hay un intento en vuelo); uno viejo
  -- sí (el emitter ya corrió el recovery FECompConsultar antes de re-entrar).
  IF v_i.status = 'processing'
     AND v_i.last_attempt_at IS NOT NULL
     AND v_i.last_attempt_at > NOW() - INTERVAL '2 minutes' THEN
    RAISE EXCEPTION 'Esta factura ya se esta emitiendo. Reintenta en unos segundos.' USING errcode = 'P0021';
  END IF;

  SELECT * INTO v_s FROM public.fiscal_settings WHERE id = 1;
  IF NOT COALESCE(v_s.enabled, FALSE) THEN
    RAISE EXCEPTION 'La facturacion electronica no esta configurada o habilitada.' USING errcode = 'P0025';
  END IF;
  IF v_i.environment <> v_s.environment THEN
    RAISE EXCEPTION 'La factura pertenece a otro ambiente (%). Config actual: %.', v_i.environment, v_s.environment USING errcode = 'P0025';
  END IF;

  -- Single-flight: una sola emisión en vuelo por ambiente (serializa numeración).
  IF EXISTS (
    SELECT 1 FROM public.invoices o
    WHERE o.environment = v_i.environment
      AND o.id <> v_i.id
      AND o.status = 'processing'
      AND o.last_attempt_at > NOW() - INTERVAL '2 minutes'
  ) THEN
    RAISE EXCEPTION 'Hay otra factura emitiendose. Reintenta en unos segundos.' USING errcode = 'P0021';
  END IF;

  IF v_i.doc_tipo = 96 THEN
    -- Factura B: re-snapshot del receptor desde la reserva (corregir DNI y reintentar).
    SELECT r.client_name, r.client_dni INTO v_r
    FROM public.reservations r WHERE r.id = v_i.reservation_id;
    v_digits := regexp_replace(COALESCE(v_r.client_dni, ''), '\D', '', 'g');
    IF length(v_digits) NOT IN (7, 8) THEN
      RAISE EXCEPTION 'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.' USING errcode = 'P0022';
    END IF;
    v_doc_nro := v_digits::bigint;
    v_receptor := v_r.client_name;
  ELSE
    -- Factura A (doc_tipo 80, CUIT): el receptor se fijó en el draft; no re-snapshot.
    v_digits := regexp_replace(v_i.doc_nro::text, '\D', '', 'g');
    IF length(v_digits) <> 11 THEN
      RAISE EXCEPTION 'El CUIT del receptor no es valido (11 digitos). Descarta la factura y volve a emitirla con el CUIT correcto.' USING errcode = 'P0022';
    END IF;
    v_doc_nro := v_i.doc_nro;
    v_receptor := v_i.receptor_nombre;
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;
  v_today := (NOW() AT TIME ZONE v_tz)::date;

  UPDATE public.invoices
  SET status = 'processing',
      cbte_nro = p_cbte_nro,
      cbte_fch = v_today,
      fch_vto_pago = v_today,          -- contado: vence el mismo día
      doc_nro = v_doc_nro,
      receptor_nombre = v_receptor,
      attempt_count = attempt_count + 1,
      last_attempt_at = NOW(),
      last_error = NULL,
      updated_at = NOW()
  WHERE id = p_invoice_id;

  -- Todo lo necesario para armar el SOAP en un solo round-trip.
  SELECT * INTO v_i FROM public.invoices WHERE id = p_invoice_id;
  RETURN jsonb_build_object(
    'invoice_id', v_i.id,
    'environment', v_i.environment,
    'pto_vta', v_i.pto_vta,
    'cbte_tipo', v_i.cbte_tipo,
    'concepto', v_i.concepto,
    'cbte_nro', v_i.cbte_nro,
    'cbte_fch', to_char(v_i.cbte_fch, 'YYYYMMDD'),
    'doc_tipo', v_i.doc_tipo,
    'doc_nro', v_i.doc_nro::text,
    'condicion_iva_receptor_id', v_i.condicion_iva_receptor_id,
    'imp_total', v_i.imp_total,
    'imp_neto', v_i.imp_neto,
    'imp_iva', v_i.imp_iva,
    'iva_id', v_i.iva_id,
    'mon_id', v_i.mon_id,
    'mon_cotiz', v_i.mon_cotiz,
    'fch_serv_desde', to_char(v_i.fch_serv_desde, 'YYYYMMDD'),
    'fch_serv_hasta', to_char(v_i.fch_serv_hasta, 'YYYYMMDD'),
    'fch_vto_pago', to_char(v_i.fch_vto_pago, 'YYYYMMDD'),
    'cuit', (SELECT cuit FROM public.fiscal_settings WHERE id = 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_begin_invoice_emission(UUID, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_begin_invoice_emission(UUID, BIGINT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) rpc_list_invoiceable_checkouts: quitar la exclusión por empresa
--    (associated_client_id IS NULL). Las empresas que pagaron en caja ahora
--    aparecen como facturables. Se mantienen cuenta corriente y vale blanco.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_invoiceable_checkouts()
RETURNS TABLE (
  reservation_id UUID,
  room_number TEXT,
  client_name TEXT,
  client_dni TEXT,
  total_price NUMERIC,
  actual_check_out TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, ro.room_number, r.client_name, r.client_dni, r.total_price, r.actual_check_out
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.status = 'checked_out'
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = r.id AND i.status <> 'discarded'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.cuenta_corriente_movimientos m
      WHERE m.reservation_id = r.id AND m.tipo = 'cargo'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.reservation_id = r.id AND p.payment_method = 'vale_blanco'
    )
    AND (
      (public.app_is_admin() AND r.actual_check_out > NOW() - INTERVAL '10 days')
      OR r.checkout_cash_shift_id = public.app_current_open_shift()
    )
  ORDER BY r.actual_check_out DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_invoiceable_checkouts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_invoiceable_checkouts() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Red de seguridad: coherencia tipo ↔ documento ↔ condición IVA del receptor.
--    B (6) → DNI (96) / Consumidor Final (5); A (1) → CUIT (80) / RI (1) o Mono (6).
--    Las filas B existentes (6/96/5) cumplen la primera rama.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_tipo_doc_coherent;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_tipo_doc_coherent
  CHECK (
    (cbte_tipo = 6 AND doc_tipo = 96 AND condicion_iva_receptor_id = 5)
    OR (cbte_tipo = 1 AND doc_tipo = 80 AND condicion_iva_receptor_id IN (1, 6))
  );

COMMIT;
