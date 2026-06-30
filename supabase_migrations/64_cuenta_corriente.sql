-- Migration 64: Cuenta Corriente (cta cte) para empresas y personas
--
-- Clientes (empresas o huéspedes) habilitados a "fiar": al hacer check-out se carga la estadía
-- a su cuenta en vez de cobrarla, y el saldo se salda después con pagos registrados por admin.
--
-- Decisiones (def. con el dueño):
-- - Flag cuenta_corriente_habilitada en associated_clients y guests (DEFAULT false; solo admin edita).
-- - Los movimientos de cta cte viven en una tabla SEPARADA de payments y NO impactan la caja/arqueo
--   (lo que rinde el recepcionista es el comprobante firmado, no efectivo).
-- - Saldo = Σ cargos − Σ pagos; puede quedar negativo (saldo a favor / anticipos).
-- - Registrar pagos a cuenta: solo admin. Cerrar a cuenta corriente en el check-out: staff
--   (gateado por el flag del cliente).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Flag de habilitación (DEFAULT false: nadie habilitado por accidente)
-- ---------------------------------------------------------------------------
ALTER TABLE public.associated_clients
  ADD COLUMN IF NOT EXISTS cuenta_corriente_habilitada boolean NOT NULL DEFAULT false;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS cuenta_corriente_habilitada boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2) Movimientos de cuenta corriente (fuente de verdad del saldo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cuenta_corriente_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  associated_client_id uuid REFERENCES public.associated_clients(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('cargo', 'pago')),
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  payment_method text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Exactamente UN cliente (empresa o huésped)
  CONSTRAINT cc_mov_one_client CHECK ((associated_client_id IS NOT NULL) <> (guest_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS cc_mov_assoc_idx ON public.cuenta_corriente_movimientos (associated_client_id);
CREATE INDEX IF NOT EXISTS cc_mov_guest_idx ON public.cuenta_corriente_movimientos (guest_id);
CREATE INDEX IF NOT EXISTS cc_mov_reservation_idx ON public.cuenta_corriente_movimientos (reservation_id);

ALTER TABLE public.cuenta_corriente_movimientos ENABLE ROW LEVEL SECURITY;

-- Staff lee (para mostrar saldos / fichas); las escrituras van solo por los RPCs SECURITY DEFINER.
DROP POLICY IF EXISTS "Staff can read cc movimientos" ON public.cuenta_corriente_movimientos;
CREATE POLICY "Staff can read cc movimientos" ON public.cuenta_corriente_movimientos
  FOR SELECT TO authenticated USING (public.app_is_staff());

GRANT SELECT ON public.cuenta_corriente_movimientos TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Check-out: rama cuenta_corriente (carga la estadía a la cuenta del cliente)
-- ---------------------------------------------------------------------------
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
  v_assoc UUID;
  v_guest UUID;
  v_payment_amount NUMERIC := p_payment_amount;
  v_payment_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_shift_id UUID;
  v_payment_id UUID;
  v_movement_id UUID;
  v_cc_enabled BOOLEAN;
  v_charge NUMERIC;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, total_price, paid_amount, associated_client_id, guest_id
  INTO v_room_id, v_status, v_total_price, v_paid_amount, v_assoc, v_guest
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  IF v_payment_method = 'cuenta_corriente' THEN
    -- Cargar el saldo pendiente a la cuenta del cliente facturable (empresa o huésped).
    IF v_assoc IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.associated_clients WHERE id = v_assoc;
    ELSIF v_guest IS NOT NULL THEN
      SELECT cuenta_corriente_habilitada INTO v_cc_enabled FROM public.guests WHERE id = v_guest;
    ELSE
      RAISE EXCEPTION 'La reserva no tiene un cliente al que cargar la cuenta corriente.' USING errcode = '22023';
    END IF;

    IF NOT COALESCE(v_cc_enabled, false) THEN
      RAISE EXCEPTION 'Este cliente no tiene cuenta corriente habilitada.' USING errcode = '22023';
    END IF;

    v_charge := round(v_total_price - v_paid_amount, 2);
    IF v_charge > 0 THEN
      INSERT INTO public.cuenta_corriente_movimientos (
        associated_client_id, guest_id, tipo, amount, reservation_id, created_by, created_at
      )
      VALUES (v_assoc, v_guest, 'cargo', v_charge, p_reservation_id, v_user_id, v_now)
      RETURNING id INTO v_movement_id;
    END IF;

    -- La reserva queda saldada en sus libros; la deuda real vive en la cuenta corriente.
    -- No se inserta pago en `payments` ni se toca la caja.
    v_paid_amount := v_total_price;

  ELSIF v_payment_amount IS NOT NULL THEN
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
    'payment_id', v_payment_id,
    'movement_id', v_movement_id,
    'cuenta_corriente', (v_payment_method = 'cuenta_corriente')
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Registrar un pago a cuenta corriente (solo admin; no toca caja)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_register_account_payment(
  p_associated_client_id uuid DEFAULT NULL,
  p_guest_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF (p_associated_client_id IS NOT NULL) = (p_guest_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Indicá exactamente un cliente (empresa o huésped).' USING errcode = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
  END IF;

  INSERT INTO public.cuenta_corriente_movimientos (
    associated_client_id, guest_id, tipo, amount, payment_method, notes, created_by, created_at
  )
  VALUES (
    p_associated_client_id, p_guest_id, 'pago', round(p_amount, 2),
    NULLIF(BTRIM(p_method), ''), NULLIF(BTRIM(p_notes), ''), auth.uid(), now()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('movement_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_register_account_payment(uuid, uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_register_account_payment(uuid, uuid, numeric, text, text) TO authenticated;

COMMIT;
