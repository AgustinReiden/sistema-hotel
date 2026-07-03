-- Migration 59: Una sola caja por hotel + "piezas rendidas" (check-outs por turno)
--
-- Dos problemas que resuelve:
--
-- 1) Falsa alarma "caja abierta hace mucho tiempo".
--    El modelo anterior abria UNA caja por usuario (indice unico por opened_by).
--    Al cambiar de turno sin cerrar quedaban varias cajas abiertas a la vez y
--    algunas quedaban huerfanas (p. ej. una abierta 7 dias). El aviso saltaba
--    por esas cajas viejas aunque el recepcionista de turno si cerrara la suya.
--    Ahora hay UNA sola caja por hotel: si ya hay una abierta, se reutiliza.
--
-- 2) La rendicion no informaba cuantas piezas (habitaciones) se rindieron.
--    Agregamos reservations.checkout_cash_shift_id: cada check-out queda ligado
--    a la caja abierta en ese momento, asi la rendicion cuenta exactamente los
--    check-outs del turno (incluidos los de reservas ya pagas, que no generan
--    pago y por ende no se podian contar por la tabla payments).
--
-- Efecto colateral buscado: al haber una sola caja sin solapamientos, cerrar la
-- caja deja de forzar el cierre de sesion (se maneja en el front) y el conteo de
-- piezas por turno es inequivoco.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Limpieza: dejar como maximo UNA caja abierta (la mas reciente).
--    Las demas (huerfanas) se cierran cuadrando efectivo esperado = cobrado en
--    efectivo, diferencia 0, con nota. Es un saneamiento unico de datos.
-- ─────────────────────────────────────────────────────────────────────────────
WITH keep AS (
  SELECT id
  FROM public.cash_shifts
  WHERE status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1
)
UPDATE public.cash_shifts cs
SET status       = 'closed',
    closed_at    = NOW(),
    closed_by    = cs.opened_by,
    expected_cash = COALESCE((SELECT SUM(p.amount) FROM public.payments p
                              WHERE p.cash_shift_id = cs.id AND p.payment_method = 'cash'), 0),
    actual_cash   = COALESCE((SELECT SUM(p.amount) FROM public.payments p
                              WHERE p.cash_shift_id = cs.id AND p.payment_method = 'cash'), 0),
    discrepancy   = 0,
    notes = BTRIM(COALESCE(cs.notes, '') || ' [cierre automatico: migracion a una sola caja por hotel]')
WHERE cs.status = 'open'
  AND cs.id NOT IN (SELECT id FROM keep);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Una sola caja abierta por HOTEL (antes era una por usuario).
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.cash_shifts_one_open_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_one_open_hotel
  ON public.cash_shifts (status)
  WHERE status = 'open';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) rpc_open_cash_shift: idempotente. Si ya hay una caja abierta (de quien sea)
--    la reutiliza; si no, abre una. Seguro ante carreras (unique_violation).
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Una sola caja por hotel: si ya hay una abierta, se reutiliza.
  SELECT id INTO v_shift_id FROM public.cash_shifts WHERE status = 'open' LIMIT 1;
  IF v_shift_id IS NOT NULL THEN
    RETURN v_shift_id;
  END IF;

  BEGIN
    INSERT INTO public.cash_shifts (opened_by, opening_cash)
    VALUES (v_user_id, 0)
    RETURNING id INTO v_shift_id;
  EXCEPTION WHEN unique_violation THEN
    -- Otro abrio la caja al mismo tiempo: devolvemos la que quedo abierta.
    SELECT id INTO v_shift_id FROM public.cash_shifts WHERE status = 'open' LIMIT 1;
  END;

  RETURN v_shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_open_cash_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_cash_shift() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_close_cash_shift: cualquier staff puede cerrar la caja del hotel
--    (antes solo el que la abrio, o un admin). El resto igual.
-- ─────────────────────────────────────────────────────────────────────────────
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

  SELECT status
  INTO v_status
  FROM public.cash_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Turno no encontrado.' USING errcode = 'P0002';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) "Piezas rendidas": cada check-out se liga a la caja abierta del momento.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS checkout_cash_shift_id UUID REFERENCES public.cash_shifts(id);

CREATE INDEX IF NOT EXISTS reservations_checkout_shift_idx
  ON public.reservations(checkout_cash_shift_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) rpc_staff_checkout_reservation: setea checkout_cash_shift_id (la caja
--    abierta del hotel) SIEMPRE que se hace un check-out, haya o no cobro.
--    Igual que la version 42, solo cambia: se calcula v_shift_id antes y se
--    graba en la reserva al pasar a checked_out.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_payment_id UUID;
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

  -- Caja abierta del hotel (si hay). Sirve para imputar el cobro y para contar
  -- esta pieza (check-out) en la rendicion del turno.
  v_shift_id := public.app_current_open_shift();

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
    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Debes abrir la caja antes de cobrar.' USING errcode = 'P0003';
    END IF;

    INSERT INTO public.payments (
      reservation_id, amount, payment_method, notes,
      created_at, created_by, cash_shift_id
    )
    VALUES (
      p_reservation_id, v_payment_amount, v_payment_method,
      NULLIF(BTRIM(p_payment_notes), ''), v_now, v_user_id, v_shift_id
    )
    RETURNING id INTO v_payment_id;

    v_paid_amount := v_paid_amount + v_payment_amount;
  END IF;

  IF v_paid_amount < v_total_price THEN
    RAISE EXCEPTION 'No se puede realizar el check-out con saldo pendiente.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_out',
      actual_check_out = v_now,
      paid_amount = v_paid_amount,
      checkout_cash_shift_id = v_shift_id,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms SET status = 'cleaning' WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now,
    'total_price', v_total_price,
    'paid_amount', v_paid_amount,
    'cash_shift_id', v_shift_id,
    'payment_id', v_payment_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) RLS: cualquier staff puede LEER la caja abierta del hotel (para verla y
--    cerrarla) y las que abrio o cerro. El admin ve todo.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff read own cash_shifts or admin all" ON public.cash_shifts;
CREATE POLICY "Staff read cash_shifts open own closed_by or admin"
  ON public.cash_shifts FOR SELECT TO authenticated
  USING (
    public.app_is_staff()
    AND (
      status = 'open'
      OR opened_by = auth.uid()
      OR closed_by = auth.uid()
      OR public.app_is_admin()
    )
  );

COMMIT;
