-- Migration 113: numero de cliente en Robinet, en las dos fichas de cliente
--
-- POR QUE. Robinet es otro sistema que usa el hotel, con su propio numero de
-- cliente. La cuenta corriente del hotel admite dos clases de cliente
-- (empresas en associated_clients, huespedes en guests, ver mig 94/89), asi
-- que el campo va en las dos: cualquiera de las dos puede ser el cliente que
-- alguien busca del lado de Robinet.
--
-- No es un dato de ARCA: no participa de ningun comprobante ni de la
-- resolucion del receptor (ver mig 112, "lo que se elige es lo que se
-- factura"). Es solo una referencia cruzada para ubicar al cliente en el
-- otro sistema.
--
-- Nullable porque la mayoria de los clientes no lo van a tener cargado.
-- Indice unico parcial: dos clientes con el mismo numero de Robinet es un
-- error de tipeo (es un id de un sistema ajeno), asi que conviene que la
-- base lo frene antes de que se mezclen las cuentas.

BEGIN;

ALTER TABLE public.associated_clients
  ADD COLUMN IF NOT EXISTS robinet_id integer NULL;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS robinet_id integer NULL;

CREATE UNIQUE INDEX IF NOT EXISTS associated_clients_robinet_id_key
  ON public.associated_clients (robinet_id)
  WHERE robinet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guests_robinet_id_key
  ON public.guests (robinet_id)
  WHERE robinet_id IS NOT NULL;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('113_robinet_id_en_fichas_de_cliente.sql');
  END IF;
END $$;

COMMIT;
