-- Migration 73: Fixes de facturación ARCA (hallazgos de las pruebas de homologación)
--
-- FIX 2: vale blanco (además de cuenta corriente) = consumo interno → no se factura.
-- FIX 3: recuperar una factura rechazada/pendiente → corregir el DNI de la reserva
--        (aunque ya esté checked_out) y reintentar, o descartar la factura. El
--        descarte es REVERSIBLE: la reserva vuelve a quedar facturable.
-- FIX 4: emitir sobre una reserva ya autorizada NO da error; devuelve la fila
--        authorized para que el front reimprima el comprobante.
-- FIX 6: el vale blanco no se puede partir ni combinar con otra forma de pago
--        (trigger BEFORE INSERT ON payments; no se tocan los RPC de cobro).
--
-- Estados de invoices: se agrega 'discarded' (descartada, no cuenta como emitida
-- ni bloquea re-facturar). El índice único por reserva pasa a ser parcial.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl('...') SIN ; final.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Estado 'discarded' en el CHECK de invoices.status (DROP + ADD)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('pending', 'processing', 'authorized', 'rejected', 'discarded'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) invoices_reservation_uq → índice único PARCIAL (ignora las descartadas),
--    para poder re-facturar una reserva cuya factura fue descartada.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.invoices_reservation_uq;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_reservation_uq
  ON public.invoices(reservation_id)
  WHERE status <> 'discarded';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_create_invoice_draft: + exclusión vale_blanco (FIX 2), ignora filas
--    descartadas (FIX 3), y devuelve already_authorized en vez de error (FIX 4).
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
  -- FIX 2: vale blanco = consumo interno, no se factura.
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

  -- FIX 3: ignorar filas descartadas → permite re-facturar tras descartar.
  SELECT * INTO v_existing FROM public.invoices
  WHERE reservation_id = p_reservation_id AND status <> 'discarded';
  IF FOUND THEN
    IF v_existing.status = 'authorized' THEN
      -- FIX 4: no romper con error; señalar que hay que reimprimir.
      RETURN jsonb_build_object(
        'invoice_id', v_existing.id,
        'status', 'authorized',
        'already_authorized', TRUE,
        'reused', TRUE
      );
    END IF;
    RETURN jsonb_build_object('invoice_id', v_existing.id, 'status', v_existing.status, 'reused', TRUE);
  END IF;

  v_digits := regexp_replace(COALESCE(v_r.client_dni, ''), '\D', '', 'g');
  IF length(v_digits) NOT IN (7, 8) THEN
    RAISE EXCEPTION 'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.' USING errcode = 'P0022';
  END IF;

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
-- 4) rpc_list_invoiceable_checkouts: + exclusión vale_blanco (FIX 2), y las
--    descartadas reaparecen como facturables (FIX 3).
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
    AND r.associated_client_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = r.id AND i.status <> 'discarded'   -- FIX 3
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.cuenta_corriente_movimientos m
      WHERE m.reservation_id = r.id AND m.tipo = 'cargo'
    )
    AND NOT EXISTS (                                              -- FIX 2
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
-- 5) rpc_list_pending_invoices: no listar las descartadas (FIX 3).
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
  WHERE i.status NOT IN ('authorized', 'discarded')   -- FIX 3
    AND (
      public.app_is_admin()
      OR i.cash_shift_id = public.app_current_open_shift()
    )
  ORDER BY i.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_pending_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_pending_invoices() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) rpc_fix_reservation_dni_for_invoice: corrige el DNI de una reserva ya
--    cerrada, para poder re-facturar. Staff, gate de turno, no si ya hay CAE.
--    Tras corregir, el retry existente re-snapshotea el DNI (mig 72).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_fix_reservation_dni_for_invoice(
  p_reservation_id UUID,
  p_dni TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r RECORD;
  v_digits TEXT;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.id, r.status, r.checkout_cash_shift_id
  INTO v_r
  FROM public.reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_r.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Solo se corrige el DNI de reservas con check-out realizado.' USING errcode = '22023';
  END IF;

  -- Mismo gate de turno que create_invoice_draft.
  IF NOT public.app_is_admin()
     AND v_r.checkout_cash_shift_id IS DISTINCT FROM public.app_current_open_shift() THEN
    RAISE EXCEPTION 'Solo podes corregir check-outs de tu turno abierto. Pedile al administrador.' USING errcode = 'P0023';
  END IF;

  -- No alterar el receptor de un CAE ya emitido.
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.reservation_id = p_reservation_id AND i.status = 'authorized'
  ) THEN
    RAISE EXCEPTION 'La reserva ya tiene factura emitida: no se puede cambiar el DNI del receptor.' USING errcode = 'P0020';
  END IF;

  v_digits := regexp_replace(COALESCE(p_dni, ''), '\D', '', 'g');
  IF length(v_digits) NOT IN (7, 8) THEN
    RAISE EXCEPTION 'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.' USING errcode = 'P0022';
  END IF;

  UPDATE public.reservations
  SET client_dni = v_digits, updated_at = NOW()
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', TRUE, 'client_dni', v_digits);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_fix_reservation_dni_for_invoice(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_fix_reservation_dni_for_invoice(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) rpc_discard_invoice: descarta una factura pendiente/rechazada (reversible:
--    la reserva vuelve a quedar facturable). No se puede descartar una autorizada.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_discard_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i public.invoices%ROWTYPE;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT * INTO v_i FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_i.status = 'authorized' THEN
    RAISE EXCEPTION 'La factura ya fue emitida (CAE): no se puede descartar.' USING errcode = 'P0020';
  END IF;
  IF v_i.status = 'discarded' THEN
    RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'discarded', 'already', TRUE);
  END IF;
  -- processing "fresco" (intento en vuelo) no se descarta.
  IF v_i.status = 'processing'
     AND v_i.last_attempt_at IS NOT NULL
     AND v_i.last_attempt_at > NOW() - INTERVAL '2 minutes' THEN
    RAISE EXCEPTION 'La factura se esta emitiendo. Reintenta en unos segundos.' USING errcode = 'P0021';
  END IF;

  -- Paridad con la visibilidad de la lista de pendientes.
  IF NOT public.app_is_admin()
     AND v_i.cash_shift_id IS DISTINCT FROM public.app_current_open_shift() THEN
    RAISE EXCEPTION 'Solo podes descartar facturas de tu turno abierto. Pedile al administrador.' USING errcode = 'P0023';
  END IF;

  UPDATE public.invoices
  SET status = 'discarded',
      cbte_nro = NULL,   -- libera el número del backstop invoices_number_uq
      cbte_fch = NULL,
      last_error = NULL,
      updated_at = NOW()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'discarded');
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_discard_invoice(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_discard_invoice(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) FIX 6: el vale blanco no se parte ni se combina. Trigger BEFORE INSERT en
--    payments (centraliza la regla sin tocar los RPC de cobro).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_validate_vale_blanco()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC;
  v_paid NUMERIC;   -- pagado ANTES de este pago (el RPC actualiza paid_amount después del INSERT)
  v_has_vale BOOLEAN;
BEGIN
  SELECT total_price, paid_amount INTO v_total, v_paid
  FROM public.reservations WHERE id = NEW.reservation_id;

  IF v_total IS NULL THEN
    RETURN NEW; -- sin reserva conocida, no validamos acá
  END IF;

  IF NEW.payment_method = 'vale_blanco' THEN
    -- Debe ser el único pago y cubrir el total exacto.
    IF v_paid <> 0 OR NEW.amount <> v_total THEN
      RAISE EXCEPTION 'El vale blanco es consumo interno: tiene que cubrir el total de la reserva de una sola vez, sin combinar con otra forma de pago.'
        USING errcode = '22023';
    END IF;
  ELSE
    -- Ningún otro método puede sumarse si ya hubo un pago con vale blanco.
    SELECT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.reservation_id = NEW.reservation_id AND p.payment_method = 'vale_blanco'
    ) INTO v_has_vale;
    IF v_has_vale THEN
      RAISE EXCEPTION 'Esta reserva se pago con vale blanco (consumo interno): no se puede agregar otra forma de pago.'
        USING errcode = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_vale_blanco ON public.payments;
CREATE TRIGGER trg_validate_vale_blanco
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.app_validate_vale_blanco();

COMMIT;
