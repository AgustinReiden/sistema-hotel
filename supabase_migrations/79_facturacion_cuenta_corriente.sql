-- Migration 79: Facturación de cuenta corriente (modo por cliente, factura
-- consolidada y listado de control).
--
-- PROBLEMA QUE CIERRA: hoy ninguna venta a cuenta corriente se factura nunca.
-- El check-out a cta cte no ofrece factura, y rpc_create_invoice_draft la rechaza
-- con "se factura al saldar la cuenta" (mig 75) — pero ese flujo NO EXISTE:
-- rpc_register_account_payment (mig 64) registra el pago y no emite nada. Todo el
-- volumen de empresas con convenio quedaba sin comprobante fiscal, indefinidamente.
--
-- QUÉ AGREGA
--   1) associated_clients.facturacion_modo / guests.facturacion_modo:
--      'por_checkout' | 'consolidada' | 'no_factura'. Decide si la estadía se
--      factura al cerrar o se junta en una factura periódica que emite el admin.
--   2) invoices.kind ('checkout' | 'consolidada') + reservation_id NULLABLE.
--      Una consolidada no cuelga de una reserva ni de un turno de caja.
--   3) invoice_reservations: qué estadías cubre cada factura (1 fila para las de
--      check-out, N para las consolidadas). Un índice único parcial sobre
--      reservation_id WHERE unlinked_at IS NULL garantiza en la base las dos
--      invariantes: una estadía no entra en dos consolidadas Y no puede tener
--      además factura propia.
--   4) 3 RPC nuevos: listar cargos facturables, crear el draft consolidado y el
--      listado de control facturado/no facturado.
--
-- POR QUÉ reservation_id NULL Y NO OTRO MODELO: Postgres trata los NULL como
-- distintos en índices únicos, así que N consolidadas conviven sin tocar
-- invoices_reservation_uq. No se modifica NINGUNA constraint fiscal existente
-- (invoices_number_uq, invoices_tipo_doc_coherent, invoices_amounts_add_up,
-- invoices_authorized_complete quedan igual). Las consolidadas comparten las
-- secuencias de numeración con las de check-out, que es lo correcto fiscalmente.
--
-- NOTA DE IMPLEMENTACIÓN: el vínculo factura↔estadías se mantiene con un TRIGGER
-- acotado sobre invoices (mismo criterio que la mig 78) en vez de reescribir los
-- RPC grandes. Cubre todo INSERT/UPDATE de status por cualquier RPC presente o
-- futuro. Descartar una factura desvincula (unlinked_at) → las estadías vuelven
-- al pool de facturables.
--
-- DOS BUGS LATENTES QUE SE CORRIGEN DE PASO (sección 6):
--   · rpc_discard_invoice: un recepcionista SIN turno abierto pasaba el gate sobre
--     una consolidada, porque con cash_shift_id NULL y app_current_open_shift()
--     NULL, `NULL IS DISTINCT FROM NULL` es FALSE.
--   · rpc_begin_invoice_emission: una consolidada tipo B (doc_tipo 96) entraba a la
--     rama que re-lee el DNI desde reservations; con reservation_id NULL el SELECT
--     no devuelve nada y reventaba con P0022.
--
-- INVARIANTE QUE NO SE ROMPE: ningún reporte de ventas cambia. La emisión
-- consolidada escribe sólo en invoices, invoice_reservations y (backfill de datos
-- fiscales) associated_clients. NO toca payments, reservations, cash_shifts ni
-- cuenta_corriente_movimientos. invoices.cash_shift_id es NULL POR CONSTRAINT en
-- las consolidadas, así que no se pueden imputar a ningún turno ni por error.
--
-- EFECTO DEL BACKFILL: los clientes con cuenta corriente habilitada quedan en modo
-- 'consolidada' (preserva el comportamiento actual: lo cerrado a cta cte no se
-- factura al cerrar). Sus estadías históricas van a aparecer TODAS como
-- 'pendiente_consolidada' en el listado de control. Eso es el objetivo: hacer
-- visible el trabajo fiscal atrasado.
--
-- CHEQUEO PREVIO (debe dar 0 filas, garantizado por invoices_reservation_uq):
--   SELECT reservation_id, count(*) FROM public.invoices
--   WHERE reservation_id IS NOT NULL AND status <> 'discarded'
--   GROUP BY 1 HAVING count(*) > 1;
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ … $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Verificar después con SELECTs.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Preferencia de facturación por cliente.
--    'por_checkout' → se ofrece factura al cerrar (incluso a cuenta corriente).
--    'consolidada'  → no se factura al cerrar; el admin junta N estadías.
--    'no_factura'   → nunca se factura (consumo interno, convenios sin fiscal).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.associated_clients
  ADD COLUMN IF NOT EXISTS facturacion_modo TEXT NOT NULL DEFAULT 'por_checkout';
ALTER TABLE public.associated_clients
  DROP CONSTRAINT IF EXISTS associated_clients_facturacion_modo_check;
ALTER TABLE public.associated_clients
  ADD CONSTRAINT associated_clients_facturacion_modo_check
  CHECK (facturacion_modo IN ('por_checkout', 'consolidada', 'no_factura'));

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS facturacion_modo TEXT NOT NULL DEFAULT 'por_checkout';
ALTER TABLE public.guests
  DROP CONSTRAINT IF EXISTS guests_facturacion_modo_check;
ALTER TABLE public.guests
  ADD CONSTRAINT guests_facturacion_modo_check
  CHECK (facturacion_modo IN ('por_checkout', 'consolidada', 'no_factura'));

-- Backfill: preservar EXACTAMENTE el comportamiento de hoy. Lo cerrado a cuenta
-- corriente no se factura en el check-out → esos clientes arrancan 'consolidada'.
UPDATE public.associated_clients SET facturacion_modo = 'consolidada'
  WHERE cuenta_corriente_habilitada AND facturacion_modo = 'por_checkout';
UPDATE public.guests SET facturacion_modo = 'consolidada'
  WHERE cuenta_corriente_habilitada AND facturacion_modo = 'por_checkout';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) invoices: tipo de comprobante interno + reservation_id nullable.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'checkout';
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_kind_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_kind_check CHECK (kind IN ('checkout', 'consolidada'));

ALTER TABLE public.invoices ALTER COLUMN reservation_id DROP NOT NULL;

-- La consolidada no cuelga de una reserva NI de un turno: cash_shift_id NULL por
-- constraint la vuelve invisible para el recepcionista (en rpc_list_pending_invoices
-- la comparación NULL = <uuid> da NULL) y para cualquier lógica que agrupe por turno.
-- Las filas existentes son todas kind='checkout' con reservation_id NOT NULL.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_kind_shape;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_kind_shape CHECK (
    (kind = 'checkout' AND reservation_id IS NOT NULL)
    OR (kind = 'consolidada' AND reservation_id IS NULL AND cash_shift_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS invoices_kind_status_idx ON public.invoices(kind, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) invoice_reservations: qué estadías cubre cada factura.
--    Se puebla para los DOS tipos (las de check-out con 1 fila) para que el
--    listado de control y las invariantes se resuelvan con una sola consulta.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_reservations (
  invoice_id       UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  reservation_id   UUID NOT NULL REFERENCES public.reservations(id),
  cc_movimiento_id UUID REFERENCES public.cuenta_corriente_movimientos(id) ON DELETE SET NULL,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  room_number TEXT,                      -- snapshot para el impreso
  fch_desde   DATE NOT NULL,
  fch_hasta   DATE NOT NULL,
  unlinked_at TIMESTAMPTZ,               -- se setea al descartar la factura
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invoice_id, reservation_id)
);

-- LA invariante: una estadía, a lo sumo un vínculo vivo (propio o consolidado).
CREATE UNIQUE INDEX IF NOT EXISTS invoice_reservations_active_uq
  ON public.invoice_reservations(reservation_id) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS invoice_reservations_invoice_idx
  ON public.invoice_reservations(invoice_id);

ALTER TABLE public.invoice_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read invoice_reservations" ON public.invoice_reservations;
CREATE POLICY "Staff read invoice_reservations"
  ON public.invoice_reservations FOR SELECT TO authenticated
  USING (public.app_is_staff());

GRANT SELECT ON public.invoice_reservations TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoice_reservations FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Backfill de las facturas existentes (todas de check-out, 1 estadía c/u).
--    Las descartadas entran ya desvinculadas para no ocupar el índice único.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.invoice_reservations
  (invoice_id, reservation_id, amount, room_number, fch_desde, fch_hasta, unlinked_at)
SELECT i.id, i.reservation_id, i.imp_total, ro.room_number,
       i.fch_serv_desde, i.fch_serv_hasta,
       CASE WHEN i.status = 'discarded' THEN NOW() ELSE NULL END
FROM public.invoices i
JOIN public.reservations r ON r.id = i.reservation_id
LEFT JOIN public.rooms ro ON ro.id = r.room_id
WHERE i.reservation_id IS NOT NULL
ON CONFLICT (invoice_id, reservation_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Trigger de sincronización del vínculo.
--    INSERT de una factura de check-out → crea su fila.
--    Pasar a 'discarded' → desvincula (la estadía vuelve a ser facturable).
--    Salir de 'discarded' → re-vincula.
--    Las consolidadas insertan sus propias filas en el RPC (montos y períodos por
--    estadía), así que el trigger las ignora vía reservation_id IS NULL.
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

DROP TRIGGER IF EXISTS trg_sync_invoice_reservation_link ON public.invoices;
CREATE TRIGGER trg_sync_invoice_reservation_link
  AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.app_sync_invoice_reservation_link();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RPC existentes: se adaptan al modo por cliente y a las consolidadas.
--    Todos con CREATE OR REPLACE y MISMA FIRMA, para que la app deployada no se
--    rompa durante el deploy (un DROP dejaría la app viva sin la función).
--
--    Errcodes nuevos:
--      P0026 estadía ya incluida en otra factura
--      P0027 el modo de la ficha no permite facturar acá
--      P0028 selección vacía / sin cargos facturables
--      P0029 la selección mezcla clientes
-- ─────────────────────────────────────────────────────────────────────────────

-- 6.1) rpc_create_invoice_draft: la exclusión de cuenta corriente pasa a ser
--      CONDICIONAL al modo de la ficha (antes bloqueaba siempre, y el flujo que
--      prometía —"se factura al saldar la cuenta"— no existía).
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

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id, 'status', 'pending', 'reused', FALSE, 'cbte_tipo', v_cbte_tipo
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 6.2) rpc_begin_invoice_emission: gate de admin para consolidadas + re-snapshot
--      del receptor en 3 ramas. BUG QUE CIERRA: una consolidada tipo B (doc_tipo
--      96, reservation_id NULL) entraba a la rama que re-lee el DNI desde
--      reservations; el SELECT no devolvía nada y reventaba con P0022.
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

  IF v_i.kind = 'consolidada' AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador emite facturas consolidadas.' USING errcode = '42501';
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

  IF v_i.kind = 'consolidada' THEN
    -- No cuelga de una reserva: el receptor se fijó en el draft desde la ficha.
    v_digits := regexp_replace(v_i.doc_nro::text, '\D', '', 'g');
    IF v_i.doc_tipo = 80 AND NOT public.app_is_valid_cuit(v_digits) THEN
      RAISE EXCEPTION 'El CUIT del receptor no es valido. Descarta la factura y volve a generarla con el CUIT correcto.' USING errcode = 'P0022';
    ELSIF v_i.doc_tipo = 96 AND length(v_digits) NOT IN (7, 8) THEN
      RAISE EXCEPTION 'El DNI del receptor no es valido. Corregilo en la ficha del huesped y volve a generar la factura.' USING errcode = 'P0022';
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

-- 6.3) rpc_discard_invoice: gate de admin para consolidadas.
--      BUG QUE CIERRA: con cash_shift_id NULL en la consolidada y un recepcionista
--      SIN turno abierto, app_current_open_shift() también es NULL y
--      `NULL IS DISTINCT FROM NULL` es FALSE → el gate de turno se pasaba solo.
--      El desvinculado de invoice_reservations lo hace el trigger.
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

  IF v_i.kind = 'consolidada' AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador descarta facturas consolidadas.' USING errcode = '42501';
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

-- 6.4) rpc_list_pending_invoices: LEFT JOIN (la consolidada no tiene reserva).
--      Visibilidad: con cash_shift_id NULL, `NULL = <uuid>` da NULL → sólo el admin
--      ve las consolidadas, que es lo correcto.
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
         COALESCE(ro.room_number, 'CONSOLIDADA'), i.receptor_nombre,
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

-- 6.5) rpc_list_invoiceable_checkouts: la exclusión ciega de cuenta corriente pasa
--      a filtro por modo, y se suma el guard de consolidada. La ventana de 10 días
--      SE MANTIENE acá: es la lista de trabajo del recepcionista. El listado de
--      control (7.3) no la tiene.
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
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = r.id AND i.status <> 'discarded'
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) RPC nuevos. Los tres son admin-only.
-- ─────────────────────────────────────────────────────────────────────────────

-- 7.1) Cargos de cuenta corriente pendientes de facturar, de UN cliente.
--      Es el selector de la pantalla de factura consolidada.
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
      WHERE i.reservation_id = r.id AND i.status <> 'discarded'
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

-- 7.2) Draft de factura consolidada: N estadías de un cliente → UNA factura.
--      El importe sale del CARGO de cuenta corriente, no de reservations.total_price:
--      si hubo un pago parcial en caja, total_price > cargo y facturar el total
--      duplicaría lo ya cobrado.
--      El emisor (src/lib/arca/emitter.ts) trata esta factura como cualquier otra:
--      WSFEv1 no recibe renglones de detalle, sólo totales.
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
      WHERE i.reservation_id = v_row.res_id AND i.status <> 'discarded'
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

-- 7.3) Listado de control: qué está facturado y qué no, SIN la ventana de 10 días
--      y SIN excluir cuenta corriente. La columna `estado` separa lo que
--      legítimamente no se factura de lo que falta facturar.
CREATE OR REPLACE FUNCTION public.rpc_list_billing_control(
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
  imp_total NUMERIC
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
      WHEN i.status = 'authorized' AND i.kind = 'consolidada' THEN 'facturado_consolidado'
      WHEN i.status = 'authorized' THEN 'facturado'
      WHEN i.id IS NOT NULL THEN 'en_proceso'
      WHEN EXISTS (SELECT 1 FROM public.payments p
                   WHERE p.reservation_id = r.id AND p.payment_method = 'vale_blanco') THEN 'no_corresponde'
      WHEN COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout') = 'no_factura' THEN 'no_corresponde'
      WHEN cc.cargo IS NOT NULL THEN 'pendiente_consolidada'
      ELSE 'falta'
    END,
    i.id, i.kind, i.status, i.cbte_tipo, i.pto_vta, i.cbte_nro, i.imp_total
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
