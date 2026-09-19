-- Migration 114: la plata se puede apuntar a una estadia que todavia no tiene factura
--
-- COMO ESTABA. La mig 109 hizo que un pago de cuenta corriente diga QUE cancela, y
-- para eso eligio una unidad: la FACTURA. cc_pago_imputaciones.invoice_id es NOT NULL
-- y toda la maquinaria cuelga de ahi. Eso alcanza para el cliente que paga contra un
-- comprobante, pero no para el que paga antes: al 2026-09-18 hay 65 estadias cerradas
-- a cuenta corriente sin facturar, sobre 10.220.000 de saldo. A ninguna de esas
-- deudas se le puede apuntar un peso. La plata entra como pago a cuenta y despues
-- alguien tiene que acordarse, de memoria, de que esa transferencia era por esas dos
-- noches de julio.
--
-- QUE CAMBIA. Un pago se puede imputar tambien a una ESTADIA sin facturar. Y cuando
-- esa estadia se factura -- suelta o dentro de una consolidada -- la imputacion se
-- MUDA SOLA a la factura nueva. Decision de Agustin, y es la unica coherente: si el
-- sistema ya sabe que esa estadia quedo cubierta por ese comprobante, pedirle a una
-- persona que mueva la plata a mano es pedirle que repita una cuenta que la maquina
-- ya hizo. Lo que la maquina NO hace sola es inventar plata: lo que no entra, queda a
-- cuenta y lo aplica un admin.
--
-- EL DESTINO ES EL CARGO, NO LA RESERVA. cargo_movimiento_id apunta al cargo de
-- cuenta corriente de esa estadia -- la misma fila que nace en el check-out. Es la
-- estadia dicha de la forma que sirve: el cargo ES la deuda, trae el importe (el
-- techo de lo que se le puede imputar sale solo, sin ir a buscarlo a otra tabla) y
-- trae el cliente (la guarda de pertenencia queda en una comparacion, contra las dos
-- ramas que necesita la factura). Y contra una reserva que se pago en caja, que no
-- tiene cargo, no se puede ni intentar: lo impide la clave foranea.
--
-- UNO Y SOLO UNO DE LOS DOS DESTINOS. invoice_id afloja el NOT NULL y un CHECK fija
-- que cada fila apunte a una factura O a un cargo, nunca a los dos ni a ninguno. La
-- PK ya es subrogada desde la mig 111, asi que no hay que rehacerla: alcanza con
-- partir el unico parcial en dos, uno por destino, los dos sobre la fila VIVA.
--
-- LA GUARDA P0038 SIGUE CERRANDO LA CARRERA, ahora por duplicado.
-- app_validar_imputacion (factura) queda igual. Al lado va
-- app_validar_imputacion_estadia, que hace lo mismo con el cargo: lockea la fila,
-- valida, y RECIEN DESPUES suma lo ya imputado, en sentencias separadas. Fusionarlas
-- volveria a leer del mismo snapshot y dos cobros simultaneos sobre-imputarian los dos.
--
-- EL CANDADO DEL CARGO ES TAMBIEN EL QUE ORDENA LA MUDANZA. Imputar a una estadia
-- lockea su cargo; mudar la plata al facturarla lockea los mismos cargos antes de
-- tocar nada. Por eso no existe el intervalo en que un admin imputa a una estadia que
-- otro esta facturando en ese mismo instante: uno de los dos espera.
--
-- LA TRAMPA QUE PUEDE ROMPER UNA EMISION, y que es la razon por la que la mudanza
-- AGRUPA. Si un mismo pago tiene plata en dos estadias y las dos entran en la misma
-- consolidada, mudarlas tal cual crearia dos filas con el mismo par (pago, factura) y
-- reventaria contra cc_pago_imputaciones_activa_uq. Eso pasaria DESPUES de que ARCA
-- dio el CAE: el comprobante ya existe afuera y el UPDATE se cae adentro. Por eso la
-- mudanza suma por pago y escribe UNA fila viva por pago y factura. Y por eso, en
-- todo el bloque, no hay una sola condicion que pueda tirar una excepcion: si lo
-- mudado no entrara en el total de la factura, el sobrante se suelta como saldo a
-- cuenta en vez de abortar. Una emision nunca se cae por esto.
--
-- LA MUDANZA VA AL AUTORIZAR, NO AL CREAR EL BORRADOR. Un borrador se descarta y no
-- tiene CAE; imputarle plata romperia la regla de que solo se imputa a facturas
-- autorizadas (P0036). Cuando la factura pasa a authorized, las filas de
-- invoice_reservations ya existen por los dos caminos: las de check-out las crea este
-- mismo trigger en el INSERT, las de la consolidada las escribe su RPC. Un solo
-- gancho cubre los dos casos. Si alguna vez naciera una factura ya autorizada de una
-- sola vez, la mudanza no correria y la plata quedaria en la estadia; hoy no existe
-- ese camino -- todo pasa por borrador y despues emision.
--
-- SE MARCA, NO SE BORRA, y se distingue de una desimputacion. La fila que se muda
-- queda revertida -- que es lo que hace que TODAS las sumas de plata que ya filtran
-- por vivas queden bien solas, en SQL y en cc-pagos.ts, sin ir a corregir cada una --
-- pero ademas apunta con mudada_a_imputacion_id a la fila nueva. Sin ese puntero la
-- pantalla diria que alguien desimputo esa plata, y no es cierto: la plata no se
-- solto, cambio de comprobante.
--
-- LA NOTA DE CREDITO NO CAMBIA. Decision de Agustin: sigue haciendo lo de la mig 111,
-- soltar la plata como saldo a cuenta del pago. Como la nota de credito ademas
-- desvincula la estadia, esa estadia vuelve a quedar facturable y el admin puede
-- volver a apuntarle la plata en un clic con la pantalla nueva. La alternativa --
-- devolverla sola a las estadias de donde vino -- se descarto por ser una segunda
-- mecanica automatica para un caso raro.
--
-- LA ESTADIA FACTURADA AFUERA (mig 82) queda afuera a proposito: no es facturable, no
-- hay comprobante nuestro contra el cual imputar y no hay a donde mudar la plata. Su
-- deuda se sigue pagando a cuenta, como hoy.
--
-- Errcodes nuevos:
--   P0042 la estadia ya esta facturada (no se le puede imputar: va a la factura)
--   P0043 techo por estadia: no entra mas plata en ese cargo
-- P0037 se reusa para la pertenencia -- misma regla, mensaje propio -- y P0039 pasa a
-- hablar de factura o estadia.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig114$ ... $mig114$) SIN
-- ; final y SIN BEGIN/COMMIT. Cada funcion va en UNA SOLA llamada, para no dejar a la
-- app sin funcion en el medio. La seccion 7 es DROP+CREATE porque cambia el tipo de
-- retorno (42P13) y por eso reemite el GRANT; las demas son CREATE OR REPLACE con la
-- misma firma, asi que conservan el ACL. Si despues PostgREST dice "Could not find
-- the function ... in the schema cache": NOTIFY pgrst, 'reload schema'.
--
-- Y VERIFICAR EJECUTANDO, no contando funciones: plpgsql no valida el cuerpo al
-- crearla (la leccion de la mig 93). El probe no se puede hacer dentro de exec_ddl,
-- que corre como postgres: ahi auth.uid() es NULL, app_is_admin() da false y todo
-- rebota con 42501. Hay que registrar un pago contra una estadia desde la app con
-- sesion de admin.

BEGIN;

-- ===========================================================================
-- Seccion 1: la fila de imputacion admite un segundo tipo de destino
-- ===========================================================================

ALTER TABLE public.cc_pago_imputaciones
  ALTER COLUMN invoice_id DROP NOT NULL;

-- Sin ON DELETE, igual que invoice_id (NO ACTION): un cargo con plata aplicada no se
-- puede borrar, y asi lo impide la base. Ademas nada en el sistema borra cargos.
ALTER TABLE public.cc_pago_imputaciones
  ADD COLUMN IF NOT EXISTS cargo_movimiento_id uuid
    REFERENCES public.cuenta_corriente_movimientos(id);

ALTER TABLE public.cc_pago_imputaciones
  ADD COLUMN IF NOT EXISTS mudada_a_imputacion_id uuid
    REFERENCES public.cc_pago_imputaciones(id);

COMMENT ON COLUMN public.cc_pago_imputaciones.cargo_movimiento_id IS
  'Cargo de cuenta corriente (la estadia) al que se apunto esta plata mientras no tiene factura. Excluyente con invoice_id.';
COMMENT ON COLUMN public.cc_pago_imputaciones.mudada_a_imputacion_id IS
  'Si esta fila se mudo a la factura que despues cubrio la estadia, la fila nueva. Distingue una mudanza de una desimputacion: la plata no se solto, cambio de comprobante.';

-- ADD CONSTRAINT no tiene IF NOT EXISTS y la migracion tiene que poder re-correrse.
ALTER TABLE public.cc_pago_imputaciones
  DROP CONSTRAINT IF EXISTS cc_pago_imputaciones_un_destino;
ALTER TABLE public.cc_pago_imputaciones
  ADD CONSTRAINT cc_pago_imputaciones_un_destino CHECK (
    (invoice_id IS NOT NULL) <> (cargo_movimiento_id IS NOT NULL)
  );

-- El unico parcial de la mig 111, ahora explicito en que habla del destino FACTURA.
-- El predicado nuevo no cambia nada para las filas que ya existen (todas tienen
-- invoice_id), pero deja dicho que la unicidad es por destino.
DROP INDEX IF EXISTS public.cc_pago_imputaciones_activa_uq;
CREATE UNIQUE INDEX IF NOT EXISTS cc_pago_imputaciones_activa_uq
  ON public.cc_pago_imputaciones (movimiento_id, invoice_id)
  WHERE revertida_at IS NULL AND invoice_id IS NOT NULL;

-- El mismo invariante del otro lado: un par (pago, estadia) puede repetirse en la
-- historia, nunca dos veces vivo. Es lo que obliga a desimputar antes de corregir un
-- importe, en vez de acumular dos lineas que nadie sabe cual vale.
CREATE UNIQUE INDEX IF NOT EXISTS cc_pago_imputaciones_estadia_activa_uq
  ON public.cc_pago_imputaciones (movimiento_id, cargo_movimiento_id)
  WHERE revertida_at IS NULL AND cargo_movimiento_id IS NOT NULL;

-- El indice de "cuanto lleva imputado esta estadia": corre en cada imputacion (con el
-- cargo lockeado), en el listado de estadias y en la mudanza.
CREATE INDEX IF NOT EXISTS cc_pago_imputaciones_cargo_viva_idx
  ON public.cc_pago_imputaciones (cargo_movimiento_id)
  WHERE revertida_at IS NULL AND cargo_movimiento_id IS NOT NULL;

COMMENT ON TABLE public.cc_pago_imputaciones IS
  'A que factura -- o a que estadia todavia sin facturar -- se imputo un pago de cuenta corriente. Se escribe solo por RPC (registrar, imputar, revertir) y por la mudanza del trigger de facturacion. Una fila revertida queda como historia: ver revertida_at y mudada_a_imputacion_id.';

-- ===========================================================================
-- Seccion 2: la guarda de una imputacion a una ESTADIA
--
-- Gemela de app_validar_imputacion (mig 111, seccion 2) y con la misma forma: lockea
-- la fila del destino, valida todo lo que puede rechazarla, y recien despues suma. La
-- llaman los dos caminos de escritura, que es justo el par que se iba a separar si se
-- copiaba el bloque.
--
-- No lleva guarda de admin: es interna y sus llamadores ya la tienen. Por eso tampoco
-- se le da EXECUTE a nadie -- corre con los privilegios del owner porque los
-- llamadores son SECURITY DEFINER.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.app_validar_imputacion_estadia(
  p_cargo_movimiento_id uuid,
  p_monto numeric,
  p_associated_client_id uuid,
  p_guest_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cargo record;
  v_ya numeric(12,2);
BEGIN
  -- El candado y la lectura, en la MISMA sentencia, y sobre el CARGO: es el mismo
  -- candado que toma la mudanza antes de llevarse la plata a la factura, asi que
  -- imputar a una estadia y facturarla no pueden cruzarse.
  -- FOR NO KEY UPDATE y no FOR UPDATE: conflictua consigo mismo (que es la exclusion
  -- que hace falta) pero no con el FOR KEY SHARE de cualquier INSERT que referencie
  -- este movimiento por FK.
  SELECT m.id, m.tipo, m.amount, m.reservation_id,
         m.associated_client_id, m.guest_id
  INTO v_cargo
  FROM public.cuenta_corriente_movimientos m
  WHERE m.id = p_cargo_movimiento_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa estadía no existe en la cuenta corriente.' USING errcode = 'P0002';
  END IF;

  -- Un pago no cancela otro pago. La unica deuda de una cuenta corriente es el cargo.
  IF v_cargo.tipo <> 'cargo' THEN
    RAISE EXCEPTION 'Solo se puede imputar contra el cargo de una estadía.' USING errcode = '22023';
  END IF;

  IF v_cargo.reservation_id IS NULL THEN
    RAISE EXCEPTION 'Ese cargo no tiene estadía asociada.' USING errcode = '22023';
  END IF;

  -- Pertenencia, en una sola comparacion: el cargo ya dice de quien es. Es la ventaja
  -- de apuntar al cargo y no a la reserva (ver la cabecera).
  IF NOT (
    (p_associated_client_id IS NOT NULL AND v_cargo.associated_client_id = p_associated_client_id)
    OR (p_guest_id IS NOT NULL AND v_cargo.guest_id = p_guest_id)
  ) THEN
    RAISE EXCEPTION 'Esa estadía no es de este cliente.' USING errcode = 'P0037';
  END IF;

  -- El MISMO predicado que `facturable` en rpc_list_cc_account_stays: si hay vinculo
  -- vivo (factura nuestra o marca de facturacion externa) o una factura colgada de la
  -- reserva sin descartar, la estadia ya no es el destino -- lo es su comprobante.
  -- Que este repetido aca y alla es deuda conocida; lo que no se puede es que digan
  -- cosas distintas, y por eso el mensaje manda a la factura en vez de solo negar.
  IF EXISTS (
    SELECT 1 FROM public.invoice_reservations ir
    WHERE ir.reservation_id = v_cargo.reservation_id AND ir.unlinked_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.invoices i2
    WHERE i2.reservation_id = v_cargo.reservation_id
      AND i2.status <> 'discarded' AND i2.anulada_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Esa estadía ya está facturada: imputá el pago a su factura.'
      USING errcode = 'P0042';
  END IF;

  -- Recien ahora la suma, en una sentencia aparte: con el cargo lockeado arriba, esta
  -- lectura ya ve lo que commiteo cualquier imputacion anterior. Solo las VIVAS: una
  -- revertida no cancela nada.
  SELECT COALESCE(SUM(pi.amount), 0)
  INTO v_ya
  FROM public.cc_pago_imputaciones pi
  WHERE pi.cargo_movimiento_id = v_cargo.id
    AND pi.revertida_at IS NULL;

  IF round(v_ya + p_monto, 2) > v_cargo.amount THEN
    RAISE EXCEPTION 'La estadía es de % y ya tiene % imputados: no entran % más.',
      v_cargo.amount, v_ya, p_monto USING errcode = 'P0043';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_validar_imputacion_estadia(uuid, numeric, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- Seccion 3: la FORMA del arreglo de imputaciones, en un solo lugar
--
-- Hasta la mig 111 este bloque estaba copiado en las dos RPC que escriben
-- imputaciones. Se podia vivir con eso mientras la regla era "un invoice_id y un
-- amount". Ahora la regla es "un importe y UNO SOLO de los dos destinos", que es
-- justo el tipo de regla que en una copia se corrige y en la otra no -- y la copia
-- que se olvida no rechaza: acepta una fila sin destino o con los dos, que el CHECK
-- de la seccion 1 despues rebota con un 23514 que el front muestra como "error
-- inesperado". Asi que sale a una funcion propia, como ya hizo la 111 con la guarda.
--
-- La forma se valida con jsonb_typeof, que no castea: asi una clave que falta o un
-- tipo equivocado dan un mensaje que se entiende, en vez del 22P02 del cast.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.app_validar_forma_imputaciones(p_imputaciones jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF jsonb_typeof(p_imputaciones) <> 'array' THEN
    RAISE EXCEPTION 'Las imputaciones tienen que venir como una lista.' USING errcode = '22023';
  END IF;

  -- La comparacion de los dos destinos con <> es "exactamente uno": si faltan los dos
  -- o vienen los dos, los booleanos coinciden y la fila se rechaza.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_imputaciones) AS e(v)
    WHERE jsonb_typeof(e.v) <> 'object'
       OR jsonb_typeof(e.v -> 'amount') IS DISTINCT FROM 'number'
       OR (jsonb_typeof(e.v -> 'invoice_id') = 'string')
          = (jsonb_typeof(e.v -> 'cargo_movimiento_id') = 'string')
  ) THEN
    RAISE EXCEPTION 'Cada imputación necesita un importe y una sola factura o estadía.'
      USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_imputaciones)
      AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric)
    WHERE round(x.amount, 2) <= 0
  ) THEN
    RAISE EXCEPTION 'El importe imputado a cada factura o estadía tiene que ser mayor a 0.'
      USING errcode = '22023';
  END IF;

  -- Los unicos parciales ya lo impedirian, pero con un 23505 que el front oculta como
  -- "error inesperado". Mejor decirlo. Se agrupa por el destino que haya: un id de
  -- factura y uno de cargo nunca coinciden, asi que el COALESCE no puede confundir
  -- dos filas distintas.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_imputaciones)
      AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric)
    GROUP BY COALESCE(x.invoice_id, x.cargo_movimiento_id)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'La misma factura o estadía aparece dos veces en la imputación.'
      USING errcode = 'P0034';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_validar_forma_imputaciones(jsonb)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- Seccion 4: rpc_register_account_payment acepta los dos destinos
--
-- Misma firma de 9 tipos que dejaron la 109 y la 111: no cambia nada para el
-- llamador, y las claves del jsonb siguen siendo las de siempre mas una nueva
-- (cargo_movimiento_id). Un pago que solo imputa a facturas se manda igual que ayer.
--
-- CREATE OR REPLACE y NO DROP+CREATE: los tipos de los argumentos no cambian, asi que
-- no hay riesgo del overload duplicado que explica la 109, y conservar el ACL es
-- preferible a reemitirlo.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.rpc_register_account_payment(
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_retencion_ganancias numeric DEFAULT 0,
  p_retencion_iibb numeric DEFAULT 0,
  p_retencion_certificado text DEFAULT NULL,
  p_imputaciones jsonb DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_recibo integer;
  v_amount numeric(12,2);
  v_rg numeric(12,2);
  v_iibb numeric(12,2);
  v_imputado numeric(12,2);
  v_tiene_imputaciones boolean;
  v_fila record;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF (p_associated_client_id IS NOT NULL) = (p_guest_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Indicá exactamente un cliente (empresa o huésped).' USING errcode = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
  END IF;

  v_amount := round(p_amount, 2);
  v_rg := round(COALESCE(p_retencion_ganancias, 0), 2);
  v_iibb := round(COALESCE(p_retencion_iibb, 0), 2);

  -- Las mismas reglas que los CHECK de la seccion 1 de la 109, repetidas acá a
  -- proposito: el 23514 de un CHECK lo enmascara parseActionError como "error
  -- inesperado", y estos mensajes con 22023 / P00xx llegan textuales al admin. El
  -- CHECK queda de backstop.
  IF v_rg < 0 OR v_iibb < 0 THEN
    RAISE EXCEPTION 'Las retenciones no pueden ser negativas.' USING errcode = '22023';
  END IF;

  -- El monto es lo que cancela de deuda (efectivo + retenciones), asi que las
  -- retenciones son una parte de el. Ver la cabecera de la mig 109.
  IF v_rg + v_iibb > v_amount THEN
    RAISE EXCEPTION 'Las retenciones (%) no pueden superar el monto del pago (%). El monto ya incluye lo retenido.',
      v_rg + v_iibb, v_amount USING errcode = 'P0033';
  END IF;

  v_tiene_imputaciones := p_imputaciones IS NOT NULL
                          AND p_imputaciones <> 'null'::jsonb
                          AND p_imputaciones <> '[]'::jsonb;

  -- ── Todo lo que puede fallar, ANTES de insertar el movimiento ──────────────
  -- El trigger asigna el numero de recibo en el INSERT: validar despues haria que
  -- cada error de tipeo se coma un numero. Ver la cabecera de la mig 109.
  IF v_tiene_imputaciones THEN
    PERFORM public.app_validar_forma_imputaciones(p_imputaciones);

    SELECT round(SUM(round(x.amount, 2)), 2)
    INTO v_imputado
    FROM jsonb_to_recordset(p_imputaciones)
      AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric);

    -- Se imputa contra el monto que cancela deuda, NO contra el neto recibido: la
    -- retencion cancela igual que el efectivo. Alcanza con mirar el arreglo porque el
    -- movimiento es nuevo y no tiene otras imputaciones.
    IF v_imputado > v_amount THEN
      RAISE EXCEPTION 'Lo imputado (%) supera el monto del pago (%).', v_imputado, v_amount
        USING errcode = 'P0035';
    END IF;

    -- En orden del id del destino: dos admin que imputan a los mismos dos destinos
    -- toman los candados en el mismo orden, asi que uno espera en vez de morir por
    -- deadlock (que llega como 40P01 y el front muestra como error generico). Las
    -- facturas y los cargos entran en el MISMO orden por la misma razon: los dos
    -- caminos lockean filas y no pueden ordenarlas distinto entre si.
    FOR v_fila IN
      SELECT x.invoice_id, x.cargo_movimiento_id, round(x.amount, 2) AS amount
      FROM jsonb_to_recordset(p_imputaciones)
        AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric)
      ORDER BY COALESCE(x.invoice_id, x.cargo_movimiento_id)
    LOOP
      IF v_fila.invoice_id IS NOT NULL THEN
        PERFORM public.app_validar_imputacion(
          v_fila.invoice_id, v_fila.amount, p_associated_client_id, p_guest_id
        );
      ELSE
        PERFORM public.app_validar_imputacion_estadia(
          v_fila.cargo_movimiento_id, v_fila.amount, p_associated_client_id, p_guest_id
        );
      END IF;
    END LOOP;
  END IF;

  -- ── Recien acá se escribe ──────────────────────────────────────────────────

  INSERT INTO public.cuenta_corriente_movimientos (
    associated_client_id, guest_id, tipo, amount, payment_method, notes,
    retencion_ganancias, retencion_iibb, retencion_certificado,
    created_by, created_at
  )
  VALUES (
    p_associated_client_id, p_guest_id, 'pago', v_amount,
    NULLIF(BTRIM(p_method), ''), NULLIF(BTRIM(p_notes), ''),
    v_rg, v_iibb, NULLIF(BTRIM(p_retencion_certificado), ''),
    auth.uid(), now()
  )
  RETURNING id, recibo_cc_numero INTO v_id, v_recibo;

  IF v_tiene_imputaciones THEN
    -- Los candados de los destinos siguen tomados hasta el commit, asi que los techos
    -- que se validaron arriba siguen valiendo.
    INSERT INTO public.cc_pago_imputaciones
      (movimiento_id, invoice_id, cargo_movimiento_id, amount, created_by)
    SELECT v_id, x.invoice_id, x.cargo_movimiento_id, round(x.amount, 2), auth.uid()
    FROM jsonb_to_recordset(p_imputaciones)
      AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric);
  END IF;

  RETURN jsonb_build_object('movement_id', v_id, 'recibo_cc_numero', v_recibo);
END;
$function$;

-- ===========================================================================
-- Seccion 5: imputar un pago YA registrado, tambien a una estadia
--
-- El cliente NO viene por parametro: se lee del movimiento, porque dejarlo entrar
-- seria darle a quien llama la posibilidad de imputar el pago de una empresa a la
-- deuda de otra, que es exactamente lo que la guarda de pertenencia existe para
-- impedir (mig 111).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.rpc_add_payment_imputaciones(
  p_movimiento_id uuid,
  p_imputaciones jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mov record;
  v_ya numeric(12,2);
  v_nuevo numeric(12,2);
  v_fila record;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_movimiento_id IS NULL THEN
    RAISE EXCEPTION 'Indicá el pago a imputar.' USING errcode = '22023';
  END IF;

  -- Se lockea el movimiento: dos admin imputando el mismo pago a la vez leerian los
  -- dos el mismo "ya imputado" y lo sobre-imputarian. El candado de cada destino lo
  -- toman las guardas mas abajo; este es el del pago.
  SELECT m.id, m.tipo, m.amount, m.associated_client_id, m.guest_id
  INTO v_mov
  FROM public.cuenta_corriente_movimientos m
  WHERE m.id = p_movimiento_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese pago no existe.' USING errcode = 'P0002';
  END IF;

  IF v_mov.tipo <> 'pago' THEN
    RAISE EXCEPTION 'Solo se imputa un pago; un cargo es deuda que nace en el check-out.'
      USING errcode = '22023';
  END IF;

  IF p_imputaciones IS NULL
     OR p_imputaciones = 'null'::jsonb
     OR p_imputaciones = '[]'::jsonb THEN
    RAISE EXCEPTION 'No hay nada que imputar.' USING errcode = '22023';
  END IF;

  PERFORM public.app_validar_forma_imputaciones(p_imputaciones);

  -- Que no haya ya una imputacion VIVA de este pago a ese mismo destino. Los unicos
  -- parciales lo impedirian igual, con un 23505 que el front muestra como "error
  -- inesperado"; ademas el arreglo correcto no es insertar otra fila sino revertir la
  -- que hay y rehacerla, y eso conviene decirlo.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_imputaciones)
      AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric)
    JOIN public.cc_pago_imputaciones pi
      ON pi.movimiento_id = v_mov.id
     AND pi.revertida_at IS NULL
     AND (pi.invoice_id = x.invoice_id OR pi.cargo_movimiento_id = x.cargo_movimiento_id)
  ) THEN
    RAISE EXCEPTION 'Este pago ya está imputado a esa factura o estadía. Desimputá esa línea primero.'
      USING errcode = 'P0039';
  END IF;

  -- Lo que este pago ya tiene aplicado y vivo. Las revertidas no cuentan: ese es el
  -- monto que revertir devolvio al pago.
  SELECT COALESCE(SUM(pi.amount), 0)
  INTO v_ya
  FROM public.cc_pago_imputaciones pi
  WHERE pi.movimiento_id = v_mov.id
    AND pi.revertida_at IS NULL;

  SELECT round(SUM(round(x.amount, 2)), 2)
  INTO v_nuevo
  FROM jsonb_to_recordset(p_imputaciones)
    AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric);

  -- Contra `amount`, no contra el neto: la retencion cancela igual que el efectivo
  -- (cabecera de la mig 109).
  IF round(v_ya + v_nuevo, 2) > v_mov.amount THEN
    RAISE EXCEPTION 'El pago es de % y ya tiene % imputados: no entran % más.',
      v_mov.amount, v_ya, v_nuevo USING errcode = 'P0035';
  END IF;

  -- En orden del id del destino, por lo mismo que en la seccion 4: mismo orden de
  -- candados, sin deadlock.
  FOR v_fila IN
    SELECT x.invoice_id, x.cargo_movimiento_id, round(x.amount, 2) AS amount
    FROM jsonb_to_recordset(p_imputaciones)
      AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric)
    ORDER BY COALESCE(x.invoice_id, x.cargo_movimiento_id)
  LOOP
    IF v_fila.invoice_id IS NOT NULL THEN
      PERFORM public.app_validar_imputacion(
        v_fila.invoice_id, v_fila.amount, v_mov.associated_client_id, v_mov.guest_id
      );
    ELSE
      PERFORM public.app_validar_imputacion_estadia(
        v_fila.cargo_movimiento_id, v_fila.amount, v_mov.associated_client_id, v_mov.guest_id
      );
    END IF;
  END LOOP;

  INSERT INTO public.cc_pago_imputaciones
    (movimiento_id, invoice_id, cargo_movimiento_id, amount, created_by)
  SELECT v_mov.id, x.invoice_id, x.cargo_movimiento_id, round(x.amount, 2), auth.uid()
  FROM jsonb_to_recordset(p_imputaciones)
    AS x(invoice_id uuid, cargo_movimiento_id uuid, amount numeric);

  RETURN jsonb_build_object(
    'movement_id', v_mov.id,
    'imputado', round(v_ya + v_nuevo, 2),
    'sin_imputar', round(v_mov.amount - v_ya - v_nuevo, 2)
  );
END;
$function$;

-- ===========================================================================
-- Seccion 6: el listado de pagos dice tambien a que ESTADIA apunta cada linea
--
-- Las facturas se resuelven por invoice_id DIRECTO, nunca pasando por
-- invoice_reservations: despues de una nota de credito esas filas quedan
-- desvinculadas (mig 80), asi que un join que exigiera unlinked_at IS NULL haria
-- DESAPARECER una imputacion historica del recibo.
--
-- Los joins pasan a ser LEFT porque ahora cada fila tiene UNO de los dos destinos:
-- la mitad de las columnas de factura viaja en NULL cuando la linea apunta a una
-- estadia, y al reves. Por eso viaja `destino`, para que la pantalla no tenga que
-- adivinar mirando cual de los dos ids vino vacio.
--
-- Y viaja `mudada`. Una fila mudada esta revertida -- es lo que hace que no sume dos
-- veces -- pero no la desimputo nadie: se la llevo la factura. Decirle "desimputada"
-- al que mira el recibo seria mentirle sobre quien movio la plata.
--
-- Las fechas de la estadia se calculan con la zona horaria del hotel, igual que
-- rpc_list_cc_account_stays: si esta pantalla dijera un dia distinto que aquella, la
-- misma estadia tendria dos fechas segun donde se la mire.
--
-- Cambia el contenido del jsonb pero no el tipo de retorno, asi que CREATE OR REPLACE
-- alcanza y el ACL se conserva.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.rpc_list_client_payments(
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_id uuid DEFAULT NULL
)
RETURNS TABLE (
  movimiento_id uuid,
  created_at timestamptz,
  amount numeric,
  payment_method text,
  retencion_ganancias numeric,
  retencion_iibb numeric,
  retencion_certificado text,
  neto_recibido numeric,
  sin_imputar numeric,
  recibo_cc_numero integer,
  notes text,
  imputaciones jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tz TEXT;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF (p_associated_client_id IS NOT NULL) = (p_guest_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Indicá exactamente un cliente (empresa o huésped).' USING errcode = '22023';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(timezone), ''), 'America/Argentina/Tucuman')
  INTO v_tz FROM public.hotel_settings LIMIT 1;

  -- Toda referencia a columna va calificada (m., pi., i., cg., r.): los nombres del
  -- RETURNS TABLE son variables plpgsql en scope y una referencia pelada daria 42702
  -- en ejecucion, que la creacion de la funcion no detecta.
  RETURN QUERY
  SELECT
    m.id,
    m.created_at,
    m.amount,
    m.payment_method,
    m.retencion_ganancias,
    m.retencion_iibb,
    m.retencion_certificado,
    -- El neto se deriva acá y no se guarda: otra columna seria una segunda version de
    -- la misma cuenta, y dos versiones se pueden separar.
    round(m.amount - m.retencion_ganancias - m.retencion_iibb, 2),
    -- Solo las vivas: es lo que hace que desimputar devuelva plata disponible. Una
    -- linea mudada tambien queda revertida, asi que la plata que se fue a la factura
    -- no vuelve a aparecer acá como disponible.
    round(m.amount - COALESCE((
      SELECT SUM(pi.amount) FROM public.cc_pago_imputaciones pi
      WHERE pi.movimiento_id = m.id AND pi.revertida_at IS NULL
    ), 0), 2),
    m.recibo_cc_numero,
    m.notes,
    -- Subquery correlacionada y no LEFT JOIN + GROUP BY: la consulta ya es una fila
    -- por pago, y con GROUP BY habria que listar todas las columnas de nuevo cada vez
    -- que se agregue una. Ademas asi [null] es imposible: cero filas hacen que
    -- jsonb_agg de NULL y el COALESCE lo vuelve '[]'.
    -- SIN filtro de revertida_at: la linea revertida viaja marcada. Ver la cabecera.
    COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'imputacion_id', pi.id,
                 'destino', CASE WHEN pi.invoice_id IS NOT NULL THEN 'factura' ELSE 'estadia' END,
                 'invoice_id', i.id,
                 'cbte_tipo', i.cbte_tipo,
                 'pto_vta', i.pto_vta,
                 'cbte_nro', i.cbte_nro,
                 'cbte_fch', i.cbte_fch,
                 'kind', i.kind,
                 'anulada', (i.anulada_at IS NOT NULL),
                 'imp_total', i.imp_total,
                 'cargo_movimiento_id', pi.cargo_movimiento_id,
                 'reservation_id', cg.reservation_id,
                 'estadia_habitacion', ro.room_number,
                 'estadia_pasajero', r.client_name,
                 'estadia_desde', (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date,
                 'estadia_hasta', (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date,
                 'estadia_total', cg.amount,
                 'imputado', pi.amount,
                 'revertida', (pi.revertida_at IS NOT NULL),
                 'revertida_at', pi.revertida_at,
                 'revertida_motivo', pi.revertida_motivo,
                 'mudada', (pi.mudada_a_imputacion_id IS NOT NULL)
               )
               -- Las vivas primero: la pantalla muestra lo que cuenta y deja la
               -- historia abajo. Dentro de cada grupo, por la fecha del comprobante o
               -- la de salida de la estadia, que es la que esa linea tiene.
               ORDER BY
                 (pi.revertida_at IS NOT NULL),
                 COALESCE(i.cbte_fch, (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date),
                 i.cbte_nro
             )
      FROM public.cc_pago_imputaciones pi
      LEFT JOIN public.invoices i ON i.id = pi.invoice_id
      LEFT JOIN public.cuenta_corriente_movimientos cg ON cg.id = pi.cargo_movimiento_id
      LEFT JOIN public.reservations r ON r.id = cg.reservation_id
      LEFT JOIN public.rooms ro ON ro.id = r.room_id
      WHERE pi.movimiento_id = m.id
    ), '[]'::jsonb)
  FROM public.cuenta_corriente_movimientos m
  WHERE m.tipo = 'pago'
    AND (
      (p_associated_client_id IS NOT NULL AND m.associated_client_id = p_associated_client_id)
      OR (p_guest_id IS NOT NULL AND m.guest_id = p_guest_id)
    )
  ORDER BY m.created_at DESC;
END;
$function$;

-- ===========================================================================
-- Seccion 7: el listado de estadias dice cuanta plata tiene apuntada cada una
--
-- Dos columnas nuevas, que son las que el modal de cobro necesita para ofrecer una
-- estadia como destino: cuanto lleva imputado y cuanto le falta. El techo es el
-- CARGO, no total_price: es la deuda que nacio en el check-out (que puede ser menor
-- si parte se cobro en caja, la columna mixed_payment).
--
-- saldo_estadia viaja SOLO cuando la estadia es facturable, por el mismo criterio con
-- el que imp_total/imputado viajan solo si hay factura cobrable: una estadia ya
-- facturada no tiene saldo propio -- lo tiene su comprobante -- y devolver ahi el
-- importe del cargo invitaria a cobrar dos veces la misma noche.
--
-- Y de paso `facturable` deja de estar escrito dos veces. Estaba calculado una vez
-- para la columna y habria que repetirlo dos veces mas para las nuevas; sale a un
-- LATERAL y las tres lo leen del mismo lugar. Duplicar ese predicado es exactamente
-- la deriva que ya mordio a este repo (cuatro lugares preguntando si algo estaba
-- facturado, corregidos de a uno cuando llego la nota de credito).
--
-- DROP + CREATE porque cambia el tipo de retorno (42P13), en UNA SOLA llamada de
-- exec_ddl. Los tipos de argumento no cambian, asi que no hay riesgo de overload,
-- pero el DROP borra el ACL y por eso el REVOKE/GRANT se reemite. listCcAccountStays
-- mapea campo por campo, asi que las columnas nuevas no rompen a la app desplegada
-- mientras se aplica.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.rpc_list_cc_account_stays(text, uuid, date, date);

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
  external_ref text,
  imp_total numeric,
  imputado numeric,
  cobro_estado text,
  imputado_estadia numeric,
  saldo_estadia numeric
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

  -- Toda referencia a columna va calificada, porque los nombres del RETURNS TABLE
  -- (amount, imp_total, imputado, ...) son variables plpgsql y una referencia pelada
  -- daria 42702 recien en ejecucion.
  RETURN QUERY
  SELECT r.id, m.id, ro.room_number, r.client_name,
         (COALESCE(r.actual_check_in, r.check_in_target) AT TIME ZONE v_tz)::date,
         (COALESCE(r.actual_check_out, r.check_out_target) AT TIME ZONE v_tz)::date,
         m.amount, r.total_price, r.actual_check_out,
         (m.amount <> r.total_price
          OR EXISTS (SELECT 1 FROM public.payments p WHERE p.reservation_id = r.id)),
         fact.es_facturable,
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
         ir.external_ref,
         -- Los importes de cobro solo existen si hay una factura cobrable.
         CASE WHEN i.status = 'authorized' AND i.anulada_at IS NULL THEN i.imp_total END,
         CASE WHEN i.status = 'authorized' AND i.anulada_at IS NULL THEN COALESCE(pag.cobrado, 0) END,
         CASE
           -- Facturada afuera: no hay comprobante nuestro contra el que imputar, y
           -- decir "sin facturar" mandaria a alguien a facturarla dos veces.
           WHEN ir.external_ref IS NOT NULL THEN 'facturado_externo'
           -- numeric es decimal exacto y el techo por factura acota la suma en
           -- imp_total, asi que la igualdad se alcanza de verdad y >= es exacto.
           -- Sin epsilon: un faltante de medio centavo NO es "pagada".
           WHEN i.status = 'authorized' AND i.anulada_at IS NULL
             AND COALESCE(pag.cobrado, 0) >= i.imp_total THEN 'facturada_pagada'
           WHEN i.id IS NOT NULL THEN 'facturada_impaga'
           -- Factura que cuelga de la reserva sin vinculo vivo: es la que `estado`
           -- llama 'en_proceso'. Esta facturada y todavia sin cobrar.
           WHEN EXISTS (
             SELECT 1 FROM public.invoices i2
             WHERE i2.reservation_id = r.id AND i2.status <> 'discarded' AND i2.anulada_at IS NULL
           ) THEN 'facturada_impaga'
           ELSE 'sin_facturar'
         END,
         -- La plata apuntada a la estadia misma (mig 114). Es un hecho, se devuelve
         -- siempre: despues de facturar tiene que dar 0 porque la mudanza la vacio, y
         -- si algun dia no diera 0 eso es justamente lo que hay que poder ver.
         COALESCE(est.apuntado, 0),
         -- El saldo, en cambio, solo tiene sentido mientras la estadia sea el destino.
         CASE WHEN fact.es_facturable THEN round(m.amount - COALESCE(est.apuntado, 0), 2) END
  FROM public.cuenta_corriente_movimientos m
  JOIN public.reservations r ON r.id = m.reservation_id
  LEFT JOIN public.rooms ro ON ro.id = r.room_id
  LEFT JOIN public.invoice_reservations ir
         ON ir.reservation_id = r.id AND ir.unlinked_at IS NULL
  LEFT JOIN public.invoices i ON i.id = ir.invoice_id
  LEFT JOIN LATERAL (
    -- Solo las imputaciones vivas: una desimputada dejo de cobrar esta factura.
    SELECT COALESCE(SUM(pi.amount), 0) AS cobrado
    FROM public.cc_pago_imputaciones pi
    WHERE pi.invoice_id = i.id
      AND pi.revertida_at IS NULL
  ) pag ON TRUE
  LEFT JOIN LATERAL (
    -- Idem del otro lado: lo que este cargo tiene apuntado y todavia vale.
    -- Los alias de estos dos LATERAL (apuntado, es_facturable) NO se llaman como las
    -- columnas del RETURNS TABLE a proposito: esos nombres son variables plpgsql en
    -- scope, y cruzarlos es la clase de ambiguedad que no aparece al crear la funcion
    -- sino al ejecutarla.
    SELECT COALESCE(SUM(pi.amount), 0) AS apuntado
    FROM public.cc_pago_imputaciones pi
    WHERE pi.cargo_movimiento_id = m.id
      AND pi.revertida_at IS NULL
  ) est ON TRUE
  LEFT JOIN LATERAL (
    -- El MISMO predicado que usa app_validar_imputacion_estadia para rechazar con
    -- P0042 y el que usa el draft para rechazar con P0026: sin vinculo vivo y sin
    -- factura colgada de la reserva.
    SELECT (ir.id IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.invoices i2
      WHERE i2.reservation_id = r.id AND i2.status <> 'discarded' AND i2.anulada_at IS NULL
    )) AS es_facturable
  ) fact ON TRUE
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

-- ===========================================================================
-- Seccion 8: al facturar la estadia, la plata se muda sola a la factura
--
-- LA BASE ES LA MIG 111, que es la ultima que redefinio esta funcion y la que
-- coincide con PROD (verificado el 2026-09-18: prosrc menciona cc_pago_imputaciones y
-- conserva el ON CONFLICT parcial de la 82). Antes que la 111 la definieron la 79, la
-- 80 y la 82, y partir de la primera que aparece en un grep rompe cosas: la 80 no
-- tiene el predicado `WHERE invoice_id IS NOT NULL` del ON CONFLICT y sin el, el
-- INSERT no encuentra arbitro y cada factura con reserva muere con 42P10. El resto
-- del cuerpo va tal cual estaba: es CREATE OR REPLACE de la funcion entera, asi que
-- omitir una rama la borraria.
--
-- LO NUEVO ES UNA SOLA RAMA: la transicion a authorized. Ahi la factura ya existe,
-- tiene CAE y sus filas de invoice_reservations estan puestas (las de check-out las
-- puso el INSERT de mas arriba; las de la consolidada, su RPC). Se toma la plata que
-- apunta a esas estadias y se la pasa al comprobante.
--
-- POR QUE AGRUPA POR PAGO. Si un mismo pago tiene plata en dos estadias de la misma
-- consolidada, dos filas darian el mismo par (pago, factura) y reventarian contra
-- cc_pago_imputaciones_activa_uq DESPUES de que ARCA dio el CAE: comprobante emitido
-- afuera, transaccion caida adentro, y el numero ya consumido. Por eso se suma por
-- pago y se escribe UNA fila.
--
-- POR QUE NO PUEDE FALLAR. Nada en este bloque valida ni rechaza: si lo que hay que
-- mudar no entra en el total de la factura, se muda lo que entra y el resto se suelta
-- como saldo a cuenta del pago, con el motivo escrito. El techo de la factura se
-- respeta siempre (la invariante de P0038), pero se respeta recortando, no abortando.
-- Una emision no se cae por una cuestion de imputacion.
--
-- EL CANDADO. Se lockean los cargos de las estadias de esta factura antes de tocar
-- nada, en orden de id. Es el mismo candado que toma app_validar_imputacion_estadia,
-- asi que un admin imputando a una estadia y otro facturandola no se cruzan: el
-- segundo espera y ve lo que hizo el primero.
--
-- revertida_por y created_by salen de auth.uid(): es quien emitio la factura, o sea
-- quien provoco la mudanza. Si el UPDATE viniera de un contexto sin sesion queda
-- NULL, que es la verdad.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.app_sync_invoice_reservation_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_room TEXT;
  v_cap numeric(12,2);
  v_mudar numeric(12,2);
  v_nueva uuid;
  v_motivo TEXT;
  v_pago RECORD;
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
      -- El predicado no es decorativo: sin el, el ON CONFLICT no encuentra arbitro
      -- (el unico es parcial, mig 82) y cada factura con reserva muere con 42P10.
      ON CONFLICT (invoice_id, reservation_id) WHERE invoice_id IS NOT NULL
      DO UPDATE SET unlinked_at = NULL, amount = EXCLUDED.amount;
    END IF;
    RETURN NEW;
  END IF;

  -- Nota de crédito con CAE: marca el comprobante anulado y libera sus estadías,
  -- que vuelven a quedar facturables. Sin esto, "volver a facturar" no funciona.
  IF NEW.kind = 'nota_credito'
     AND NEW.status = 'authorized' AND OLD.status <> 'authorized'
     AND NEW.nota_credito_de IS NOT NULL THEN
    UPDATE public.invoices
    SET anulada_at = NOW(), updated_at = NOW()
    WHERE id = NEW.nota_credito_de AND anulada_at IS NULL;

    UPDATE public.invoice_reservations
    SET unlinked_at = NOW()
    WHERE invoice_id = NEW.nota_credito_de AND unlinked_at IS NULL;

    -- Y la PLATA, que es lo que agrega la mig 111. Liberar la estadía sin liberar el
    -- pago dejaba el monto consumido contra un comprobante muerto y hacía que la
    -- factura de reemplazo no se pudiera cobrar con ese mismo pago.
    -- Queda como saldo a cuenta del pago y NO vuelve sola a la estadía: la estadía ya
    -- está facturable de nuevo, así que aplicarla es un clic (decisión de Agustín,
    -- mig 114).
    UPDATE public.cc_pago_imputaciones
    SET revertida_at = NOW(),
        revertida_por = auth.uid(),
        revertida_motivo = 'Anulada por nota de crédito'
    WHERE invoice_id = NEW.nota_credito_de AND revertida_at IS NULL;
  END IF;

  -- La factura obtuvo CAE: la plata que apuntaba a sus estadías pasa a apuntarle a
  -- ella (mig 114). La nota de crédito se excluye explícitamente: hoy nunca tiene
  -- estadías vinculadas, y si alguna vez las tuviera, mudarle plata sería aplicarle
  -- un cobro a un comprobante que resta.
  IF NEW.status = 'authorized' AND OLD.status <> 'authorized'
     AND NEW.kind <> 'nota_credito' AND NEW.anulada_at IS NULL
     AND NEW.imp_total IS NOT NULL THEN

    -- Los candados, en orden de id y antes de leer nada. Subquery y no JOIN para que
    -- el FOR NO KEY UPDATE caiga solo sobre los cargos.
    PERFORM 1
    FROM public.cuenta_corriente_movimientos cg
    WHERE cg.tipo = 'cargo'
      AND cg.reservation_id IN (
        SELECT ir2.reservation_id
        FROM public.invoice_reservations ir2
        WHERE ir2.invoice_id = NEW.id AND ir2.unlinked_at IS NULL
      )
    ORDER BY cg.id
    FOR NO KEY UPDATE OF cg;

    -- Cuanto entra todavía en esta factura. Normalmente es su total entero: recién
    -- ahora queda autorizada, así que nadie pudo haberle imputado nada antes.
    SELECT round(NEW.imp_total - COALESCE(SUM(pi.amount), 0), 2)
    INTO v_cap
    FROM public.cc_pago_imputaciones pi
    WHERE pi.invoice_id = NEW.id AND pi.revertida_at IS NULL;

    FOR v_pago IN
      SELECT pi.movimiento_id, round(SUM(pi.amount), 2) AS total
      FROM public.cc_pago_imputaciones pi
      JOIN public.cuenta_corriente_movimientos cg ON cg.id = pi.cargo_movimiento_id
      JOIN public.invoice_reservations ir2 ON ir2.reservation_id = cg.reservation_id
      WHERE ir2.invoice_id = NEW.id
        AND ir2.unlinked_at IS NULL
        AND pi.revertida_at IS NULL
      GROUP BY pi.movimiento_id
      -- El pago más viejo primero: si la plata no entrara toda, que se quede la que
      -- llegó antes. Es arbitrario, pero tiene que ser estable y explicable.
      ORDER BY MIN(pi.created_at), pi.movimiento_id
    LOOP
      v_mudar := LEAST(v_pago.total, GREATEST(COALESCE(v_cap, 0), 0));

      IF v_mudar > 0 THEN
        INSERT INTO public.cc_pago_imputaciones
          (movimiento_id, invoice_id, amount, created_by)
        VALUES (v_pago.movimiento_id, NEW.id, v_mudar, auth.uid())
        -- El ON CONFLICT no es decorativo y el predicado tampoco (el unico es
        -- parcial): si este pago ya tuviera una linea viva contra esta factura, un
        -- INSERT pelado moriria con 23505 con el CAE ya otorgado. Hoy no puede pasar
        -- --recien ahora la factura queda autorizada y antes nadie podia imputarle--
        -- pero esta es la sentencia que no se puede permitir fallar, asi que suma en
        -- vez de chocar. El techo se respeta igual: v_cap ya descuenta lo que la
        -- factura tuviera aplicado.
        ON CONFLICT (movimiento_id, invoice_id)
          WHERE revertida_at IS NULL AND invoice_id IS NOT NULL
        DO UPDATE SET amount = cc_pago_imputaciones.amount + EXCLUDED.amount
        RETURNING id INTO v_nueva;
        v_cap := round(v_cap - v_mudar, 2);
      ELSE
        v_nueva := NULL;
      END IF;

      v_motivo := CASE
        WHEN v_nueva IS NULL THEN
          'Estadía facturada: la plata no entraba en el comprobante y queda a cuenta'
        WHEN v_mudar < v_pago.total THEN
          'Mudada a la factura de la estadía; la diferencia no entraba y queda a cuenta'
        ELSE 'Mudada a la factura de la estadía'
      END;

      UPDATE public.cc_pago_imputaciones pi
      SET revertida_at = NOW(),
          revertida_por = auth.uid(),
          revertida_motivo = v_motivo,
          mudada_a_imputacion_id = v_nueva
      FROM public.cuenta_corriente_movimientos cg
      JOIN public.invoice_reservations ir2 ON ir2.reservation_id = cg.reservation_id
      WHERE pi.cargo_movimiento_id = cg.id
        AND ir2.invoice_id = NEW.id
        AND ir2.unlinked_at IS NULL
        AND pi.movimiento_id = v_pago.movimiento_id
        AND pi.revertida_at IS NULL;
    END LOOP;
  END IF;

  IF NEW.status = 'discarded' AND OLD.status <> 'discarded' THEN
    UPDATE public.invoice_reservations
    SET unlinked_at = NOW()
    WHERE invoice_id = NEW.id AND unlinked_at IS NULL;

    -- Por simetría con la rama de la nota de crédito. Hoy no puede disparar (solo se
    -- imputa a facturas autorizadas, y una autorizada con CAE se anula con nota de
    -- crédito, no se descarta -- ver mig 73); está para que no vuelva a pasar que se
    -- libere la estadía y no la plata.
    UPDATE public.cc_pago_imputaciones
    SET revertida_at = NOW(),
        revertida_por = auth.uid(),
        revertida_motivo = 'Factura descartada'
    WHERE invoice_id = NEW.id AND revertida_at IS NULL;
  ELSIF OLD.status = 'discarded' AND NEW.status <> 'discarded' THEN
    UPDATE public.invoice_reservations
    SET unlinked_at = NULL
    WHERE invoice_id = NEW.id;
    -- Las imputaciones NO se re-activan: revertida_at es un hecho con autor y motivo,
    -- no un flag que se prende y se apaga. Si hay que volver a aplicar la plata, se
    -- imputa de nuevo con rpc_add_payment_imputaciones y queda el rastro de las dos.
  END IF;

  RETURN NEW;
END;
$fn$;

-- ===========================================================================
-- Registro
-- ===========================================================================

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('114_pago_imputado_a_una_estadia.sql');
  END IF;
END
$do$;

COMMIT;
