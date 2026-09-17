-- Migration 103: la consolidada puede salir impresa como UN SOLO CONCEPTO.
--
-- QUE PIDE EL CLIENTE: hay empresas que no quieren que en la factura figure quien
-- durmio donde. Hoy el comprobante consolidado imprime una linea por estadia
-- ("Hab. 5 - 01/08/2026 al 03/08/2026"), o sea habitacion y fechas de cada una.
-- Piden una sola linea, "Alojamiento", por el total, y el periodo al pie (que ya
-- estaba y se queda: es el dato que la RG 1415 pide del servicio).
--
-- ES UNA OPCION, NO UN REEMPLAZO. El modo detallado sigue siendo el default y no
-- cambia en nada. La eleccion se hace a mano en cada factura, y a proposito NO se
-- guarda en la ficha del cliente: una preferencia vieja prendida sin que nadie la
-- mire manda una factura colapsada sin querer, y una factura emitida no se corrige,
-- se anula con nota de credito.
--
-- POR QUE ESTO NECESITA SQL Y NO ES UN MODO DE IMPRESION. La mig 93 congelo el
-- texto del detalle al emitir, justamente para que reimprimir una factura dentro de
-- tres anios de el mismo papel. Si "un solo concepto" viviera nada mas en la pantalla
-- o en un parametro de la URL del impreso, el MISMO comprobante podria imprimirse
-- detallado hoy y colapsado manana. La eleccion es parte del comprobante, asi que se
-- guarda con el comprobante.
--
-- UNA SOLA COLUMNA LLEVA LA BANDERA Y EL TEXTO:
--   detalle_concepto_unico IS NULL      -> detallado (lo de siempre, y lo que tienen
--                                         todas las facturas ya emitidas)
--   detalle_concepto_unico = 'Alojamiento' -> una sola linea con ese texto
-- NO hay un booleano aparte a proposito: dos columnas se pueden contradecir
-- (bandera prendida y texto vacio, o al revés) y despues nadie sabe cual manda en un
-- papel que ya se entrego. Con una, el estado imposible no existe.
--
-- LO QUE NO CAMBIA: las filas de invoice_reservations se siguen escribiendo igual,
-- una por estadia y con su descripcion congelada. Son las que vinculan las estadias
-- a la factura y las que impiden facturar dos veces la misma (la unique parcial
-- invoice_reservations_active_uq). Aca solo colapsa lo que se IMPRIME; el vinculo, el
-- importe, el neto, el IVA y el periodo salen exactamente igual que antes. Si algun
-- dia hay que auditar esa factura, las estadias siguen estando.
--
-- Cero cambios en src/lib/arca/: WSFEv1 recibe totales, no renglones. Esto es
-- representacion impresa (RG 1415).
--
-- El cuerpo de la funcion es el de la mig 93 con el parametro nuevo y nada mas
-- (verificado contra PROD: el cuerpo vivo y el de la mig 93 son el mismo).
--
-- RENUMERADA DE 102 A 103. Nacio como 102 en su rama, pero mientras tanto se
-- aplico a PROD otra 102 (102_cancelar_reserva_solo_admin.sql). Dos archivos con el
-- mismo numero se pisan en la cabeza de cualquiera que mire el registro, y el numero
-- duplicado fue justamente lo que hizo que esta migracion se mergeara a main sin
-- aplicarse: la consolidada quedo rota en PROD (el front mandaba 10 parametros a una
-- funcion de 9). El numero sale de applied_migrations, no del orden de las ramas.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig103$ ... $mig103$) SIN
-- ; final y SIN BEGIN/COMMIT. Requiere la 93 y la 98 aplicadas.
-- OJO: el DROP+CREATE de rpc_create_consolidated_invoice_draft va en UNA SOLA
-- seccion, como avisa la mig 93: dos overloads conviviendo dejarian a PostgREST
-- eligiendo cual llamar.

BEGIN;
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Esquema: el texto del concepto unico.
--    80 caracteres, el mismo limite que invoice_reservations.descripcion, y por la
--    misma razon: la comandera son 72 mm de ancho util y mas que eso envuelve y
--    deja el ticket ilegible.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS detalle_concepto_unico TEXT;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_detalle_concepto_unico_len;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_detalle_concepto_unico_len
  CHECK (detalle_concepto_unico IS NULL OR char_length(detalle_concepto_unico) <= 80);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Draft de la consolidada, ahora con la eleccion del impreso. Cambia la firma
--    (un parametro mas), asi que va DROP + CREATE en UNA SOLA seccion de exec_ddl.
--
--    p_concepto_unico = NULL -> detallado. Con texto -> una sola linea con ese
--    texto. Se sanitiza con app_sanitize_detalle igual que el resto del detalle:
--    todo lo que pasa por aca va a salir impreso en un comprobante fiscal.
--
--    p_detalle sigue aceptandose y sigue congelando la descripcion de cada estadia,
--    incluso en modo concepto unico. No es contradiccion: la pantalla no lo manda en
--    ese modo y las filas quedan con el texto automatico, pero si alguien lo manda no
--    hay nada que romper, porque esas filas no se imprimen.
-- ─────────────────────────────────────────────────────────────────────────────
-- El DROP saca la firma de 9 argumentos que dejo la mig 93; el CREATE OR REPLACE
-- deja la migracion re-ejecutable sobre una base que ya la tenga.
DROP FUNCTION IF EXISTS public.rpc_create_consolidated_invoice_draft(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_create_consolidated_invoice_draft(
  p_kind            TEXT,
  p_client_id       UUID,
  p_reservation_ids UUID[],
  p_cuit            TEXT DEFAULT NULL,
  p_condicion_iva   TEXT DEFAULT NULL,
  p_razon_social    TEXT DEFAULT NULL,
  p_domicilio       TEXT DEFAULT NULL,
  p_detalle         JSONB DEFAULT NULL,
  p_nota            TEXT DEFAULT NULL,
  p_concepto_unico  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    UPDATE public.associated_clients
    SET condicion_iva = COALESCE(condicion_iva, v_cond_txt),
        domicilio = COALESCE(domicilio, v_domicilio),
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
$$;

REVOKE ALL ON FUNCTION public.rpc_create_consolidated_invoice_draft(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_consolidated_invoice_draft(TEXT, UUID, UUID[], TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('103_consolidada_concepto_unico.sql');
  END IF;
END $$;

COMMIT;
