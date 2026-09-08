-- Migration 90: capturar la deriva de facturacion de cuenta corriente
--
-- Al armar el registro de migraciones aparecio que PROD tenia tres funciones que NO
-- estan en ningun commit del repo (`git log --all -S` no las encuentra):
--
--   * rpc_list_cc_account_stays      <- reemplazo de rpc_list_cc_charges_to_invoice
--   * app_default_stay_description   <- helper de descripcion de estadia
--   * app_sanitize_detalle           <- helper de saneado de texto para el comprobante
--
-- Alguien las creo directo contra la base y nunca las escribio como migracion. La
-- consecuencia era un BUG EN PRODUCCION: `listCcChargesToInvoice` (src/lib/data.ts)
-- llamaba a rpc_list_cc_charges_to_invoice, que ya no existe, asi que
-- /admin/fiscal/consolidada fallaba con "No se pudieron cargar las estadias a
-- facturar". Pasaba desapercibido porque la facturacion ARCA esta frenada por el
-- tramite WSASS.
--
-- Esta migracion NO cambia la base: transcribe lo que ya esta vivo, para que el repo
-- deje de mentir y la proxima reconstruccion no pierda estas funciones. Es idempotente
-- (CREATE OR REPLACE) y segura de correr en cualquier entorno.
--
-- En PROD (2026-09-08) corrio como no-op: las definiciones se copiaron textuales de
-- pg_get_functiondef, el GRANT a authenticated ya estaba, y rpc_list_cc_charges_to_invoice
-- ya no existia. Sirve para cualquier otro entorno que venga de la 79/80.
--
-- Diferencia contra la version vieja (migracion 80): en vez de filtrar internamente
-- las estadias ya facturadas, devuelve TODAS con columnas de estado (`facturable`,
-- `estado`, `invoice_*`, `external_ref`). El filtro pasa a ser responsabilidad del
-- llamador; `listCcChargesToInvoice` filtra por `facturable` para conservar el
-- contrato original.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Helpers de texto del comprobante
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_default_stay_description(
  p_room text,
  p_desde date,
  p_hasta date
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN NULLIF(BTRIM(COALESCE(p_room, '')), '') IS NULL
      THEN 'Estadia ' || to_char(p_desde, 'DD/MM/YYYY') || ' al ' || to_char(p_hasta, 'DD/MM/YYYY')
    ELSE 'Hab. ' || BTRIM(p_room) || ' - ' || to_char(p_desde, 'DD/MM/YYYY')
         || ' al ' || to_char(p_hasta, 'DD/MM/YYYY')
  END;
$function$;

CREATE OR REPLACE FUNCTION public.app_sanitize_detalle(p_txt text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(
    BTRIM(LEFT(
      BTRIM(regexp_replace(
        regexp_replace(COALESCE(p_txt, ''), '[[:cntrl:]]+', ' ', 'g'),
        '\s+', ' ', 'g')),
      GREATEST(COALESCE(p_max, 80), 1))),
    '');
$function$;

-- ---------------------------------------------------------------------------
-- 2) Estadias de cuenta corriente de un cliente, con su estado de facturacion
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_list_cc_account_stays(
  p_kind text,
  p_client_id uuid,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date
)
RETURNS TABLE(
  reservation_id uuid,
  movimiento_id uuid,
  room_number text,
  passenger text,
  fch_desde date,
  fch_hasta date,
  amount numeric,
  total_price numeric,
  actual_check_out timestamp with time zone,
  mixed_payment boolean,
  facturable boolean,
  estado text,
  invoice_id uuid,
  invoice_kind text,
  invoice_status text,
  cbte_tipo integer,
  pto_vta integer,
  cbte_nro bigint,
  cbte_fch date,
  external_ref text
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
          OR EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id = r.id)),
         (ir.id IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.invoices i2
            WHERE i2.reservation_id = r.id AND i2.status <> 'discarded' AND i2.anulada_at IS NULL
          )),
         CASE
           WHEN ir.external_ref IS NOT NULL THEN 'facturado_externo'
           WHEN i.status = 'authorized' AND i.kind = 'consolidada' THEN 'facturado_consolidado'
           WHEN i.status = 'authorized' THEN 'facturado'
           WHEN i.id IS NOT NULL THEN 'en_proceso'
           WHEN EXISTS (
             SELECT 1 FROM public.invoices i2
             WHERE i2.reservation_id = r.id AND i2.status <> 'discarded' AND i2.anulada_at IS NULL
           ) THEN 'en_proceso'
           ELSE 'pendiente'
         END,
         i.id, i.kind, i.status, i.cbte_tipo, i.pto_vta, i.cbte_nro, i.cbte_fch,
         ir.external_ref
  FROM public.cuenta_corriente_movimientos m
  JOIN public.reservations r ON r.id = m.reservation_id
  LEFT JOIN public.rooms ro ON ro.id = r.room_id
  LEFT JOIN public.invoice_reservations ir
         ON ir.reservation_id = r.id AND ir.unlinked_at IS NULL
  LEFT JOIN public.invoices i ON i.id = ir.invoice_id
  WHERE m.tipo = 'cargo'
    AND r.status = 'checked_out'
    AND (
      (p_kind = 'company' AND m.associated_client_id = p_client_id)
      OR (p_kind = 'guest' AND m.guest_id = p_client_id)
    )
    AND (p_from IS NULL OR (r.actual_check_out AT TIME ZONE v_tz)::date >= p_from)
    AND (p_to IS NULL OR (r.actual_check_out AT TIME ZONE v_tz)::date <= p_to)
  ORDER BY r.actual_check_out DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_list_cc_account_stays(TEXT, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_cc_account_stays(TEXT, UUID, DATE, DATE) TO authenticated;

-- La vieja quedo huerfana: nadie la llama y su reemplazo ya esta vivo. Se elimina
-- para que no queden dos verdades sobre lo mismo (en PROD ya no existe; el DROP IF
-- EXISTS es para entornos que hayan corrido la 79/80 y no la deriva).
DROP FUNCTION IF EXISTS public.rpc_list_cc_charges_to_invoice(TEXT, UUID, DATE, DATE);


-- Anotar en el registro de migraciones (nace en la 91; si todavia no existe,
-- la 91 la backfillea, asi que este bloque no falla en una base desde cero).
DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('90_captura_drift_facturacion_cta_cte.sql');
  END IF;
END $$;

COMMIT;
