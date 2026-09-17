-- Migration 104: El medio dia no se puede vender encima de otra reserva.
--
-- EL AGUJERO. rpc_staff_apply_late_checkout (vigente desde la mig 56) es la unica
-- de las cuatro funciones que extienden una estadia que NO chequea solapamiento.
-- Y no es un olvido facil de ver: es que el medio dia NO mueve check_out_target,
-- solo mueve late_check_out_until. El candado real del hotel es
--
--   reservations_no_active_overlap  EXCLUDE USING gist (
--     room_id WITH =, tstzrange(check_in_target, check_out_target, '[)') WITH &&)
--
-- (mig 03), que mira check_out_target. Entonces la tarde vendida hasta las 18:00
-- es invisible para el constraint: se cobra el medio dia sobre una pieza que ya
-- tiene otro pasajero entrando a las 12:00 de ese mismo dia, y nadie se entera
-- hasta que el que llega esta parado en el mostrador y su check-in falla con
-- 'La habitacion esta ocupada por otro huesped' (mig 87/88).
--
-- EL ARREGLO. Un EXISTS antes de cobrar, con el mismo idioma de solapamiento que
-- ya usa el pre-chequeo de rpc_extend_reservation (mig 101): media abierta a
-- derecha, o.check_in_target < fin AND o.check_out_target > inicio, sobre los
-- estados que el constraint considera activos.
--
-- POR QUE VA ANTES DEL INSERT. El INSERT es ON CONFLICT DO NOTHING contra el
-- indice parcial extra_charges_one_half_day_per_reservation. Si el guard fuera
-- despues, un segundo click sobre una reserva que ya tiene el medio dia cobrado
-- no insertaria nada y el error nunca saldria: el conflicto quedaria enmascarado
-- por la idempotencia.
--
-- POR QUE EL GUARD SE SALTEA SI NO SE EXTIENDE NADA. Si late_check_out_until ya
-- llega hasta v_late_until, esta llamada no ocupa ni un minuto mas de la pieza,
-- asi que no puede crear un conflicto nuevo. Sin esta salvedad, apretar el boton
-- dos veces pasaria de "no vuelve a cobrar" a "explota", que es peor que el bug.
--
-- LIMITE CONOCIDO, A PROPOSITO. El guard es de una sola direccion: impide vender
-- el medio dia cuando el que llega ya existe. No impide el orden inverso (vender
-- el medio dia y despues cargar una reserva que entra esa tarde), porque para eso
-- habria que meter late_check_out_until en el EXCLUDE y tocar las cinco funciones
-- que crean o mueven reservas. En la practica el medio dia se cobra la manana de
-- la salida, cuando la reserva que llega ya esta cargada, que es el caso real.
--
-- Se re-crea con la misma firma (p_reservation_id uuid) -> CREATE OR REPLACE, sin DROP.
-- Aplicar a PROD via select public.exec_ddl($MIG$ ... $MIG$) SIN ; final y SIN BEGIN/COMMIT.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_staff_apply_late_checkout(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_room_id int;
  v_room_number text;
  v_status public.reservation_status;
  v_current_checkout timestamptz;
  v_current_late timestamptz;
  v_late_until timestamptz;
  v_late_time time := '18:00'::time;
  v_half_day_price numeric(10, 2) := 0;
  v_inserted_rows int := 0;
  v_tz text := 'America/Argentina/Tucuman';
  v_blocker_name text;
  v_blocker_in timestamptz;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.room_id, ro.room_number, r.status, r.check_out_target, r.late_check_out_until,
         COALESCE(ro.half_day_price, 0)
  INTO v_room_id, v_room_number, v_status, v_current_checkout, v_current_late, v_half_day_price
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  WHERE r.id = p_reservation_id
  FOR UPDATE OF r;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se puede aplicar medio dia sobre reservas checked_in.' USING errcode = '22023';
  END IF;

  SELECT late_check_out_time, COALESCE(timezone, 'America/Argentina/Tucuman')
  INTO v_late_time, v_tz
  FROM public.hotel_settings
  ORDER BY id
  LIMIT 1;

  v_late_until := ((((v_current_checkout AT TIME ZONE v_tz)::date) + v_late_time) AT TIME ZONE v_tz);
  IF v_late_until < v_current_checkout THEN
    v_late_until := v_current_checkout;
  END IF;

  -- Guard de solapamiento. Solo cuando esta llamada realmente estira la ocupacion:
  -- si late_check_out_until ya cubre v_late_until, no hay minuto nuevo que pisar.
  IF v_current_late IS NULL OR v_current_late < v_late_until THEN
    SELECT COALESCE(g.full_name, ac.display_name, o.client_name, 'otra reserva'), o.check_in_target
    INTO v_blocker_name, v_blocker_in
    FROM public.reservations o
    LEFT JOIN public.guests g ON g.id = o.guest_id
    LEFT JOIN public.associated_clients ac ON ac.id = o.associated_client_id
    WHERE o.room_id = v_room_id
      AND o.id <> p_reservation_id
      AND o.status IN ('pending', 'confirmed', 'checked_in')
      AND o.check_in_target < v_late_until
      AND o.check_out_target > v_current_checkout
    ORDER BY o.check_in_target
    LIMIT 1;

    IF v_blocker_name IS NOT NULL THEN
      RAISE EXCEPTION
        'No se puede cobrar el medio dia en la Hab. %: entra % el %. Mudalo de habitacion o cobrale la noche completa.',
        v_room_number,
        v_blocker_name,
        to_char(v_blocker_in AT TIME ZONE v_tz, 'DD/MM HH24:MI')
        USING errcode = 'P0001';
    END IF;
  END IF;

  IF v_half_day_price > 0 THEN
    INSERT INTO public.extra_charges (
      reservation_id,
      charge_type,
      amount,
      description
    )
    VALUES (
      p_reservation_id,
      'half_day',
      v_half_day_price,
      'Penalizacion por Check-out tardio (Medio Dia)'
    )
    ON CONFLICT (reservation_id, charge_type) WHERE charge_type = 'half_day'
    DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  END IF;

  UPDATE public.reservations
  SET late_check_out_until = v_late_until,
      total_price = CASE
        WHEN v_inserted_rows > 0 THEN total_price + v_half_day_price
        ELSE total_price
      END,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'check_out_target', v_current_checkout,
    'late_check_out_until', v_late_until,
    'half_day_amount', v_half_day_price,
    'half_day_charged', (v_inserted_rows > 0)
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'No se puede aplicar late check-out.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_staff_apply_late_checkout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_staff_apply_late_checkout(uuid) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('104_medio_dia_no_se_vende_encima_de_otra_reserva.sql');
  END IF;
END $$;

COMMIT;
