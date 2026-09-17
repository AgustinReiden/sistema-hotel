-- Migration 102: cancelar una reserva ya tomada pasa a ser cosa del admin.
--
-- POR QUE: cancelar es la unica accion de mostrador que borra plata y libera una
-- habitacion de una sola vez, sin dejar nada que cobrar ni nadie a quien preguntarle.
-- Sobre una reserva confirmada o con el pasajero adentro, el ajuste contable de este
-- mismo RPC baja total_price a lo ya pagado: la diferencia deja de existir y nadie se
-- entera. Es la clase de error que no se puede deshacer desde la pantalla.
--
-- QUE CAMBIA: una sola guarda nueva en rpc_cancel_reservation. Recepcion conserva el
-- rechazo de una solicitud web todavia en 'pending' (no toca caja, no toca habitacion,
-- y es el trabajo normal de /admin/solicitudes). Cualquier otro estado -- confirmed,
-- checked_in, checked_out -- pide admin.
--
-- QUE NO CAMBIA: el cuerpo de la cancelacion es identico al de la mig 71 (auditoria en
-- reservation_cancellations, habitacion a 'cleaning' si estaba ocupada, ajuste contable
-- solo para las no cerradas). Esto es un portero nuevo, no una regla nueva.
--
-- La UI esconde el boton para recepcion, pero la guarda vive aca: la pantalla se puede
-- saltear, el RPC no.
--
-- Aplicar a PROD via select public.exec_ddl($mig102$ ... $mig102$) SIN ; final y SIN
-- BEGIN/COMMIT.

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

  -- Guarda nueva de la mig 102. Va DESPUES del SELECT porque depende del estado:
  -- rechazar una solicitud pendiente sigue siendo de recepcion, cancelar una reserva
  -- ya tomada es del admin.
  IF v_status <> 'pending' AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cancelar una reserva confirmada. Avisale al admin.'
      USING errcode = '42501';
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

  -- Al cancelar una estadía en curso la habitación pasa a limpieza, como
  -- cualquier otra salida de huésped (antes quedaba 'available' sin limpiar).
  IF v_status = 'checked_in' THEN
    UPDATE public.rooms
    SET status = 'cleaning'
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

REVOKE ALL ON FUNCTION public.rpc_cancel_reservation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_reservation(uuid, text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('102_cancelar_reserva_solo_admin.sql');
  END IF;
END $$;

COMMIT;
