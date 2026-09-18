-- Migration 112: el control de facturacion tambien rescata la factura huerfana
--
-- QUE PASABA. "Esta estadia ya esta facturada" se contesta mirando DOS lugares: una
-- factura viva en `invoices` (status <> 'discarded' AND anulada_at IS NULL), o un
-- vinculo vivo en `invoice_reservations` (unlinked_at IS NULL). Tres de las cuatro
-- funciones que responden esa pregunta miran los dos:
--
--   rpc_count_billing_pending      (mig 82)      -- los dos NOT EXISTS
--   rpc_list_cc_account_stays      (mig 111:822) -- rama de rescate en el CASE
--   rpc_list_invoiceable_checkouts (mig 80)      -- los dos NOT EXISTS
--
-- rpc_list_billing_control miraba SOLO el vinculo. Una reserva con factura viva pero
-- sin fila viva en invoice_reservations caia en el ELSE 'falta' del listado y, al
-- mismo tiempo, quedaba EXCLUIDA del contador del badge. El listado y el contador se
-- contradecian sobre la misma estadia, y justo en la pantalla que el admin usa como
-- planilla de trabajo: le habria pedido facturar algo que ya tenia factura.
--
-- POR QUE NO EXPLOTO NUNCA. El trigger app_sync_invoice_reservation_link (mig 79,
-- redefinido en 80/82/111) crea la fila de invoice_reservations en el INSERT de toda
-- factura con reservation_id, y la nota de credito desvincula Y marca anulada_at en
-- el mismo gesto. Mientras el trigger funcione, las dos mitades coinciden. Verificado
-- contra PROD el 2026-09-18: 0 filas en esa situacion. Esta migracion no cambia una
-- sola fila de los datos de hoy: cierra el hueco antes de que lo abra la proxima
-- deriva, que en esta area ya paso una vez (ver cabecera de la mig 90).
--
-- COMO SE ARREGLA. Un LATERAL que busca la factura huerfana, y SOLO cuando no hay
-- vinculo vivo. Con eso la fila recupera las dos cosas:
--   - su `estado` real, via dos ramas nuevas en el CASE;
--   - su comprobante (invoice_id, cbte_nro, etc.), via COALESCE.
-- Lo segundo no es adorno: decir "Facturado" sin poder mostrar cual es exactamente la
-- media respuesta que el resto de este trabajo vino a sacar. Ver
-- docs/solapamiento-cuentas-facturacion.md.
--
-- NO se agrega la rama 'facturado_consolidado' al rescate: una consolidada tiene
-- reservation_id NULL (mig 79:105 + invoices_kind_shape de la 80), asi que una factura
-- alcanzable por r.id es siempre kind='checkout'. Verificado en PROD: de las facturas
-- con reservation_id hay un solo kind, y 0 que no sean 'checkout'.
--
-- CREATE OR REPLACE y no DROP+CREATE: el RETURNS TABLE no cambia, solo el cuerpo. La
-- firma se copia VERBATIM de la mig 83, que es la version viva en PROD (md5 del
-- prosrc comparado antes de escribir esto). OJO si se vuelve a tocar esta funcion:
-- la definen las migraciones 79, 82 y 83. Partir de la primera que aparece en un
-- grep borraria la columna `bancario`.
--
-- TRAMPA DEL CONECTOR, para el que aplique la proxima. El conector MCP de Supabase
-- parsea comillas por su cuenta antes de mandar el SQL, y se le indigesta una comilla
-- suelta DENTRO de un comentario -- devuelve 'syntax error at or near ";"', que no
-- tiene nada que ver. Por eso los comentarios de adentro de la funcion no llevan
-- comillas simples ni dobles. Importa que no las lleven: los comentarios de adentro
-- del cuerpo SI viajan a prosrc, y este archivo esta escrito para que el md5 del
-- cuerpo de un lado y del otro sea el mismo. Al aplicar, sacar BEGIN/COMMIT y partir
-- en dos llamadas (funcion, y despues grants + registro).
--
-- HAY DOS 112, A PROPOSITO. Main mergeo su propia 112 (lo_que_se_elige_es_lo_que_se_factura)
-- mientras esta rama estaba abierta. Tocan funciones DISTINTAS -- aquella
-- rpc_create_invoice_draft y rpc_list_invoiceable_checkouts, esta rpc_list_billing_control --
-- y las dos estan aplicadas y sanas en PROD (la otra 14:51, esta 19:13 del 2026-09-18).
-- NO se renumero esta a 113 porque ya estaba aplicada y anotada en applied_migrations como
-- 112: mover el archivo habria dejado el registro diciendo una cosa y el repo otra, que es
-- exactamente la deriva que ese registro existe para evitar. Precedente en esta carpeta: ya
-- hay dos 59_ y dos 106_. Al reconstruir desde cero el orden alfabetico las corre bien
-- (lo_que... antes que rescate...), que es el mismo orden en que se aplicaron.
--
-- APLICADA en PROD el 2026-09-18. md5 del cuerpo, repo y PROD:
-- a44f10f4c3b285798754a8bf8f08e7cb (4262 chars).

BEGIN;

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
      -- Rescate (mig 112): factura viva colgada de la reserva a la que se le perdió
      -- el vínculo. Va ACÁ, antes de vale_blanco y de no_factura: si el comprobante
      -- existe, ya no importa si correspondía emitirlo. Existe.
      WHEN resc.status = 'authorized' THEN 'facturado'
      WHEN resc.id IS NOT NULL THEN 'en_proceso'
      WHEN EXISTS (SELECT 1 FROM public.payments p
                   WHERE p.reservation_id = r.id AND p.payment_method = 'vale_blanco') THEN 'no_corresponde'
      WHEN COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout') = 'no_factura' THEN 'no_corresponde'
      WHEN cc.cargo IS NOT NULL THEN 'pendiente_consolidada'
      ELSE 'falta'
    END,
    -- El comprobante sale del vínculo, y si no hay vínculo, del rescate.
    COALESCE(i.id, resc.id),
    COALESCE(i.kind, resc.kind),
    COALESCE(i.status, resc.status),
    COALESCE(i.cbte_tipo, resc.cbte_tipo),
    COALESCE(i.pto_vta, resc.pto_vta),
    COALESCE(i.cbte_nro, resc.cbte_nro),
    COALESCE(i.imp_total, resc.imp_total),
    ir.external_ref,
    public.app_reservation_has_bank_payment(r.id)
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  LEFT JOIN public.associated_clients ac ON ac.id = r.associated_client_id
  LEFT JOIN public.guests g ON g.id = r.guest_id
  LEFT JOIN public.invoice_reservations ir
         ON ir.reservation_id = r.id AND ir.unlinked_at IS NULL
  LEFT JOIN public.invoices i ON i.id = ir.invoice_id
  -- Sólo busca cuando NO hay factura por el vínculo y NO es una marca de facturado
  -- por fuera (esa no tiene comprobante nuestro que mostrar). Con el trigger sano
  -- no devuelve nada nunca: es una red, no un camino.
  LEFT JOIN LATERAL (
    SELECT i2.id, i2.kind, i2.status, i2.cbte_tipo, i2.pto_vta, i2.cbte_nro, i2.imp_total
    FROM public.invoices i2
    WHERE i.id IS NULL
      AND ir.external_ref IS NULL
      AND i2.reservation_id = r.id
      AND i2.status <> 'discarded'
      AND i2.anulada_at IS NULL
    -- Si hubiera más de una (no debería: invoices_reservation_uq es un único parcial
    -- sobre exactamente este predicado), gana la autorizada y después la más nueva.
    ORDER BY (i2.status = 'authorized') DESC, i2.created_at DESC
    LIMIT 1
  ) resc ON TRUE
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

-- ===========================================================================
-- Registro
-- ===========================================================================

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('112_rescate_billing_control.sql');
  END IF;
END
$do$;

COMMIT;
