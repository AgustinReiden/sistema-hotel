-- Migration 94: el CUIT deja de ser clave unica de cliente, y las empresas ganan
-- razon social.
--
-- EL CASO REAL: JUFEC opera como dos areas separadas (Drogueria y Perfumeria) que
-- fiscalmente son la MISMA empresa, con un solo CUIT. El hotel las necesita como dos
-- clientes distintos, cada una con su cuenta corriente. Pero `document_id` tenia un
-- indice UNICO, asi que la segunda no entraba: alguien la cargo con el CUIT de la
-- primera cambiandole el ultimo digito (30629421463 -> 30629421462). Ese numero no
-- pasa el modulo 11, o sea que esa cuenta ($1.870.000 en 34 estadias) no se podia
-- facturar.
--
-- EL SUPUESTO EQUIVOCADO: el CUIT identifica a un CONTRIBUYENTE, no a un cliente. Un
-- contribuyente puede ser dos cuentas del hotel y recibir dos facturas; eso es normal
-- y legal. Forzar unicidad sobre el CUIT empuja a inventar numeros, que es exactamente
-- lo que paso. El indice pasa a ser NO unico (se conserva para buscar por CUIT) y el
-- aviso de duplicado se mueve al alta, como confirmacion visible: "ya existe X con
-- este CUIT, es otra area de la misma empresa?".
--
-- RAZON SOCIAL: `associated_clients` no la tenia. El receptor de la factura salia de
-- `display_name`, que es el nombre operativo con el que recepcion llama al cliente
-- ("JUFEC - DROGUERIA"), no el nombre legal. RG 1415 pide la razon social del
-- receptor. Ahora es un campo propio, opcional, que cae a `display_name` cuando esta
-- vacio: para los clientes donde el nombre operativo y el legal son el mismo no
-- cambia nada. Misma separacion que ya tienen los huespedes desde la mig 81.
--
-- NO hace falta tocar los RPC grandes de facturacion: la razon social viaja como
-- `p_razon_social` desde la pantalla, que la precarga de la ficha. Aca solo se ajusta
-- `rpc_lookup_receptor_by_cuit`, que es el que completa el receptor al tipear un CUIT.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig94$ ... $mig94$) SIN ;
-- final y SIN BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) El CUIT deja de ser unico. El indice queda para buscar por CUIT (lo usa
--    rpc_lookup_receptor_by_cuit y el aviso de duplicado del alta).
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.associated_clients_document_id_idx;

CREATE INDEX IF NOT EXISTS associated_clients_document_id_idx
  ON public.associated_clients (document_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Razon social del receptor, separada del nombre operativo.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.associated_clients
  ADD COLUMN IF NOT EXISTS razon_social TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Correccion del CUIT inventado de JUFEC - DROGUERIA.
--    Acotada por id y por el valor viejo: si ya se corrigio, no hace nada. El CUIT
--    correcto es el de JUFEC SA - PERFUMERIA, que si pasa el modulo 11.
--    Los otros dos CUIT invalidos (COMISARIA TACO POZO, COMPANIA LA LEGUA) NO se
--    tocan: no se puede deducir cual es el numero bueno y adivinar un CUIT en un
--    comprobante fiscal no es una opcion. Se corrigen a mano en la ficha.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.associated_clients
SET document_id = '30629421463',
    updated_at = NOW()
WHERE id = '0de1bcbc-7b98-4ac6-b382-3f806d70e762'
  AND regexp_replace(document_id, '\D', '', 'g') = '30629421462';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) El lookup por CUIT devuelve la razon social cuando esta cargada.
--    Ya venia con ORDER BY ... LIMIT 1, asi que tolerar CUIT repetidos no es un
--    cambio de comportamiento: elige la empresa activa mas reciente, y como todas
--    las que comparten CUIT comparten identidad fiscal, cualquiera sirve.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_lookup_receptor_by_cuit(p_cuit text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NOT public.app_is_valid_cuit(v_cuit) THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  SELECT * INTO v_ac FROM public.associated_clients
  WHERE regexp_replace(COALESCE(document_id, ''), '\D', '', 'g') = v_cuit
  ORDER BY is_active DESC, updated_at DESC
  LIMIT 1;

  IF v_ac.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'found', TRUE, 'fuente', 'empresa',
      'razon_social', COALESCE(NULLIF(BTRIM(v_ac.razon_social), ''), v_ac.display_name),
      'condicion_iva', v_ac.condicion_iva,
      'domicilio', v_ac.domicilio
    );
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.rpc_lookup_receptor_by_cuit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_lookup_receptor_by_cuit(TEXT) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('94_cuit_compartido_y_razon_social.sql');
  END IF;
END $$;

COMMIT;
