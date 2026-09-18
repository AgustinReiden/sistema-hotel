-- Migration 112: lo que se elige en la pantalla es lo que se factura
--
-- EL BUG (PROD, 18/09/2026). En Facturacion se apreto "Emitir factura" sobre la
-- estadia de un pasajero, se eligio CONSUMIDOR FINAL, y ARCA devolvio CAE para una
-- FACTURA A (comprobante 0008-00000005) a nombre de la EMPRESA que figuraba en la
-- ficha de ese huesped. Ni el tipo ni el receptor son los que se eligieron. Hubo que
-- anularla con nota de credito.
--
-- POR QUE PASO. El front, cuando se elige Consumidor Final, no manda NINGUN dato de
-- receptor (era el "default"). Y esta funcion resolvia la condicion frente al IVA asi:
--
--     v_cond_txt := COALESCE(p_condicion_iva, v_ac.condicion_iva, v_g.condicion_iva, '')
--
-- es decir, ante la ausencia del parametro se la copiaba de la FICHA del cliente. Esa
-- ficha tenia condicion_iva='responsable_inscripto' y la razon social de la empresa
-- porque una factura ANTERIOR se las habia guardado ahi (el bloque "queda guardado"
-- de la mig 75/81). Resultado: elegir "Consumidor Final" emitia una Factura A a la
-- empresa del huesped, en silencio, contra ARCA, en produccion.
--
-- LA REGLA QUE FALTABA. La ficha PRECARGA la pantalla; NO decide el comprobante. El
-- unico que decide es el que esta facturando, y decide eligiendo. Por eso:
--
--   * 'consumidor_final' pasa a ser un valor explicito y reconocido: fuerza Factura B
--     con el DNI de la reserva y no mira la ficha ni aunque tenga CUIT cargado.
--   * La ausencia de parametro (NULL) ya NO cae en la ficha: cae en consumidor final.
--     El default seguro es el que no puede emitir un comprobante a un tercero. Una A
--     ahora requiere que alguien la haya pedido: no sale nunca sola.
--
-- EL NOMBRE DE LA FACTURA B SE PUEDE ESCRIBIR. Hasta hoy el receptor de la B era
-- siempre `reservations.client_name`, tal cual estaba cargado. Ahora `p_razon_social`
-- tambien vale para la B: la pantalla lo precarga con el nombre de la reserva y el
-- recepcionista lo corrige antes de emitir (el pasajero se anota apurado y la factura
-- la quiere con el nombre completo). Se sanea igual que el detalle de la consolidada
-- -- sin caracteres de control, sin espacios dobles, 120 caracteres -- porque termina
-- impreso en la comandera.
--
-- ANULAR NO ES RE-FACTURAR. La mig 80 dejo que una factura anulada por nota de
-- credito libere la estadia para volver a facturarla. Eso esta bien, pero no puede
-- quedar en las mismas manos que la anularon: el recepcionista PUEDE anular (arregla
-- su error en el momento) y NO puede volver a emitir. El segundo intento lo hace el
-- administrador, que es el que va a tener que explicarle el par factura+NC al
-- contador. P0041, con mensaje propio.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig112$ ... $mig112$) SIN
-- ; final y SIN BEGIN/COMMIT. No depende de la 108/109/111 (que al 18/09/2026 no
-- figuran en applied_migrations): toca solo funciones que existen desde la 80/81.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) rpc_create_invoice_draft: la eleccion manda sobre la ficha.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_invoice_draft(
  p_reservation_id UUID,
  p_tipo           TEXT DEFAULT 'B',   -- vestigial: la condición IVA manda
  p_cuit           TEXT DEFAULT NULL,
  p_condicion_iva  TEXT DEFAULT NULL,  -- 'consumidor_final' | 'responsable_inscripto' | 'monotributo' | 'exento'
  p_razon_social   TEXT DEFAULT NULL,  -- también vale para la B: es el nombre impreso
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
  v_g public.guests%ROWTYPE;
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
  v_nombre_pedido TEXT;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.id, r.status, r.total_price, r.client_name, r.client_dni,
         r.associated_client_id, r.guest_id, r.checkout_cash_shift_id,
         r.check_in_target, r.actual_check_in, r.actual_check_out,
         r.invoice_decision
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

  -- Fichas del cliente facturable. La empresa manda sobre el huésped, igual
  -- criterio que rpc_staff_checkout_reservation al elegir a quién cargar.
  -- OJO: de acá sale el MODO de facturación y los datos que se completan cuando el
  -- que factura pidió CUIT sin escribirlos. NUNCA el tipo de comprobante.
  IF v_r.associated_client_id IS NOT NULL THEN
    SELECT * INTO v_ac FROM public.associated_clients WHERE id = v_r.associated_client_id;
  ELSIF v_r.guest_id IS NOT NULL THEN
    SELECT * INTO v_g FROM public.guests WHERE id = v_r.guest_id;
  END IF;
  v_modo := COALESCE(v_ac.facturacion_modo, v_g.facturacion_modo, 'por_checkout');

  IF v_modo = 'no_factura' THEN
    RAISE EXCEPTION 'La ficha del cliente esta marcada como "no se factura".' USING errcode = 'P0027';
  END IF;

  -- PUNTO 1: si en el check-out se eligió NO, el playero no puede cambiarlo.
  -- Esto NO afecta los reintentos: el retry va por rpc_begin_invoice_emission.
  IF v_r.invoice_decision = 'no' AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'En el check-out se eligio no facturar. Solo el administrador puede emitirla ahora.' USING errcode = 'P0030';
  END IF;

  -- Cuenta corriente: sólo se bloquea si el cliente se factura consolidado.
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

  -- `anulada_at IS NULL`: una factura anulada por nota de credito ya no cuenta,
  -- justamente para poder volver a facturar la estadia (mig 80).
  SELECT * INTO v_existing FROM public.invoices
  WHERE reservation_id = p_reservation_id AND status <> 'discarded' AND anulada_at IS NULL;
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

  -- Anular y volver a emitir son dos manos distintas. Va DESPUÉS del bloque de
  -- reuso para no romper la reimpresión de la factura viva que pueda haber quedado.
  IF NOT public.app_is_admin() AND EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.reservation_id = p_reservation_id AND i.anulada_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Esta estadia ya tuvo una factura anulada con nota de credito. Solo el administrador puede volver a facturarla.' USING errcode = 'P0041';
  END IF;

  -- Va DESPUÉS del bloque de reuso: si la estadía tiene factura propia, arriba se
  -- devolvió para reimprimir. Acá sólo cae la que está en una consolidada ajena.
  IF EXISTS (
    SELECT 1 FROM public.invoice_reservations ir
    WHERE ir.reservation_id = p_reservation_id AND ir.unlinked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esta estadia ya esta incluida en una factura consolidada.' USING errcode = 'P0026';
  END IF;

  v_neto := round(v_r.total_price / (1 + v_s.iva_pct / 100), 2);
  v_iva := v_r.total_price - v_neto;

  -- EL COMPROBANTE LO DECIDE LA ELECCIÓN, NO LA FICHA. Sin parámetro es consumidor
  -- final: una Factura A nunca sale sola. (Ver la cabecera: acá vivía el bug.)
  v_cond_txt := lower(BTRIM(COALESCE(NULLIF(BTRIM(p_condicion_iva), ''), 'consumidor_final')));

  -- Nombre pedido para el comprobante, saneado: sale impreso en la comandera.
  v_nombre_pedido := NULLIF(
    BTRIM(regexp_replace(regexp_replace(COALESCE(p_razon_social, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g')),
    ''
  );
  v_nombre_pedido := LEFT(v_nombre_pedido, 120);

  IF v_cond_txt IN ('responsable_inscripto', 'monotributo', 'exento') THEN
    -- Receptor con CUIT (razón social y domicilio independientes del huésped).
    -- Ojo: para el huésped se usa guests.cuit, NO document_id (que es el DNI).
    v_cuit := regexp_replace(COALESCE(
      NULLIF(BTRIM(p_cuit), ''), v_ac.document_id, v_g.cuit, ''
    ), '\D', '', 'g');
    IF NOT public.app_is_valid_cuit(v_cuit) THEN
      RAISE EXCEPTION 'El CUIT del receptor no es valido (11 digitos con digito verificador). Corregilo y reintenta.' USING errcode = 'P0022';
    END IF;
    v_receptor := COALESCE(
      v_nombre_pedido, v_ac.display_name, v_g.razon_social,
      v_g.full_name, v_r.client_name
    );
    v_domicilio := COALESCE(
      NULLIF(BTRIM(p_domicilio), ''), v_ac.domicilio, v_g.domicilio_fiscal
    );
    v_doc_tipo := 80;
    v_doc_nro := v_cuit;

    IF v_cond_txt = 'responsable_inscripto' THEN
      v_cbte_tipo := 1; v_cond_id := 1;   -- Factura A
    ELSIF v_cond_txt = 'monotributo' THEN
      v_cbte_tipo := 1; v_cond_id := 6;   -- Factura A (leyenda Ley 27.618 en el impreso)
    ELSE
      v_cbte_tipo := 6; v_cond_id := 4;   -- Factura B a IVA Sujeto Exento
    END IF;

    -- "Queda guardado": completar la ficha que corresponda si estaba vacía. Sigue
    -- siendo sólo PRECARGA para la próxima vez; desde esta migración ya no puede
    -- decidir un comprobante por su cuenta.
    IF v_r.associated_client_id IS NOT NULL THEN
      UPDATE public.associated_clients
      SET condicion_iva = COALESCE(condicion_iva, v_cond_txt),
          domicilio = COALESCE(domicilio, v_domicilio),
          updated_at = NOW()
      WHERE id = v_r.associated_client_id;
    ELSIF v_r.guest_id IS NOT NULL THEN
      UPDATE public.guests
      SET condicion_iva = COALESCE(condicion_iva, v_cond_txt),
          cuit = COALESCE(cuit, v_cuit),
          razon_social = COALESCE(razon_social, v_nombre_pedido),
          domicilio_fiscal = COALESCE(domicilio_fiscal, v_domicilio),
          updated_at = NOW()
      WHERE id = v_r.guest_id;
    END IF;
  ELSE
    -- Factura B a consumidor final con DNI. El nombre es editable: lo que se ve en
    -- la pantalla de confirmación es lo que se imprime.
    v_digits := regexp_replace(COALESCE(v_r.client_dni, ''), '\D', '', 'g');
    IF length(v_digits) NOT IN (7, 8) THEN
      RAISE EXCEPTION 'El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.' USING errcode = 'P0022';
    END IF;
    v_cbte_tipo := 6;
    v_doc_tipo := 96;
    v_doc_nro := v_digits;
    v_cond_id := 5;
    v_receptor := COALESCE(v_nombre_pedido, v_r.client_name);
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

  -- Queda registrado que se decidió facturar (punto 1). Es el único camino a 'si'.
  UPDATE public.reservations
  SET invoice_decision = 'si',
      invoice_decision_at = COALESCE(invoice_decision_at, NOW()),
      invoice_decision_by = COALESCE(invoice_decision_by, auth.uid()),
      updated_at = NOW()
  WHERE id = p_reservation_id AND invoice_decision IS DISTINCT FROM 'si';

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id, 'status', 'pending', 'reused', FALSE, 'cbte_tipo', v_cbte_tipo
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_invoice_draft(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) rpc_list_invoiceable_checkouts: al recepcionista no se le ofrece lo que ya no
--    puede hacer. Este listado es también el que cuenta el aviso del cierre de caja
--    ("te quedan N sin facturar"): si contara las anuladas, lo mandaría a pelearse
--    con un P0041.
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
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.rpc_list_invoiceable_checkouts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_invoiceable_checkouts() TO authenticated;

-- ===========================================================================
-- Registro
-- ===========================================================================

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('112_lo_que_se_elige_es_lo_que_se_factura.sql');
  END IF;
END
$do$;

COMMIT;
