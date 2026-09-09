-- Migration 95: las noches se cuentan por calendario, no por horas.
--
-- EL CASO REAL: la habitacion 15 sale 50.000 la noche. El 09/09 se cargo un walk-in de
-- UNA noche (JOSE BORJA) y quedo con 100.000 pendientes. La habitacion estaba bien
-- cargada y la pantalla de walk-in mostro 50.000; la base guardo 100.000.
--
-- LA CAUSA: app_calculate_reservation_pricing contaba las noches dividiendo la duracion
-- por 24 horas y redondeando para arriba:
--
--   v_nights := GREATEST(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400));
--
-- El huesped entro 09:20 y la salida quedo fijada a las 10:00 del dia siguiente (la hora
-- estandar del hotel). Eso son 24 h 40 min: 1,027 dias, que redondea a 2 noches.
--
-- LA REGLA DEL BUG: todo walk-in registrado ANTES de la hora de check-out (10:00) cobra
-- una noche de mas. Si el huesped entra a las 14:00 la cuenta da 20 h -> 1 noche y sale
-- bien. Por eso pasaba poco y parecia aleatorio. Ya habia pasado 4 veces (habitaciones
-- 15, 7, 9 y 16), siempre con entradas de madrugada o temprano a la manana.
--
-- EL SUPUESTO EQUIVOCADO: una noche de hotel es una noche de CALENDARIO, no un bloque de
-- 24 horas. Del 9 al 10 es una noche, se entre a las 6 de la manana o a las 11 de la
-- noche. La hora de entrada define el servicio, no la cantidad de noches.
--
-- EL ARREGLO: contar dias de calendario en la zona del hotel, igual que ya hace el front
-- en countHotelNights (src/lib/time.ts). Se conserva el minimo de 1 noche, asi que una
-- estadia que entra y sale el mismo dia sigue cobrando una noche. La siesta / media
-- estadia NO pasa por aca (va por half_day_price), no se toca.
--
-- Esta funcion es el UNICO punto donde se calcula el precio de una reserva: la usan el
-- walk-in, la reserva de mostrador, la reserva publica, la edicion de reserva y el cambio
-- de habitacion. Se arregla en un solo lugar.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig95$ ... $mig95$) SIN ;
-- final y SIN BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Noches de calendario en la zona del hotel.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_calculate_reservation_pricing(
  p_room_id integer,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_associated_client_id uuid DEFAULT NULL,
  p_discount_percent numeric DEFAULT NULL
)
RETURNS TABLE(
  base_total_price numeric,
  discount_percent numeric,
  discount_amount numeric,
  final_total_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_room_base_price numeric := 0;
  v_nights int := 1;
  v_discount_percent numeric := 0;
  v_tz text := 'UTC';
BEGIN
  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'La fecha de salida debe ser posterior a la fecha de entrada.' USING errcode = '22023';
  END IF;

  SELECT base_price
  INTO v_room_base_price
  FROM public.rooms
  WHERE id = p_room_id;

  IF v_room_base_price IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;

  IF p_discount_percent IS NOT NULL THEN
    v_discount_percent := p_discount_percent;
  ELSIF p_associated_client_id IS NOT NULL THEN
    SELECT ac.discount_percent
    INTO v_discount_percent
    FROM public.associated_clients ac
    WHERE ac.id = p_associated_client_id
      AND ac.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa/Convenio no encontrado o inactivo.' USING errcode = 'P0002';
    END IF;
  ELSE
    v_discount_percent := 0;
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz
  FROM public.hotel_settings ORDER BY id LIMIT 1;
  v_tz := COALESCE(v_tz, 'UTC');

  -- Noches de CALENDARIO en la zona del hotel: del 9 al 10 es una noche, entre a las
  -- 06:00 o a las 23:00. El minimo de 1 cubre la estadia que entra y sale el mismo dia.
  v_nights := GREATEST(1, (
    (p_check_out AT TIME ZONE v_tz)::date - (p_check_in AT TIME ZONE v_tz)::date
  ));

  base_total_price := round((v_nights * COALESCE(v_room_base_price, 0))::numeric, 2);
  discount_percent := round(COALESCE(v_discount_percent, 0)::numeric, 2);
  discount_amount := round((base_total_price * discount_percent / 100)::numeric, 2);
  final_total_price := round((base_total_price - discount_amount)::numeric, 2);

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_calculate_reservation_pricing(int, timestamptz, timestamptz, uuid, numeric) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Corregir las reservas ABIERTAS que quedaron con una noche de mas.
--
--    Como se reconoce una reserva mal tarifada: su base_total_price es EXACTAMENTE
--    las noches que cobro la formula vieja por la tarifa de la habitacion. Esa
--    firma es la que se corrige, y se reemplaza por noches_reales * tarifa.
--
--    Anclar en la tarifa (y no en dividir base_total_price por las noches) es lo
--    que hace este UPDATE IDEMPOTENTE: una vez corregida, la reserva ya no tiene
--    la firma y volver a correr la migracion no la vuelve a tocar. Si se dividiera,
--    una segunda corrida bajaria 50.000 a 25.000.
--
--    Efecto lateral querido: si la tarifa de la habitacion cambio despues de crear
--    la reserva, la firma no coincide y la reserva NO se toca. La tarifa congelada
--    manda (mig 69); esos casos se resuelven a mano.
--
--    Tres candados mas, porque esto toca plata:
--      a) solo reservas sin cerrar (confirmed / checked_in): las ya facturadas y
--         cobradas no se tocan por migracion.
--      b) solo si las noches reales son MENOS que las cobradas: nunca sube un precio.
--      c) solo si el total nuevo sigue cubriendo lo ya pagado: nunca deja una
--         reserva en sobrepago silencioso.
--    Los recargos que no son base (minibar, danos, medio dia) se preservan.
--
--    Al aplicarse alcanzo a UNA reserva: la 15, JOSE BORJA (100.000 -> 50.000).
-- ─────────────────────────────────────────────────────────────────────────────
WITH cfg AS (
  SELECT COALESCE(timezone, 'UTC') AS tz FROM public.hotel_settings ORDER BY id LIMIT 1
),
recalculo AS (
  SELECT
    r.id,
    r.paid_amount,
    -- Recargos que no son base: se preservan tal cual.
    round((r.total_price - (r.base_total_price - COALESCE(r.discount_amount, 0)))::numeric, 2) AS extras,
    round((
      GREATEST(1, ((r.check_out_target AT TIME ZONE c.tz)::date - (r.check_in_target AT TIME ZONE c.tz)::date))::int
      * ro.base_price
    )::numeric, 2) AS nueva_base,
    round((
      GREATEST(1, ((r.check_out_target AT TIME ZONE c.tz)::date - (r.check_in_target AT TIME ZONE c.tz)::date))::int
      * ro.base_price * COALESCE(r.discount_percent, 0) / 100
    )::numeric, 2) AS nuevo_descuento
  FROM public.reservations r
  JOIN public.rooms ro ON ro.id = r.room_id
  CROSS JOIN cfg c
  WHERE r.status IN ('confirmed', 'checked_in')                                   -- candado (a)
    -- Firma de la reserva mal tarifada: se le cobro la cuenta vieja de horas/24.
    AND r.base_total_price = round((
          GREATEST(1, ceil(extract(epoch from (r.check_out_target - r.check_in_target)) / 86400))::int
          * ro.base_price
        )::numeric, 2)
    -- ...y esa cuenta dio mas noches que el calendario.                            candado (b)
    AND GREATEST(1, ((r.check_out_target AT TIME ZONE c.tz)::date - (r.check_in_target AT TIME ZONE c.tz)::date))::int
        < GREATEST(1, ceil(extract(epoch from (r.check_out_target - r.check_in_target)) / 86400))::int
)
UPDATE public.reservations r
SET base_total_price = x.nueva_base,
    discount_amount  = x.nuevo_descuento,
    total_price      = round(x.nueva_base - x.nuevo_descuento + x.extras, 2),
    updated_at       = now()
FROM recalculo x
WHERE r.id = x.id
  AND round(x.nueva_base - x.nuevo_descuento + x.extras, 2) >= COALESCE(x.paid_amount, 0);  -- candado (c)

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('95_noches_de_calendario_no_de_horas.sql');
  END IF;
END $$;

COMMIT;
