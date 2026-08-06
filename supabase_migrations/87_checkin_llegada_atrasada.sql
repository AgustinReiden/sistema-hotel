-- Migration 87: guardas de fecha y de ocupación en el check-in
--
-- Contexto: la recepción sólo veía la reserva el día exacto de la entrada. Si el
-- pasajero llegaba de noche y el check-in quedaba para el día siguiente, la
-- reserva desaparecía del dashboard y la habitación figuraba libre. La corrección
-- de UI (dashboard + calendario) mantiene la llegada visible mientras la estadía
-- corra; esta migración pone las guardas equivalentes del lado del servidor.
--
-- El RPC hoy acepta cualquier reserva pending/confirmed sin mirar fechas ni si la
-- habitación ya está ocupada por otro huésped. Se agregan tres validaciones:
--   1) la estadía no puede estar vencida (no-show viejo que nadie canceló),
--   2) la entrada no puede ser de un día futuro (check-in adelantado por error),
--   3) la habitación no puede estar ocupada por otra estadía en curso
--      (dejaría dos reservas 'checked_in' sobre la misma habitación).
-- Las guardas de limpieza y mantenimiento de la migración 39 se conservan.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_staff_checkin_reservation(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_room_id int;
  v_status public.reservation_status;
  v_check_in_target timestamptz;
  v_check_out_target timestamptz;
  v_room_status public.room_status;
  v_tz text := 'UTC';
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT room_id, status, check_in_target, check_out_target
  INTO v_room_id, v_status, v_check_in_target, v_check_out_target
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Solo se puede hacer check-in de reservas pendientes o confirmadas.' USING errcode = '22023';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  -- La estadía ya terminó: el pasajero nunca llegó. Corresponde cancelarla o
  -- cargar una reserva nueva, no revivir la vieja.
  IF v_check_out_target <= v_now THEN
    RAISE EXCEPTION 'La reserva ya vencio: la salida estaba prevista para el %.',
      to_char(v_check_out_target AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI')
      USING errcode = '22023';
  END IF;

  -- Entrada de un día posterior: no se adelanta el check-in. Se compara por día
  -- del hotel para que una llegada temprana (antes del horario estándar) entre.
  IF (v_check_in_target AT TIME ZONE v_tz)::date > (v_now AT TIME ZONE v_tz)::date THEN
    RAISE EXCEPTION 'La entrada de esta reserva es el %. No se puede adelantar el check-in.',
      to_char(v_check_in_target AT TIME ZONE v_tz, 'DD/MM/YYYY')
      USING errcode = '22023';
  END IF;

  SELECT status INTO v_room_status FROM public.rooms WHERE id = v_room_id;

  IF v_room_status = 'cleaning' THEN
    RAISE EXCEPTION 'La habitacion todavia no fue habilitada por mantenimiento.' USING errcode = '22023';
  END IF;
  IF v_room_status = 'maintenance' THEN
    RAISE EXCEPTION 'La habitacion esta fuera de servicio por mantenimiento.' USING errcode = '22023';
  END IF;

  -- Ocupada por otra estadía en curso: primero el check-out del anterior.
  IF EXISTS (
    SELECT 1
    FROM public.reservations r
    WHERE r.room_id = v_room_id
      AND r.status = 'checked_in'
      AND r.id <> p_reservation_id
  ) THEN
    RAISE EXCEPTION 'La habitacion esta ocupada por otro huesped. Hace el check-out anterior primero.' USING errcode = '22023';
  END IF;

  UPDATE public.reservations
  SET status = 'checked_in',
      actual_check_in = v_now,
      updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.rooms
  SET status = 'occupied'
  WHERE id = v_room_id;
END;
$$;

COMMIT;
