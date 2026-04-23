-- Migration 33: Permitir cancelar reservas en estado checked_out
--
-- Hasta ahora rpc_cancel_reservation solo cancelaba pending / confirmed /
-- checked_in. El admin quiere poder cancelar (ocultar) huéspedes que ya
-- hicieron check-out desde el directorio.
--
-- Política de pagos: al cancelar un checked_out, NO se toca total_price ni
-- los pagos registrados. La caja ya cerrada queda intacta; solo se marca la
-- reserva como cancelled y se archiva en reservation_cancellations con
-- previous_status='checked_out'.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_cancel_reservation(
  p_reservation_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_room_id int;
  v_room_number text;
  v_room_type text;
  v_client_name text;
  v_client_dni text;
  v_client_phone text;
  v_status public.reservation_status;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_total_price numeric;
  v_paid_amount numeric;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'El motivo de cancelacion es obligatorio.' USING errcode = '22023';
  END IF;

  SELECT
    r.room_id,
    ro.room_number,
    ro.room_type,
    r.client_name,
    r.client_dni,
    r.client_phone,
    r.status,
    r.check_in_target,
    r.check_out_target,
    r.total_price,
    r.paid_amount
  INTO
    v_room_id,
    v_room_number,
    v_room_type,
    v_client_name,
    v_client_dni,
    v_client_phone,
    v_status,
    v_check_in,
    v_check_out,
    v_total_price,
    v_paid_amount
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'La reserva ya se encuentra cancelada.' USING errcode = '22023';
  END IF;

  INSERT INTO public.reservation_cancellations (
    reservation_id,
    room_id,
    room_number,
    room_type,
    client_name,
    client_dni,
    client_phone,
    check_in_target,
    check_out_target,
    total_price,
    paid_amount,
    previous_status,
    reason,
    cancelled_at,
    cancelled_by
  )
  VALUES (
    p_reservation_id,
    v_room_id,
    v_room_number,
    v_room_type,
    v_client_name,
    v_client_dni,
    v_client_phone,
    v_check_in,
    v_check_out,
    v_total_price,
    v_paid_amount,
    v_status,
    v_reason,
    v_now,
    v_user_id
  );

  -- Liberamos la habitación solo si la reserva estaba activa
  IF v_status = 'checked_in' THEN
    UPDATE public.rooms
    SET status = 'available'
    WHERE id = v_room_id AND status = 'occupied';
  END IF;

  -- Ajuste contable: solo para reservas aún no cerradas.
  -- Si ya estaba checked_out, preservamos total_price y paid_amount intactos
  -- (caja histórica cerrada, no se re-toca).
  IF v_status <> 'checked_out' AND v_total_price > v_paid_amount THEN
    v_total_price := v_paid_amount;
    UPDATE public.reservations
    SET status = 'cancelled',
        total_price = v_total_price,
        updated_at = v_now
    WHERE id = p_reservation_id;
  ELSE
    UPDATE public.reservations
    SET status = 'cancelled',
        updated_at = v_now
    WHERE id = p_reservation_id;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'status', 'cancelled',
    'previous_status', v_status,
    'reason', v_reason
  );
END;
$$;

COMMIT;
