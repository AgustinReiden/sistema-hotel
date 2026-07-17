-- Migration 72: Facturación electrónica ARCA (Factura B por WSFEv1) — v1
--
-- Pedido del gerente: al cerrar la habitación el playero elige "¿Emitir
-- factura? SÍ/NO" y sale la Factura B (consumidor final, DNI) con CAE.
-- Solo puede facturar check-outs de SU turno abierto; después, solo admin.
-- Si ARCA no responde, el check-out no se traba: la factura queda pendiente.
--
-- Modelo de confianza: las server actions llaman a PostgREST con el JWT del
-- usuario, así que un staff malicioso podría invocar los RPC por fuera de la
-- app. Los RPC que finalizan facturas o manejan el Ticket de Acceso del WSAA
-- exigen ADEMÁS una clave interna del servidor (ARCA_INTERNAL_KEY, env
-- server-only) cuyo SHA-256 vive en fiscal_private (RLS sin policies).
-- Así: staff = un humano autorizado disparó la acción; clave = la llamada
-- pasó por nuestro código de servidor. El certificado NUNCA está en la DB.
--
-- Estados de invoices:
--   pending ──begin──▶ processing ──A/recuperado──▶ authorized (terminal)
--      ▲                   │
--      │                   ├──R──▶ rejected ──retry──▶ processing
--      └── fallo conocido ─┘
--   processing con outcome desconocido (timeout post-envío) QUEDA processing;
--   el próximo intento consulta FECompConsultar antes de re-emitir.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) pgcrypto para digest() (hash de la clave interna)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) fiscal_settings: configuración fiscal del hotel (singleton id=1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  environment TEXT NOT NULL DEFAULT 'homologacion'
    CHECK (environment IN ('homologacion', 'produccion')),
  cuit TEXT CHECK (cuit ~ '^[0-9]{11}$'),
  razon_social TEXT,
  domicilio_fiscal TEXT,
  iibb TEXT,
  inicio_actividades DATE,
  punto_venta INT CHECK (punto_venta BETWEEN 1 AND 99998),
  cbte_tipo INT NOT NULL DEFAULT 6,   -- 6 = Factura B
  concepto INT NOT NULL DEFAULT 2,    -- 2 = Servicios
  iva_pct NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id),
  -- No se puede habilitar con la config incompleta.
  CONSTRAINT fiscal_settings_complete_when_enabled CHECK (
    NOT enabled OR (
      cuit IS NOT NULL AND razon_social IS NOT NULL AND punto_venta IS NOT NULL
    )
  )
);

INSERT INTO public.fiscal_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.fiscal_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read fiscal_settings" ON public.fiscal_settings;
CREATE POLICY "Staff read fiscal_settings"
  ON public.fiscal_settings FOR SELECT TO authenticated
  USING (public.app_is_staff());

DROP POLICY IF EXISTS "Admin update fiscal_settings" ON public.fiscal_settings;
CREATE POLICY "Admin update fiscal_settings"
  ON public.fiscal_settings FOR UPDATE TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fiscal_private (clave interna) y arca_ta (Ticket de Acceso WSAA):
--    RLS habilitado SIN policies = ilegibles por PostgREST. Solo los RPC
--    SECURITY DEFINER de abajo los tocan.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_private (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  internal_key_hash BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.fiscal_private ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.arca_ta (
  environment TEXT NOT NULL CHECK (environment IN ('homologacion', 'produccion')),
  service TEXT NOT NULL DEFAULT 'wsfe',
  token TEXT NOT NULL,
  sign TEXT NOT NULL,
  generation_time TIMESTAMPTZ,
  expiration_time TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment, service)
);
ALTER TABLE public.arca_ta ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) invoices: una fila por comprobante; los reintentos REUSAN la fila
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'authorized', 'rejected')),
  environment TEXT NOT NULL CHECK (environment IN ('homologacion', 'produccion')),
  -- identificación del comprobante
  pto_vta INT NOT NULL,
  cbte_tipo INT NOT NULL DEFAULT 6,
  concepto INT NOT NULL DEFAULT 2,
  cbte_nro BIGINT,
  cbte_fch DATE,
  cae TEXT,
  cae_vto DATE,
  -- receptor (RG 5616: condición IVA obligatoria)
  doc_tipo INT NOT NULL DEFAULT 96,
  doc_nro BIGINT NOT NULL,
  condicion_iva_receptor_id INT NOT NULL DEFAULT 5,
  receptor_nombre TEXT,
  -- importes (IVA incluido en el precio; neto+iva = total exacto)
  imp_total NUMERIC(12,2) NOT NULL CHECK (imp_total > 0),
  imp_neto NUMERIC(12,2) NOT NULL,
  imp_iva NUMERIC(12,2) NOT NULL,
  iva_id INT NOT NULL DEFAULT 5,             -- 5 = 21%
  mon_id TEXT NOT NULL DEFAULT 'PES',
  mon_cotiz NUMERIC(10,4) NOT NULL DEFAULT 1,
  -- concepto 2 (servicios)
  fch_serv_desde DATE NOT NULL,
  fch_serv_hasta DATE NOT NULL,
  fch_vto_pago DATE,
  -- resultado / auditoría / reintentos
  qr_url TEXT,
  arca_result JSONB,
  last_error TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  cash_shift_id UUID REFERENCES public.cash_shifts(id),
  created_by UUID REFERENCES auth.users(id),
  issued_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_amounts_add_up CHECK (imp_neto + imp_iva = imp_total),
  CONSTRAINT invoices_authorized_complete CHECK (
    status <> 'authorized' OR (cae IS NOT NULL AND cbte_nro IS NOT NULL)
  )
);

-- Una factura por reserva (v1: solo Factura B del total de la estadía).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_reservation_uq
  ON public.invoices(reservation_id);
-- Backstop de la carrera de numeración: un número no puede estar "vivo" dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_uq
  ON public.invoices(environment, pto_vta, cbte_tipo, cbte_nro)
  WHERE cbte_nro IS NOT NULL AND status IN ('processing', 'authorized');
CREATE INDEX IF NOT EXISTS invoices_pending_idx
  ON public.invoices(status, cash_shift_id)
  WHERE status <> 'authorized';

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read invoices" ON public.invoices;
CREATE POLICY "Staff read invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (public.app_is_staff());
-- Escritura: solo vía RPC SECURITY DEFINER (sin policies de INSERT/UPDATE/DELETE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Clave interna: helper de verificación + setter admin
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_check_fiscal_key(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fiscal_private fp
    WHERE fp.id = 1
      AND p_key IS NOT NULL
      AND fp.internal_key_hash = extensions.digest(p_key, 'sha256')
  );
$$;

REVOKE ALL ON FUNCTION public.app_check_fiscal_key(TEXT) FROM PUBLIC;
-- Sin GRANT: solo la llaman otras funciones SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.rpc_set_fiscal_internal_key(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_key IS NULL OR length(p_key) < 32 THEN
    RAISE EXCEPTION 'La clave interna debe tener al menos 32 caracteres.' USING errcode = '22023';
  END IF;

  INSERT INTO public.fiscal_private (id, internal_key_hash, updated_at)
  VALUES (1, extensions.digest(p_key, 'sha256'), NOW())
  ON CONFLICT (id) DO UPDATE
  SET internal_key_hash = EXCLUDED.internal_key_hash,
      updated_at = NOW();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_set_fiscal_internal_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_fiscal_internal_key(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Ticket de Acceso WSAA: get/set (staff + clave interna)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_get_arca_ta(p_environment TEXT, p_internal_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.arca_ta%ROWTYPE;
BEGIN
  IF NOT public.app_is_staff() OR NOT public.app_check_fiscal_key(p_internal_key) THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.arca_ta
  WHERE environment = p_environment AND service = 'wsfe';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'token', v_row.token,
    'sign', v_row.sign,
    'generation_time', v_row.generation_time,
    'expiration_time', v_row.expiration_time
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_arca_ta(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_arca_ta(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_set_arca_ta(
  p_environment TEXT,
  p_token TEXT,
  p_sign TEXT,
  p_generation_time TIMESTAMPTZ,
  p_expiration_time TIMESTAMPTZ,
  p_internal_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_staff() OR NOT public.app_check_fiscal_key(p_internal_key) THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_token IS NULL OR p_sign IS NULL OR p_expiration_time IS NULL THEN
    RAISE EXCEPTION 'Ticket de acceso incompleto.' USING errcode = '22023';
  END IF;

  INSERT INTO public.arca_ta (environment, service, token, sign, generation_time, expiration_time, updated_at)
  VALUES (p_environment, 'wsfe', p_token, p_sign, p_generation_time, p_expiration_time, NOW())
  ON CONFLICT (environment, service) DO UPDATE
  SET token = EXCLUDED.token,
      sign = EXCLUDED.sign,
      generation_time = EXCLUDED.generation_time,
      expiration_time = EXCLUDED.expiration_time,
      updated_at = NOW();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_set_arca_ta(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_arca_ta(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) rpc_create_invoice_draft: intención de facturar (solo staff, sin clave —
--    crear un borrador no habilita fraude). Idempotente por reserva.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_invoice_draft(p_reservation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r RECORD;
  v_s public.fiscal_settings%ROWTYPE;
  v_tz TEXT;
  v_digits TEXT;
  v_neto NUMERIC;
  v_iva NUMERIC;
  v_existing public.invoices%ROWTYPE;
  v_invoice_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
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

  -- Exclusiones v1
  IF v_r.associated_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reserva de empresa: la Factura A la emite la oficina.' USING errcode = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos m
    WHERE m.reservation_id = p_reservation_id AND m.tipo = 'cargo'
  ) THEN
    RAISE EXCEPTION 'Reserva cerrada a cuenta corriente: se factura al saldar la cuenta.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_s FROM public.fiscal_settings WHERE id = 1;
  IF NOT COALESCE(v_s.enabled, FALSE) THEN
    RAISE EXCEPTION 'La facturacion electronica no esta configurada o habilitada.' USING errcode = 'P0025';
  END IF;

  -- Gate de turno: el playero solo factura check-outs de SU turno abierto.
  IF NOT public.app_is_admin()
     AND v_r.checkout_cash_shift_id IS DISTINCT FROM public.app_current_open_shift() THEN
    RAISE EXCEPTION 'Solo podes facturar check-outs de tu turno abierto. Pedile al administrador.' USING errcode = 'P0023';
  END IF;

  -- Si ya existe una factura para la reserva: authorized bloquea; el resto se reusa.
  SELECT * INTO v_existing FROM public.invoices WHERE reservation_id = p_reservation_id;
  IF FOUND THEN
    IF v_existing.status = 'authorized' THEN
      RAISE EXCEPTION 'Esta reserva ya tiene factura emitida (%-%).',
        lpad(v_existing.pto_vta::text, 5, '0'), lpad(v_existing.cbte_nro::text, 8, '0')
        USING errcode = 'P0020';
    END IF;
    RETURN jsonb_build_object('invoice_id', v_existing.id, 'status', v_existing.status, 'reused', TRUE);
  END IF;

  -- DNI del receptor (7-8 dígitos → DocTipo 96; sin fallback a "sin identificar").
  v_digits := regexp_replace(COALESCE(v_r.client_dni, ''), '\D', '', 'g');
  IF length(v_digits) NOT IN (7, 8) THEN
    RAISE EXCEPTION 'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.' USING errcode = 'P0022';
  END IF;

  -- Importes: IVA incluido; el IVA absorbe el redondeo (neto+iva = total exacto).
  v_neto := round(v_r.total_price / (1 + v_s.iva_pct / 100), 2);
  v_iva := v_r.total_price - v_neto;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  INSERT INTO public.invoices (
    reservation_id, status, environment, pto_vta, cbte_tipo, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre,
    imp_total, imp_neto, imp_iva, iva_id,
    fch_serv_desde, fch_serv_hasta,
    cash_shift_id, created_by
  )
  VALUES (
    p_reservation_id, 'pending', v_s.environment, v_s.punto_venta, v_s.cbte_tipo, v_s.concepto,
    96, v_digits::bigint, 5, v_r.client_name,
    v_r.total_price, v_neto, v_iva, 5,
    (COALESCE(v_r.actual_check_in, v_r.check_in_target) AT TIME ZONE v_tz)::date,
    (COALESCE(v_r.actual_check_out, NOW()) AT TIME ZONE v_tz)::date,
    v_r.checkout_cash_shift_id, auth.uid()
  )
  RETURNING id INTO v_invoice_id;

  RETURN jsonb_build_object('invoice_id', v_invoice_id, 'status', 'pending', 'reused', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_create_invoice_draft(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_invoice_draft(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) rpc_begin_invoice_emission: claim de emisión + asignación de número.
--    Staff + clave interna. Single-flight por environment.
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

  -- Re-snapshot del receptor: permite "corregir el DNI y reintentar".
  SELECT r.client_name, r.client_dni INTO v_r
  FROM public.reservations r WHERE r.id = v_i.reservation_id;
  v_digits := regexp_replace(COALESCE(v_r.client_dni, ''), '\D', '', 'g');
  IF length(v_digits) NOT IN (7, 8) THEN
    RAISE EXCEPTION 'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.' USING errcode = 'P0022';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;
  v_today := (NOW() AT TIME ZONE v_tz)::date;

  UPDATE public.invoices
  SET status = 'processing',
      cbte_nro = p_cbte_nro,
      cbte_fch = v_today,
      fch_vto_pago = v_today,          -- contado: vence el mismo día
      doc_nro = v_digits::bigint,
      receptor_nombre = v_r.client_name,
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
-- 8) rpc_finalize_invoice: cierra un intento. Staff + clave interna.
--    Outcomes: authorized / rejected / pending (fallo conocido) / unknown
--    (queda processing → recovery con FECompConsultar en el próximo intento).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_finalize_invoice(
  p_invoice_id UUID,
  p_outcome TEXT,
  p_cae TEXT,
  p_cae_vto DATE,
  p_arca_result JSONB,
  p_qr_url TEXT,
  p_last_error TEXT,
  p_internal_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i public.invoices%ROWTYPE;
BEGIN
  IF NOT public.app_is_staff() OR NOT public.app_check_fiscal_key(p_internal_key) THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_outcome NOT IN ('authorized', 'rejected', 'pending', 'unknown') THEN
    RAISE EXCEPTION 'Outcome invalido.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_i FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_i.status <> 'processing' THEN
    RAISE EXCEPTION 'Solo se finalizan facturas en emision (estado actual: %).', v_i.status USING errcode = '22023';
  END IF;

  IF p_outcome = 'authorized' THEN
    IF p_cae IS NULL OR BTRIM(p_cae) = '' THEN
      RAISE EXCEPTION 'Falta el CAE para autorizar.' USING errcode = '22023';
    END IF;
    UPDATE public.invoices
    SET status = 'authorized',
        cae = BTRIM(p_cae),
        cae_vto = p_cae_vto,
        qr_url = p_qr_url,
        arca_result = p_arca_result,
        last_error = NULL,
        issued_by = auth.uid(),
        updated_at = NOW()
    WHERE id = p_invoice_id;

  ELSIF p_outcome = 'rejected' THEN
    UPDATE public.invoices
    SET status = 'rejected',
        cbte_nro = NULL,          -- ARCA no consume numeración en rechazos
        cbte_fch = NULL,
        arca_result = p_arca_result,
        last_error = p_last_error,
        updated_at = NOW()
    WHERE id = p_invoice_id;

  ELSIF p_outcome = 'pending' THEN
    UPDATE public.invoices
    SET status = 'pending',
        cbte_nro = NULL,
        cbte_fch = NULL,
        last_error = p_last_error,
        updated_at = NOW()
    WHERE id = p_invoice_id;

  ELSE -- 'unknown': el pedido pudo haber llegado; conservar número para el recovery
    UPDATE public.invoices
    SET last_error = p_last_error,
        updated_at = NOW()
    WHERE id = p_invoice_id;
  END IF;

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status',
    CASE WHEN p_outcome = 'unknown' THEN 'processing' ELSE p_outcome END);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_finalize_invoice(UUID, TEXT, TEXT, DATE, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_invoice(UUID, TEXT, TEXT, DATE, JSONB, TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) Listados para /admin/fiscal (staff; el RPC recorta la visibilidad)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_pending_invoices()
RETURNS TABLE (
  invoice_id UUID,
  reservation_id UUID,
  status TEXT,
  room_number TEXT,
  receptor_nombre TEXT,
  imp_total NUMERIC,
  attempt_count INT,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
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
  SELECT i.id, i.reservation_id, i.status, ro.room_number, i.receptor_nombre,
         i.imp_total, i.attempt_count, i.last_error, i.last_attempt_at, i.created_at
  FROM public.invoices i
  JOIN public.reservations r ON r.id = i.reservation_id
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE i.status <> 'authorized'
    AND (
      public.app_is_admin()
      OR i.cash_shift_id = public.app_current_open_shift()
    )
  ORDER BY i.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_pending_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_pending_invoices() TO authenticated;

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
    AND r.associated_client_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.reservation_id = r.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.cuenta_corriente_movimientos m
      WHERE m.reservation_id = r.id AND m.tipo = 'cargo'
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

COMMIT;
