-- Migration 30: Fix bug B1 — get_today_extra_income() usaba UTC en vez de la
-- timezone del hotel. Cerca de medianoche, ingresos del dia local podian
-- aparecer como "maniana" o "ayer".

BEGIN;

CREATE OR REPLACE FUNCTION public.get_today_extra_income()
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM public.extra_charges
  WHERE charge_type = 'half_day'
    AND (created_at AT TIME ZONE (SELECT COALESCE(timezone, 'UTC') FROM public.hotel_settings ORDER BY id LIMIT 1))::date
        = (NOW() AT TIME ZONE (SELECT COALESCE(timezone, 'UTC') FROM public.hotel_settings ORDER BY id LIMIT 1))::date;
$$;

COMMIT;
