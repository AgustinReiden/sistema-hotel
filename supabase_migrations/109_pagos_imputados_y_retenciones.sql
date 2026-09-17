-- Migration 109: un pago a cuenta deja de ser un numero suelto
--
-- COMO ESTABA. Un pago de cuenta corriente era una fila en
-- cuenta_corriente_movimientos con tipo='pago' y un amount (mig 64). Nada mas: no se
-- ataba a ninguna factura, no habia donde anotar una retencion y no imprimia papel.
-- Con eso se podia decir CUANTO debe un cliente, pero no QUE facturas quedaron pagas,
-- que es justo lo que pregunta una empresa cuando transfiere y lo que necesita el
-- contador para conciliar. Y si el cliente retenia Ganancias o IIBB, el pago "no
-- cerraba" contra lo que habia transferido: faltaba plata que nunca fue nuestra.
--
-- LA DECISION QUE NO SE PUEDE EQUIVOCAR, y que es lo primero que alguien va a querer
-- "corregir" al reves:
--
--     `amount` es lo que CANCELA de deuda = efectivo + retenciones.
--     Lo que entro de verdad es  amount - retencion_ganancias - retencion_iibb.
--
-- Una retencion NO es un descuento ni una quita: es plata que el cliente le pago a
-- ARCA en nombre del hotel, con un certificado que despues el hotel computa a cuenta
-- de sus propios impuestos. Para el cliente la deuda se extinguio por el total, asi
-- que el saldo de la cuenta tiene que bajar por el total. Si alguien "arregla" esto
-- restandole las retenciones al amount, el cliente queda debiendo para siempre una
-- plata que ya pago y el saldo de la cuenta corriente pasa a ser mentira.
--
-- Las dos guardas que sostienen la regla: las retenciones no pueden sumar mas que
-- amount (son una PARTE de el), y tienen que ser cero en los cargos (un cargo es
-- deuda que nace en el check-out, no un cobro).
--
-- COROLARIO, por si no se ve solo: la imputacion tambien se mide contra `amount`, no
-- contra el neto recibido. Una retencion cancela factura igual que el efectivo.
--
-- EL SALDO NO CAMBIA DE FORMULA. Sigue siendo suma de cargos menos suma de pagos
-- sobre `amount`, asi que las retenciones no mueven el saldo y no hay una sola linea
-- de codigo de saldo que tocar. Eso es consecuencia de la decision de arriba, no una
-- casualidad.
--
-- LA CAJA NO SE TOCA. Un pago de cuenta corriente sigue sin pasar por `payments` ni
-- por el arqueo: la mig 89 prohibio expresamente ese camino porque inflaba la caja
-- cobrada y escondia la deuda. Esta migracion no agrega ningun medio de pago nuevo,
-- no toca `payments` y no toca el CHECK de payment_method (los dos vocabularios son
-- distintos a proposito).
--
-- NUMERO DE RECIBO. La mig 106 numero los recibos de `payments` y, con un trigger,
-- los comprobantes de cuenta corriente, pero SOLO los cargos ("el remito que firma el
-- cliente"): los pagos a cuenta quedaron a proposito sin numero porque no habia papel
-- que numerar. Ahora lo hay, asi que se llena ese hueco con una secuencia propia. Son
-- comprobantes INTERNOS, no fiscales -- el correlativo fiscal lo da ARCA y vive en
-- `invoices` -- asi que se aceptan huecos, igual que el shift_number de la mig 43.
--
-- OJO, quedan DOS series que se llaman "recibo": payments.recibo_numero (cobros de
-- caja, mig 106) y cuenta_corriente_movimientos.recibo_cc_numero (cobros a cuenta).
-- Van a existir dos "recibo 42". Por eso el impreso de cuenta corriente dice
-- "RECIBO DE COBRANZA / CUENTA CORRIENTE" y el nombre del archivo lleva el prefijo de
-- la mig 107: el numero solo no alcanza para archivar.
--
-- POR QUE LA GUARDA DE SOBRE-IMPUTACION VA EN LA RPC Y NO EN UN TRIGGER. Un trigger
-- no puede tomar el candado de la factura ANTES de leer cuanto lleva imputado, que es
-- justo lo que evita que dos cobros simultaneos la sobre-imputen los dos. La RPC
-- lockea la fila de `invoices` y despues suma, en ese orden y en sentencias separadas
-- (fusionarlas volveria a leer del mismo snapshot y perderia la actualizacion). Como
-- las tablas estan cerradas a escritura directa desde la mig 77/97, la RPC es el
-- unico camino y el candado alcanza.
--
-- POR QUE SE VALIDA TODO ANTES DE INSERTAR EL MOVIMIENTO. El trigger asigna el numero
-- de recibo en el INSERT, asi que cada intento fallido se come un numero. "Me equivoque
-- en el importe" y "esa factura ya esta paga" son errores de usuario ordinarios: si se
-- validaran despues, la numeracion saldria llena de huecos por el uso normal. Primero
-- se valida (forma del arreglo, duplicados, pertenencia, estado y techo de cada
-- factura con la fila lockeada) y solo despues se escribe.
--
-- QUE FALTA, dicho para que no se descubra de casualidad: no hay forma de DESIMPUTAR.
-- Si una nota de credito anula una factura que ya tenia un pago imputado, la plata
-- queda pegada a un comprobante muerto y el pago no se puede volver a imputar a la
-- factura de reemplazo; hoy eso se arregla a mano. La PK (movimiento_id, invoice_id)
-- no bloquea la salida -- re-imputar a OTRA factura es un par distinto -- asi que la
-- RPC de reversion se puede agregar despues sin cambiar esta tabla.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig109$ ... $mig109$) SIN
-- ; final y SIN BEGIN/COMMIT. Las secciones 5 y 7 son DROP+CREATE de una funcion:
-- cada una va en UNA SOLA llamada, para no dejar a la app sin funcion en el medio.
-- Si despues de aplicar PostgREST dice "Could not find the function ... in the schema
-- cache", el cache no recargo: NOTIFY pgrst, 'reload schema'.
--
-- Y VERIFICAR EJECUTANDO, no contando funciones: plpgsql no valida el cuerpo al
-- crearla (la leccion de la mig 93, donde min(uuid) hizo que la consolidada no se
-- pudiera emitir nunca). El probe NO se puede hacer dentro de exec_ddl, que corre como
-- `postgres`: ahi auth.uid() es NULL, app_is_admin() da false y la guarda rebota con
-- 42501 antes de tocar nada. Hay que registrar un pago desde la app con sesion de
-- admin.

BEGIN;

-- ===========================================================================
-- Seccion 1: retenciones sobre el movimiento de pago
-- ===========================================================================

ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS retencion_ganancias numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retencion_iibb numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retencion_certificado text;

COMMENT ON COLUMN public.cuenta_corriente_movimientos.retencion_ganancias IS
  'Retencion de Ganancias incluida EN amount. amount = efectivo + retenciones; el neto recibido es amount - retenciones.';
COMMENT ON COLUMN public.cuenta_corriente_movimientos.retencion_iibb IS
  'Retencion de Ingresos Brutos incluida EN amount. Ver retencion_ganancias.';
COMMENT ON COLUMN public.cuenta_corriente_movimientos.retencion_certificado IS
  'Nro de certificado de retencion que entrego el cliente. Opcional: la retencion se avisa al transferir y el papel suele llegar despues.';

-- Constraints separadas y nombradas. El nombre es lo unico que dice que regla se
-- rompio (el 23514 lo enmascara parseActionError, asi que el nombre solo aparece en
-- los logs), y cambiar una regla no deberia forzar revalidar las otras.
-- Van con DROP IF EXISTS previo porque ADD CONSTRAINT no tiene IF NOT EXISTS y la
-- migracion tiene que poder re-correrse.

-- Las dos cotas, y la de abajo no es decorativa: sin ella una retencion negativa
-- haria que el neto recibido sea MAYOR que lo que cancelo deuda.
ALTER TABLE public.cuenta_corriente_movimientos
  DROP CONSTRAINT IF EXISTS cc_mov_retenciones_no_negativas;
ALTER TABLE public.cuenta_corriente_movimientos
  ADD CONSTRAINT cc_mov_retenciones_no_negativas CHECK (
    retencion_ganancias >= 0 AND retencion_iibb >= 0
  );

-- <= y no <: un pago absorbido entero por la retencion (neto 0) es legitimo.
ALTER TABLE public.cuenta_corriente_movimientos
  DROP CONSTRAINT IF EXISTS cc_mov_retenciones_no_superan_amount;
ALTER TABLE public.cuenta_corriente_movimientos
  ADD CONSTRAINT cc_mov_retenciones_no_superan_amount CHECK (
    retencion_ganancias + retencion_iibb <= amount
  );

-- Un cargo es deuda que nace en el check-out: no hay nada retenido ni certificado que
-- guardar. Si algun dia hiciera falta, que sea una migracion que lo piense.
ALTER TABLE public.cuenta_corriente_movimientos
  DROP CONSTRAINT IF EXISTS cc_mov_cargo_sin_retenciones;
ALTER TABLE public.cuenta_corriente_movimientos
  ADD CONSTRAINT cc_mov_cargo_sin_retenciones CHECK (
    tipo <> 'cargo'
    OR (retencion_ganancias = 0 AND retencion_iibb = 0 AND retencion_certificado IS NULL)
  );

-- Un certificado en blanco no es un certificado: o hay numero o hay NULL. Evita
-- heredar la ambiguedad cadena-vacia-vs-NULL que el resto del repo pelea con
-- NULLIF(BTRIM(...)).
ALTER TABLE public.cuenta_corriente_movimientos
  DROP CONSTRAINT IF EXISTS cc_mov_retencion_certificado_fmt;
ALTER TABLE public.cuenta_corriente_movimientos
  ADD CONSTRAINT cc_mov_retencion_certificado_fmt CHECK (
    retencion_certificado IS NULL
    OR (BTRIM(retencion_certificado) <> '' AND char_length(retencion_certificado) <= 60)
  );

-- ===========================================================================
-- Seccion 2: numero de recibo propio para el pago a cuenta
-- ===========================================================================

CREATE SEQUENCE IF NOT EXISTS public.recibo_cc_numero_seq AS INTEGER;

ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS recibo_cc_numero INTEGER;

COMMENT ON COLUMN public.cuenta_corriente_movimientos.recibo_cc_numero IS
  'Correlativo interno del recibo de cobranza (solo tipo=pago; los cargos usan remito_numero). No es fiscal: se aceptan huecos.';

-- Backfill de los pagos que ya existen, por fecha de creacion, igual que la mig 43 y
-- la 106. Arranca DESPUES del maximo ya asignado en vez de en 1, para que una
-- aplicacion parcial no genere numeros duplicados que despues revienten al crear el
-- indice unico.
WITH ordenados AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)
      + COALESCE((SELECT MAX(recibo_cc_numero) FROM public.cuenta_corriente_movimientos), 0) AS numero
  FROM public.cuenta_corriente_movimientos
  WHERE tipo = 'pago' AND recibo_cc_numero IS NULL
)
UPDATE public.cuenta_corriente_movimientos AS m
SET recibo_cc_numero = ordenados.numero
FROM ordenados
WHERE m.id = ordenados.id;

SELECT setval(
  'public.recibo_cc_numero_seq',
  COALESCE((SELECT MAX(recibo_cc_numero) FROM public.cuenta_corriente_movimientos), 1),
  COALESCE((SELECT MAX(recibo_cc_numero) FROM public.cuenta_corriente_movimientos), 0) > 0
);

-- Sin NOT NULL y con indice unico PARCIAL, por el mismo motivo que remito_numero: los
-- cargos quedan con NULL a proposito. Tampoco lleva OWNED BY: no hay DEFAULT de
-- columna, el numero lo pone el trigger y nextval dentro de un trigger no crea
-- dependencia.
CREATE UNIQUE INDEX IF NOT EXISTS cc_movimientos_recibo_cc_numero_idx
  ON public.cuenta_corriente_movimientos (recibo_cc_numero)
  WHERE recibo_cc_numero IS NOT NULL;

-- ===========================================================================
-- Seccion 3: el trigger de numeracion, con la rama del pago
--
-- Se EXTIENDE la funcion de la mig 106 en vez de montar un segundo BEFORE INSERT
-- sobre la misma tabla: un solo lugar decide que papel se lleva que numero, que es lo
-- que hace la regla legible de un vistazo. Reemplazarla es seguro y no tiene nada que
-- ver con la trampa de overloads de la seccion 5: esa aparece solo cuando cambia la
-- lista de TIPOS de argumento, y esta funcion no recibe ninguno.
--
-- El nombre quedo corto para lo que hace ahora (asigna los dos correlativos), pero
-- renombrarla obligaria a recrear el trigger y a pelear con la dependencia
-- (DROP FUNCTION falla con 2BP01 mientras el trigger la use, y CASCADE se llevaria el
-- trigger en silencio, dejando a TODO cargo posterior sin numero de remito y sin un
-- solo error). Se paga con este comentario. El trigger trg_assign_remito_numero no se
-- toca: ya apunta a la funcion por nombre.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.app_assign_remito_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Cargo: comprobante de deuda, el "remito" que firma el cliente (mig 106).
  IF NEW.tipo = 'cargo' AND NEW.remito_numero IS NULL THEN
    NEW.remito_numero := nextval('public.remito_numero_seq');
  -- Pago: recibo de cobranza. Es el hueco que la mig 106 dejo abierto a proposito.
  ELSIF NEW.tipo = 'pago' AND NEW.recibo_cc_numero IS NULL THEN
    NEW.recibo_cc_numero := nextval('public.recibo_cc_numero_seq');
  END IF;
  RETURN NEW;
END;
$$;

-- El REVOKE que la mig 106 no hizo. Llamar una trigger function directamente da 0A000,
-- asi que no es explotable, pero el idioma que fija la mig 85 es que ninguna funcion
-- quede ejecutable por PUBLIC.
REVOKE ALL ON FUNCTION public.app_assign_remito_numero() FROM PUBLIC;

-- ===========================================================================
-- Seccion 4: imputacion del pago a facturas
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.cc_pago_imputaciones (
  movimiento_id uuid NOT NULL REFERENCES public.cuenta_corriente_movimientos(id) ON DELETE CASCADE,
  -- Sin ON DELETE a proposito (NO ACTION): una factura con plata aplicada no se
  -- puede borrar, y asi lo impide la base. Ademas nada en el sistema borra invoices.
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Un pago cubre N facturas y una factura recibe N pagos parciales: la unicidad es
  -- del PAR, nunca del invoice_id solo.
  PRIMARY KEY (movimiento_id, invoice_id)
);

COMMENT ON TABLE public.cc_pago_imputaciones IS
  'A que facturas se imputo un pago de cuenta corriente. Se escribe solo por rpc_register_account_payment.';

-- El indice que usa "cuanto lleva cobrado esta factura", que corre en cada imputacion
-- (con la fila de invoices lockeada) y en cada listado de estado de cobro. La PK no
-- sirve para eso: arranca por movimiento_id.
CREATE INDEX IF NOT EXISTS cc_pago_imputaciones_invoice_idx
  ON public.cc_pago_imputaciones (invoice_id);

ALTER TABLE public.cc_pago_imputaciones ENABLE ROW LEVEL SECURITY;

-- Staff lee; las escrituras van solo por la RPC SECURITY DEFINER. Igual que
-- cuenta_corriente_movimientos y que invoice_reservations.
DROP POLICY IF EXISTS "Staff read cc_pago_imputaciones" ON public.cc_pago_imputaciones;
CREATE POLICY "Staff read cc_pago_imputaciones"
  ON public.cc_pago_imputaciones FOR SELECT TO authenticated
  USING (public.app_is_staff());

-- REVOKE ALL y despues el GRANT minimo, en ese orden: el default de Supabase para
-- tablas nuevas incluye TRUNCATE, REFERENCES y TRIGGER para anon/authenticated, y la
-- RLS no filtra TRUNCATE. Revocar solo INSERT/UPDATE/DELETE dejaria eso colgando.
REVOKE ALL ON public.cc_pago_imputaciones FROM anon, authenticated;
GRANT SELECT ON public.cc_pago_imputaciones TO authenticated;

-- ===========================================================================
-- Seccion 5: rpc_register_account_payment con retenciones e imputacion
--
-- DROP + CREATE en la MISMA llamada de exec_ddl. Agregar parametros a una funcion
-- plpgsql NO la reemplaza: crea otra funcion con otra lista de tipos y quedan dos
-- overloads. Y como los 5 parametros viejos YA tienen DEFAULT NULL (mig 64), la
-- ambiguedad no cubriria solo la llamada de 5 argumentos sino toda llamada de 0 a 5:
-- no habria forma de invocarla. Postgres no se queja al crearla -- la migracion
-- reporta exito -- y revienta recien cuando alguien registra un pago, con 42725 o
-- PGRST203. Es exactamente la forma en que la consolidada quedo rota en produccion.
--
-- El DROP tambien borra el ACL, asi que el REVOKE/GRANT de abajo va con la lista de
-- tipos NUEVA (9 tipos). Escribirlo con los 5 viejos fallaria, o peor, no daria
-- permiso a nadie.
--
-- "Sin romper la firma vieja" es desde el llamador: la firma no se conserva, se
-- reemplaza por un superconjunto que la contiene. src/lib/data.ts manda las 5 claves
-- de siempre por nombre y los 4 parametros nuevos toman su DEFAULT.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.rpc_register_account_payment(uuid, uuid, numeric, text, text);

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
  v_factura record;
  v_ya numeric(12,2);
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

  -- Las mismas reglas que los CHECK de la seccion 1, repetidas acá a proposito: el
  -- 23514 de un CHECK lo enmascara parseActionError como "error inesperado", y estos
  -- mensajes con 22023 / P00xx llegan textuales al admin. El CHECK queda de backstop.
  IF v_rg < 0 OR v_iibb < 0 THEN
    RAISE EXCEPTION 'Las retenciones no pueden ser negativas.' USING errcode = '22023';
  END IF;

  -- El monto es lo que cancela de deuda (efectivo + retenciones), asi que las
  -- retenciones son una parte de el. Ver la cabecera de la migracion.
  IF v_rg + v_iibb > v_amount THEN
    RAISE EXCEPTION 'Las retenciones (%) no pueden superar el monto del pago (%). El monto ya incluye lo retenido.',
      v_rg + v_iibb, v_amount USING errcode = 'P0033';
  END IF;

  v_tiene_imputaciones := p_imputaciones IS NOT NULL
                          AND p_imputaciones <> 'null'::jsonb
                          AND p_imputaciones <> '[]'::jsonb;

  -- ── Todo lo que puede fallar, ANTES de insertar el movimiento ──────────────
  -- El trigger asigna el numero de recibo en el INSERT: validar despues haria que
  -- cada error de tipeo se coma un numero. Ver la cabecera.
  IF v_tiene_imputaciones THEN
    IF jsonb_typeof(p_imputaciones) <> 'array' THEN
      RAISE EXCEPTION 'Las imputaciones tienen que venir como una lista.' USING errcode = '22023';
    END IF;

    -- La forma se valida con jsonb_typeof, que no castea: asi una clave que falta o
    -- un tipo equivocado dan un mensaje que se entiende, en vez del 22P02 del cast
    -- que el front muestra como "error inesperado".
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

    -- La PK ya lo impediria, pero con un 23505 que el front oculta como "error
    -- inesperado". Mejor decirlo.
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
      -- El candado y la lectura del estado, en la MISMA sentencia: si se leyera el
      -- estado aparte, entre las dos podria commitear el trigger de la nota de
      -- credito (mig 80) y se imputaria a una factura recien anulada.
      -- FOR NO KEY UPDATE y no FOR UPDATE: conflictua consigo mismo (que es la
      -- exclusion que hace falta) pero no con el FOR KEY SHARE que toma cualquier
      -- INSERT que referencie esta factura por FK, asi que imputar no traba la
      -- emision de una nota de credito ni un invoice_reservations nuevo.
      SELECT i.id, i.status, i.anulada_at, i.imp_total
      INTO v_factura
      FROM public.invoices i
      WHERE i.id = v_fila.invoice_id
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
      -- setea cc_movimiento_id. Verificado contra los datos reales: con una sola rama
      -- la mitad de las facturas queda "de ningun cliente".
      -- Significa "tiene al menos una estadia viva de este cliente", no "todas": una
      -- consolidada es de un solo cliente por construccion (la RPC que la emite
      -- rechaza la mezcla con P0029), asi que al-menos-una alcanza.
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

      -- Recien ahora la suma, en una sentencia aparte: con la fila lockeada arriba,
      -- esta lectura ya ve lo que commiteo cualquier imputacion anterior.
      SELECT COALESCE(SUM(pi.amount), 0)
      INTO v_ya
      FROM public.cc_pago_imputaciones pi
      WHERE pi.invoice_id = v_factura.id;

      IF round(v_ya + v_fila.amount, 2) > v_factura.imp_total THEN
        RAISE EXCEPTION 'La factura es de % y ya tiene % imputados: no entran % más.',
          v_factura.imp_total, v_ya, v_fila.amount USING errcode = 'P0038';
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
    -- Los candados de las facturas siguen tomados hasta el commit, asi que los techos
    -- que se validaron arriba siguen valiendo.
    INSERT INTO public.cc_pago_imputaciones (movimiento_id, invoice_id, amount, created_by)
    SELECT v_id, x.invoice_id, round(x.amount, 2), auth.uid()
    FROM jsonb_to_recordset(p_imputaciones) AS x(invoice_id uuid, amount numeric);
  END IF;

  RETURN jsonb_build_object('movement_id', v_id, 'recibo_cc_numero', v_recibo);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_register_account_payment(uuid, uuid, numeric, text, text, numeric, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_register_account_payment(uuid, uuid, numeric, text, text, numeric, numeric, text, jsonb) TO authenticated;

-- ===========================================================================
-- Seccion 6: lectura de los pagos de un cliente, con su imputacion
--
-- Las facturas imputadas se resuelven por invoice_id DIRECTO, nunca pasando por
-- invoice_reservations: despues de una nota de credito esas filas quedan
-- desvinculadas (mig 80), asi que un join que exigiera unlinked_at IS NULL haria
-- DESAPARECER una imputacion historica del recibo. Un recibo tiene que seguir
-- mostrando lo mismo que el dia que se imprimio, por eso viaja tambien `anulada`:
-- que la factura despues se anule es informacion, no motivo para esconder el cobro.
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
    round(m.amount - COALESCE((
      SELECT SUM(pi.amount) FROM public.cc_pago_imputaciones pi WHERE pi.movimiento_id = m.id
    ), 0), 2),
    m.recibo_cc_numero,
    m.notes,
    -- Subquery correlacionada y no LEFT JOIN + GROUP BY: la consulta ya es una fila
    -- por pago, y con GROUP BY habria que listar todas las columnas de nuevo cada vez
    -- que se agregue una. Ademas asi [null] es imposible: cero filas hacen que
    -- jsonb_agg de NULL y el COALESCE lo vuelve '[]'.
    COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'invoice_id', i.id,
                 'cbte_tipo', i.cbte_tipo,
                 'pto_vta', i.pto_vta,
                 'cbte_nro', i.cbte_nro,
                 'cbte_fch', i.cbte_fch,
                 'kind', i.kind,
                 'anulada', (i.anulada_at IS NOT NULL),
                 'imp_total', i.imp_total,
                 'imputado', pi.amount
               )
               ORDER BY i.cbte_fch, i.cbte_nro
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

REVOKE ALL ON FUNCTION public.rpc_list_client_payments(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_client_payments(uuid, uuid) TO authenticated;

-- ===========================================================================
-- Seccion 7: estado de COBRO por estadia
--
-- POR QUE SE AMPLIA rpc_list_cc_account_stays EN VEZ DE HACER UNA RPC NUEVA. La parte
-- dificil no es sumar imputaciones: es resolver QUE factura viva cubre esta estadia
-- (invoice_reservations.unlinked_at IS NULL, anulada_at, discarded, mas la marca
-- externa de la mig 82 y las facturas que cuelgan de la reserva sin vinculo vivo).
-- Ese predicado ya vive aca, y duplicarlo es exactamente la deriva que ya mordio a
-- este repo: cuando aparecio la nota de credito hubo que corregir de a uno los cuatro
-- lugares que preguntaban "¿ya esta facturada?". Ampliar cuesta un LEFT JOIN LATERAL;
-- una RPC nueva tendria que copiar cinco joins y quedaria libre para separarse.
--
-- LA UNIDAD DE COBRO ES LA FACTURA, NO LA ESTADIA. Una consolidada de 10 estadias
-- imputada al 50% deja las 10 en "facturada_impaga": no hay forma de saber que mitad
-- se cobro, porque el cliente paga contra el comprobante. Por eso se devuelven tambien
-- imp_total e imputado, para que la pantalla pueda decir "impaga (40.000 de 100.000)"
-- en vez de fingir una precision que no existe. Y por eso NO se prorratea la
-- consolidada entre sus estadias: invoice_reservations.amount lo haria facil, y seria
-- poner en pantalla un numero que ningun recibo respalda.
--
-- cobro_estado nunca contradice a estado: 'sin_facturar' sale exactamente cuando
-- estado da 'pendiente'. Y los importes (imp_total, imputado) vienen SOLO de una
-- factura autorizada y no anulada: una rechazada no puede aportar un imp_total que
-- haga parecer que hay algo por cobrar.
--
-- DROP + CREATE porque cambia el tipo de retorno (42P13), en UNA SOLA llamada de
-- exec_ddl. Aca no hay riesgo de overload -- los tipos de argumento no cambian -- pero
-- el DROP igual borra el ACL, asi que el REVOKE/GRANT se reemite.
-- listCcAccountStays mapea campo por campo, asi que las columnas nuevas no rompen a
-- la app desplegada mientras se aplica.
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
  -- nombres del RETURNS TABLE (amount, imp_total, imputado, ...) son variables
  -- plpgsql y una referencia pelada daria 42702 recien en ejecucion.
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
    SELECT COALESCE(SUM(pi.amount), 0) AS cobrado
    FROM public.cc_pago_imputaciones pi
    WHERE pi.invoice_id = i.id
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

REVOKE ALL ON FUNCTION public.rpc_list_cc_account_stays(TEXT, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_cc_account_stays(TEXT, UUID, DATE, DATE) TO authenticated;

-- ===========================================================================
-- Registro
-- ===========================================================================

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('109_pagos_imputados_y_retenciones.sql');
  END IF;
END
$do$;

COMMIT;
