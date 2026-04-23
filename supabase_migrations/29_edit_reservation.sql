-- Migration 29: Editar reservas activas
--
-- Permite modificar datos del huesped (nombre, DNI, telefono, notas) y fechas
-- de una reserva en estado pending/confirmed/checked_in. Si cambian las fechas,
-- recalcula el precio usando app_calculate_reservation_pricing (respetando
-- descuentos de clientes asociados). Solo un admin puede sobreescribir
-- total_price manualmente.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_update_reservation(
  p_reservation_id UUID,
  p_client_name TEXT,
  p_client_dni TEXT,
  p_client_phone TEXT,
  p_check_in TIMESTAMPTZ,
  p_check_out TIMESTAMPTZ,
  p_notes TEXT,
  p_override_total_price NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_room_id INT;
  v_status public.reservation_status;
  v_associated_id UUID;
  v_paid_amount NUMERIC;
  v_old_check_in TIMESTAMPTZ;
  v_old_check_out TIMESTAMPTZ;
  v_client_name TEXT := NULLIF(BTRIM(p_client_name), '');
  v_client_dni TEXT := NULLIF(BTRIM(p_client_dni), '');
  v_client_phone TEXT := NULLIF(BTRIM(p_client_phone), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_base_total NUMERIC;
  v_discount_percent NUMERIC;
  v_discount_amount NUMERIC;
  v_final_total NUMERIC;
  v_dates_changed BOOLEAN;
  v_is_admin BOOLEAN := public.app_is_admin();
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_client_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del huesped es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Las fechas son obligatorias.' USING errcode = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la de entrada.' USING errcode = '22023';
  END IF;

  SELECT room_id, status, associated_client_id, paid_amount, check_in_target, check_out_target
  INTO v_room_id, v_status, v_associated_id, v_paid_amount, v_old_check_in, v_old_check_out
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status IN ('checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'No se puede editar una reserva finalizada o cancelada.' USING errcode = '22023';
  END IF;

  v_dates_changed := (p_check_in <> v_old_check_in) OR (p_check_out <> v_old_check_out);

  -- Si hay override de precio, solo admin lo puede hacer.
  IF p_override_total_price IS NOT NULL THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Solo un admin puede sobreescribir el precio total.' USING errcode = '42501';
    END IF;
    IF p_override_total_price < 0 THEN
      RAISE EXCEPTION 'El precio total no puede ser negativo.' USING errcode = '22023';
    END IF;
    IF p_override_total_price < v_paid_amount THEN
      RAISE EXCEPTION 'El total no puede ser menor al monto ya pagado.' USING errcode = '22023';
    END IF;

    -- Mantenemos base_total con el valor anterior recalculado (o el mismo si no cambiaron fechas)
    IF v_dates_changed THEN
      SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount
      INTO v_base_total, v_discount_percent, v_discount_amount
      FROM public.app_calculate_reservation_pricing(
        v_room_id, p_check_in, p_check_out, v_associated_id
      ) AS pricing;
    ELSE
      SELECT base_total_price, discount_percent, discount_amount
      INTO v_base_total, v_discount_percent, v_discount_amount
      FROM public.reservations
      WHERE id = p_reservation_id;
    END IF;

    v_final_total := p_override_total_price;
  ELSIF v_dates_changed THEN
    -- Sin override y con fechas nuevas: recalcular todo desde pricing helper.
    SELECT pricing.base_total_price, pricing.discount_percent, pricing.discount_amount, pricing.final_total_price
    INTO v_base_total, v_discount_percent, v_discount_amount, v_final_total
    FROM public.app_calculate_reservation_pricing(
      v_room_id, p_check_in, p_check_out, v_associated_id
    ) AS pricing;

    IF v_final_total < v_paid_amount THEN
      RAISE EXCEPTION 'El nuevo total calculado es menor al monto ya pagado. Cancela y reemiti la reserva.' USING errcode = '22023';
    END IF;
  ELSE
    -- Sin override y sin cambio de fechas: no tocar precios.
    SELECT base_total_price, discount_percent, discount_amount, total_price
    INTO v_base_total, v_discount_percent, v_discount_amount, v_final_total
    FROM public.reservations
    WHERE id = p_reservation_id;
  END IF;

  UPDATE public.reservations
  SET client_name = v_client_name,
      client_dni = v_client_dni,
      client_phone = v_client_phone,
      notes = v_notes,
      check_in_target = p_check_in,
      check_out_target = p_check_out,
      base_total_price = v_base_total,
      discount_percent = v_discount_percent,
      discount_amount = v_discount_amount,
      total_price = v_final_total,
      updated_at = v_now
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'dates_changed', v_dates_changed,
    'price_overridden', (p_override_total_price IS NOT NULL),
    'base_total_price', v_base_total,
    'discount_percent', v_discount_percent,
    'discount_amount', v_discount_amount,
    'total_price', v_final_total
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Las nuevas fechas se solapan con otra reserva activa en esta habitacion.' USING errcode = '23P01';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_update_reservation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_update_reservation(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, NUMERIC) TO authenticated;

COMMIT;
