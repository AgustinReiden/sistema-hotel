-- Migration 77: Cierre de escritura directa a tablas de dinero
-- Auditoría 2026-07-18 · hallazgos H-01 (reservations), H-02 (cash_shifts), H-03 (payments)
--
-- reservations / payments / cash_shifts tenían policies de INSERT/UPDATE que solo pedían
-- app_is_staff(), y anon/authenticated tienen GRANT de DML por default de Supabase. Como la
-- app usa solo la anon key + RLS, un recepcionista podía extraer su JWT + la anon key del
-- navegador y pegarle a PostgREST directo (PATCH/POST /rest/v1/...), salteando los RPC
-- SECURITY DEFINER que imponen las reglas reales:
--   · reservations → editar cualquier reserva: bajar total_price antes de facturar (Factura
--     con IVA subdeclarado), o marcar checked_out/pagada sin que entre efectivo a la caja.
--   · cash_shifts  → falsificar el arqueo (discrepancy=0 con montos inventados; reescribir
--     turnos ya cerrados), ocultando faltantes de efectivo.
--   · payments     → insertar/editar pagos, cambiar método (cash→tarjeta) o turno, descuadrar
--     la caja sin dejar rastro.
--
-- Fix: revocar INSERT/UPDATE/DELETE de anon+authenticated y quitar las policies de escritura.
-- TODA mutación pasa por los RPC SECURITY DEFINER existentes, que corren como owner (bypass
-- RLS) y validan rol/estado/montos. Los SELECT (lectura de staff) se MANTIENEN intactos.
-- Mismo modelo con el que ya están blindadas invoices / arca_ta / fiscal_private (mig 72).
--
-- REQUISITO: aplicar DESPUÉS de la migración 76 (que dio RPC a los 2 writes directos que la
-- app hace a reservations: ampliar + whatsapp_notified). payments y cash_shifts no tenían
-- writes directos en la app, así que su parte se puede aplicar sin dependencia.
--
-- Aplicar a PROD por secciones vía select public.exec_ddl($MIG$ ... $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. VERIFICAR EN HOMOLOGACIÓN antes de PROD: check-out, cobro de pago,
-- apertura y cierre de caja, ampliar reserva, reenvío de WhatsApp y emisión de factura deben
-- seguir funcionando (todos van por RPC).

BEGIN;

-- ── reservations ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can insert reservations" ON public.reservations;
DROP POLICY IF EXISTS "Staff can update reservations" ON public.reservations;
REVOKE INSERT, UPDATE, DELETE ON public.reservations FROM anon, authenticated;

-- ── payments ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Staff can update payments" ON public.payments;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM anon, authenticated;

-- ── cash_shifts ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can insert cash_shifts" ON public.cash_shifts;
DROP POLICY IF EXISTS "Staff can update own cash_shifts" ON public.cash_shifts;
REVOKE INSERT, UPDATE, DELETE ON public.cash_shifts FROM anon, authenticated;

COMMIT;

-- Verificación post-aplicación (deben devolver 0 filas de policies de escritura):
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('reservations','payments','cash_shifts')
--      AND cmd IN ('INSERT','UPDATE','DELETE');
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee IN ('anon','authenticated') AND table_schema='public'
--      AND table_name IN ('reservations','payments','cash_shifts')
--      AND privilege_type IN ('INSERT','UPDATE','DELETE');
