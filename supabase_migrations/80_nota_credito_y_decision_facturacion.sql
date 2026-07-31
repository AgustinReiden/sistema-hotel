-- Migration 80: Nota de crédito (anulación fiscal) + decisión SÍ/NO del check-out.
--
-- PUNTO 2 DEL GERENTE — NOTA DE CRÉDITO. Hoy, si el playero factura con el CUIT
-- equivocado y sale el CAE, NO HAY FORMA de arreglarlo desde el sistema:
-- rpc_discard_invoice sólo aplica a pending/rejected, nunca a una autorizada.
-- Esta migración agrega la NC, que AFIP exige que referencie el comprobante que
-- cancela (bloque <CbtesAsoc> del WSFEv1).
--
--   Factura B (6) → Nota de Crédito B (8)
--   Factura A (1) → Nota de Crédito A (3)
--
-- Permisos (regla textual de Jorge): el playero puede anular mientras su turno
-- siga abierto; después del cierre, sólo el administrador. Las consolidadas las
-- anula sólo el admin. La NC es SÓLO FISCAL: no devuelve plata ni toca la caja.
--
-- CLAVE DEL DISEÑO — `invoices.anulada_at`: al obtener CAE la NC, el trigger marca
-- la factura anulada y desvincula sus estadías. Sin eso, "volver a facturar" sería
-- IMPOSIBLE: la factura anulada seguiría ocupando `invoices_reservation_uq` y el
-- bloque de reuso de rpc_create_invoice_draft devolvería `already_authorized`.
-- Por eso el índice único de reserva se recrea con `AND anulada_at IS NULL`.
-- Después de anular quedan 3 papeles (factura mala + NC + factura buena): es lo
-- correcto, AFIP conserva las dos primeras y el número queda consumido.
--
-- PUNTO 1 DEL GERENTE — VENTANA DE FACTURACIÓN. Hoy elegir "NO" no deja rastro, así
-- que el playero puede volver más tarde (dentro de su turno) y facturar igual.
-- Se agrega `reservations.invoice_decision`: una vez que dijo NO, no puede
-- cambiarlo — sólo el administrador. **Reintentar una emisión que ya se decidió y
-- falló SIGUE PERMITIDO**, porque el reintento va por rpc_begin_invoice_emission y
-- no por rpc_create_invoice_draft. Esa distinción es deliberada: sin ella, una
-- caída de ARCA dejaría esa venta sin factura para siempre.
--
-- Errcodes nuevos: P0030 (se eligió no facturar), P0031 (la factura ya está
-- anulada o tiene una NC en curso).
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ … $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Requiere la migración 79 aplicada.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) invoices: nota de crédito y marca de anulación.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS nota_credito_de UUID REFERENCES public.invoices(id);
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS anulada_at TIMESTAMPTZ;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_kind_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_kind_check
  CHECK (kind IN ('checkout', 'consolidada', 'nota_credito'));

-- La NC no cuelga de una reserva (chocaría con invoices_reservation_uq) y SIEMPRE
-- referencia al comprobante que cancela. Sí lleva cash_shift_id: es el turno en
-- que se emitió, y es lo que habilita el gate del playero.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_kind_shape;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_kind_shape CHECK (
    (kind = 'checkout' AND reservation_id IS NOT NULL AND nota_credito_de IS NULL)
    OR (kind = 'consolidada' AND reservation_id IS NULL AND cash_shift_id IS NULL
        AND nota_credito_de IS NULL)
    OR (kind = 'nota_credito' AND reservation_id IS NULL AND nota_credito_de IS NOT NULL)
  );

-- Coherencia tipo ↔ documento ↔ condición IVA, ahora también para las NC, que
-- espejan exactamente al comprobante que anulan.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_tipo_doc_coherent;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_tipo_doc_coherent
  CHECK (
    -- Facturas
    (cbte_tipo = 6 AND doc_tipo = 96 AND condicion_iva_receptor_id = 5)
    OR (cbte_tipo = 6 AND doc_tipo = 80 AND condicion_iva_receptor_id = 4)
    OR (cbte_tipo = 1 AND doc_tipo = 80 AND condicion_iva_receptor_id IN (1, 6))
    -- Notas de crédito (B = 8, A = 3)
    OR (cbte_tipo = 8 AND doc_tipo = 96 AND condicion_iva_receptor_id = 5)
    OR (cbte_tipo = 8 AND doc_tipo = 80 AND condicion_iva_receptor_id = 4)
    OR (cbte_tipo = 3 AND doc_tipo = 80 AND condicion_iva_receptor_id IN (1, 6))
  );

-- Una sola NC viva por comprobante (descartar la NC libera el comprobante).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_nota_credito_uq
  ON public.invoices(nota_credito_de)
  WHERE nota_credito_de IS NOT NULL AND status <> 'discarded';

-- Recrear el único por reserva excluyendo las anuladas: es lo que permite
-- volver a facturar la estadía después de la NC.
DROP INDEX IF EXISTS public.invoices_reservation_uq;
CREATE UNIQUE INDEX invoices_reservation_uq
  ON public.invoices(reservation_id)
  WHERE reservation_id IS NOT NULL AND status <> 'discarded' AND anulada_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Trigger: al autorizarse la NC, anula el comprobante y libera sus estadías.
--    Se extiende la función de la mig 79 (misma firma, mismo trigger).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_sync_invoice_reservation_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_room TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reservation_id IS NOT NULL AND NEW.status <> 'discarded' THEN
      SELECT ro.room_number INTO v_room
      FROM public.reservations r
      LEFT JOIN public.rooms ro ON ro.id = r.room_id
      WHERE r.id = NEW.reservation_id;

      INSERT INTO public.invoice_reservations
        (invoice_id, reservation_id, amount, room_number, fch_desde, fch_hasta)
      VALUES (NEW.id, NEW.reservation_id, NEW.imp_total, v_room,
              NEW.fch_serv_desde, NEW.fch_serv_hasta)
      ON CONFLICT (invoice_id, reservation_id)
      DO UPDATE SET unlinked_at = NULL, amount = EXCLUDED.amount;
    END IF;
    RETURN NEW;
  END IF;

  -- Nota de crédito con CAE: marca el comprobante anulado y libera sus estadías,
  -- que vuelven a quedar facturables. Sin esto, "volver a facturar" no funciona.
  IF NEW.kind = 'nota_credito'
     AND NEW.status = 'authorized' AND OLD.status <> 'authorized'
     AND NEW.nota_credito_de IS NOT NULL THEN
    UPDATE public.invoices
    SET anulada_at = NOW(), updated_at = NOW()
    WHERE id = NEW.nota_credito_de AND anulada_at IS NULL;

    UPDATE public.invoice_reservations
    SET unlinked_at = NOW()
    WHERE invoice_id = NEW.nota_credito_de AND unlinked_at IS NULL;
  END IF;

  IF NEW.status = 'discarded' AND OLD.status <> 'discarded' THEN
    UPDATE public.invoice_reservations
    SET unlinked_at = NOW()
    WHERE invoice_id = NEW.id AND unlinked_at IS NULL;
  ELSIF OLD.status = 'discarded' AND NEW.status <> 'discarded' THEN
    UPDATE public.invoice_reservations
    SET unlinked_at = NULL
    WHERE invoice_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) reservations: decisión SÍ/NO tomada en el check-out (punto 1).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS invoice_decision TEXT;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS invoice_decision_at TIMESTAMPTZ;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS invoice_decision_by UUID REFERENCES auth.users(id);

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_invoice_decision_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_invoice_decision_check
  CHECK (invoice_decision IS NULL OR invoice_decision IN ('si', 'no'));

CREATE INDEX IF NOT EXISTS reservations_invoice_decision_idx
  ON public.reservations(invoice_decision)
  WHERE invoice_decision IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_decline_invoice: el playero eligió NO en el prompt del check-out.
--    Sólo graba 'no'. El 'si' lo graba solo rpc_create_invoice_draft al facturar,
--    así no existe ningún camino para "des-decidir" desde el cliente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_decline_invoice(p_reservation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r RECORD;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.id, r.status, r.invoice_decision, r.checkout_cash_shift_id
  INTO v_r
  FROM public.reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_r.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Solo aplica a reservas con check-out realizado.' USING errcode = '22023';
  END IF;

  -- Si ya se facturó, la decisión 'no' no tiene sentido: se ignora sin romper.
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.reservation_id = p_reservation_id
      AND i.status <> 'discarded' AND i.anulada_at IS NULL
  ) THEN
    RETURN jsonb_build_object('reservation_id', p_reservation_id, 'decision', 'si', 'ignored', TRUE);
  END IF;

  IF v_r.invoice_decision = 'no' THEN
    RETURN jsonb_build_object('reservation_id', p_reservation_id, 'decision', 'no', 'already', TRUE);
  END IF;

  UPDATE public.reservations
  SET invoice_decision = 'no',
      invoice_decision_at = NOW(),
      invoice_decision_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object('reservation_id', p_reservation_id, 'decision', 'no');
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_decline_invoice(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_decline_invoice(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) rpc_create_credit_note_draft: NC que anula un comprobante autorizado.
--    Espeja tipo/documento/condición/importes del original y lo referencia.
--    El CAE lo pide el emisor de siempre (emitInvoice); acá sólo se arma el draft.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_credit_note_draft(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_i public.invoices%ROWTYPE;
  v_s public.fiscal_settings%ROWTYPE;
  v_existing public.invoices%ROWTYPE;
  v_nc_tipo INT;
  v_nc_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT * INTO v_i FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada.' USING errcode = 'P0002';
  END IF;

  -- Sólo se anula lo que tiene CAE. Sin CAE el camino correcto es descartar.
  IF v_i.status <> 'authorized' THEN
    RAISE EXCEPTION 'Solo se anula con nota de credito una factura ya emitida (con CAE). Si no tiene CAE, descartala.' USING errcode = '22023';
  END IF;
  IF v_i.kind = 'nota_credito' THEN
    RAISE EXCEPTION 'No se emite una nota de credito de otra nota de credito.' USING errcode = '22023';
  END IF;
  IF v_i.anulada_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta factura ya fue anulada con una nota de credito.' USING errcode = 'P0031';
  END IF;

  -- ¿Ya hay una NC en curso para esta factura? Reusarla en vez de duplicar.
  SELECT * INTO v_existing FROM public.invoices
  WHERE nota_credito_de = p_invoice_id AND status <> 'discarded';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'invoice_id', v_existing.id,
      'status', v_existing.status,
      'kind', 'nota_credito',
      'reused', TRUE,
      'cbte_tipo', v_existing.cbte_tipo
    );
  END IF;

  SELECT * INTO v_s FROM public.fiscal_settings WHERE id = 1;
  IF NOT COALESCE(v_s.enabled, FALSE) THEN
    RAISE EXCEPTION 'La facturacion electronica no esta configurada o habilitada.' USING errcode = 'P0025';
  END IF;
  IF v_i.environment <> v_s.environment THEN
    RAISE EXCEPTION 'La factura pertenece a otro ambiente (%). Config actual: %.', v_i.environment, v_s.environment USING errcode = 'P0025';
  END IF;

  -- Permisos (regla del gerente): el playero anula dentro de su turno abierto;
  -- cerrado el turno, sólo el administrador. Las consolidadas, sólo el admin.
  IF NOT public.app_is_admin() THEN
    IF v_i.kind = 'consolidada' THEN
      RAISE EXCEPTION 'Solo el administrador anula facturas consolidadas.' USING errcode = '42501';
    END IF;
    IF v_i.cash_shift_id IS NULL
       OR v_i.cash_shift_id IS DISTINCT FROM public.app_current_open_shift() THEN
      RAISE EXCEPTION 'Solo podes anular facturas de tu turno abierto. Pedile al administrador.' USING errcode = 'P0023';
    END IF;
  END IF;

  -- B (6) → NC B (8) · A (1) → NC A (3). El resto de los campos se espejan.
  v_nc_tipo := CASE v_i.cbte_tipo WHEN 1 THEN 3 WHEN 6 THEN 8 END;
  IF v_nc_tipo IS NULL THEN
    RAISE EXCEPTION 'Tipo de comprobante % sin nota de credito definida.', v_i.cbte_tipo USING errcode = '22023';
  END IF;

  INSERT INTO public.invoices (
    kind, reservation_id, nota_credito_de, status, environment, pto_vta, cbte_tipo, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre, receptor_domicilio,
    imp_total, imp_neto, imp_iva, iva_id,
    fch_serv_desde, fch_serv_hasta,
    cash_shift_id, created_by
  )
  VALUES (
    'nota_credito', NULL, p_invoice_id, 'pending', v_i.environment, v_i.pto_vta, v_nc_tipo, v_i.concepto,
    v_i.doc_tipo, v_i.doc_nro, v_i.condicion_iva_receptor_id, v_i.receptor_nombre, v_i.receptor_domicilio,
    v_i.imp_total, v_i.imp_neto, v_i.imp_iva, v_i.iva_id,
    v_i.fch_serv_desde, v_i.fch_serv_hasta,
    public.app_current_open_shift(), auth.uid()
  )
  RETURNING id INTO v_nc_id;

  RETURN jsonb_build_object(
    'invoice_id', v_nc_id,
    'status', 'pending',
    'kind', 'nota_credito',
    'reused', FALSE,
    'cbte_tipo', v_nc_tipo
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_create_credit_note_draft(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_credit_note_draft(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RPC existentes: reconocer `anulada_at` (una factura anulada ya no ocupa la
--    reserva) y la decisión del check-out. Todos CREATE OR REPLACE, misma firma.
-- ─────────────────────────────────────────────────────────────────────────────

-- 6.1) rpc_create_invoice_draft: gate de la decisión (punto 1) + ignorar anuladas.
CREATE OR REPLACE FUNCTION public.rpc_create_invoice_draft(
  p_reservation_id UUID,
  p_tipo           TEXT DEFAULT 'B',   -- vestigial: la condición IVA manda
  p_cuit           TEXT DEFAULT NULL,
  p_condicion_iva  TEXT DEFAULT NULL,
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
  v_modo TEXT;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.id, r.status, r.total_price, r.client_name, r.client_dni,
         r.associated_client_id, r.guest_id, r.checkout_cash_shift_id,
         r.check_in_target, r.actual_check_in, r.actual_check_out,
         r.invoice_decision
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

  -- Modo de facturación de la ficha. La empresa manda sobre el huésped, igual
  -- criterio que rpc_staff_checkout_reservation al elegir a quién cargar.
  IF v_r.associated_client_id IS NOT NULL THEN
    SELECT facturacion_modo INTO v_modo
    FROM public.associated_clients WHERE id = v_r.associated_client_id;
  ELSIF v_r.guest_id IS NOT NULL THEN
    SELECT facturacion_modo INTO v_modo
    FROM public.guests WHERE id = v_r.guest_id;
  END IF;
  v_modo := COALESCE(v_modo, 'por_checkout');

  IF v_modo = 'no_factura' THEN
    RAISE EXCEPTION 'La ficha del cliente esta marcada como "no se factura".' USING errcode = 'P0027';
  END IF;

  -- PUNTO 1: si en el check-out se eligió NO, el playero no puede cambiarlo.
  -- Esto NO afecta los reintentos: el retry va por rpc_begin_invoice_emission.
  IF v_r.invoice_decision = 'no' AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'En el check-out se eligio no facturar. Solo el administrador puede emitirla ahora.' USING errcode = 'P0030';
  END IF;

  -- Cuenta corriente: sólo se bloquea si el cliente se factura consolidado.
  -- Con 'por_checkout' la estadía se factura al cerrar aunque vaya a cta cte.
  IF v_modo <> 'por_checkout' AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos m
    WHERE m.reservation_id = p_reservation_id AND m.tipo = 'cargo'
  ) THEN
    RAISE EXCEPTION 'Cliente con factura consolidada: esta estadia se factura desde Control de facturacion.' USING errcode = 'P0027';
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

  -- `anulada_at IS NULL`: una factura anulada por nota de credito ya no cuenta,
  -- justamente para poder volver a facturar la estadia.
  SELECT * INTO v_existing FROM public.invoices
  WHERE reservation_id = p_reservation_id AND status <> 'discarded' AND anulada_at IS NULL;
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

  -- Va DESPUÉS del bloque de reuso: si la estadía tiene factura propia, arriba se
  -- devolvió para reimprimir. Acá sólo cae la que está en una consolidada ajena.
  IF EXISTS (
    SELECT 1 FROM public.invoice_reservations ir
    WHERE ir.reservation_id = p_reservation_id AND ir.unlinked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esta estadia ya esta incluida en una factura consolidada.' USING errcode = 'P0026';
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
    kind, reservation_id, status, environment, pto_vta, cbte_tipo, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre, receptor_domicilio,
    imp_total, imp_neto, imp_iva, iva_id,
    fch_serv_desde, fch_serv_hasta,
    cash_shift_id, created_by
  )
  VALUES (
    'checkout', p_reservation_id, 'pending', v_s.environment, v_s.punto_venta, v_cbte_tipo, v_s.concepto,
    v_doc_tipo, v_doc_nro::bigint, v_cond_id, v_receptor, v_domicilio,
    v_r.total_price, v_neto, v_iva, 5,
    (COALESCE(v_r.actual_check_in, v_r.check_in_target) AT TIME ZONE v_tz)::date,
    (COALESCE(v_r.actual_check_out, NOW()) AT TIME ZONE v_tz)::date,
    v_r.checkout_cash_shift_id, auth.uid()
  )
  RETURNING id INTO v_invoice_id;

  -- Queda registrado que se decidió facturar (punto 1). Es el único camino a 'si'.
  UPDATE public.reservations
  SET invoice_decision = 'si',
      invoice_decision_at = COALESCE(invoice_decision_at, NOW()),
      invoice_decision_by = COALESCE(invoice_decision_by, auth.uid()),
      updated_at = NOW()
  WHERE id = p_reservation_id AND invoice_decision IS DISTINCT FROM 'si';

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id, 'status', 'pending', 'reused', FALSE, 'cbte_tipo', v_cbte_tipo
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 6.2) rpc_begin_invoice_emission: la rama "sin reserva" ahora cubre consolidada Y
--      nota de crédito (misma condición: reservation_id IS NULL), y el payload
--      lleva el comprobante asociado que la NC necesita para el <CbtesAsoc>.
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

-- 6.3) rpc_list_pending_invoices: etiquetar también las notas de crédito.
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
  SELECT i.id, i.reservation_id, i.status,
         CASE
           WHEN i.kind = 'nota_credito' THEN 'NOTA DE CREDITO'
           WHEN ro.room_number IS NULL THEN 'CONSOLIDADA'
           ELSE ro.room_number
         END,
         i.receptor_nombre,
         i.imp_total, i.attempt_count, i.last_error, i.last_attempt_at, i.created_at
  FROM public.invoices i
  LEFT JOIN public.reservations r ON r.id = i.reservation_id
  LEFT JOIN public.rooms ro ON ro.id = r.room_id
  WHERE i.status NOT IN ('authorized', 'discarded')
    AND (
      public.app_is_admin()
      OR i.cash_shift_id = public.app_current_open_shift()
    )
  ORDER BY i.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_pending_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_pending_invoices() TO authenticated;

-- 6.4) rpc_list_invoiceable_checkouts: las anuladas vuelven a ser facturables, y
--      al recepcionista no se le ofrece lo que él mismo marcó como "no facturar".
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
  LEFT JOIN public.associated_clients ac ON ac.id = r.associated_client_id
  LEFT JOIN public.guests g ON g.id = r.guest_id
  WHERE r.status = 'checked_out'
    AND COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout') = 'por_checkout'
    AND (public.app_is_admin() OR r.invoice_decision IS DISTINCT FROM 'no')
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = r.id AND i.status <> 'discarded' AND i.anulada_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.invoice_reservations ir
      WHERE ir.reservation_id = r.id AND ir.unlinked_at IS NULL
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

-- 6.5) rpc_list_cc_charges_to_invoice: idem, una estadía cuya factura fue anulada
--      vuelve al pool de consolidables.
CREATE OR REPLACE FUNCTION public.rpc_list_cc_charges_to_invoice(
  p_kind      TEXT,
  p_client_id UUID,
  p_from      DATE DEFAULT NULL,
  p_to        DATE DEFAULT NULL
)
RETURNS TABLE (
  reservation_id UUID,
  movimiento_id UUID,
  room_number TEXT,
  passenger TEXT,
  fch_desde DATE,
  fch_hasta DATE,
  amount NUMERIC,
  total_price NUMERIC,
  actual_check_out TIMESTAMPTZ,
  mixed_payment BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('company', 'guest') THEN
    RAISE EXCEPTION 'Tipo de cliente invalido.' USING errcode = '22023';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Indica el cliente a facturar.' USING errcode = '22023';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  RETURN QUERY
  SELECT r.id, m.id, ro.room_number, r.client_name,
         (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date,
         (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date,
         m.amount, r.total_price, r.actual_check_out,
         (m.amount <> r.total_price
          OR EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id = r.id))
  FROM public.cuenta_corriente_movimientos m
  JOIN public.reservations r ON r.id = m.reservation_id
  LEFT JOIN public.rooms ro ON ro.id = r.room_id
  WHERE m.tipo = 'cargo'
    AND r.status = 'checked_out'
    AND (
      (p_kind = 'company' AND m.associated_client_id = p_client_id)
      OR (p_kind = 'guest' AND m.guest_id = p_client_id)
    )
    AND (p_from IS NULL OR (r.actual_check_out AT TIME ZONE v_tz)::date >= p_from)
    AND (p_to IS NULL OR (r.actual_check_out AT TIME ZONE v_tz)::date <= p_to)
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = r.id AND i.status <> 'discarded' AND i.anulada_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.invoice_reservations ir
      WHERE ir.reservation_id = r.id AND ir.unlinked_at IS NULL
    )
  ORDER BY r.actual_check_out;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_cc_charges_to_invoice(TEXT, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_cc_charges_to_invoice(TEXT, UUID, DATE, DATE) TO authenticated;

-- 6.6) rpc_create_consolidated_invoice_draft: mismo criterio en el guard P0026.
--      Sin esto, una estadía cuya factura se anuló no se podría re-consolidar.
CREATE OR REPLACE FUNCTION public.rpc_create_consolidated_invoice_draft(
  p_kind            TEXT,
  p_client_id       UUID,
  p_reservation_ids UUID[],
  p_cuit            TEXT DEFAULT NULL,
  p_condicion_iva   TEXT DEFAULT NULL,
  p_razon_social    TEXT DEFAULT NULL,
  p_domicilio       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_s public.fiscal_settings%ROWTYPE;
  v_ac public.associated_clients%ROWTYPE;
  v_g public.guests%ROWTYPE;
  v_tz TEXT;
  v_ids UUID[];
  v_row RECORD;
  v_count INT := 0;
  v_total NUMERIC := 0;
  v_desde DATE;
  v_hasta DATE;
  v_neto NUMERIC;
  v_iva NUMERIC;
  v_cbte_tipo INT;
  v_doc_tipo INT;
  v_doc_nro TEXT;
  v_cond_id INT;
  v_cond_txt TEXT;
  v_receptor TEXT;
  v_domicilio TEXT;
  v_cuit TEXT;
  v_digits TEXT;
  v_invoice_id UUID;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador emite facturas consolidadas.' USING errcode = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('company', 'guest') THEN
    RAISE EXCEPTION 'Tipo de cliente invalido.' USING errcode = '22023';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Indica el cliente a facturar.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_s FROM public.fiscal_settings WHERE id = 1;
  IF NOT COALESCE(v_s.enabled, FALSE) THEN
    RAISE EXCEPTION 'La facturacion electronica no esta configurada o habilitada.' USING errcode = 'P0025';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT unnest(COALESCE(p_reservation_ids, ARRAY[]::UUID[])));
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos una estadia para facturar.' USING errcode = 'P0028';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  -- Lock determinístico por id: evita deadlock entre dos admins consolidando a la vez.
  PERFORM 1 FROM public.reservations r
  WHERE r.id = ANY (v_ids)
  ORDER BY r.id
  FOR UPDATE;

  -- Agrupado por reserva: si alguna tuviera más de un cargo, se suman en una sola
  -- fila (si no, el conteo daría un P0029 falso y el INSERT de abajo violaría la PK).
  FOR v_row IN
    SELECT r.id AS res_id, r.status AS res_status,
           SUM(m.amount) AS amount,
           (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date AS d1,
           (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date AS d2
    FROM public.cuenta_corriente_movimientos m
    JOIN public.reservations r ON r.id = m.reservation_id
    WHERE m.tipo = 'cargo'
      AND m.reservation_id = ANY (v_ids)
      AND (
        (p_kind = 'company' AND m.associated_client_id = p_client_id)
        OR (p_kind = 'guest' AND m.guest_id = p_client_id)
      )
    GROUP BY r.id, r.status, r.actual_check_in, r.check_in_target,
             r.actual_check_out, r.check_out_target
  LOOP
    v_count := v_count + 1;

    IF v_row.res_status <> 'checked_out' THEN
      RAISE EXCEPTION 'Solo se facturan estadias con check-out realizado.' USING errcode = '22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = v_row.res_id AND i.status <> 'discarded' AND i.anulada_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.invoice_reservations ir
      WHERE ir.reservation_id = v_row.res_id AND ir.unlinked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Una de las estadias seleccionadas ya esta facturada. Recarga la lista.' USING errcode = 'P0026';
    END IF;

    v_total := v_total + v_row.amount;
    v_desde := LEAST(COALESCE(v_desde, v_row.d1), v_row.d1);
    v_hasta := GREATEST(COALESCE(v_hasta, v_row.d2), v_row.d2);
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Ninguna de las estadias seleccionadas tiene cargo de cuenta corriente facturable.' USING errcode = 'P0028';
  END IF;
  IF v_count <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'La seleccion incluye estadias de otro cliente o sin cargo a cuenta corriente.' USING errcode = 'P0029';
  END IF;

  -- Receptor: sale de la ficha (o de lo que corrija el admin en el formulario).
  IF p_kind = 'company' THEN
    SELECT * INTO v_ac FROM public.associated_clients WHERE id = p_client_id;
    IF v_ac.id IS NULL THEN
      RAISE EXCEPTION 'Empresa no encontrada.' USING errcode = 'P0002';
    END IF;

    v_cond_txt := lower(BTRIM(COALESCE(NULLIF(BTRIM(p_condicion_iva), ''), v_ac.condicion_iva, '')));
    IF v_cond_txt NOT IN ('responsable_inscripto', 'monotributo', 'exento') THEN
      RAISE EXCEPTION 'Carga la condicion frente al IVA de la empresa (responsable inscripto, monotributo o exento) para poder facturar.' USING errcode = 'P0022';
    END IF;

    v_cuit := regexp_replace(COALESCE(NULLIF(BTRIM(p_cuit), ''), v_ac.document_id, ''), '\D', '', 'g');
    IF NOT public.app_is_valid_cuit(v_cuit) THEN
      RAISE EXCEPTION 'El CUIT del receptor no es valido (11 digitos con digito verificador).' USING errcode = 'P0022';
    END IF;

    v_receptor := COALESCE(NULLIF(BTRIM(p_razon_social), ''), v_ac.display_name);
    v_domicilio := COALESCE(NULLIF(BTRIM(p_domicilio), ''), v_ac.domicilio);
    v_doc_tipo := 80;
    v_doc_nro := v_cuit;

    IF v_cond_txt = 'responsable_inscripto' THEN
      v_cbte_tipo := 1; v_cond_id := 1;   -- Factura A
    ELSIF v_cond_txt = 'monotributo' THEN
      v_cbte_tipo := 1; v_cond_id := 6;   -- Factura A (leyenda Ley 27.618 en el impreso)
    ELSE
      v_cbte_tipo := 6; v_cond_id := 4;   -- Factura B a IVA Sujeto Exento
    END IF;

    -- "Queda guardado", mismo criterio que rpc_create_invoice_draft.
    UPDATE public.associated_clients
    SET condicion_iva = COALESCE(condicion_iva, v_cond_txt),
        domicilio = COALESCE(domicilio, v_domicilio),
        updated_at = NOW()
    WHERE id = p_client_id;
  ELSE
    -- Persona física: Factura B con DNI. No se agregan campos fiscales a guests.
    SELECT * INTO v_g FROM public.guests WHERE id = p_client_id;
    IF v_g.id IS NULL THEN
      RAISE EXCEPTION 'Huesped no encontrado.' USING errcode = 'P0002';
    END IF;

    v_digits := regexp_replace(COALESCE(v_g.document_id, ''), '\D', '', 'g');
    IF length(v_digits) NOT IN (7, 8) THEN
      RAISE EXCEPTION 'El DNI del huesped no es valido para facturar (7 u 8 digitos). Corregilo en la ficha.' USING errcode = 'P0022';
    END IF;

    v_cbte_tipo := 6;
    v_doc_tipo := 96;
    v_doc_nro := v_digits;
    v_cond_id := 5;
    v_receptor := v_g.full_name;
    v_domicilio := NULLIF(BTRIM(v_g.address), '');
  END IF;

  -- Redondeo SOBRE EL TOTAL. Sumar netos por estadía rompería invoices_amounts_add_up.
  v_total := round(v_total, 2);
  v_neto := round(v_total / (1 + v_s.iva_pct / 100), 2);
  v_iva := v_total - v_neto;

  INSERT INTO public.invoices (
    kind, reservation_id, status, environment, pto_vta, cbte_tipo, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre, receptor_domicilio,
    imp_total, imp_neto, imp_iva, iva_id,
    fch_serv_desde, fch_serv_hasta,
    cash_shift_id, created_by
  )
  VALUES (
    'consolidada', NULL, 'pending', v_s.environment, v_s.punto_venta, v_cbte_tipo, v_s.concepto,
    v_doc_tipo, v_doc_nro::bigint, v_cond_id, v_receptor, v_domicilio,
    v_total, v_neto, v_iva, 5,
    v_desde, v_hasta,
    NULL, auth.uid()
  )
  RETURNING id INTO v_invoice_id;

  -- Filas ya lockeadas arriba, y agrupadas igual que el loop (una por estadía).
  -- El backstop final es invoice_reservations_active_uq.
  INSERT INTO public.invoice_reservations
    (invoice_id, reservation_id, cc_movimiento_id, amount, room_number, fch_desde, fch_hasta)
  SELECT v_invoice_id, r.id, MIN(m.id), SUM(m.amount), ro.room_number,
         (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date,
         (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date
  FROM public.cuenta_corriente_movimientos m
  JOIN public.reservations r ON r.id = m.reservation_id
  LEFT JOIN public.rooms ro ON ro.id = r.room_id
  WHERE m.tipo = 'cargo'
    AND m.reservation_id = ANY (v_ids)
    AND (
      (p_kind = 'company' AND m.associated_client_id = p_client_id)
      OR (p_kind = 'guest' AND m.guest_id = p_client_id)
    )
  GROUP BY r.id, ro.room_number, r.actual_check_in, r.check_in_target,
           r.actual_check_out, r.check_out_target;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'status', 'pending',
    'kind', 'consolidada',
    'imp_total', v_total,
    'count', v_count,
    'cbte_tipo', v_cbte_tipo
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_create_consolidated_invoice_draft(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_consolidated_invoice_draft(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
