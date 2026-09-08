-- Migration 89: un pago "cuenta corriente" no es plata cobrada
--
-- Contexto: el Tablero Gerencial no cerraba ("la venta no coincide con lo cobrado
-- mas impago") porque faltaba la pata del FIADO a cuenta corriente. Auditando el
-- dato aparecio ademas un agujero que la ensucia:
--
--   rpc_register_payment aceptaba cualquier texto como metodo de pago. Con
--   'cuenta_corriente' insertaba una fila en `payments` que NO es plata que entra
--   (infla la caja cobrada y el arqueo del turno) y que ademas NO genera el cargo
--   en la cuenta del cliente (esconde la deuda). El cierre a cuenta corriente solo
--   puede salir del check-out (rpc_staff_checkout_reservation /
--   rpc_staff_early_checkout), que si crea el cargo y deja la reserva saldada.
--
-- En produccion quedaron 2 filas asi (JUFEC SA - PERFUMERIA, 03/07/2026, $50.000
-- c/u): $100.000 figuraban como cobrados sin haber entrado, y la deuda de JUFEC
-- estaba $100.000 por debajo de la real.
--
-- Que hace esta migracion:
--   1) Convierte esos pagos en cargos de cuenta corriente (que es lo que paso).
--   2) Blinda rpc_register_payment: solo metodos validos, y nunca cuenta corriente.
--   3) CHECK en payments para que no vuelva a entrar por ninguna via.
--
-- El arqueo NO se toca: rpc_close_cash_shift calcula expected_cash sumando solo
-- payment_method = 'cash', asi que sacar estas filas no altera ninguna rendicion
-- ya cerrada. Tampoco cambia reservations.paid_amount: el cargo reemplaza al pago,
-- y la invariante paid_amount = SUM(pagos) + SUM(cargos cta cte) se mantiene.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Corregir los pagos mal cargados: pasan a ser cargos de cuenta corriente
-- ---------------------------------------------------------------------------

-- Guarda: si alguno no tiene cliente facturable no hay a quien cargarle la deuda.
-- Preferimos abortar y que se revise a mano antes que perder el rastro de la plata.
DO $$
DECLARE
  v_huerfanos int;
BEGIN
  SELECT count(*)
  INTO v_huerfanos
  FROM public.payments p
  JOIN public.reservations r ON r.id = p.reservation_id
  WHERE p.payment_method = 'cuenta_corriente'
    AND r.associated_client_id IS NULL
    AND r.guest_id IS NULL;

  IF v_huerfanos > 0 THEN
    RAISE EXCEPTION
      'Hay % pago(s) con metodo cuenta_corriente sobre reservas sin empresa ni huesped asociado. Asignar el cliente antes de correr esta migracion.',
      v_huerfanos;
  END IF;
END $$;

INSERT INTO public.cuenta_corriente_movimientos (
  associated_client_id,
  guest_id,
  tipo,
  amount,
  reservation_id,
  notes,
  created_by,
  created_at
)
SELECT
  r.associated_client_id,
  -- Exactamente un cliente (constraint cc_mov_one_client): manda la empresa si la hay.
  CASE WHEN r.associated_client_id IS NULL THEN r.guest_id END,
  'cargo',
  p.amount,
  p.reservation_id,
  'Migracion 89: estaba cargado como pago con metodo cuenta corriente (no habia entrado plata).',
  p.created_by,
  p.created_at
FROM public.payments p
JOIN public.reservations r ON r.id = p.reservation_id
WHERE p.payment_method = 'cuenta_corriente';

DELETE FROM public.payments WHERE payment_method = 'cuenta_corriente';

-- ---------------------------------------------------------------------------
-- 2) rpc_register_payment: validar el metodo de pago
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_register_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_method TEXT := NULLIF(BTRIM(p_payment_method), '');
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_shift_id UUID;
  v_payment_id UUID;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser numerico y mayor a 0.' USING errcode = '22023';
  END IF;

  -- Fiar no es cobrar: el cargo a la cuenta del cliente lo hace el check-out, que
  -- ademas valida que el cliente tenga cuenta corriente habilitada. Meterlo por aca
  -- inflaba la caja y dejaba la deuda sin registrar.
  IF v_method = 'cuenta_corriente' THEN
    RAISE EXCEPTION 'La cuenta corriente se cierra en el check-out, no como pago suelto.'
      USING errcode = '22023';
  END IF;

  IF v_method IS NULL OR v_method NOT IN (
    'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other', 'mercado_pago', 'vale_blanco'
  ) THEN
    RAISE EXCEPTION 'Metodo de pago invalido: %', COALESCE(v_method, '(vacio)')
      USING errcode = '22023';
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
    reservation_id, amount, payment_method, notes,
    created_at, created_by, cash_shift_id
  )
  VALUES (
    p_reservation_id, p_amount, v_method, p_notes,
    v_now, v_user_id, v_shift_id
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.reservations
  SET paid_amount = v_paid_amount + p_amount, updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'payment_id', v_payment_id,
    'new_paid_amount', v_paid_amount + p_amount,
    'cash_shift_id', v_shift_id
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Que la base no acepte nunca mas un pago "cuenta corriente"
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN (
    'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other', 'mercado_pago', 'vale_blanco'
  ));

COMMIT;
