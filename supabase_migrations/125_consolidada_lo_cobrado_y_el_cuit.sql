-- ─────────────────────────────────────────────────────────────────────────────
-- 125: la consolidada espera solo lo fiado, y el CUIT de la empresa queda en su ficha.
--
-- POR QUE (1). rpc_list_invoiceable_checkouts dejaba afuera toda ficha que no
-- fuera por_checkout, como si consolidada quisiera decir nunca se factura en el
-- check-out. Pero en una ficha consolidada solo lo FIADO espera a la consolidada.
-- Una estadia de esa ficha cobrada en efectivo, tarjeta o transferencia se factura
-- en el check-out como cualquier otra: el check-out ofrece la factura y
-- rpc_create_invoice_draft la acepta. Si en el check-out cerraban el cartel de
-- factura, la estadia no aparecia en los check-outs sin facturar de Facturacion ni
-- en el aviso del cierre de caja, y tampoco entraba en la consolidada, que solo
-- junta cargos de cuenta corriente. La veia solo el admin, como falta, en Control
-- de facturacion. Desde el PR 141 las fichas nuevas con cuenta corriente nacen
-- consolidadas, asi que pasa cada vez mas seguido.
--
-- LA REGLA. La ficha no es no_factura, y es por_checkout o la estadia no tiene
-- cargo a cuenta corriente. Es la misma con la que rpc_create_invoice_draft (mig
-- 112) acepta o rechaza la factura del check-out, y la misma con la que el
-- check-out la ofrece. En las fichas consolidadas coincide con Control de
-- facturacion: con cargo es pendiente_consolidada, sin cargo es falta. El Control
-- se aparta en un solo caso, que esta migracion NO toca: ficha por_checkout con
-- cargo. El Control la llama pendiente_consolidada, y el check-out,
-- rpc_create_invoice_draft y este listado la siguen tratando como factura del
-- check-out, igual que antes.
--
-- POR QUE (2). rpc_create_consolidated_invoice_draft completaba en la ficha de la
-- empresa la condicion frente al IVA y el domicilio, pero no el CUIT. A una empresa
-- guardada con DNI, o con un CUIT mal cargado, habia que reescribirle el CUIT en
-- cada consolidada, aunque la pantalla dice que lo completado queda guardado en la
-- ficha (en los huespedes si se guardaba). Decision de Agustin del 26/09: si la
-- ficha no tiene un CUIT valido, se guarda el que se uso para emitir. Un CUIT
-- valido no se pisa nunca. Se guarda en digitos, como lo dejo la mig 94 y como
-- esta misma funcion guarda guests.cuit. Todos los que lo leen lo comparan sin
-- guiones.
--
-- BASE. Las dos funciones parten de su definicion vigente en PROD
-- (pg_get_functiondef del 26/09, verificada por md5), identica a la de la 112
-- (listado) y la 103 (consolidada). Fuera de las lineas marcadas con mig 125 el
-- cuerpo es el mismo. Misma firma y mismos permisos: CREATE OR REPLACE conserva el
-- ACL, y el REVOKE y GRANT de abajo repiten los de la 112 y la 103.
--
-- VUELTA ATRAS. Recrear las dos funciones como estan en la 112 y la 103. El CUIT
-- que se haya guardado en alguna ficha queda (es el de una factura emitida).
--
-- Aplicar via select public.exec_ddl($mig125$ ... $mig125$) SIN BEGIN y SIN COMMIT.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Check-outs sin facturar: la ficha consolidada solo aparta lo fiado ----------
CREATE OR REPLACE FUNCTION public.rpc_list_invoiceable_checkouts()
 RETURNS TABLE(reservation_id uuid, room_number text, client_name text, client_dni text, total_price numeric, actual_check_out timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Mig 125: en una ficha consolidada solo lo fiado espera a la consolidada. Lo
    -- cobrado en caja se factura en el check-out, como en rpc_create_invoice_draft.
    AND COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout') <> 'no_factura'
    AND (
      COALESCE(ac.facturacion_modo, g.facturacion_modo, 'por_checkout') = 'por_checkout'
      OR NOT EXISTS (
        SELECT 1 FROM public.cuenta_corriente_movimientos m
        WHERE m.reservation_id = r.id AND m.tipo = 'cargo'
      )
    )
    AND (public.app_is_admin() OR r.invoice_decision IS DISTINCT FROM 'no')
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = r.id AND i.status <> 'discarded' AND i.anulada_at IS NULL
    )
    -- Anulada con nota de crédito: re-facturarla es cosa del administrador (P0041).
    AND (public.app_is_admin() OR NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.reservation_id = r.id AND i.anulada_at IS NOT NULL
    ))
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
$function$;

REVOKE ALL ON FUNCTION public.rpc_list_invoiceable_checkouts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_invoiceable_checkouts() TO authenticated;

-- 2) Consolidada de una empresa: el CUIT usado queda en la ficha si no tenia uno valido
CREATE OR REPLACE FUNCTION public.rpc_create_consolidated_invoice_draft(p_kind text, p_client_id uuid, p_reservation_ids uuid[], p_cuit text DEFAULT NULL::text, p_condicion_iva text DEFAULT NULL::text, p_razon_social text DEFAULT NULL::text, p_domicilio text DEFAULT NULL::text, p_detalle jsonb DEFAULT NULL::jsonb, p_nota text DEFAULT NULL::text, p_concepto_unico text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_nota TEXT;
  v_concepto_unico TEXT;
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

  -- Detalle: se valida ANTES de tocar nada. Todo lo que pase por aca va a salir
  -- impreso en un comprobante fiscal.
  IF p_detalle IS NOT NULL THEN
    IF jsonb_typeof(p_detalle) <> 'array' THEN
      RAISE EXCEPTION 'El detalle del comprobante es invalido.' USING errcode = '22023';
    END IF;

    PERFORM 1
    FROM jsonb_to_recordset(p_detalle) AS d(reservation_id UUID, descripcion TEXT)
    WHERE d.reservation_id IS NULL OR NOT (d.reservation_id = ANY (v_ids));
    IF FOUND THEN
      RAISE EXCEPTION 'El detalle incluye una estadia que no esta en la seleccion.' USING errcode = '22023';
    END IF;

    PERFORM 1
    FROM jsonb_to_recordset(p_detalle) AS d(reservation_id UUID, descripcion TEXT)
    GROUP BY d.reservation_id
    HAVING count(*) > 1;
    IF FOUND THEN
      RAISE EXCEPTION 'El detalle repite una estadia.' USING errcode = '22023';
    END IF;
  END IF;

  v_nota := public.app_sanitize_detalle(p_nota, 200);
  -- Mismo sanitizado y mismo limite que una linea del detalle: sale impreso en el
  -- mismo ancho de ticket. NULL (o todo espacios) queda NULL = detallado, el default.
  v_concepto_unico := public.app_sanitize_detalle(p_concepto_unico, 80);

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  -- Lock deterministico por id: evita deadlock entre dos admins consolidando a la vez.
  PERFORM 1 FROM public.reservations r
  WHERE r.id = ANY (v_ids)
  ORDER BY r.id
  FOR UPDATE;

  -- Agrupado por reserva: si alguna tuviera mas de un cargo, se suman en una sola
  -- fila (si no, el conteo daria un P0029 falso y el INSERT de abajo violaria la PK).
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

    -- Mig 125: el CUIT con el que se emite queda en la ficha si la ficha no tenia
    -- uno valido (un DNI, o un CUIT mal cargado). Un CUIT valido no se pisa nunca.
    UPDATE public.associated_clients
    SET condicion_iva = COALESCE(condicion_iva, v_cond_txt),
        domicilio = COALESCE(domicilio, v_domicilio),
        document_id = CASE
          WHEN public.app_is_valid_cuit(regexp_replace(COALESCE(document_id, ''), '\D', '', 'g')) THEN document_id
          ELSE v_cuit
        END,
        updated_at = NOW()
    WHERE id = p_client_id;
  ELSE
    SELECT * INTO v_g FROM public.guests WHERE id = p_client_id;
    IF v_g.id IS NULL THEN
      RAISE EXCEPTION 'Huesped no encontrado.' USING errcode = 'P0002';
    END IF;

    -- Con datos de facturacion en la ficha (mig 81) se factura como corresponda;
    -- sin ellos, B con DNI, que es el default de siempre.
    v_cond_txt := lower(BTRIM(COALESCE(NULLIF(BTRIM(p_condicion_iva), ''), v_g.condicion_iva, '')));

    IF v_cond_txt IN ('responsable_inscripto', 'monotributo', 'exento') THEN
      v_cuit := regexp_replace(COALESCE(NULLIF(BTRIM(p_cuit), ''), v_g.cuit, ''), '\D', '', 'g');
      IF NOT public.app_is_valid_cuit(v_cuit) THEN
        RAISE EXCEPTION 'El CUIT del huesped no es valido. Cargalo en la seccion de facturacion de su ficha.' USING errcode = 'P0022';
      END IF;

      v_receptor := COALESCE(NULLIF(BTRIM(p_razon_social), ''), v_g.razon_social, v_g.full_name);
      v_domicilio := COALESCE(NULLIF(BTRIM(p_domicilio), ''), v_g.domicilio_fiscal, NULLIF(BTRIM(v_g.address), ''));
      v_doc_tipo := 80;
      v_doc_nro := v_cuit;

      IF v_cond_txt = 'responsable_inscripto' THEN
        v_cbte_tipo := 1; v_cond_id := 1;
      ELSIF v_cond_txt = 'monotributo' THEN
        v_cbte_tipo := 1; v_cond_id := 6;
      ELSE
        v_cbte_tipo := 6; v_cond_id := 4;
      END IF;

      UPDATE public.guests
      SET condicion_iva = COALESCE(condicion_iva, v_cond_txt),
          cuit = COALESCE(cuit, v_cuit),
          domicilio_fiscal = COALESCE(domicilio_fiscal, v_domicilio),
          updated_at = NOW()
      WHERE id = p_client_id;
    ELSE
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
  END IF;

  -- Redondeo SOBRE EL TOTAL. Sumar netos por estadia romperia invoices_amounts_add_up.
  v_total := round(v_total, 2);
  v_neto := round(v_total / (1 + v_s.iva_pct / 100), 2);
  v_iva := v_total - v_neto;

  INSERT INTO public.invoices (
    kind, reservation_id, status, environment, pto_vta, cbte_tipo, concepto,
    doc_tipo, doc_nro, condicion_iva_receptor_id, receptor_nombre, receptor_domicilio,
    imp_total, imp_neto, imp_iva, iva_id,
    fch_serv_desde, fch_serv_hasta,
    cash_shift_id, created_by, detalle_nota, detalle_concepto_unico
  )
  VALUES (
    'consolidada', NULL, 'pending', v_s.environment, v_s.punto_venta, v_cbte_tipo, v_s.concepto,
    v_doc_tipo, v_doc_nro::bigint, v_cond_id, v_receptor, v_domicilio,
    v_total, v_neto, v_iva, 5,
    v_desde, v_hasta,
    NULL, auth.uid(), v_nota, v_concepto_unico
  )
  RETURNING id INTO v_invoice_id;

  -- Filas ya lockeadas arriba, y agrupadas igual que el loop (una por estadia).
  -- La descripcion se congela aca: la que escribio el admin, o la automatica.
  --
  -- BUG CORREGIDO (venia desde la mig 79 y se arrastro por la 80 y la 81): aca
  -- decia `MIN(m.id)` sobre una columna UUID, y en Postgres no existe min(uuid).
  -- O sea que este INSERT reventaba con "function min(uuid) does not exist" en
  -- CUALQUIER llamada: la factura consolidada nunca pudo emitirse desde que se
  -- escribio. No se noto porque la facturacion electronica esta deshabilitada y
  -- nunca se llego a ejecutar el camino completo.
  -- array_agg ordenado da el mismo "elegi uno, siempre el mismo" que se buscaba.
  INSERT INTO public.invoice_reservations
    (invoice_id, reservation_id, cc_movimiento_id, amount, room_number, fch_desde, fch_hasta, descripcion)
  SELECT v_invoice_id, r.id, (array_agg(m.id ORDER BY m.id))[1], SUM(m.amount), ro.room_number,
         (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date,
         (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date,
         COALESCE(
           public.app_sanitize_detalle(det.descripcion, 80),
           public.app_default_stay_description(
             ro.room_number,
             (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date,
             (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date
           )
         )
  FROM public.cuenta_corriente_movimientos m
  JOIN public.reservations r ON r.id = m.reservation_id
  LEFT JOIN public.rooms ro ON ro.id = r.room_id
  LEFT JOIN LATERAL (
    SELECT d.descripcion
    FROM jsonb_to_recordset(COALESCE(p_detalle, '[]'::jsonb)) AS d(reservation_id UUID, descripcion TEXT)
    WHERE d.reservation_id = r.id
    LIMIT 1
  ) det ON TRUE
  WHERE m.tipo = 'cargo'
    AND m.reservation_id = ANY (v_ids)
    AND (
      (p_kind = 'company' AND m.associated_client_id = p_client_id)
      OR (p_kind = 'guest' AND m.guest_id = p_client_id)
    )
  GROUP BY r.id, ro.room_number, r.actual_check_in, r.check_in_target,
           r.actual_check_out, r.check_out_target, det.descripcion;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'status', 'pending',
    'kind', 'consolidada',
    'imp_total', v_total,
    'count', v_count,
    'cbte_tipo', v_cbte_tipo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_create_consolidated_invoice_draft(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_consolidated_invoice_draft(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- Registro
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('125_consolidada_lo_cobrado_y_el_cuit.sql');
  END IF;
END
$do$;

COMMIT;
