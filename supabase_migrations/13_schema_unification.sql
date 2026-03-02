-- Migration 13: Schema Unification and Deduplication (Fase 3)

BEGIN;

-- 1. Unificar 'amount_paid' y 'paid_amount'
-- 'paid_amount' será la columna canónica.
UPDATE public.reservations
SET paid_amount = amount_paid
WHERE paid_amount = 0 AND amount_paid > 0;

ALTER TABLE public.reservations DROP COLUMN IF EXISTS amount_paid;

-- 2. Unificar 'base_price_per_night' y 'base_price'
-- 'base_price' será la columna canónica
UPDATE public.rooms
SET base_price = base_price_per_night
WHERE base_price = 50.00 AND base_price_per_night <> 50.00;

ALTER TABLE public.rooms DROP COLUMN IF EXISTS base_price_per_night;

COMMIT;
