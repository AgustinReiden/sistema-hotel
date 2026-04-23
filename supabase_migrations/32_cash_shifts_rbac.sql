-- Migration 32: RBAC en cash_shifts + eliminar uso de opening_cash
--
-- Cambios:
-- 1) La política SELECT filtra por opened_by = auth.uid(); admin ve todo.
-- 2) rpc_open_cash_shift pierde el parámetro p_opening_cash (el anterior debe
--    haber rendido todo; la caja arranca en 0).
-- 3) rpc_close_cash_shift calcula expected_cash = cash_income (sin sumar
--    opening_cash, que es siempre 0 a partir de ahora).
--
-- La columna cash_shifts.opening_cash se mantiene por compatibilidad histórica
-- (su default ya es 0) y el CHECK constraint la deja en cero para registros
-- nuevos. Los históricos (si los hay) quedan como están.

BEGIN;

-- 1) Reemplazar política SELECT con filtro por dueño
DROP POLICY IF EXISTS "Staff can read cash_shifts" ON public.cash_shifts;
CREATE POLICY "Staff read own cash_shifts or admin all"
  ON public.cash_shifts FOR SELECT TO authenticated
  USING (
    public.app_is_staff()
    AND (opened_by = auth.uid() OR public.app_is_admin())
  );

-- 2) Reemplazar rpc_open_cash_shift sin parámetro p_opening_cash
DROP FUNCTION IF EXISTS public.rpc_open_cash_shift(numeric);

CREATE OR REPLACE FUNCTION public.rpc_open_cash_shift()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_shift_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.cash_shifts WHERE opened_by = v_user_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya tenes un turno abierto. Cerralo antes de abrir uno nuevo.' USING errcode = 'P0004';
  END IF;

  INSERT INTO public.cash_shifts (opened_by, opening_cash)
  VALUES (v_user_id, 0)
  RETURNING id INTO v_shift_id;

  RETURN v_shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_open_cash_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_cash_shift() TO authenticated;

-- 3) rpc_close_cash_shift: expected_cash = cash_income (sin opening_cash)
CREATE OR REPLACE FUNCTION public.rpc_close_cash_shift(
  p_shift_id UUID,
  p_actual_cash NUMERIC,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_opened_by UUID;
  v_status TEXT;
  v_cash_income NUMERIC;
  v_expected NUMERIC;
  v_discrepancy NUMERIC;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'El efectivo contado debe ser cero o mayor.' USING errcode = '22023';
  END IF;

  SELECT opened_by, status
  INTO v_opened_by, v_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF v_opened_by IS NULL THEN
    RAISE EXCEPTION 'Turno no encontrado.' USING errcode = 'P0002';
  END IF;

  IF v_opened_by <> v_user_id AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo podes cerrar tu propio turno.' USING errcode = '42501';
  END IF;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'El turno ya esta cerrado.' USING errcode = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_cash_income
  FROM public.payments
  WHERE cash_shift_id = p_shift_id
    AND payment_method = 'cash';

  v_expected := v_cash_income;
  v_discrepancy := p_actual_cash - v_expected;

  UPDATE public.cash_shifts
  SET status = 'closed',
      closed_at = NOW(),
      closed_by = v_user_id,
      expected_cash = v_expected,
      actual_cash = p_actual_cash,
      discrepancy = v_discrepancy,
      notes = NULLIF(BTRIM(p_notes), '')
  WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'shift_id', p_shift_id,
    'cash_income', v_cash_income,
    'expected_cash', v_expected,
    'actual_cash', p_actual_cash,
    'discrepancy', v_discrepancy
  );
END;
$$;

COMMIT;
