-- Migration 76: Escrituras de reservas vía RPC (prerequisito del cierre de escritura directa)
-- Auditoría 2026-07-18 · hallazgo H-01
--
-- La app usa SOLO la anon key + RLS. Hoy `reservations` tiene policies de INSERT/UPDATE que
-- solo piden app_is_staff(), y anon/authenticated tienen GRANT de DML por default de Supabase:
-- un recepcionista puede pegarle a PostgREST directo y editar cualquier reserva (bajar
-- total_price antes de facturar, o marcar checked_out/pagada sin que entre efectivo a la caja).
-- El fix (migración 77) revoca la escritura directa y fuerza TODA mutación por RPC.
--
-- Antes de revocar hay que dar RPC a los DOS únicos writes directos que la app hace hoy a
-- reservations (src/lib/data.ts): "ampliar reserva" (re-tarifa) y el flag whatsapp_notified.
-- payments y cash_shifts ya no tienen escrituras directas en la app (solo RPC).
--
-- Estas RPC replican EXACTAMENTE la lógica actual: NO cambian montos ni comportamiento, solo
-- mueven la escritura detrás de un procedimiento SECURITY DEFINER que valida rol y estado.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ ... $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT (ver reference-supabase-mcp). Verificar en homologación.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) rpc_extend_reservation: "ampliar" una reserva activa N noches (staff, igual que hoy).
--    Preserva la tarifa congelada y los recargos: recalcula la base con la tarifa/noche
--    EXISTENTE de la reserva, no re-tarifa contra el maestro (así no borra recargos ni deja
--    fijar un total arbitrario). Espeja src/lib/data.ts:extendReservation línea por línea.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_extend_reservation(
  p_reservation_id UUID,
  p_extra_nights INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.reservations%ROWTYPE;
  v_existing_nights NUMERIC;
  v_net_base NUMERIC;
  v_surcharges NUMERIC;
  v_nightly_base NUMERIC;
  v_new_base NUMERIC;
  v_new_discount NUMERIC;
  v_new_total NUMERIC;
  v_new_out TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_extra_nights IS NULL OR p_extra_nights <= 0 THEN
    RAISE EXCEPTION 'Debe agregar al menos 1 noche.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_r FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  -- Guard de estado (la UI solo ofrece "Ampliar" en reservas activas; no dependemos del render).
  IF v_r.status NOT IN ('confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'Solo se puede ampliar una reserva activa (confirmada o en estadía).'
      USING errcode = 'P0001';
  END IF;

  v_new_out := v_r.check_out_target + make_interval(days => p_extra_nights);

  -- Solapamiento con otra reserva activa en la misma habitación sobre el tramo agregado
  -- (misma semántica que el constraint reservations_no_active_overlap).
  IF EXISTS (
    SELECT 1 FROM public.reservations o
    WHERE o.room_id = v_r.room_id
      AND o.id <> v_r.id
      AND o.status IN ('pending', 'confirmed', 'checked_in')
      AND o.check_in_target < v_new_out
      AND o.check_out_target > v_r.check_out_target
  ) THEN
    RAISE EXCEPTION 'No se puede ampliar la reserva porque la habitación ya está comprometida para esas fechas.'
      USING errcode = 'P0001';
  END IF;

  -- Recalcular preservando tarifa congelada + recargos (espeja data.ts:1735-1753):
  --  recargos = total_price - (base - descuento);  base nueva = base + noches_extra * (base/noches).
  v_existing_nights := GREATEST(1, round(extract(epoch FROM (v_r.check_out_target - v_r.check_in_target)) / 86400));
  v_net_base   := COALESCE(v_r.base_total_price, v_r.total_price) - COALESCE(v_r.discount_amount, 0);
  v_surcharges := GREATEST(0, round((v_r.total_price - v_net_base)::numeric, 2));
  v_nightly_base := COALESCE(v_r.base_total_price, v_r.total_price) / v_existing_nights;
  v_new_base   := COALESCE(v_r.base_total_price, v_r.total_price) + p_extra_nights * v_nightly_base;
  v_new_discount := round((v_new_base * COALESCE(v_r.discount_percent, 0) / 100)::numeric, 2);
  v_new_total  := v_new_base - v_new_discount + v_surcharges;

  BEGIN
    UPDATE public.reservations
    SET check_out_target = v_new_out,
        base_total_price = v_new_base,
        discount_percent = COALESCE(v_r.discount_percent, 0),
        discount_amount  = v_new_discount,
        total_price      = v_new_total,
        -- Ampliar mueve el checkout hacia adelante: un late-checkout viejo deja de valer,
        -- si no el tablero marca un falso "Retraso Check-out".
        late_check_out_until = NULL,
        updated_at = NOW()
    WHERE id = p_reservation_id;
  EXCEPTION WHEN exclusion_violation THEN
    -- Carrera con el constraint anti-solapamiento: mensaje claro en vez del error crudo.
    RAISE EXCEPTION 'No se puede ampliar: la habitación quedó comprometida para esas fechas.'
      USING errcode = 'P0001';
  END;

  RETURN jsonb_build_object('ok', TRUE, 'new_total', v_new_total, 'check_out_target', v_new_out);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_extend_reservation(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_extend_reservation(UUID, INT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) rpc_set_whatsapp_notified: marca el flag whatsapp_notified de una reserva (staff).
--    Espeja src/lib/data.ts:updateWhatsappStatus.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_set_whatsapp_notified(
  p_reservation_id UUID,
  p_notified BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  UPDATE public.reservations
  SET whatsapp_notified = COALESCE(p_notified, FALSE),
      updated_at = NOW()
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_set_whatsapp_notified(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_whatsapp_notified(UUID, BOOLEAN) TO authenticated;

COMMIT;
