-- Migration 81: Datos de facturación en la ficha del huésped (punto 3 del gerente).
--
-- "Los datos de la factura deberían venir ya de los que cargaste en la ficha del
-- cliente. Por lo que la ficha del cliente debería tener una sección donde se le
-- carguen los datos de facturación."
--
-- Hoy eso funciona SOLO para empresas (`associated_clients` tiene condicion_iva y
-- domicilio desde la mig 74/75, y el check-out los precarga). Para una persona no
-- hay nada: un monotributista que se aloja seguido tiene que dictar CUIT, razón
-- social, condición IVA y domicilio a mano, en cada check-out.
--
-- POR QUÉ UN `cuit` SEPARADO DE `document_id`: `guests.document_id` es el DNI, y es
-- lo que usa la Factura B (doc_tipo 96). El CUIT es otro número (20-DNI-DV) y va en
-- la Factura A (doc_tipo 80). Meterlos en la misma columna haría que una Factura A
-- saliera con el DNI en el campo del CUIT. Son campos distintos porque son datos
-- distintos.
--
-- POR QUÉ `domicilio_fiscal` Y NO `domicilio`: `guests.address` ya existe y es el
-- domicilio particular del registro de huéspedes. El fiscal puede ser otro (el del
-- comercio del monotributista) y es el que exige RG 1415 en el impreso.
--
-- EFECTO EN LA CONSOLIDADA: hasta la mig 79 un huésped con cuenta corriente se
-- facturaba siempre B con DNI, porque no había de dónde sacar la condición IVA.
-- Ahora, si la ficha dice RI/Monotributo/Exento, sale A (o B a exento) como
-- corresponde. Sin condición cargada, sigue saliendo B con DNI: mismo default.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ … $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Requiere las migraciones 79 y 80 aplicadas.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) guests: sección de datos de facturación.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS condicion_iva TEXT;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS cuit TEXT;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS domicilio_fiscal TEXT;

-- Mismo set que associated_clients (mig 75).
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_condicion_iva_check;
ALTER TABLE public.guests
  ADD CONSTRAINT guests_condicion_iva_check
  CHECK (condicion_iva IS NULL OR condicion_iva IN
    ('responsable_inscripto', 'monotributo', 'consumidor_final', 'exento'));

-- Sólo dígitos y 11 posiciones. El dígito verificador lo valida app_is_valid_cuit
-- al facturar (acá un CHECK con módulo 11 obligaría a limpiar datos viejos a mano).
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_cuit_format_check;
ALTER TABLE public.guests
  ADD CONSTRAINT guests_cuit_format_check
  CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) rpc_create_invoice_draft: la ficha del huésped como fuente de los datos de
--    facturación cuando la reserva NO es de una empresa.
--    Prioridad: lo que se tipeó en el modal → ficha de la empresa → ficha del
--    huésped. Y lo que se completa a mano queda guardado en la ficha que
--    corresponda (mismo criterio "queda guardado" de la mig 75).
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- La condición IVA del receptor decide el comprobante. Fuente: parámetro →
  -- ficha de empresa → ficha de huésped.
  v_cond_txt := lower(BTRIM(COALESCE(
    NULLIF(BTRIM(p_condicion_iva), ''), v_ac.condicion_iva, v_g.condicion_iva, ''
  )));

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
      NULLIF(BTRIM(p_razon_social), ''), v_ac.display_name, v_g.razon_social,
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

    -- "Queda guardado": completar la ficha que corresponda si estaba vacía.
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
          razon_social = COALESCE(razon_social, NULLIF(BTRIM(p_razon_social), '')),
          domicilio_fiscal = COALESCE(domicilio_fiscal, v_domicilio),
          updated_at = NOW()
      WHERE id = v_r.guest_id;
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

-- NOTA: el prefill del modal del check-out NO necesita un RPC nuevo. La capa de
-- datos ya lee `associated_clients` y `guests` por reserva en
-- `resolveBillingContextByReservation` (src/lib/data.ts) para el flag de cuenta
-- corriente y el modo de facturación; ahí mismo se resuelven estos campos, sin
-- sumar otro round-trip. Ambas tablas son legibles por staff vía RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_create_consolidated_invoice_draft: la rama del huésped ahora deriva el
--    comprobante de su condición IVA, igual que la de empresa. Hasta la mig 80
--    un huésped con cuenta corriente salía SIEMPRE B con DNI porque no había de
--    dónde sacar la condición. Sin condición cargada, sigue saliendo B con DNI.
-- ─────────────────────────────────────────────────────────────────────────────
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

    -- Con datos de facturación en la ficha (mig 81) se factura como corresponda;
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

COMMIT;
