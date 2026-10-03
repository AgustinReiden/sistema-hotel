-- ─────────────────────────────────────────────────────────────────────────────
-- 119: el check-out se puede cobrar en varios medios (efectivo + tarjeta, etc.).
--
-- POR QUE. Si un huesped paga una parte en efectivo y otra con tarjeta, hoy hay que
-- meter todo en un solo medio (y la caja no cuadra: el arqueo de efectivo espera
-- plata que nunca entro) o cobrar una parte suelta y despues hacer el check-out con
-- el resto, en dos pasos que pueden quedar a medias. Con esta funcion los pagos
-- entran en la MISMA transaccion que cierra la estadia: o entra todo o no entra
-- nada. No queda nunca un pago suelto de un check-out que fallo.
--
-- COMO. rpc_staff_checkout_split recibe de 2 a 4 pagos ({method, amount}). Valida
-- todo antes de tocar nada, inserta los N-1 primeros con la logica de
-- rpc_register_payment (staff, caja abierta, sin cuenta corriente ni vale blanco) y
-- cierra la estadia llamando a la RPC de check-out de siempre con el ultimo pago:
-- rpc_staff_checkout_reservation, o rpc_staff_early_checkout si p_early. Esa RPC
-- recalcula el saldo y exige que el ultimo pago lo deje exacto; si no da, se
-- deshace todo, incluidos los pagos ya insertados. Asi el calculo de la salida
-- anticipada (noches usadas, descuento, extras) sigue viviendo en un solo lugar.
-- Todos los pagos quedan con el mismo created_at (NOW() es el de la transaccion),
-- el mismo turno y el mismo usuario.
--
-- MENSAJES. En el check-out normal la suma se valida al principio contra el saldo
-- de hoy. En la salida anticipada el saldo lo recalcula rpc_staff_early_checkout,
-- que con los N-1 pagos ya cargados puede contestar "el huesped pago mas de lo que
-- corresponde" aunque el problema sea la suma de esta pantalla. Por eso esos dos
-- rechazos de la RPC vieja se traducen a un mensaje del cobro partido. La
-- traduccion depende del texto de la RPC vieja: si ese texto cambia, el error sale
-- con el mensaje viejo, pero se deshace todo igual.
--
-- QUEDA AFUERA (v1). La cuenta corriente no se combina con otros medios: fiar
-- cierra la estadia entera (mig 89). El vale blanco tampoco: es consumo interno y
-- cubre el total de una sola vez (mig 73). Un solo medio y la cuenta corriente
-- siguen por las RPC de siempre, que esta migracion NO toca.
--
-- OJO. Esta funcion llama a rpc_staff_checkout_reservation(uuid, numeric, text,
-- text) y a rpc_staff_early_checkout(uuid, numeric, text, text) por su firma. Si
-- alguna cambia de firma o deja de devolver payment_id, esta se rompe: revisarla
-- junto con cualquier migracion que las toque.
--
-- EXPORT DEL TURNO. rpc_shift_checkout_export toma UN medio por estadia para el CSV
-- del sistema de gestion. Elegia el ultimo pago del turno por created_at; con el
-- cobro partido todos los pagos tienen el mismo created_at y la eleccion quedaba al
-- azar. Ahora toma el de mayor monto (el medio principal), con created_at e id para
-- desempatar. Parte de la definicion de PROD del 03/10 (pg_get_functiondef, md5
-- f67f0abc1e645dae1f0ba88f12f9eb17); fuera del ORDER BY marcado con mig 119 el
-- cuerpo es el mismo. Misma firma: CREATE OR REPLACE conserva sus permisos. El
-- LATERAL "hist" (pagos de otros turnos) no cambia.
--
-- VUELTA ATRAS. DROP FUNCTION public.rpc_staff_checkout_split(uuid, jsonb, boolean)
-- y recrear rpc_shift_checkout_export con la definicion de PROD del 03/10 (ORDER BY
-- p.created_at DESC en el LATERAL "pay"), y borrar la fila de la 119 de
-- public.applied_migrations para que el registro no diga que esta aplicada. Los pagos
-- que ya se hayan cargado partidos quedan: son cobros reales.
--
-- Aplicar pasando el archivo entero a public.exec_ddl entre dollar-quotes (con una
-- marca que NO aparezca en este texto, por ejemplo la de la migracion): el archivo no
-- trae BEGIN ni COMMIT (exec_ddl corre todo en una sola transaccion) ni ; final.
-- Si PostgREST no ve la funcion nueva: NOTIFY pgrst, 'reload schema'.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Check-out cobrado en varios medios.
CREATE OR REPLACE FUNCTION public.rpc_staff_checkout_split(
  p_reservation_id uuid,
  p_payments jsonb,
  p_early boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_user_id UUID := auth.uid();
  v_early BOOLEAN := COALESCE(p_early, false);
  v_count INT;
  v_item JSONB;
  v_method TEXT;
  v_amount NUMERIC;
  v_methods TEXT[] := ARRAY[]::TEXT[];
  v_amounts NUMERIC[] := ARRAY[]::NUMERIC[];
  v_sum NUMERIC := 0;
  v_status public.reservation_status;
  v_total_price NUMERIC;
  v_paid_amount NUMERIC;
  v_shift_id UUID;
  v_payment_id UUID;
  v_payment_ids UUID[] := ARRAY[]::UUID[];
  v_result JSONB;
  v_msg TEXT;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  -- Forma de la lista: de 2 a 4 pagos. Uno solo va por el check-out de siempre.
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' THEN
    RAISE EXCEPTION 'Los pagos tienen que venir como una lista.' USING errcode = '22023';
  END IF;

  v_count := jsonb_array_length(p_payments);
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Para cobrar en varios medios hacen falta al menos 2 pagos. Con un solo medio, usá el check-out de siempre.'
      USING errcode = '22023';
  END IF;
  IF v_count > 4 THEN
    RAISE EXCEPTION 'Se puede cobrar en hasta 4 medios.' USING errcode = '22023';
  END IF;

  -- Cada pago: medio de la lista y monto > 0 con 2 decimales como maximo.
  FOR i IN 0 .. v_count - 1 LOOP
    v_item := p_payments -> i;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Cada pago tiene que traer el medio y el monto.' USING errcode = '22023';
    END IF;

    v_method := NULLIF(BTRIM(v_item ->> 'method'), '');
    IF v_method = 'cuenta_corriente' THEN
      RAISE EXCEPTION 'La cuenta corriente no se combina con otros medios: si la estadía se fía, el check-out se cierra solo con cuenta corriente.'
        USING errcode = '22023';
    END IF;
    IF v_method = 'vale_blanco' THEN
      RAISE EXCEPTION 'El vale blanco no se combina con otros medios: cubre el total de la estadía de una sola vez.'
        USING errcode = '22023';
    END IF;
    IF v_method IS NULL OR v_method NOT IN (
      'cash', 'credit_card', 'debit_card', 'bank_transfer', 'mercado_pago', 'other'
    ) THEN
      RAISE EXCEPTION 'Medio de pago inválido: %', COALESCE(v_method, '(vacío)') USING errcode = '22023';
    END IF;

    IF jsonb_typeof(v_item -> 'amount') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Cada pago tiene que tener un monto.' USING errcode = '22023';
    END IF;
    v_amount := (v_item ->> 'amount')::numeric;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Cada monto tiene que ser mayor a 0.' USING errcode = '22023';
    END IF;
    IF v_amount <> round(v_amount, 2) THEN
      RAISE EXCEPTION 'Los montos llevan como mucho 2 decimales (centavos).' USING errcode = '22023';
    END IF;

    v_methods := v_methods || v_method;
    v_amounts := v_amounts || v_amount;
    v_sum := v_sum + v_amount;
  END LOOP;

  -- La reserva, bloqueada hasta el final (la RPC de check-out la vuelve a pedir en
  -- la misma transaccion).
  SELECT status, total_price, paid_amount
  INTO v_status, v_total_price, v_paid_amount
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_status <> 'checked_in' THEN
    RAISE EXCEPTION 'Solo se pueden cerrar reservas en estado checked_in.' USING errcode = '22023';
  END IF;

  v_shift_id := public.app_current_open_shift();
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Debes abrir la caja antes de hacer un check-out.' USING errcode = 'P0003';
  END IF;

  -- Check-out normal: el saldo es el de hoy y se valida antes de insertar nada. En
  -- la salida anticipada el saldo lo recalcula rpc_staff_early_checkout (abajo).
  IF NOT v_early AND v_paid_amount + v_sum <> v_total_price THEN
    RAISE EXCEPTION 'La suma de los pagos no da justo el saldo de la estadía. Revisá los montos: no se cobró nada.'
      USING errcode = '22023';
  END IF;

  -- Los N-1 primeros pagos, con la logica de rpc_register_payment. Los triggers de
  -- payments (caja abierta, vale blanco) corren igual que en cualquier cobro.
  FOR i IN 1 .. v_count - 1 LOOP
    INSERT INTO public.payments (
      reservation_id, amount, payment_method, notes,
      created_at, created_by, cash_shift_id
    )
    VALUES (
      p_reservation_id, v_amounts[i], v_methods[i], NULL,
      v_now, v_user_id, v_shift_id
    )
    RETURNING id INTO v_payment_id;

    v_payment_ids := v_payment_ids || v_payment_id;
    v_paid_amount := v_paid_amount + v_amounts[i];
  END LOOP;

  UPDATE public.reservations
  SET paid_amount = v_paid_amount, updated_at = v_now
  WHERE id = p_reservation_id;

  -- El ultimo pago cierra la estadia por el camino de siempre. Si no deja el saldo
  -- exacto, la RPC rechaza y se deshace todo (tambien los pagos de arriba).
  BEGIN
    IF v_early THEN
      v_result := public.rpc_staff_early_checkout(
        p_reservation_id, v_amounts[v_count], v_methods[v_count], NULL
      );
    ELSE
      v_result := public.rpc_staff_checkout_reservation(
        p_reservation_id, v_amounts[v_count], v_methods[v_count], NULL
      );
    END IF;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_early AND v_msg LIKE 'El huesped pago mas de lo que corresponde%' THEN
      RAISE EXCEPTION 'Con la salida anticipada el total baja a las noches usadas y estos pagos lo superan. Revisá los montos contra el saldo recalculado: no se cobró nada. Si el huésped ya había pagado de más antes, esta salida la tiene que cerrar un administrador.'
        USING errcode = '22023';
    ELSIF v_early AND v_msg LIKE 'Solo se puede cobrar el saldo exacto pendiente%' THEN
      RAISE EXCEPTION 'La suma de los pagos no da justo el saldo recalculado de la salida anticipada. Revisá los montos: no se cobró nada.'
        USING errcode = '22023';
    END IF;
    RAISE;
  END;

  v_payment_ids := v_payment_ids || (v_result ->> 'payment_id')::uuid;

  RETURN v_result || jsonb_build_object(
    'payment_id', v_payment_ids[1],
    'payment_ids', to_jsonb(v_payment_ids),
    'movement_id', NULL,
    'split', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_staff_checkout_split(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_staff_checkout_split(uuid, jsonb, boolean) TO authenticated;

-- 2) Export del turno: el medio de la estadia es el pago de mayor monto del turno.
CREATE OR REPLACE FUNCTION public.rpc_shift_checkout_export(p_shift_id uuid)
 RETURNS TABLE(actual_check_out timestamp with time zone, client_name text, client_dni text, total_price numeric, payment_method text, shift_number integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.actual_check_out,
    r.client_name,
    r.client_dni,
    r.total_price,
    COALESCE(
      pay.payment_method,
      CASE WHEN cc.reservation_id IS NOT NULL THEN 'cuenta_corriente' END,
      hist.payment_method,
      'sin_cobro'
    ) AS payment_method,
    s.shift_number
  FROM public.reservations r
  JOIN public.cash_shifts s ON s.id = p_shift_id
  LEFT JOIN LATERAL (
    SELECT p.payment_method
    FROM public.payments p
    WHERE p.reservation_id = r.id
      AND p.cash_shift_id = p_shift_id
    ORDER BY p.amount DESC, p.created_at DESC, p.id  -- mig 119: el medio principal
    LIMIT 1
  ) pay ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.reservation_id
    FROM public.cuenta_corriente_movimientos m
    WHERE m.reservation_id = r.id
      AND m.tipo = 'cargo'
    ORDER BY m.created_at DESC
    LIMIT 1
  ) cc ON TRUE
  LEFT JOIN LATERAL (
    SELECT p.payment_method
    FROM public.payments p
    WHERE p.reservation_id = r.id
    ORDER BY p.created_at DESC
    LIMIT 1
  ) hist ON TRUE
  WHERE r.checkout_cash_shift_id = p_shift_id
    AND r.status = 'checked_out'
  ORDER BY r.actual_check_out;
END;
$function$;

-- 3) Registro
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('119_cobro_en_varios_medios.sql');
  END IF;
END
$do$
