-- Migration 108: las facturas de un cliente, que hasta hoy no se podian pedir
--
-- POR QUE: la ficha de cuenta corriente muestra los movimientos del cliente, pero no
-- hay forma de preguntar "que comprobantes le emitimos a este cliente". Y no la hay
-- porque `invoices` NO tiene columna de cliente: el receptor quedo guardado como
-- snapshot del impreso (`doc_nro`, `receptor_nombre`), que es texto y numero de
-- documento del momento, no una FK. Buscar por `doc_nro` seria la trampa facil y
-- estaria mal: un CUIT es de un contribuyente, no de un cliente, y dos areas de la
-- misma empresa son dos cuentas distintas con el mismo CUIT (mig 94).
--
-- El vinculo real existe, pero indirecto y por DOS caminos, segun como nacio la
-- factura (los dos pasan por `invoice_reservations`, que la 79 puebla para ambos
-- tipos: la consolidada con N filas, la de check-out con 1 fila que le arma el
-- trigger):
--
--   consolidada   ->  invoice_reservations.cc_movimiento_id
--                     -> cuenta_corriente_movimientos.associated_client_id / guest_id
--   de check-out  ->  invoice_reservations.reservation_id
--                     -> reservations.associated_client_id / guest_id
--
-- LO QUE HAY QUE NO REPETIR: una consolidada cubre N estadias, o sea N filas en
-- `invoice_reservations`. Recorrer los vinculos y devolverlos tal cual pintaria la
-- misma factura N veces en la ficha, y peor, sumaria N veces su importe si alguien
-- despues totaliza la columna. Por eso el GROUP BY es por factura y no por vinculo:
-- la unidad de esta lista es el COMPROBANTE. El conteo de estadias que cubre viaja
-- como dato de la fila (`estadias`), que es justo lo que distingue una consolidada
-- de una de check-out a simple vista.
--
-- Los vinculos con `unlinked_at` no nulo quedan afuera: la 79/80 los desvincula al
-- descartar o anular, y son precisamente los que ya no cuentan como cobertura de esa
-- estadia.
--
-- Las notas de credito NO salen como fila propia, y es a proposito: por el CHECK
-- `invoices_kind_shape` una NC tiene `reservation_id` NULL y nunca recibe filas en
-- `invoice_reservations`, asi que no tiene por donde atarse a un cliente. La NC se ve
-- donde importa: en la factura que anulo, via `anulada_at`.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Comprobantes emitidos a un cliente de cuenta corriente.
--    Firma con los dos ids (uno y solo uno), igual que rpc_register_account_payment:
--    la empresa y el huesped son dos columnas distintas, no un "kind" + id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_client_invoices(
  p_associated_client_id uuid,
  p_guest_id uuid,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date
)
RETURNS TABLE(
  invoice_id uuid,
  kind text,
  status text,
  cbte_tipo integer,
  pto_vta integer,
  cbte_nro bigint,
  cbte_fch date,
  imp_total numeric,
  anulada_at timestamp with time zone,
  receptor_nombre text,
  estadias integer,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz TEXT;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  -- Uno y solo uno. Con los dos, la lista mezclaria comprobantes de dos cuentas
  -- distintas en una sola ficha; con ninguno, devolveria las facturas de todos.
  IF (p_associated_client_id IS NULL) = (p_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Indica la empresa o el huesped, no ambos.' USING errcode = '22023';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  RETURN QUERY
  SELECT i.id,
         i.kind,
         i.status,
         i.cbte_tipo,
         i.pto_vta,
         i.cbte_nro,
         i.cbte_fch,
         i.imp_total,
         i.anulada_at,
         i.receptor_nombre,
         COUNT(*)::int,
         i.created_at
  FROM public.invoices i
  JOIN public.invoice_reservations ir
       ON ir.invoice_id = i.id AND ir.unlinked_at IS NULL
  -- Los dos caminos, como LEFT JOIN: cada vinculo resuelve por uno solo (la
  -- consolidada trae cc_movimiento_id, la de check-out no), y el WHERE se queda
  -- con el vinculo que da en el cliente por cualquiera de los dos.
  LEFT JOIN public.cuenta_corriente_movimientos m ON m.id = ir.cc_movimiento_id
  LEFT JOIN public.reservations r ON r.id = ir.reservation_id
  WHERE i.status <> 'discarded'
    AND (
      (p_associated_client_id IS NOT NULL
        AND (m.associated_client_id = p_associated_client_id
             OR r.associated_client_id = p_associated_client_id))
      OR (p_guest_id IS NOT NULL
        AND (m.guest_id = p_guest_id OR r.guest_id = p_guest_id))
    )
    -- Se filtra por la fecha del comprobante; las que todavia no tienen CAE no
    -- tienen cbte_fch, asi que caen en la fecha en que se crearon.
    AND (p_from IS NULL
         OR COALESCE(i.cbte_fch, (i.created_at AT TIME ZONE v_tz)::date) >= p_from)
    AND (p_to IS NULL
         OR COALESCE(i.cbte_fch, (i.created_at AT TIME ZONE v_tz)::date) <= p_to)
  -- Por factura, NO por vinculo: ver el comentario de cabecera. `i.id` es PK, asi
  -- que el resto de las columnas de `invoices` viajan por dependencia funcional.
  GROUP BY i.id
  ORDER BY COALESCE(i.cbte_fch, (i.created_at AT TIME ZONE v_tz)::date) DESC,
           i.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_list_client_invoices(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_client_invoices(UUID, UUID, DATE, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Registro de la migracion.
-- ─────────────────────────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('108_facturas_por_cliente.sql');
  END IF;
END
$do$;

COMMIT;
