-- Migration 27: Caja multi-turno (cash_shifts) + auditoria de pagos
--
-- Introduce el concepto de "turno de caja": cada recepcionista abre su caja al
-- comenzar y la cierra al terminar, contando el efectivo real contra el
-- esperado. Los pagos quedan asociados al turno en que se cobraron para poder
-- reconciliar caja diariamente.
--
-- Regla clave: no se puede registrar un pago sin un turno abierto. Esto evita
-- pagos sueltos que no cuadren con el efectivo fisico al cerrar.

BEGIN;

-- 1) Tabla de turnos
CREATE TABLE IF NOT EXISTS public.cash_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opened_by UUID NOT NULL REFERENCES auth.users(id),
  closed_by UUID REFERENCES auth.users(id),
  opening_cash NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  expected_cash NUMERIC(12, 2),
  actual_cash NUMERIC(12, 2),
  discrepancy NUMERIC(12, 2),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  CONSTRAINT cash_shifts_closed_consistency CHECK (
    (status = 'open' AND closed_at IS NULL AND closed_by IS NULL AND actual_cash IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

-- Un solo turno abierto por usuario a la vez
CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_one_open_per_user
  ON public.cash_shifts (opened_by) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS cash_shifts_opened_at_idx
  ON public.cash_shifts (opened_at DESC);

-- 2) Backfill de payments.created_by (habia 2 pagos historicos) + NOT NULL
UPDATE public.payments
SET created_by = '0dc93df4-c237-4ba2-8374-63f71935630d'
WHERE created_by IS NULL;

ALTER TABLE public.payments ALTER COLUMN created_by SET NOT NULL;

-- 3) FK a cash_shifts en payments (nullable para los 2 pagos historicos)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS cash_shift_id UUID REFERENCES public.cash_shifts(id);

CREATE INDEX IF NOT EXISTS payments_cash_shift_idx
  ON public.payments(cash_shift_id);

-- 4) RLS en cash_shifts
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read cash_shifts" ON public.cash_shifts;
CREATE POLICY "Staff can read cash_shifts"
  ON public.cash_shifts FOR SELECT TO authenticated
  USING (public.app_is_staff());

-- Escritura solo via RPCs (SECURITY DEFINER); igual dejamos policies coherentes
DROP POLICY IF EXISTS "Staff can insert cash_shifts" ON public.cash_shifts;
CREATE POLICY "Staff can insert cash_shifts"
  ON public.cash_shifts FOR INSERT TO authenticated
  WITH CHECK (public.app_is_staff() AND opened_by = auth.uid());

DROP POLICY IF EXISTS "Staff can update own cash_shifts" ON public.cash_shifts;
CREATE POLICY "Staff can update own cash_shifts"
  ON public.cash_shifts FOR UPDATE TO authenticated
  USING (public.app_is_staff() AND opened_by = auth.uid())
  WITH CHECK (public.app_is_staff() AND opened_by = auth.uid());

-- 5) Helper: turno abierto del usuario actual
CREATE OR REPLACE FUNCTION public.app_current_open_shift()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.cash_shifts
  WHERE opened_by = auth.uid()
    AND status = 'open'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.app_current_open_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_current_open_shift() TO authenticated;

-- 6) RPC: abrir turno
CREATE OR REPLACE FUNCTION public.rpc_open_cash_shift(p_opening_cash NUMERIC)
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

  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'El efectivo inicial debe ser cero o mayor.' USING errcode = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.cash_shifts WHERE opened_by = v_user_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya tenes un turno abierto. Cerralo antes de abrir uno nuevo.' USING errcode = 'P0004';
  END IF;

  INSERT INTO public.cash_shifts (opened_by, opening_cash)
  VALUES (v_user_id, p_opening_cash)
  RETURNING id INTO v_shift_id;

  RETURN v_shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_open_cash_shift(NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_cash_shift(NUMERIC) TO authenticated;

-- 7) RPC: cerrar turno
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
  v_opening_cash NUMERIC;
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

  SELECT opened_by, status, opening_cash
  INTO v_opened_by, v_status, v_opening_cash
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

  v_expected := v_opening_cash + v_cash_income;
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
    'opening_cash', v_opening_cash,
    'cash_income', v_cash_income,
    'expected_cash', v_expected,
    'actual_cash', p_actual_cash,
    'discrepancy', v_discrepancy
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_close_cash_shift(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_cash_shift(UUID, NUMERIC, TEXT) TO authenticated;

-- 8) Reemplazar rpc_register_payment: asocia al turno abierto del usuario
CREATE OR REPLACE FUNCTION public.rpc_register_payment(
  p_reservation_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_shift_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
  END IF;

  v_shift_id := public.app_current_open_shift();
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Debes abrir la caja antes de cobrar.' USING errcode = 'P0003';
  END IF;

  SELECT total_price, paid_amount
  INTO v_total_price, v_paid_amount
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_total_price IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_paid_amount + p_amount > v_total_price THEN
    RAISE EXCEPTION 'El pago excede el total estipulado de la reserva.' USING errcode = '22023';
  END IF;

  INSERT INTO public.payments (
    reservation_id,
    amount,
    payment_method,
    notes,
    created_at,
    created_by,
    cash_shift_id
  ) VALUES (
    p_reservation_id,
    p_amount,
    p_payment_method,
    p_notes,
    v_now,
    v_user_id,
    v_shift_id
  );

  UPDATE public.reservations
  SET paid_amount = v_paid_amount + p_amount,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'new_paid_amount', v_paid_amount + p_amount,
    'cash_shift_id', v_shift_id
  );
END;
$$;

-- 9) Reemplazar rpc_staff_checkout_reservation: idem al anterior, pero
--    si hay pago, lo asocia al turno abierto del usuario.
CREATE OR REPLACE FUNCTION public.rpc_staff_checkout_reservation(
  p_reservation_id UUID,
  p_payment_amount NUMERIC DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_room_id INT;
  v_status public.reservation_status;
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_payment_amount NUMERIC := p_payment_amount;
  v_payment_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_shift_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, total_price, paid_amount
  INTO v_room_id, v_status, v_total_price, v_paid_amount
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  IF v_payment_amount IS NOT NULL THEN
    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
    END IF;

    IF v_payment_method IS NULL THEN
      RAISE EXCEPTION 'Debe indicar un metodo de pago.' USING errcode = '22023';
    END IF;

    IF v_paid_amount + v_payment_amount <> v_total_price THEN
      RAISE EXCEPTION 'Solo se puede cobrar el saldo exacto pendiente para finalizar el check-out.' USING errcode = '22023';
    END IF;

    v_shift_id := public.app_current_open_shift();
    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Debes abrir la caja antes de cobrar.' USING errcode = 'P0003';
    END IF;

    INSERT INTO public.payments (
      reservation_id,
      amount,
      payment_method,
      notes,
      created_at,
      created_by,
      cash_shift_id
    ) VALUES (
      p_reservation_id,
      v_payment_amount,
      v_payment_method,
      NULLIF(BTRIM(p_payment_notes), ''),
      v_now,
      v_user_id,
      v_shift_id
    );

    v_paid_amount := v_paid_amount + v_payment_amount;
  END IF;

  IF v_paid_amount < v_total_price THEN
    RAISE EXCEPTION 'No se puede realizar el check-out con saldo pendiente.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_out',
      actual_check_out = v_now,
      paid_amount = v_paid_amount,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms
  SET status = 'cleaning'
  WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now,
    'total_price', v_total_price,
    'paid_amount', v_paid_amount,
    'cash_shift_id', v_shift_id
  );
END;
$$;

COMMIT;
