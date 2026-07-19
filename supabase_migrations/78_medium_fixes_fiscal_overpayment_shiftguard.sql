-- Migration 78: Fixes de severidad media B4 + B5 + B6 (auditoría 2026-07-18)
--
-- B4: no se puede habilitar la facturación sin domicilio fiscal, inicio de
--     actividades ni IIBB (datos formales del emisor exigidos por RG 1415).
-- B5: alertar (no bloquear) cuando un cambio de habitación deja el total por
--     debajo de lo ya pagado (saldo a favor del huésped).
-- B6: cerrar la carrera cobro/cierre de caja: un pago no puede quedar en un turno
--     que ya se cerró.
--
-- Nota de implementación: B5 y B6 se resuelven con TRIGGERS acotados en vez de
-- reescribir las funciones grandes (rpc_change_reservation_room y los 3 RPC de
-- cobro). Es equivalente, cubre TODO INSERT/UPDATE por cualquier RPC presente o
-- futuro, y evita el riesgo de reproducir a mano ~150 líneas de plpgsql crítico.
--   · B6: la auditoría ya sugería "un CHECK/trigger que rechace el INSERT en
--     payments cuando el turno no esté 'open'".
--   · B5: el trigger dispara sólo cuando el total BAJA por debajo de lo pagado;
--     los otros caminos (edición, early checkout) ya bloquean ese estado, así que
--     en la práctica sólo lo genera el cambio de habitación.
--
-- Orden de locks (B6): el INSERT del pago ocurre siempre después del
-- `SELECT ... FOR UPDATE` de la reserva (register_payment / checkout), y el trigger
-- toma luego `cash_shifts FOR UPDATE`. rpc_close_cash_shift sólo lockea cash_shifts
-- (su chequeo de bloqueos es un SELECT sin lock) → orden uniforme reservations →
-- cash_shifts, sin ciclo, sin deadlock.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ … $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Verificar después con SELECTs.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- B4) fiscal_settings: exigir domicilio fiscal + inicio de actividades + IIBB al
--     habilitar. PROD tiene enabled=false + campos cargados → el ADD es seguro.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fiscal_settings
  DROP CONSTRAINT IF EXISTS fiscal_settings_complete_when_enabled;

ALTER TABLE public.fiscal_settings
  ADD CONSTRAINT fiscal_settings_complete_when_enabled CHECK (
    NOT enabled OR (
      cuit IS NOT NULL
      AND razon_social IS NOT NULL
      AND punto_venta IS NOT NULL
      AND domicilio_fiscal IS NOT NULL AND btrim(domicilio_fiscal) <> ''
      AND inicio_actividades IS NOT NULL
      AND iibb IS NOT NULL AND btrim(iibb) <> ''   -- número / "Exento" / "No corresponde"
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- B5) Alerta de saldo a favor cuando el total baja por debajo de lo pagado.
--     AFTER UPDATE OF total_price, sólo cuando el nuevo total < pagado y < total
--     anterior (= el downgrade de un cambio de habitación con prepago).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_flag_reservation_overpayment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diff NUMERIC;
BEGIN
  v_diff := round((COALESCE(NEW.paid_amount, 0) - NEW.total_price)::numeric, 2);

  -- Evitar spam: una sola alerta abierta por reserva.
  IF EXISTS (
    SELECT 1 FROM public.admin_alerts
    WHERE kind = 'reservation_overpayment'
      AND related_reservation_id = NEW.id
      AND resolved_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_alerts (kind, message, related_room_id, related_reservation_id, payload)
  VALUES (
    'reservation_overpayment',
    format(
      'La reserva quedó con saldo a favor del huésped: pagó $%s y el total bajó a $%s (diferencia $%s). Revisá si corresponde reembolso o ajuste.',
      round(COALESCE(NEW.paid_amount, 0))::bigint,
      round(NEW.total_price)::bigint,
      round(v_diff)::bigint
    ),
    NEW.room_id,
    NEW.id,
    jsonb_build_object(
      'old_total_price', OLD.total_price,
      'new_total_price', NEW.total_price,
      'paid_amount', NEW.paid_amount,
      'diff', v_diff
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_overpayment ON public.reservations;
CREATE TRIGGER trg_reservation_overpayment
  AFTER UPDATE OF total_price ON public.reservations
  FOR EACH ROW
  WHEN (NEW.total_price < COALESCE(NEW.paid_amount, 0) AND NEW.total_price < OLD.total_price)
  EXECUTE FUNCTION public.app_flag_reservation_overpayment();

-- ─────────────────────────────────────────────────────────────────────────────
-- B6) Un pago no puede insertarse contra un turno que no esté 'open'. El
--     FOR UPDATE serializa contra el FOR UPDATE del cierre (rpc_close_cash_shift).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_payment_requires_open_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NEW.cash_shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM public.cash_shifts
  WHERE id = NEW.cash_shift_id
  FOR UPDATE;

  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'La caja se cerró. Volvé a intentar el cobro.' USING errcode = 'P0003';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_requires_open_shift ON public.payments;
CREATE TRIGGER trg_payment_requires_open_shift
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.app_payment_requires_open_shift();

COMMIT;

-- Verificación post-aplicación:
--   -- B4: debe fallar (constraint) —
--   -- UPDATE public.fiscal_settings SET enabled=true, domicilio_fiscal=NULL WHERE id=1;
--   -- B5/B6: triggers presentes —
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--    WHERE tgname IN ('trg_reservation_overpayment','trg_payment_requires_open_shift');
--   SELECT conname FROM pg_constraint WHERE conname='fiscal_settings_complete_when_enabled';
