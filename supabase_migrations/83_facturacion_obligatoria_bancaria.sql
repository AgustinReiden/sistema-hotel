-- Migration 83: La facturación es OBLIGATORIA cuando se cobró por medio bancario.
--
-- Lo que se cobra con tarjeta, transferencia o Mercado Pago deja rastro bancario:
-- no facturarlo es una inconsistencia que después hay que explicar. En esos casos
-- el prompt "¿Emitir factura? SÍ/NO" no se muestra — siempre es sí.
--
-- QUÉ ES OBLIGATORIO Y QUÉ NO. Lo que esta migración prohíbe es **decidir** no
-- facturar, no que algo quede sin factura. Si ARCA se cae, la estadía queda
-- pendiente y salta en el aviso de cierre de turno y en el control (mig 82). Trabar
-- el mostrador con el cliente adelante sería peor que el problema que resuelve.
--
-- POR QUÉ EL MEDIO DE PAGO SE RESUELVE EN LA BASE Y NO EN LA PANTALLA: hay tres
-- caminos de check-out **sin método de pago**. Si el huésped pagó antes (seña o
-- pago adelantado desde su ficha), el saldo llega en cero, el modal de cobro nunca
-- se abre y el check-out no inserta ninguna fila en `payments`. La única fuente
-- confiable son los pagos ya registrados de la reserva. Mismo criterio que
-- `get_shift_checkout_export` (mig 71), que ya deriva el medio de pago por estadía.
--
-- Errcode nuevo: P0032 (se cobró por medio bancario, no se puede declinar).
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ … $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Requiere 79, 80, 81 y 82 aplicadas.
-- OJO: el DROP+CREATE de rpc_list_billing_control va en UNA SOLA sección.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Qué cuenta como "bancario". Un solo lugar, para que la app y la base no se
--    desincronicen (el espejo en TS es src/lib/billing.ts).
--    `other` queda afuera a propósito: no tiene botón en el cobro y su semántica
--    es indefinida, así que no se puede afirmar que deje rastro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_is_bank_payment_method(p_method TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_method IN ('credit_card', 'debit_card', 'bank_transfer', 'mercado_pago');
$$;

-- Mira TODOS los pagos de la reserva, no sólo el del check-out: es lo que cubre
-- las estadías prepagadas por transferencia.
CREATE OR REPLACE FUNCTION public.app_reservation_has_bank_payment(p_reservation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.reservation_id = p_reservation_id
      AND public.app_is_bank_payment_method(p.payment_method)
  );
$$;

REVOKE ALL ON FUNCTION public.app_is_bank_payment_method(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_reservation_has_bank_payment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_is_bank_payment_method(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_reservation_has_bank_payment(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) rpc_decline_invoice: acá vive el enforcement real del "siempre sí". Sin este
--    guard la regla sería sólo cosmética — un fetch a mano alcanzaría para saltar
--    la pantalla y marcar la estadía como "no facturar".
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

  -- Cobrado por medio bancario: no se puede elegir no facturar. Ni el admin, que
  -- para eso tiene la marca de "facturado por fuera" (mig 82) si lo hizo en ARCA.
  IF public.app_reservation_has_bank_payment(p_reservation_id) THEN
    RAISE EXCEPTION 'Se cobro por tarjeta, transferencia o Mercado Pago: esta estadia se factura si o si.' USING errcode = 'P0032';
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
-- 3) rpc_lookup_receptor_by_cuit: "si ya se facturó antes a ese CUIT, que traiga
--    los datos solo". Se consulta al tipear el CUIT en el paso con CUIT.
--    Prioridad: ficha de empresa → ficha de huésped → última factura emitida.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_lookup_receptor_by_cuit(p_cuit TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cuit TEXT;
  v_ac public.associated_clients%ROWTYPE;
  v_g public.guests%ROWTYPE;
  v_i public.invoices%ROWTYPE;
  v_cond TEXT;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  v_cuit := regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g');
  -- Sin CUIT válido no se busca nada: evita barrer tablas mientras se tipea.
  IF NOT public.app_is_valid_cuit(v_cuit) THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  -- 1) Empresa / convenio: es la ficha canónica.
  SELECT * INTO v_ac FROM public.associated_clients
  WHERE regexp_replace(COALESCE(document_id, ''), '\D', '', 'g') = v_cuit
  ORDER BY is_active DESC, updated_at DESC
  LIMIT 1;

  IF v_ac.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'found', TRUE, 'fuente', 'empresa',
      'razon_social', v_ac.display_name,
      'condicion_iva', v_ac.condicion_iva,
      'domicilio', v_ac.domicilio
    );
  END IF;

  -- 2) Huésped con datos de facturación cargados (mig 81).
  SELECT * INTO v_g FROM public.guests
  WHERE regexp_replace(COALESCE(cuit, ''), '\D', '', 'g') = v_cuit
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_g.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'found', TRUE, 'fuente', 'huesped',
      'razon_social', COALESCE(v_g.razon_social, v_g.full_name),
      'condicion_iva', v_g.condicion_iva,
      'domicilio', COALESCE(v_g.domicilio_fiscal, NULLIF(BTRIM(v_g.address), ''))
    );
  END IF;

  -- 3) Última factura emitida a ese CUIT: no hay ficha, pero ya se le facturó.
  SELECT * INTO v_i FROM public.invoices
  WHERE doc_tipo = 80 AND status = 'authorized' AND doc_nro = v_cuit::bigint
  ORDER BY cbte_fch DESC NULLS LAST, updated_at DESC
  LIMIT 1;

  IF v_i.id IS NOT NULL THEN
    v_cond := CASE v_i.condicion_iva_receptor_id
                WHEN 1 THEN 'responsable_inscripto'
                WHEN 6 THEN 'monotributo'
                WHEN 4 THEN 'exento'
              END;
    RETURN jsonb_build_object(
      'found', TRUE, 'fuente', 'factura',
      'razon_social', v_i.receptor_nombre,
      'condicion_iva', v_cond,
      'domicilio', v_i.receptor_domicilio
    );
  END IF;

  RETURN jsonb_build_object('found', FALSE);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_lookup_receptor_by_cuit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_lookup_receptor_by_cuit(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_list_billing_control: columna `bancario`. Sin esto, cuando una estadía
--    obligatoria se escapa por el atajo de la X, el admin no puede distinguirla
--    del resto de las pendientes. Cambia el tipo de retorno → DROP+CREATE, en UNA
--    SOLA seccion de exec_ddl (dentro de la transaccion las demas sesiones siguen
--    viendo la version vieja hasta el COMMIT).
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_list_billing_control(DATE, DATE, TEXT, UUID);
CREATE FUNCTION public.rpc_list_billing_control(
  p_from         DATE,
  p_to           DATE,
  p_client_kind  TEXT DEFAULT NULL,
  p_client_id    UUID DEFAULT NULL
)
RETURNS TABLE (
  reservation_id UUID,
  room_number TEXT,
  client_name TEXT,
  cliente TEXT,
  client_kind TEXT,
  client_id UUID,
  actual_check_out TIMESTAMPTZ,
  fch_desde DATE,
  fch_hasta DATE,
  total_price NUMERIC,
  cargo_cc NUMERIC,
  cierre TEXT,
  facturacion_modo TEXT,
  estado TEXT,
  invoice_id UUID,
  invoice_kind TEXT,
  invoice_status TEXT,
  cbte_tipo INT,
  pto_vta INT,
  cbte_nro BIGINT,
  imp_total NUMERIC,
  external_ref TEXT,
  bancario BOOLEAN
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
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'Indica el rango de fechas.' USING errcode = '22023';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  RETURN QUERY
  SELECT
    r.id,
    ro.room_number,
    r.client_name,
    COALESCE(ac.display_name, g.full_name, r.client_name),
    CASE WHEN ac.id IS NOT NULL THEN 'company'
         WHEN g.id IS NOT NULL THEN 'guest' END,
    COALESCE(ac.id, g.id),
    r.actual_check_out,
    (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date,
    (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date,
    r.total_price,
    cc.cargo,
    CASE
      WHEN EXISTS (SELECT 1 FROM public.payments p
                   WHERE p.reservation_id = r.id AND p.payment_method = 'vale_blanco') THEN 'vale_blanco'
      WHEN cc.cargo IS NOT NULL THEN 'cuenta_corriente'
      ELSE 'caja'
    END,
    COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout'),
    CASE
      -- Facturada por fuera del sistema: el admin lo afirmó y quedó registrado.
      WHEN ir.external_ref IS NOT NULL THEN 'facturado_externo'
      WHEN i.status = 'authorized' AND i.kind = 'consolidada' THEN 'facturado_consolidado'
      WHEN i.status = 'authorized' THEN 'facturado'
      WHEN i.id IS NOT NULL THEN 'en_proceso'
      WHEN EXISTS (SELECT 1 FROM public.payments p
                   WHERE p.reservation_id = r.id AND p.payment_method = 'vale_blanco') THEN 'no_corresponde'
      WHEN COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout') = 'no_factura' THEN 'no_corresponde'
      WHEN cc.cargo IS NOT NULL THEN 'pendiente_consolidada'
      ELSE 'falta'
    END,
    i.id, i.kind, i.status, i.cbte_tipo, i.pto_vta, i.cbte_nro, i.imp_total,
    ir.external_ref,
    public.app_reservation_has_bank_payment(r.id)
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  LEFT JOIN public.associated_clients ac ON ac.id = r.associated_client_id
  LEFT JOIN public.guests g ON g.id = r.guest_id
  LEFT JOIN public.invoice_reservations ir
         ON ir.reservation_id = r.id AND ir.unlinked_at IS NULL
  LEFT JOIN public.invoices i ON i.id = ir.invoice_id
  LEFT JOIN LATERAL (
    SELECT SUM(m.amount) AS cargo
    FROM public.cuenta_corriente_movimientos m
    WHERE m.reservation_id = r.id AND m.tipo = 'cargo'
  ) cc ON TRUE
  WHERE r.status = 'checked_out'
    AND (r.actual_check_out AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
    AND (
      p_client_id IS NULL
      OR (p_client_kind = 'company' AND ac.id = p_client_id)
      OR (p_client_kind = 'guest' AND g.id = p_client_id)
    )
  ORDER BY r.actual_check_out DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_billing_control(DATE, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_billing_control(DATE, DATE, TEXT, UUID) TO authenticated;

COMMIT;
