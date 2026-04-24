-- Migration 43: visible numeric shift codes for cash_shifts
--
-- Adds a business-facing sequential number for each shift while keeping the
-- UUID primary key as the internal identifier.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.cash_shift_number_seq AS INTEGER;

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS shift_number INTEGER;

WITH ordered_shifts AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY opened_at ASC, id ASC) AS new_shift_number
  FROM public.cash_shifts
)
UPDATE public.cash_shifts AS cash_shifts
SET shift_number = ordered_shifts.new_shift_number
FROM ordered_shifts
WHERE cash_shifts.id = ordered_shifts.id
  AND cash_shifts.shift_number IS NULL;

ALTER TABLE public.cash_shifts
  ALTER COLUMN shift_number SET DEFAULT nextval('public.cash_shift_number_seq'::regclass);

ALTER SEQUENCE public.cash_shift_number_seq
  OWNED BY public.cash_shifts.shift_number;

SELECT setval(
  'public.cash_shift_number_seq',
  COALESCE((SELECT MAX(shift_number) FROM public.cash_shifts), 1),
  COALESCE((SELECT MAX(shift_number) FROM public.cash_shifts), 0) > 0
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_shift_number_idx
  ON public.cash_shifts (shift_number);

ALTER TABLE public.cash_shifts
  ALTER COLUMN shift_number SET NOT NULL;

COMMIT;
