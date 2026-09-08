-- Migration 93: cerrar las escrituras directas que quedaron abiertas
--
-- La migracion 77 saco reservations, payments, cash_shifts e invoice_reservations del
-- alcance de escritura directa: sin politica de INSERT/UPDATE/DELETE y sin GRANT de
-- esas operaciones para anon ni authenticated. Todo pasa por los RPC SECURITY DEFINER,
-- que son los que mantienen las invariantes.
--
-- Quedaron dos tablas con el mismo problema y el mismo remedio:
--
--   extra_charges           - politica "Staff can insert extra charges" (INSERT, staff)
--   reservation_cancellations - politica "Staff can insert reservation cancellations"
--
-- El caso de extra_charges es el que muerde. Un INSERT directo NO hace nada de lo que
-- hace rpc_add_extra_charge:
--   * no suma el cargo a reservations.total_price  -> la reserva queda descuadrada
--   * no bloquea la reserva con FOR UPDATE          -> carrera con otro cobro
--   * no rechaza reservas checked_out / cancelled   -> cargo sobre una estadia cerrada
--   * no rechaza charge_type = 'half_day'           -> saltea la exclusividad del
--                                                      late-checkout (mig 44)
-- Es decir: se puede cargar plata que la reserva nunca va a cobrar. No roba nada, pero
-- rompe la conciliacion del tablero (venta = cobrado + fiado + impago).
--
-- reservation_cancellations es un log append-only que solo escribe
-- rpc_cancel_reservation; la politica sobraba igual.
--
-- Por que es seguro sacarlas: los tres unicos escritores de estas tablas
-- (rpc_add_extra_charge, rpc_staff_apply_late_checkout, rpc_cancel_reservation) son
-- SECURITY DEFINER propiedad de postgres, que es el dueno de las tablas, y ninguna
-- tiene FORCE ROW LEVEL SECURITY: saltean RLS y no dependen de estas politicas. La app
-- solo lee estas tablas (src/lib/data.ts y admin/finances/page.tsx: puros SELECT).
--
-- Ademas se revocan los GRANT de escritura que Supabase deja por defecto sobre anon y
-- authenticated. Hoy no sirven de nada porque RLS ya niega (no hay politica de
-- escritura), pero sin ese GRANT una politica agregada a la ligera manana no alcanza
-- para abrir la puerta. Es la misma red que puso la 77.
--
-- ESTADO EN PROD (2026-09-08): aplicado SOLO el DROP POLICY de extra_charges, que es
-- el agujero que importaba. El resto quedo pendiente porque el entorno desde el que se
-- corrio bloqueo las llamadas de revocacion de permisos. Todo el archivo es idempotente:
-- se puede correr entero de nuevo sin efecto sobre lo ya aplicado.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Las dos politicas que duplicaban un RPC
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can insert extra charges" ON public.extra_charges;
DROP POLICY IF EXISTS "Staff can insert reservation cancellations" ON public.reservation_cancellations;

-- ---------------------------------------------------------------------------
-- 2) Revocar la escritura directa donde RLS ya la niega
-- ---------------------------------------------------------------------------
-- Estas tablas quedan con RLS activo y CERO politicas de escritura, asi que ningun
-- anon/authenticated puede escribirlas hoy. Revocar el GRANT no cambia nada en
-- funcionamiento; cambia el piso del que se parte si alguien agrega una politica.
REVOKE INSERT, UPDATE, DELETE ON public.extra_charges             FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reservation_cancellations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_alerts              FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.applied_migrations        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.arca_ta                   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cuenta_corriente_movimientos FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_private            FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoices                  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profiles                  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.room_cleaning_log         FROM anon, authenticated;

-- NO se tocan las tablas cuyas politicas de escritura SI se usan desde la app con el
-- cliente normal (pantallas de ABM del admin): rooms, room_categories, guests,
-- associated_clients, company_passengers, hotel_settings, fiscal_settings. Ahi el
-- GRANT hace falta para que la politica funcione.

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('93_cerrar_escrituras_directas_restantes.sql');
  END IF;
END $$;

COMMIT;
