-- Migration 75: Factura B a IVA Exento (con CUIT) + decisión de comprobante por
-- condición IVA del receptor.
--
-- Contexto (verificado contra ARCA RG 5616 / RG 4919 / Ley 27.618):
--  - Emisor Responsable Inscripto: Factura A → receptor RI (1) o Monotributo (6);
--    Factura B → Consumidor Final (5) o IVA Sujeto Exento (4).
--  - Faltaba el receptor EXENTO: va en Factura B pero con CUIT (doc 80), no con DNI.
--  - La leyenda Ley 27.618 (Monotributo) y la "condición de venta" son de impreso
--    (no tocan la DB ni el WSFE): se resuelven en la representación impresa.
--
-- El tipo de comprobante pasa a DERIVARSE de la condición IVA del receptor (más
-- robusto). La firma de rpc_create_invoice_draft NO cambia (CREATE OR REPLACE, sin
-- DROP) → la app deployada sigue funcionando sin cambios.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ ... $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Verificar después con SELECTs.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) associated_clients.condicion_iva: agregar 'exento' al set permitido.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.associated_clients DROP CONSTRAINT IF EXISTS associated_clients_condicion_iva_check;
ALTER TABLE public.associated_clients
  ADD CONSTRAINT associated_clients_condicion_iva_check
  CHECK (condicion_iva IS NULL OR condicion_iva IN
    ('responsable_inscripto', 'monotributo', 'consumidor_final', 'exento'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) invoices: coherencia tipo ↔ doc ↔ condición IVA — agregar B a Exento con CUIT.
--    B(6)→DNI(96)/CF(5); B(6)→CUIT(80)/Exento(4); A(1)→CUIT(80)/RI(1) o Mono(6).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_tipo_doc_coherent;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_tipo_doc_coherent
  CHECK (
    (cbte_tipo = 6 AND doc_tipo = 96 AND condicion_iva_receptor_id = 5)
    OR (cbte_tipo = 6 AND doc_tipo = 80 AND condicion_iva_receptor_id = 4)
    OR (cbte_tipo = 1 AND doc_tipo = 80 AND condicion_iva_receptor_id IN (1, 6))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_create_invoice_draft: deriva el comprobante de la condición IVA del
--    receptor. MISMA firma (CREATE OR REPLACE, retrocompatible).
--      responsable_inscripto → A (1) / CUIT (80) / cond 1
--      monotributo           → A (1) / CUIT (80) / cond 6
--      exento                → B (6) / CUIT (80) / cond 4
--      (sin condición / consumidor_final) → B (6) / DNI (96) / cond 5  [flujo actual]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_invoice_draft(
  p_reservation_id UUID,
  p_tipo           TEXT DEFAULT 'B',   -- vestigial: la condición IVA manda
  p_cuit           TEXT DEFAULT NULL,
  p_condicion_iva  TEXT DEFAULT NULL,  -- 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final'
  p_razon_social   TEXT DEFAULT NULL,
  p_domicilio      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  IF v_r.associated_client_id IS NOT NULL THEN
    SELECT * INTO v_ac FROM public.associated_clients WHERE id = v_r.associated_client_id;
  END IF;

  v_neto := round(v_r.total_price / (1 + v_s.iva_pct / 100), 2);
  v_iva := v_r.total_price - v_neto;

  -- La condición IVA del receptor (del parámetro o de la ficha) decide el comprobante.
  v_cond_txt := lower(BTRIM(COALESCE(NULLIF(BTRIM(p_condicion_iva), ''), v_ac.condicion_iva, '')));

  IF v_cond_txt IN ('responsable_inscripto', 'monotributo', 'exento') THEN
    -- Receptor con CUIT (razón social y domicilio independientes del huésped).
    v_cuit := regexp_replace(COALESCE(NULLIF(BTRIM(p_cuit), ''), v_ac.document_id, ''), '\D', '', 'g');
    IF NOT public.app_is_valid_cuit(v_cuit) THEN
      RAISE EXCEPTION 'El CUIT del receptor no es valido (11 digitos con digito verificador). Corregilo y reintenta.' USING errcode = 'P0022';
    END IF;
    v_receptor := COALESCE(NULLIF(BTRIM(p_razon_social), ''), v_ac.display_name, v_r.client_name);
    v_domicilio := COALESCE(NULLIF(BTRIM(p_domicilio), ''), v_ac.domicilio);
    v_doc_tipo := 80;
    v_doc_nro := v_cuit;

    IF v_cond_txt = 'responsable_inscripto' THEN
      v_cbte_tipo := 1; v_cond_id := 1;   -- Factura A
    ELSIF v_cond_txt = 'monotributo' THEN
      v_cbte_tipo := 1; v_cond_id := 6;   -- Factura A (lleva leyenda Ley 27.618 en el impreso)
    ELSE
      v_cbte_tipo := 6; v_cond_id := 4;   -- Factura B a IVA Sujeto Exento
    END IF;

    -- "Queda guardado": completar condición IVA y domicilio de la ficha si estaban vacíos.
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
$fn$;

REVOKE ALL ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
