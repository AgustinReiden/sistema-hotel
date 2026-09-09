-- Migration 97: guardas de base para pagos y tablas fiscales.
--
-- Auditoria de codigo 2026-09-09, fase 3 (M-4, M-5, M-6, M-7b). Son cuatro guardas
-- independientes: ninguna arregla un bug que este pasando hoy, todas cierran un camino
-- por el que se puede llegar a datos de plata sin pasar por las reglas.
--
-- NUMERACION: el plan de la auditoria reservaba la 95 para esta fase, pero la 95 se la
-- llevo el hotfix de las noches y la 96 la fase 4. Esta es la 97.
--
-- 1) payments.amount sin guarda de monto (M-4). Es la UNICA tabla de plata sin CHECK:
--    reservations.paid_amount/total_price, rooms.base_price/half_day_price,
--    extra_charges.amount y cuenta_corriente_movimientos.amount ya lo tienen. Todas las
--    RPC de cobro validan `amount <= 0` antes de insertar, asi que el CHECK no cambia
--    nada de lo que hace la app: es el respaldo para cuando alguien inserte por otro
--    lado. Verificado en PROD antes de escribir esto: 0 filas con amount <= 0, asi que
--    entra VALID (no hace falta NOT VALID + VALIDATE despues).
--
-- 2) payments.reservation_id era ON DELETE CASCADE desde la mig 09 (M-5). Borrar una
--    reserva se llevaba puestos sus pagos EN SILENCIO, y con ellos la plata que ya
--    entro a una caja rendida: el arqueo de ese turno deja de cuadrar y no queda rastro
--    de por que. La app no borra reservas (cancelar es un cambio de estado), pero
--    service_role si puede desde el panel de Supabase. Con RESTRICT, ese DELETE falla y
--    avisa en vez de vaciar la caja. Cancelar una reserva no se toca: no es un DELETE.
--
-- 3) invoices, arca_ta, fiscal_private y cuenta_corriente_movimientos tienen el GRANT de
--    DML completo a anon y authenticated por el default de Supabase (M-6). Hoy no es
--    explotable: las cuatro tienen RLS activo y ninguna tiene policy de escritura
--    (arca_ta y fiscal_private no tienen NINGUNA policy: deny total), asi que la
--    escritura ya rebota. Es defensa en profundidad, y sobre todo un seguro contra el
--    error que ya pasa en este repo: alguien agrega una policy de escritura "razonable"
--    y el GRANT que estaba ahi desde siempre la vuelve alcanzable. Es exactamente lo que
--    paso con extra_charges (mig 93).
--
--    EXCEPCION INTENCIONAL: fiscal_settings conserva el UPDATE. Lo usa la policy
--    "Admin update fiscal_settings" (authenticated + app_is_admin()) y el unico write
--    directo que le queda a la app: `updateFiscalSettings` en src/lib/data.ts, que hace
--    `.from("fiscal_settings").update(...)`. Sacarle el UPDATE rompe la pantalla de
--    configuracion fiscal. Se le sacan INSERT y DELETE, que nadie usa (la tabla tiene
--    una sola fila, id = 1).
--
-- 4) rpc_discard_invoice descartaba una factura en 'processing' con numero ya asignado
--    sin preguntarle a ARCA si lo autorizo (M-7b). El descarte pone cbte_nro = NULL para
--    liberar el numero; si ARCA ya emitio el CAE, queda un comprobante REAL sin registro
--    local y el numero se reusa en la siguiente factura: dos comprobantes con el mismo
--    numero, que es un problema fiscal, no un bug de pantalla. El camino correcto ya
--    existe y funciona: "Reintentar" (emitInvoice) barre las 'processing' estancadas,
--    consulta FECompConsultar y reconcilia. La UI hoy solo muestra la papelera para
--    'rejected'/'pending', asi que esto tapa el camino por RPC directa y el dia que la
--    UI cambie.
--
-- Estado de PROD verificado antes de escribir (solo lectura): 91 a 95 aplicadas, 0 pagos
-- no positivos, FK real llamado payments_reservation_id_fkey, y 1 sola factura en la
-- tabla (authorized), asi que el punto 4 no alcanza a ninguna fila existente.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($mig97$ ... $mig97$) SIN ;
-- final y SIN BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) payments.amount > 0. Verificado en PROD: 0 filas lo violan, entra VALID.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND conname = 'payments_amount_positive'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) El FK a reservations pasa de CASCADE a RESTRICT.
--    El nombre viene verificado contra PROD (pg_constraint): payments_reservation_id_fkey.
--    Se dropea y se recrea con el mismo nombre, asi que correr esto dos veces es inocuo.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_reservation_id_fkey;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_reservation_id_fkey
  FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Sacar el DML por default de Supabase de las tablas fiscales y de cuenta
--    corriente. REVOKE no falla si el grant no existe, asi que es idempotente.
--    fiscal_settings conserva el UPDATE a proposito (ver cabecera).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.invoices FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.arca_ta FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_private FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cuenta_corriente_movimientos FROM anon, authenticated;

-- fiscal_settings: INSERT y DELETE se van, UPDATE se queda (updateFiscalSettings).
REVOKE INSERT, DELETE ON public.fiscal_settings FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) rpc_discard_invoice: copia de la mig 79 (la ultima que la define; la 80 solo la
--    menciona en un comentario) mas el guard de numero asignado.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_discard_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i public.invoices%ROWTYPE;
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT * INTO v_i FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_i.status = 'authorized' THEN
    RAISE EXCEPTION 'La factura ya fue emitida (CAE): no se puede descartar.' USING errcode = 'P0020';
  END IF;
  IF v_i.status = 'discarded' THEN
    RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'discarded', 'already', TRUE);
  END IF;
  -- processing "fresco" (intento en vuelo) no se descarta.
  IF v_i.status = 'processing'
     AND v_i.last_attempt_at IS NOT NULL
     AND v_i.last_attempt_at > NOW() - INTERVAL '2 minutes' THEN
    RAISE EXCEPTION 'La factura se esta emitiendo. Reintenta en unos segundos.' USING errcode = 'P0021';
  END IF;

  -- Numero ya pedido a ARCA: descartar aca libera el numero SIN preguntarle a ARCA si
  -- lo autorizo. Si lo autorizo, queda un comprobante real sin registro local y el
  -- numero se reusa en la proxima factura: dos comprobantes con el mismo numero.
  -- La salida correcta es "Reintentar", que consulta FECompConsultar y reconcilia.
  -- Nota: rpc_begin_invoice_emission asigna cbte_nro en el mismo UPDATE que pone
  -- 'processing', asi que en la practica esto alcanza a TODA factura en 'processing'.
  -- Es a proposito: ninguna se descarta sin preguntarle antes a ARCA.
  IF v_i.status = 'processing' AND v_i.cbte_nro IS NOT NULL THEN
    RAISE EXCEPTION 'Esta factura tiene numero asignado y ARCA puede haberla autorizado. Usa "Reintentar" para verificar contra ARCA antes de descartarla.' USING errcode = 'P0024';
  END IF;

  IF v_i.kind = 'consolidada' AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador descarta facturas consolidadas.' USING errcode = '42501';
  END IF;

  -- Paridad con la visibilidad de la lista de pendientes.
  IF NOT public.app_is_admin()
     AND v_i.cash_shift_id IS DISTINCT FROM public.app_current_open_shift() THEN
    RAISE EXCEPTION 'Solo podes descartar facturas de tu turno abierto. Pedile al administrador.' USING errcode = 'P0023';
  END IF;

  UPDATE public.invoices
  SET status = 'discarded',
      cbte_nro = NULL,   -- libera el número del backstop invoices_number_uq
      cbte_fch = NULL,
      last_error = NULL,
      updated_at = NOW()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'discarded');
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_discard_invoice(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_discard_invoice(UUID) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('97_guardas_pagos_y_tablas_fiscales.sql');
  END IF;
END $$;

COMMIT;
