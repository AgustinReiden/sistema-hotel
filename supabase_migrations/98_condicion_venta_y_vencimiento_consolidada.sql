-- Migration 98: la consolidada de cuenta corriente deja de decir "contado".
--
-- Auditoria fiscal, hallazgo A-01 (y M-8 de la auditoria de codigo). Una factura
-- consolidada junta un mes de estadias fiadas: la venta es A CREDITO. El sistema le
-- decia "contado" por los dos lados a la vez:
--
--   * el impreso tenia "Cond. venta: Contado" fijo en el codigo, para toda factura;
--   * rpc_begin_invoice_emission mandaba FchVtoPago = fecha de emision, con el
--     comentario "contado: vence el mismo dia".
--
-- Era cierto cuando el unico camino de facturacion era el check-out, donde el huesped
-- paga y se va. Dejo de serlo con la mig 79. La RG 1415 exige declarar la condicion de
-- venta, y es lo primero que va a mirar el contador en la primera factura consolidada.
--
-- EL PLAZO lo decidio Agustin: 30 dias desde la emision, el plazo B2B habitual. Va como
-- COLUMNA de fiscal_settings y no clavado en la funcion, tambien decision suya: si el
-- dia de manana negocia otro plazo con una empresa, lo cambia desde Ajustes y no hace
-- falta una migracion. El default 30 cubre la fila que ya existe.
--
-- QUE NO CAMBIA: el check-out y la nota de credito siguen venciendo el mismo dia (se
-- cobran en el momento). Ningun otro campo del envelope se toca: WSFEv1 ya recibia
-- FchVtoPago (Concepto 2/3, servicios) y acepta cualquier fecha mayor o igual a
-- CbteFch, asi que sumar dias es valido sin tocar src/lib/arca/wsfe.ts.
--
-- La condicion de venta impresa no necesita columna: se deriva de invoices.kind, que ya
-- esta guardado. Eso va en el codigo, no aca.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig98$ ... $mig98$) SIN ;
-- final y SIN BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) El plazo de la cuenta corriente, configurable desde Ajustes.
--
--    NOT NULL con default 30 para que la fila existente quede con el plazo elegido
--    sin un UPDATE aparte. El tope de 365 no es burocracia: evita que un tipeo
--    ("300" en vez de "30") mande a ARCA un vencimiento a un ano, que despues no se
--    puede corregir sin nota de credito.
--
--    Nota sobre permisos: la mig 97 revoco INSERT y DELETE de fiscal_settings pero
--    dejo el UPDATE a proposito, que es por donde entra este campo desde la pantalla
--    de configuracion. No hace falta tocar grants.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fiscal_settings
  ADD COLUMN IF NOT EXISTS dias_vto_cuenta_corriente INT NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fiscal_settings'::regclass
      AND conname = 'fiscal_settings_dias_vto_cc_check'
  ) THEN
    ALTER TABLE public.fiscal_settings
      ADD CONSTRAINT fiscal_settings_dias_vto_cc_check
      CHECK (dias_vto_cuenta_corriente >= 0 AND dias_vto_cuenta_corriente <= 365);
  END IF;
END $$;

COMMENT ON COLUMN public.fiscal_settings.dias_vto_cuenta_corriente IS
  'Dias entre la emision y el vencimiento (FchVtoPago) de una factura consolidada de cuenta corriente. Las de check-out y las notas de credito vencen el mismo dia. Editable en Ajustes -> Facturacion electronica.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) rpc_begin_invoice_emission: copia de la mig 80 (la ultima que la define) con
--    el vencimiento calculado segun el tipo de comprobante. Es el unico cambio.
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
  v_asoc public.invoices%ROWTYPE;
  v_r RECORD;
  v_tz TEXT;
  v_digits TEXT;
  v_today DATE;
  v_vto DATE;
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

  IF v_i.kind = 'consolidada' AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador emite facturas consolidadas.' USING errcode = '42501';
  END IF;
  IF v_i.kind = 'nota_credito' AND NOT public.app_is_admin()
     AND v_i.cash_shift_id IS DISTINCT FROM public.app_current_open_shift() THEN
    RAISE EXCEPTION 'Solo podes emitir notas de credito de tu turno abierto. Pedile al administrador.' USING errcode = 'P0023';
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

  IF v_i.reservation_id IS NULL THEN
    -- Consolidada o nota de crédito: no hay reserva de dónde re-leer; el receptor
    -- se fijó en el draft (de la ficha, o espejado del comprobante que anula).
    v_digits := regexp_replace(v_i.doc_nro::text, '\D', '', 'g');
    IF v_i.doc_tipo = 80 AND NOT public.app_is_valid_cuit(v_digits) THEN
      RAISE EXCEPTION 'El CUIT del receptor no es valido. Descarta el comprobante y volve a generarlo.' USING errcode = 'P0022';
    ELSIF v_i.doc_tipo = 96 AND length(v_digits) NOT IN (7, 8) THEN
      RAISE EXCEPTION 'El DNI del receptor no es valido. Corregilo en la ficha y volve a generar el comprobante.' USING errcode = 'P0022';
    END IF;
    v_doc_nro := v_i.doc_nro;
    v_receptor := v_i.receptor_nombre;
  ELSIF v_i.doc_tipo = 96 THEN
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

  -- Comprobante asociado (AFIP lo exige en la NC). Debe tener número y fecha:
  -- sólo una factura ya autorizada los tiene.
  IF v_i.nota_credito_de IS NOT NULL THEN
    SELECT * INTO v_asoc FROM public.invoices WHERE id = v_i.nota_credito_de;
    IF v_asoc.id IS NULL OR v_asoc.cbte_nro IS NULL OR v_asoc.cbte_fch IS NULL THEN
      RAISE EXCEPTION 'El comprobante que se quiere anular no tiene numero asignado.' USING errcode = '22023';
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;
  v_today := (NOW() AT TIME ZONE v_tz)::date;

  -- Vencimiento de pago (FchVtoPago). El check-out y la nota de credito se cobran
  -- en el momento: vencen el mismo dia. La consolidada NO: junta un mes de estadias
  -- fiadas y la venta es a credito, asi que vence al plazo configurado. Decirle
  -- "contado" a ARCA en una venta a cuenta corriente es un defecto formal frente a
  -- la RG 1415 (auditoria fiscal, hallazgo A-01).
  -- WSFEv1 acepta FchVtoPago >= CbteFch, asi que sumar dias es valido; el resto del
  -- envelope no cambia.
  -- El plazo sale de v_s, que ya se leyo mas arriba: no hace falta otra consulta.
  IF v_i.kind = 'consolidada' THEN
    v_vto := v_today + COALESCE(v_s.dias_vto_cuenta_corriente, 30);
  ELSE
    v_vto := v_today;
  END IF;

  UPDATE public.invoices
  SET status = 'processing',
      cbte_nro = p_cbte_nro,
      cbte_fch = v_today,
      fch_vto_pago = v_vto,            -- contado el mismo dia; consolidada, al plazo
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
    'cbte_asoc_tipo', v_asoc.cbte_tipo,
    'cbte_asoc_pto_vta', v_asoc.pto_vta,
    'cbte_asoc_nro', v_asoc.cbte_nro,
    'cbte_asoc_fch', to_char(v_asoc.cbte_fch, 'YYYYMMDD'),
    'cuit', (SELECT cuit FROM public.fiscal_settings WHERE id = 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_begin_invoice_emission(UUID, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_begin_invoice_emission(UUID, BIGINT, TEXT) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('98_condicion_venta_y_vencimiento_consolidada.sql');
  END IF;
END $$;

COMMIT;
