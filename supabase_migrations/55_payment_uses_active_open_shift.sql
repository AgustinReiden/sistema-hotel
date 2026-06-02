-- Migration 55: El cobro se asocia a la caja abierta del hotel, no solo a la del usuario
--
-- Problema: `app_current_open_shift()` devolvia solo el turno abierto del usuario actual
-- (`opened_by = auth.uid()`). Como el admin no abre caja propia (la abre el recepcionista),
-- al hacer un check-out con cobro el RPC no encontraba turno y exigia "abrir la caja",
-- sin posibilidad de hacerlo. Colisiona con el modelo de "una caja por hotel".
--
-- Solucion: el helper devuelve la caja abierta del usuario si la tiene; si no, la caja
-- abierta vigente del hotel (la mas reciente). Asi el cobro/checkout del admin se imputa a
-- la caja que dejo abierta el recepcionista (consistente con que el admin ya puede verla y
-- cerrarla). El recepcionista no cambia: sigue tomando su propia caja.
--
-- Lo usan unicamente rpc_register_payment y rpc_staff_checkout_reservation (cobros).
-- Misma firma → CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION public.app_current_open_shift()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.cash_shifts
  WHERE status = 'open'
  ORDER BY (opened_by = auth.uid()) DESC, opened_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.app_current_open_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_current_open_shift() TO authenticated;

COMMIT;
