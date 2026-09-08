-- Migration 92: restituir dos guardas de monto que se perdieron en renombres
--
-- La migracion 03 puso CHECK (>= 0) sobre reservations.amount_paid y sobre
-- rooms.base_price_per_night. Las dos columnas se renombraron despues:
--
--   * rooms.base_price_per_night -> rooms.base_price          (mig 07)
--   * reservations.amount_paid   -> reservations.paid_amount  (mig 13)
--
-- Postgres borra el CHECK junto con la columna de la que depende, y nadie lo volvio a
-- crear sobre el nombre nuevo. Aparecio al armar el registro de migraciones (mig 91):
-- de los 402 objetos declarados por las migraciones, estos dos eran los unicos ausentes
-- que no se explicaban por un reemplazo posterior.
--
-- Hoy nada impide a nivel base que paid_amount o base_price queden negativos. Los RPCs
-- lo validan, pero el CHECK es la red que queda si alguna vez se toca la tabla por otro
-- lado. Los datos actuales cumplen las dos condiciones (min paid_amount = 0,
-- min base_price = 50000), asi que el ALTER no puede fallar por datos existentes.

BEGIN;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_paid_amount_non_negative;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_paid_amount_non_negative
  CHECK (paid_amount >= 0);

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_base_price_non_negative;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_base_price_non_negative
  CHECK (base_price >= 0);

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('92_restituir_guardas_de_montos.sql');
  END IF;
END $$;

COMMIT;
