-- Migration 111: la plata imputada tiene marcha atras
--
-- COMO QUEDO LA 109. Un pago de cuenta corriente se imputa a facturas y eso se
-- escribe en cc_pago_imputaciones, pero la fila no tiene salida: no hay RPC para
-- sacarla y las tablas estan cerradas a escritura directa desde la mig 77/97. La
-- propia cabecera de la 109 lo dejo anotado como hueco conocido.
--
-- POR QUE DUELE. El trigger de la mig 80 (app_sync_invoice_reservation_link), cuando
-- una nota de credito obtiene CAE, marca invoices.anulada_at y desvincula los
-- invoice_reservations: la estadia vuelve a quedar facturable. Pero no tocaba
-- cc_pago_imputaciones. O sea que liberaba la ESTADIA y no la PLATA. El resultado es
-- un pago cuyo monto quedo consumido contra un comprobante muerto -- la guarda P0038
-- mide la suma de imputaciones contra `amount` -- y que por eso no se puede aplicar a
-- la factura de reemplazo. Se arreglaba a mano en la base.
--
-- SE REVIERTE SOLA. Decision de Agustin, y es la que hace coherente al trigger
-- consigo mismo: si la nota de credito ya libera la estadia sin preguntarle a nadie,
-- tiene que liberar la plata en el mismo gesto. Liberar una sola de las dos cosas es
-- exactamente el bug que esta migracion cierra. Lo que la maquina NO hace sola es
-- decidir a que factura nueva va esa plata: eso queda como saldo sin imputar del pago
-- (rpc_list_client_payments ya devuelve `sin_imputar`) y lo aplica un admin.
--
-- SE MARCA, NO SE BORRA. revertida_at / revertida_por / revertida_motivo, igual que
-- invoice_reservations.unlinked_at hace para el caso analogo. Borrar la fila dejaria
-- la plata donde tiene que estar pero se llevaria puesto quien la movio y por que,
-- que es justo lo que un contador va a preguntar cuando un saldo no cierre.
--
-- LA CLAVE PASA A SER SUBROGADA. La PK (movimiento_id, invoice_id) de la 109 no
-- bloqueaba re-imputar a OTRA factura, pero si bloqueaba re-imputar a la MISMA, que
-- es el caso mas comun de todos: "le puse 1000 y eran 800". Se reemplaza por un id
-- propio mas un unico PARCIAL sobre el par vivo, calcado de
-- invoice_reservations_active_uq (mig 79): un par puede repetirse en la historia,
-- nunca dos veces vivo a la vez.
--
-- QUE FILTRA revertida_at Y QUE NO. La regla no es "filtrar en todos lados", y
-- equivocarla rompe cosas distintas en cada direccion:
--
--   * Donde se suma PLATA, se filtra: el techo por factura de la imputacion, el
--     `sin_imputar` del pago y el `cobrado` del estado por estadia. Una imputacion
--     revertida no cancela nada; si siguiera contando, revertir no serviria de nada.
--   * Donde se LISTA, no se filtra: la fila revertida se devuelve marcada. Es el
--     mismo argumento que la seccion 6 de la 109 escribio para `anulada` -- un recibo
--     tiene que seguir mostrando lo mismo que el dia que se imprimio. Si el listado
--     la escondiera, reimprimir un recibo le borraria una linea sin avisar.
--
-- POR QUE TAMBIEN SE PUEDE IMPUTAR A UN PAGO YA REGISTRADO. Revertir, solo, deja la
-- plata libre y sin forma de usarla: rpc_register_account_payment crea el movimiento
-- y sus imputaciones JUNTOS, asi que aplicar el saldo liberado a la factura de
-- reemplazo obligaria a inventar un segundo pago que nunca existio. Por eso va
-- tambien rpc_add_payment_imputaciones, con las mismas dos guardas. Sin ella la mitad
-- del problema que motivo esta migracion sigue abierto.
--
-- LAS GUARDAS VIVEN EN UNA SOLA FUNCION. app_validar_imputacion toma el candado de la
-- factura y valida estado, pertenencia y techo; la llaman los dos caminos de
-- escritura. Duplicar ese bloque es como se rompio la facturacion antes (cuatro
-- lugares preguntando "¿ya esta facturada?", corregidos de a uno cuando llego la nota
-- de credito). El candado se toma adentro y sigue tomado hasta el commit del llamador.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig111$ ... $mig111$) SIN
-- ; final y SIN BEGIN/COMMIT. ESTA MIGRACION VA DESPUES DE LA 109, que al 2026-09-17
-- todavia no esta aplicada (applied_migrations corta en la 99 y cc_pago_imputaciones
-- no existe en PROD). Si se corre antes, falla con 42P01 en la seccion 1, que es lo
-- que corresponde: no hay nada que reparar.
--
-- Las secciones 3 a 8 son DROP+CREATE o CREATE OR REPLACE de una funcion: cada una va
-- en UNA SOLA llamada, para no dejar a la app sin funcion en el medio. Si despues
-- PostgREST dice "Could not find the function ... in the schema cache", el cache no
-- recargo: NOTIFY pgrst, 'reload schema'.
--
-- Y VERIFICAR EJECUTANDO, no contando funciones: plpgsql no valida el cuerpo al
-- crearla (la leccion de la mig 93). El probe no se puede hacer dentro de exec_ddl,
-- que corre como `postgres`: ahi auth.uid() es NULL, app_is_admin() da false y todo
-- rebota con 42501. Hay que registrar un pago, imputarlo y revertirlo desde la app
-- con sesion de admin.

BEGIN;

-- ===========================================================================
-- Seccion 1: la fila de imputacion pasa a tener identidad y marcha atras
-- ===========================================================================

-- Id propio. La PK compuesta de la 109 hacia imposible revertir y volver a imputar la
-- MISMA factura, porque el par se repetiria. Con DEFAULT, el ADD COLUMN completa las
-- filas que ya hubiera (en PROD no hay ninguna: la 109 no esta aplicada).
ALTER TABLE public.cc_pago_imputaciones
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.cc_pago_imputaciones
  DROP CONSTRAINT IF EXISTS cc_pago_imputaciones_pkey;

-- En un bloque y no con ADD CONSTRAINT pelado: ADD CONSTRAINT no tiene IF NOT EXISTS
-- y la migracion tiene que poder re-correrse.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cc_pago_imputaciones'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.cc_pago_imputaciones
      ADD CONSTRAINT cc_pago_imputaciones_pkey PRIMARY KEY (id);
  END IF;
END
$do$;

ALTER TABLE public.cc_pago_imputaciones
  ADD COLUMN IF NOT EXISTS revertida_at timestamptz,
  ADD COLUMN IF NOT EXISTS revertida_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS revertida_motivo text;

COMMENT ON COLUMN public.cc_pago_imputaciones.revertida_at IS
  'Cuando se solto esta imputacion. NULL = viva. Las revertidas NO se borran: se listan marcadas y no suman plata en ningun lado.';
COMMENT ON COLUMN public.cc_pago_imputaciones.revertida_por IS
  'Admin que la solto, o el que emitio la nota de credito si la solto el trigger de la mig 80.';
COMMENT ON COLUMN public.cc_pago_imputaciones.revertida_motivo IS
  'Por que se solto. Obligatorio cuando lo hace una persona; el trigger escribe el suyo.';

-- LA invariante, calcada de invoice_reservations_active_uq (mig 79): un par
-- (pago, factura) puede aparecer muchas veces en la historia, nunca dos veces vivo.
CREATE UNIQUE INDEX IF NOT EXISTS cc_pago_imputaciones_activa_uq
  ON public.cc_pago_imputaciones (movimiento_id, invoice_id)
  WHERE revertida_at IS NULL;

-- El indice de la 109 arranca por invoice_id y lo usa "cuanto lleva cobrado esta
-- factura", que ahora ademas filtra por revertida_at. Se lo reemplaza por el parcial:
-- la consulta caliente solo mira filas vivas.
CREATE INDEX IF NOT EXISTS cc_pago_imputaciones_invoice_viva_idx
  ON public.cc_pago_imputaciones (invoice_id)
  WHERE revertida_at IS NULL;
DROP INDEX IF EXISTS public.cc_pago_imputaciones_invoice_idx;

COMMENT ON TABLE public.cc_pago_imputaciones IS
  'A que facturas se imputo un pago de cuenta corriente. Se escribe solo por RPC (registrar, imputar, revertir). Una fila revertida queda como historia: ver revertida_at.';

-- ===========================================================================
-- Seccion 2: la guarda de una imputacion, en un solo lugar
--
-- Toma el candado de la factura y valida todo lo que puede rechazarla. La llaman
-- rpc_register_account_payment (pago nuevo) y rpc_add_payment_imputaciones (pago ya
-- registrado), que es justo el par que se iba a separar si se copiaba el bloque.
--
-- No lleva guarda de admin: es interna y sus dos llamadores ya la tienen. Por eso
-- tampoco se le da EXECUTE a nadie -- corre con los privilegios del owner porque los
-- llamadores son SECURITY DEFINER.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.app_validar_imputacion(
  p_invoice_id uuid,
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
  v_factura record;
  v_ya numeric(12,2);
BEGIN
  -- El candado y la lectura del estado, en la MISMA sentencia: si se leyera el estado
  -- aparte, entre las dos podria commitear el trigger de la nota de credito (mig 80)
  -- y se imputaria a una factura recien anulada.
  -- FOR NO KEY UPDATE y no FOR UPDATE: conflictua consigo mismo (que es la exclusion
  -- que hace falta) pero no con el FOR KEY SHARE que toma cualquier INSERT que
  -- referencie esta factura por FK, asi que imputar no traba la emision de una nota
  -- de credito ni un invoice_reservations nuevo.
  SELECT i.id, i.status, i.anulada_at, i.imp_total
  INTO v_factura
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La factura que se quiere imputar no existe.' USING errcode = 'P0002';
  END IF;

  IF v_factura.status <> 'authorized' THEN
    RAISE EXCEPTION 'Solo se puede imputar un pago a una factura autorizada.' USING errcode = 'P0036';
  END IF;

  IF v_factura.anulada_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esa factura está anulada por una nota de crédito.' USING errcode = 'P0031';
  END IF;

  -- La factura tiene que ser de ESTE cliente, y hacen falta las DOS ramas: la
  -- consolidada resuelve el cliente por el cargo de cuenta corriente
  -- (cc_movimiento_id) y la de check-out por la reserva, porque ese camino nunca
  -- setea cc_movimiento_id. Verificado contra los datos reales: con una sola rama la
  -- mitad de las facturas queda "de ningun cliente".
  -- Significa "tiene al menos una estadia viva de este cliente", no "todas": una
  -- consolidada es de un solo cliente por construccion (la RPC que la emite rechaza
  -- la mezcla con P0029), asi que al-menos-una alcanza.
  IF NOT EXISTS (
    SELECT 1
    FROM public.invoice_reservations ir
    LEFT JOIN public.cuenta_corriente_movimientos m ON m.id = ir.cc_movimiento_id
    LEFT JOIN public.reservations r ON r.id = ir.reservation_id
    WHERE ir.invoice_id = v_factura.id
      AND ir.unlinked_at IS NULL
      AND (
        (p_associated_client_id IS NOT NULL
          AND p_associated_client_id IN (m.associated_client_id, r.associated_client_id))
        OR (p_guest_id IS NOT NULL
          AND p_guest_id IN (m.guest_id, r.guest_id))
      )
  ) THEN
    RAISE EXCEPTION 'Esa factura no es de este cliente.' USING errcode = 'P0037';
  END IF;

  -- Recien ahora la suma, en una sentencia aparte: con la fila lockeada arriba, esta
  -- lectura ya ve lo que commiteo cualquier imputacion anterior.
  -- Solo las VIVAS: una imputacion revertida no cancela nada, y si siguiera contando
  -- para el techo, revertir no liberaria la factura -- que es el punto de esta
  -- migracion entera.
  SELECT COALESCE(SUM(pi.amount), 0)
  INTO v_ya
  FROM public.cc_pago_imputaciones pi
  WHERE pi.invoice_id = v_factura.id
    AND pi.revertida_at IS NULL;

  IF round(v_ya + p_monto, 2) > v_factura.imp_total THEN
    RAISE EXCEPTION 'La factura es de % y ya tiene % imputados: no entran % más.',
      v_factura.imp_total, v_ya, p_monto USING errcode = 'P0038';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_validar_imputacion(uuid, numeric, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- Seccion 3: rpc_register_account_payment, ahora apoyada en la guarda comun
--
-- Mismo contrato y misma firma de 9 tipos que dejo la 109: no cambia nada para el
-- llamador. Lo unico que cambia adentro es que el bloque de validacion por factura
-- salio a app_validar_imputacion (que ademas filtra las revertidas al medir el techo).
--
-- CREATE OR REPLACE y NO DROP+CREATE: los tipos de los argumentos no cambian, asi que
-- no hay riesgo de overload duplicado y conservar el ACL es preferible a reemitirlo.
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
    IF jsonb_typeof(p_imputaciones) <> 'array' THEN
      RAISE EXCEPTION 'Las imputaciones tienen que venir como una lista.' USING errcode = '22023';
    END IF;

    -- La forma se valida con jsonb_typeof, que no castea: asi una clave que falta o un
    -- tipo equivocado dan un mensaje que se entiende, en vez del 22P02 del cast que el
    -- front muestra como "error inesperado".
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_imputaciones) AS e(v)
      WHERE jsonb_typeof(e.v) <> 'object'
         OR jsonb_typeof(e.v -> 'invoice_id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(e.v -> 'amount') IS DISTINCT FROM 'number'
    ) THEN
      RAISE EXCEPTION 'Cada imputación necesita una factura y un importe.' USING errcode = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric)
      WHERE round(x.amount, 2) <= 0
    ) THEN
      RAISE EXCEPTION 'El importe imputado a cada factura tiene que ser mayor a 0.' USING errcode = '22023';
    END IF;

    -- El unico parcial ya lo impediria, pero con un 23505 que el front oculta como
    -- "error inesperado". Mejor decirlo.
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric)
      GROUP BY x.invoice_id
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Una misma factura aparece dos veces en la imputación.' USING errcode = 'P0034';
    END IF;

    SELECT round(SUM(round(x.amount, 2)), 2)
    INTO v_imputado
    FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric);

    -- Se imputa contra el monto que cancela deuda, NO contra el neto recibido: la
    -- retencion cancela factura igual que el efectivo. Alcanza con mirar el arreglo
    -- porque el movimiento es nuevo y no tiene otras imputaciones.
    IF v_imputado > v_amount THEN
      RAISE EXCEPTION 'Lo imputado (%) supera el monto del pago (%).', v_imputado, v_amount
        USING errcode = 'P0035';
    END IF;

    -- En orden de invoice_id: dos admin que imputan a las mismas dos facturas toman
    -- los candados en el mismo orden, asi que uno espera en vez de morir por deadlock
    -- (que llega como 40P01 y el front muestra como error generico).
    FOR v_fila IN
      SELECT x.invoice_id, round(x.amount, 2) AS amount
      FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric)
      ORDER BY x.invoice_id
    LOOP
      PERFORM public.app_validar_imputacion(
        v_fila.invoice_id, v_fila.amount, p_associated_client_id, p_guest_id
      );
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
    -- Los candados de las facturas siguen tomados hasta el commit, asi que los techos
    -- que se validaron arriba siguen valiendo.
    INSERT INTO public.cc_pago_imputaciones (movimiento_id, invoice_id, amount, created_by)
    SELECT v_id, x.invoice_id, round(x.amount, 2), auth.uid()
    FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric);
  END IF;

  RETURN jsonb_build_object('movement_id', v_id, 'recibo_cc_numero', v_recibo);
END;
$function$;

-- ===========================================================================
-- Seccion 4: imputar un pago YA registrado
--
-- Es la mitad que le faltaba a revertir. El cliente NO viene por parametro: se lee del
-- movimiento, porque dejarlo entrar seria darle a quien llama la posibilidad de
-- imputar el pago de una empresa a la factura de otra, que es exactamente lo que la
-- guarda de pertenencia existe para impedir.
--
-- El techo del PAGO (P0035) mide contra `amount` sumando lo que ya tiene imputado y
-- VIVO: por eso revertir libera monto de verdad y no solo en la pantalla.
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
  -- dos el mismo "ya imputado" y lo sobre-imputarian. El candado de cada factura lo
  -- toma app_validar_imputacion mas abajo; este es el del pago.
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

  IF jsonb_typeof(p_imputaciones) <> 'array' THEN
    RAISE EXCEPTION 'Las imputaciones tienen que venir como una lista.' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_imputaciones) AS e(v)
    WHERE jsonb_typeof(e.v) <> 'object'
       OR jsonb_typeof(e.v -> 'invoice_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(e.v -> 'amount') IS DISTINCT FROM 'number'
  ) THEN
    RAISE EXCEPTION 'Cada imputación necesita una factura y un importe.' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric)
    WHERE round(x.amount, 2) <= 0
  ) THEN
    RAISE EXCEPTION 'El importe imputado a cada factura tiene que ser mayor a 0.' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric)
    GROUP BY x.invoice_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Una misma factura aparece dos veces en la imputación.' USING errcode = 'P0034';
  END IF;

  -- Que no haya ya una imputacion VIVA de este pago a esa factura. El unico parcial lo
  -- impediria igual, con un 23505 que el front muestra como "error inesperado"; ademas
  -- el arreglo correcto no es insertar otra fila sino revertir la que hay y rehacerla,
  -- y eso conviene decirlo.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric)
    JOIN public.cc_pago_imputaciones pi
      ON pi.invoice_id = x.invoice_id
     AND pi.movimiento_id = v_mov.id
     AND pi.revertida_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Este pago ya está imputado a esa factura. Desimputá esa línea primero.'
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
  FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric);

  -- Contra `amount`, no contra el neto: la retencion cancela factura igual que el
  -- efectivo (cabecera de la mig 109).
  IF round(v_ya + v_nuevo, 2) > v_mov.amount THEN
    RAISE EXCEPTION 'El pago es de % y ya tiene % imputados: no entran % más.',
      v_mov.amount, v_ya, v_nuevo USING errcode = 'P0035';
  END IF;

  -- En orden de invoice_id, por lo mismo que en la seccion 3: mismo orden de candados,
  -- sin deadlock.
  FOR v_fila IN
    SELECT x.invoice_id, round(x.amount, 2) AS amount
    FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric)
    ORDER BY x.invoice_id
  LOOP
    PERFORM public.app_validar_imputacion(
      v_fila.invoice_id, v_fila.amount, v_mov.associated_client_id, v_mov.guest_id
    );
  END LOOP;

  INSERT INTO public.cc_pago_imputaciones (movimiento_id, invoice_id, amount, created_by)
  SELECT v_mov.id, x.invoice_id, round(x.amount, 2), auth.uid()
  FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric);

  RETURN jsonb_build_object(
    'movement_id', v_mov.id,
    'imputado', round(v_ya + v_nuevo, 2),
    'sin_imputar', round(v_mov.amount - v_ya - v_nuevo, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_add_payment_imputaciones(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_add_payment_imputaciones(uuid, jsonb) TO authenticated;

-- ===========================================================================
-- Seccion 5: revertir una imputacion
--
-- Se identifica por el id de la FILA, no por el par (movimiento, factura): con el
-- unico parcial el par alcanzaria para encontrar la viva, pero el id es lo que la
-- pantalla ya tiene en la mano (rpc_list_client_payments lo devuelve) y no se vuelve
-- ambiguo si alguna vez se permite mas de una linea viva por par.
--
-- El motivo es obligatorio y por eso lo pide la RPC: sin el, dentro de un año la fila
-- revertida dice que alguien movio plata y no dice por que, que es la mitad de la
-- razon por la que se marca en vez de borrar.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.rpc_revert_payment_imputacion(
  p_imputacion_id uuid,
  p_motivo text
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_imp record;
  v_motivo text;
  v_sin_imputar numeric(12,2);
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_imputacion_id IS NULL THEN
    RAISE EXCEPTION 'Indicá la imputación a desimputar.' USING errcode = '22023';
  END IF;

  v_motivo := NULLIF(BTRIM(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Escribí por qué se desimputa.' USING errcode = '22023';
  END IF;

  -- Se lockea la fila: dos admin desimputando la misma linea a la vez tienen que
  -- terminar con una sola marca, y el segundo tiene que enterarse (P0040) en vez de
  -- pisar el motivo del primero.
  SELECT pi.id, pi.movimiento_id, pi.invoice_id, pi.amount, pi.revertida_at
  INTO v_imp
  FROM public.cc_pago_imputaciones pi
  WHERE pi.id = p_imputacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa imputación no existe.' USING errcode = 'P0002';
  END IF;

  IF v_imp.revertida_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esa imputación ya estaba desimputada.' USING errcode = 'P0040';
  END IF;

  UPDATE public.cc_pago_imputaciones
  SET revertida_at = now(),
      revertida_por = auth.uid(),
      revertida_motivo = v_motivo
  WHERE id = v_imp.id;

  -- Cuanto le quedo libre al pago, para que la pantalla lo diga sin volver a consultar.
  SELECT round(m.amount - COALESCE((
           SELECT SUM(pi.amount)
           FROM public.cc_pago_imputaciones pi
           WHERE pi.movimiento_id = m.id AND pi.revertida_at IS NULL
         ), 0), 2)
  INTO v_sin_imputar
  FROM public.cuenta_corriente_movimientos m
  WHERE m.id = v_imp.movimiento_id;

  RETURN jsonb_build_object(
    'imputacion_id', v_imp.id,
    'movement_id', v_imp.movimiento_id,
    'invoice_id', v_imp.invoice_id,
    'liberado', v_imp.amount,
    'sin_imputar', v_sin_imputar
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_revert_payment_imputacion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_revert_payment_imputacion(uuid, text) TO authenticated;

-- ===========================================================================
-- Seccion 6: el listado de pagos deja de contar lo revertido (pero lo muestra)
--
-- Los dos cambios van en direcciones opuestas y es a proposito:
--   * `sin_imputar` ahora suma SOLO las vivas, asi que revertir devuelve monto al pago.
--   * el arreglo `imputaciones` sigue trayendo TODAS, con `revertida` y su motivo.
-- Esconder la revertida haria que reimprimir un recibo le borre una linea, que es el
-- mismo razonamiento que la 109 escribio para `anulada`.
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
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF (p_associated_client_id IS NOT NULL) = (p_guest_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Indicá exactamente un cliente (empresa o huésped).' USING errcode = '22023';
  END IF;

  -- Toda referencia a columna va calificada (m., pi., i.): los nombres del RETURNS
  -- TABLE son variables plpgsql en scope y una referencia pelada daria 42702 en
  -- ejecucion, que la creacion de la funcion no detecta.
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
    -- Solo las vivas: es lo que hace que desimputar devuelva plata disponible.
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
                 'invoice_id', i.id,
                 'cbte_tipo', i.cbte_tipo,
                 'pto_vta', i.pto_vta,
                 'cbte_nro', i.cbte_nro,
                 'cbte_fch', i.cbte_fch,
                 'kind', i.kind,
                 'anulada', (i.anulada_at IS NOT NULL),
                 'imp_total', i.imp_total,
                 'imputado', pi.amount,
                 'revertida', (pi.revertida_at IS NOT NULL),
                 'revertida_at', pi.revertida_at,
                 'revertida_motivo', pi.revertida_motivo
               )
               -- Las vivas primero: la pantalla muestra lo que cuenta y deja la
               -- historia abajo.
               ORDER BY (pi.revertida_at IS NOT NULL), i.cbte_fch, i.cbte_nro
             )
      FROM public.cc_pago_imputaciones pi
      JOIN public.invoices i ON i.id = pi.invoice_id
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
-- Seccion 7: el estado de cobro por estadia deja de contar lo revertido
--
-- Un solo cambio, en el LATERAL que suma `cobrado`: + revertida_at IS NULL. Sin esto
-- una factura cuyo pago se desimputo seguiria diciendo 'facturada_pagada' y nadie
-- volveria a cobrarla nunca.
--
-- No cambia el tipo de retorno, asi que CREATE OR REPLACE alcanza (la 109 necesito
-- DROP porque ahi si cambiaba) y el ACL se conserva.
-- ===========================================================================

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
  cobro_estado text
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

  -- Igual que en la seccion 6: toda referencia a columna va calificada, porque los
  -- nombres del RETURNS TABLE (amount, imp_total, imputado, ...) son variables plpgsql
  -- y una referencia pelada daria 42702 recien en ejecucion.
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
         END
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

-- ===========================================================================
-- Seccion 8: la nota de credito tambien suelta la plata
--
-- Se reemplaza el trigger agregandole DOS sentencias. El resto del cuerpo va tal cual
-- estaba: es CREATE OR REPLACE de la funcion entera, asi que omitir una rama la
-- borraria.
--
-- LA BASE ES LA MIG 82, NO LA 80. La 80 es la que ESCRIBIO la rama de la nota de
-- credito, asi que es la que uno busca -- pero la 82 volvio a redefinir la misma
-- funcion para que el ON CONFLICT apunte al indice PARCIAL
-- invoice_reservations_invoice_res_uq, que esa migracion creo junto con la columna
-- `id` y la PK subrogada de invoice_reservations. Partir de la 80 borraria el
-- predicado `WHERE invoice_id IS NOT NULL` y el ON CONFLICT dejaria de encontrar
-- arbitro: 42P10 en CADA insert de factura con reserva. Verificado contra PROD, cuyo
-- prosrc coincide con la 82. Antes de tocar esta funcion de nuevo: buscar TODAS las
-- migraciones que la definen, no la primera que aparece.
--
-- La rama de la nota de credito es la que importa. La de 'discarded' se agrega por
-- simetria y cuesta tres lineas: hoy no puede disparar (solo se imputa a facturas
-- `authorized`, y una autorizada con CAE se anula con nota de credito, no se descarta
-- -- ver mig 73), pero si alguna vez se pudiera descartar una autorizada, el que haga
-- ese cambio no se va a acordar de esta tabla.
--
-- revertida_por sale de auth.uid(): es quien emitio la nota de credito, o sea quien
-- provoco la reversion. Si el UPDATE viene de un contexto sin sesion (exec_ddl, un
-- backfill) queda NULL, que es la verdad.
-- ===========================================================================

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
    UPDATE public.cc_pago_imputaciones
    SET revertida_at = NOW(),
        revertida_por = auth.uid(),
        revertida_motivo = 'Anulada por nota de crédito'
    WHERE invoice_id = NEW.nota_credito_de AND revertida_at IS NULL;
  END IF;

  IF NEW.status = 'discarded' AND OLD.status <> 'discarded' THEN
    UPDATE public.invoice_reservations
    SET unlinked_at = NOW()
    WHERE invoice_id = NEW.id AND unlinked_at IS NULL;

    -- Por simetría con la rama de arriba. Hoy no puede disparar (ver la cabecera de
    -- esta sección); está para que no vuelva a pasar que se libere la estadía y no
    -- la plata.
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
    PERFORM public.record_migration('111_desimputar_un_pago.sql');
  END IF;
END
$do$;

COMMIT;
