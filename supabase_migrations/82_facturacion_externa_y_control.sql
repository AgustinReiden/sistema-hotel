-- Migration 82: Marcar una estadía como facturada FUERA del sistema + contadores
-- de control.
--
-- CASO REAL: el contador emite el comprobante desde el portal de ARCA o desde otro
-- sistema. Esa estadía está facturada, pero HotelSync no lo sabe y la muestra para
-- siempre como "FALTA FACTURAR". El admin necesita poder marcarla, con constancia
-- de qué comprobante la cubre y quién lo afirmó.
--
-- DÓNDE VIVE LA MARCA — decisión de diseño. La marca NO es una fila de `invoices`:
-- esa tabla significa "comprobantes que emitió ESTA app contra ARCA", y meterle
-- filas sin CAE rompería `invoices_authorized_complete` y ensuciaría el libro
-- fiscal. Tampoco es una columna de `reservations`, porque entonces la regla
-- "una estadía tiene a lo sumo UNA cobertura viva" quedaría partida en dos lugares
-- y habría que repetir el predicado en los 5 RPC que preguntan si algo ya está
-- facturado.
--
-- Va en `invoice_reservations` con `invoice_id` NULL. Así:
--   · El MISMO índice único parcial `(reservation_id) WHERE unlinked_at IS NULL`
--     impide marcar como externa una estadía ya facturada por la app, Y facturar
--     una que ya se marcó como externa. Una sola regla, en la base.
--   · Los 5 RPC que ya consultan `invoice_reservations` la respetan sin cambios.
--   · Desmarcar setea `unlinked_at` (no borra): queda el rastro de quién marcó,
--     cuándo y con qué comprobante.
--
-- El CHECK `invoice_reservations_source_check` obliga a que cada fila sea una cosa
-- o la otra: o cuelga de una factura nuestra, o tiene referencia externa.
--
-- CONTADORES: el listado de control sólo sirve si alguien lo mira. Se agrega
-- `rpc_count_billing_pending` para el badge del admin; el aviso al playero en el
-- cierre de turno se resuelve contando `rpc_list_invoiceable_checkouts` (que ya
-- aplica el gate de turno), sin RPC nuevo.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ … $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Requiere 79, 80 y 81 aplicadas.
-- OJO: el DROP+CREATE de rpc_list_billing_control va en UNA SOLA sección.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) invoice_reservations admite filas sin factura propia (marca externa).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoice_reservations
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.invoice_reservations DROP CONSTRAINT IF EXISTS invoice_reservations_pkey;
ALTER TABLE public.invoice_reservations ADD PRIMARY KEY (id);

ALTER TABLE public.invoice_reservations ALTER COLUMN invoice_id DROP NOT NULL;

-- El par (factura, estadía) sigue siendo único, pero sólo donde hay factura.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_reservations_invoice_res_uq
  ON public.invoice_reservations(invoice_id, reservation_id)
  WHERE invoice_id IS NOT NULL;

ALTER TABLE public.invoice_reservations
  ADD COLUMN IF NOT EXISTS external_ref TEXT,
  ADD COLUMN IF NOT EXISTS external_fecha DATE,
  ADD COLUMN IF NOT EXISTS external_notes TEXT,
  ADD COLUMN IF NOT EXISTS marked_by UUID REFERENCES auth.users(id);

-- Una fila es de la app o es externa, nunca las dos ni ninguna.
ALTER TABLE public.invoice_reservations DROP CONSTRAINT IF EXISTS invoice_reservations_source_check;
ALTER TABLE public.invoice_reservations
  ADD CONSTRAINT invoice_reservations_source_check CHECK (
    (invoice_id IS NOT NULL AND external_ref IS NULL)
    OR (invoice_id IS NULL AND external_ref IS NOT NULL)
  );

-- El importe es informativo en la marca externa (puede ser una cortesía de $0).
ALTER TABLE public.invoice_reservations ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE public.invoice_reservations DROP CONSTRAINT IF EXISTS invoice_reservations_amount_check;
ALTER TABLE public.invoice_reservations
  ADD CONSTRAINT invoice_reservations_amount_check CHECK (amount IS NULL OR amount >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Trigger: el ON CONFLICT ahora apunta al índice PARCIAL, así que necesita su
--    predicado. El resto de la lógica (mig 79 + 80) queda igual.
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
      ON CONFLICT (invoice_id, reservation_id) WHERE invoice_id IS NOT NULL
      DO UPDATE SET unlinked_at = NULL, amount = EXCLUDED.amount;
    END IF;
    RETURN NEW;
  END IF;

  -- Nota de crédito con CAE: marca el comprobante anulado y libera sus estadías,
  -- que vuelven a quedar facturables (mig 80).
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
-- 3) Marcar / desmarcar una estadía como facturada por fuera. Sólo admin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mark_invoiced_externally(
  p_reservation_id UUID,
  p_ref            TEXT,
  p_fecha          DATE DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_r RECORD;
  v_tz TEXT;
  v_ref TEXT;
  v_amount NUMERIC;
  v_id UUID;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede marcar una estadia como facturada por fuera.' USING errcode = '42501';
  END IF;

  v_ref := NULLIF(BTRIM(COALESCE(p_ref, '')), '');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Indica el comprobante con el que se facturo (por ejemplo "FC A 0008-00000123").' USING errcode = '22023';
  END IF;

  SELECT r.id, r.status, r.total_price, r.room_id,
         r.actual_check_in, r.check_in_target, r.actual_check_out, r.check_out_target
  INTO v_r
  FROM public.reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_r.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Solo aplica a estadias con check-out realizado.' USING errcode = '22023';
  END IF;

  -- Mismo criterio que en todos lados: si ya hay una cobertura viva, no se marca.
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.reservation_id = p_reservation_id AND i.status <> 'discarded' AND i.anulada_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.invoice_reservations ir
    WHERE ir.reservation_id = p_reservation_id AND ir.unlinked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esta estadia ya tiene un comprobante asociado en el sistema.' USING errcode = 'P0026';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  -- Si cerró a cuenta corriente el importe real es el cargo; si no, el total.
  SELECT COALESCE(SUM(m.amount), v_r.total_price) INTO v_amount
  FROM public.cuenta_corriente_movimientos m
  WHERE m.reservation_id = p_reservation_id AND m.tipo = 'cargo';

  INSERT INTO public.invoice_reservations (
    invoice_id, reservation_id, amount, room_number, fch_desde, fch_hasta,
    external_ref, external_fecha, external_notes, marked_by
  )
  VALUES (
    NULL, p_reservation_id, GREATEST(COALESCE(v_amount, 0), 0),
    (SELECT ro.room_number FROM public.rooms ro WHERE ro.id = v_r.room_id),
    (COALESCE(v_r.actual_check_in, v_r.check_in_target) AT TIME ZONE v_tz)::date,
    (COALESCE(v_r.actual_check_out, v_r.check_out_target) AT TIME ZONE v_tz)::date,
    v_ref, p_fecha, NULLIF(BTRIM(COALESCE(p_notes, '')), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'mark_id', v_id, 'reservation_id', p_reservation_id, 'external_ref', v_ref
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_mark_invoiced_externally(UUID, TEXT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_mark_invoiced_externally(UUID, TEXT, DATE, TEXT) TO authenticated;

-- Desmarcar: NO borra la fila, la desvincula. Queda el rastro de la marca previa.
CREATE OR REPLACE FUNCTION public.rpc_unmark_invoiced_externally(p_reservation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede deshacer esta marca.' USING errcode = '42501';
  END IF;

  UPDATE public.invoice_reservations
  SET unlinked_at = NOW()
  WHERE reservation_id = p_reservation_id
    AND unlinked_at IS NULL
    AND external_ref IS NOT NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Esta estadia no esta marcada como facturada por fuera.' USING errcode = 'P0002';
  END IF;

  RETURN jsonb_build_object('mark_id', v_id, 'reservation_id', p_reservation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_unmark_invoiced_externally(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_unmark_invoiced_externally(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Contador para el badge del admin: cuánto falta facturar de verdad.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_count_billing_pending(p_days INT DEFAULT 60)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_falta INT;
  v_consolidar INT;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT
    count(*) FILTER (WHERE cc.cargo IS NULL),
    count(*) FILTER (WHERE cc.cargo IS NOT NULL)
  INTO v_falta, v_consolidar
  FROM public.reservations r
  LEFT JOIN public.associated_clients ac ON ac.id = r.associated_client_id
  LEFT JOIN public.guests g ON g.id = r.guest_id
  LEFT JOIN LATERAL (
    SELECT SUM(m.amount) AS cargo
    FROM public.cuenta_corriente_movimientos m
    WHERE m.reservation_id = r.id AND m.tipo = 'cargo'
  ) cc ON TRUE
  WHERE r.status = 'checked_out'
    AND r.actual_check_out > NOW() - (COALESCE(p_days, 60) || ' days')::INTERVAL
    AND COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout') <> 'no_factura'
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
    );

  RETURN jsonb_build_object(
    'falta', COALESCE(v_falta, 0),
    'pendiente_consolidada', COALESCE(v_consolidar, 0),
    'dias', COALESCE(p_days, 60)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_count_billing_pending(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_count_billing_pending(INT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) rpc_list_billing_control: nuevo estado `facturado_externo` + la referencia
--    del comprobante externo. Cambia el TYPE de retorno, así que va DROP+CREATE
--    (en PROD, ambos en LA MISMA seccion de exec_ddl; dentro de una transaccion
--    las demas sesiones siguen viendo la version vieja hasta el COMMIT).
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
  external_ref TEXT
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
    ir.external_ref
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
