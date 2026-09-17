-- Migration 106: numero correlativo propio para el recibo y para el comprobante de
-- cuenta corriente (el "remito" que firma el cliente).
--
-- QUE PIDE EL CLIENTE: poder archivar esos dos papeles y despues encontrarlos. Hoy
-- el impreso muestra los primeros 8 caracteres del UUID de la fila ("3f2a1b9c"),
-- que no sirve para buscar ni para ordenar: dos comprobantes del mismo dia quedan
-- en la carpeta uno al lado del otro sin ninguna relacion visible, y nadie puede
-- pedir "pasame el recibo 42" porque no existe el 42.
--
-- NO SON COMPROBANTES FISCALES. El correlativo fiscal lo da ARCA (CAE, punto de
-- venta y numero) y vive en `invoices`. Estos dos papeles son internos: uno prueba
-- que se cobro y el otro que el cliente reconocio la deuda. Por eso alcanza con una
-- secuencia de Postgres y se aceptan huecos: si una transaccion falla, el numero que
-- habia tomado se pierde. En un comprobante fiscal eso seria inadmisible; aca no.
-- Es, ademas, el mismo mecanismo que ya usa `cash_shifts.shift_number` (mig 43).
--
-- POR QUE EL REMITO LLEVA TRIGGER Y EL RECIBO NO. Todo pago genera recibo, asi que
-- `payments` puede numerarse con un DEFAULT de columna. En cambio
-- `cuenta_corriente_movimientos` guarda DOS cosas: los cargos (estadia fiada, que si
-- imprimen comprobante) y los pagos a cuenta (que no). Con un DEFAULT, cada pago a
-- cuenta se comeria un numero y la numeracion de remitos saldria llena de saltos sin
-- explicacion. El trigger numera unicamente los cargos.
--
-- BACKFILL: se numera lo ya existente por fecha de creacion. Los papeles que ya se
-- entregaron no tienen ese numero impreso, y esta bien: el correlativo nace para
-- archivar de aca en adelante, no para reescribir el pasado.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig106$ ... $mig106$) SIN
-- ; final y SIN BEGIN/COMMIT.

BEGIN;
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Recibos: columna + secuencia como DEFAULT.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.recibo_numero_seq AS INTEGER;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS recibo_numero INTEGER;

WITH ordenados AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS numero
  FROM public.payments
)
UPDATE public.payments AS p
SET recibo_numero = ordenados.numero
FROM ordenados
WHERE p.id = ordenados.id
  AND p.recibo_numero IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN recibo_numero SET DEFAULT nextval('public.recibo_numero_seq'::regclass);

ALTER SEQUENCE public.recibo_numero_seq OWNED BY public.payments.recibo_numero;

SELECT setval(
  'public.recibo_numero_seq',
  COALESCE((SELECT MAX(recibo_numero) FROM public.payments), 1),
  COALESCE((SELECT MAX(recibo_numero) FROM public.payments), 0) > 0
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_recibo_numero_idx
  ON public.payments (recibo_numero);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Remitos (cargos a cuenta corriente): columna + trigger.
--    Sin NOT NULL: los movimientos de tipo 'pago' quedan con NULL a proposito, y
--    el indice unico es parcial por la misma razon.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.remito_numero_seq AS INTEGER;

ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS remito_numero INTEGER;

WITH ordenados AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS numero
  FROM public.cuenta_corriente_movimientos
  WHERE tipo = 'cargo'
)
UPDATE public.cuenta_corriente_movimientos AS m
SET remito_numero = ordenados.numero
FROM ordenados
WHERE m.id = ordenados.id
  AND m.remito_numero IS NULL;

SELECT setval(
  'public.remito_numero_seq',
  COALESCE((SELECT MAX(remito_numero) FROM public.cuenta_corriente_movimientos), 1),
  COALESCE((SELECT MAX(remito_numero) FROM public.cuenta_corriente_movimientos), 0) > 0
);

CREATE UNIQUE INDEX IF NOT EXISTS cc_movimientos_remito_numero_idx
  ON public.cuenta_corriente_movimientos (remito_numero)
  WHERE remito_numero IS NOT NULL;

CREATE OR REPLACE FUNCTION public.app_assign_remito_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo los cargos imprimen comprobante, asi que solo ellos consumen numero.
  IF NEW.tipo = 'cargo' AND NEW.remito_numero IS NULL THEN
    NEW.remito_numero := nextval('public.remito_numero_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_remito_numero ON public.cuenta_corriente_movimientos;
CREATE TRIGGER trg_assign_remito_numero
  BEFORE INSERT ON public.cuenta_corriente_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.app_assign_remito_numero();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Registro de la migracion.
-- ─────────────────────────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('106_numeracion_recibos_y_remitos.sql');
  END IF;
END
$do$;

COMMIT;
