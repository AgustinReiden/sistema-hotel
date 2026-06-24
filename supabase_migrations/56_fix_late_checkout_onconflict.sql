-- Migration 56: Fix "Ampliar Reserva -> Medio dia" / "Cobrar Medio Dia"
--
-- Bug: rpc_staff_apply_late_checkout hacia
--   INSERT ... ON CONFLICT (reservation_id, charge_type) DO NOTHING
-- pero el unico indice unico que cubre esas columnas es PARCIAL
--   (extra_charges_one_half_day_per_reservation ... WHERE charge_type = 'half_day').
-- Postgres no puede inferir un indice parcial sin repetir el predicado, por lo que
-- lanzaba: "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" y no dejaba aplicar el medio dia.
--
-- Fix: agregar el predicado WHERE charge_type = 'half_day' a la clausula ON CONFLICT
-- para que matchee el indice parcial existente. No se toca el indice (es intencional:
-- un solo medio dia por reserva, pero N cargos de otros tipos).
-- Se re-crea con la misma firma (p_reservation_id uuid) -> CREATE OR REPLACE, sin DROP.

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
  v_status public.reservation_status;
  v_current_checkout timestamptz;
  v_late_until timestamptz;
  v_late_time time := '18:00'::time;
  v_half_day_price numeric(10, 2) := 0;
  v_inserted_rows int := 0;
  v_tz text := 'America/Argentina/Tucuman';
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT r.room_id, r.status, r.check_out_target, COALESCE(ro.half_day_price, 0)
  INTO v_room_id, v_status, v_current_checkout, v_half_day_price
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

COMMIT;
