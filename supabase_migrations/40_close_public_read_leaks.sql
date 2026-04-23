-- Migration 40: Cerrar leaks de privacidad en RLS (CRÍTICO seguridad)
--
-- Situación: existían tres policies `FOR SELECT TO public USING (true)` sobre
-- reservations, profiles y extra_charges. Cualquiera con el ANON_KEY (que
-- está expuesto en el HTML vía NEXT_PUBLIC_SUPABASE_ANON_KEY) podía hacer
-- `GET /rest/v1/reservations?select=*` y exfiltrar nombres, DNIs, teléfonos,
-- montos de TODAS las reservas. Idem profiles (emails + roles).
--
-- Fix: eliminar esas policies. El landing público sigue funcionando porque:
--  - Lee `rooms` y `hotel_settings` (policies `Public read` se MANTIENEN).
--  - Para disponibilidad, expone una VISTA con columnas no-PII (sólo
--    room_id + rangos de fechas activas). Nada de datos de huéspedes.
--  - Crea reservas vía `rpc_public_create_reservation` (SECURITY DEFINER).
--  - El staff sigue accediendo a la tabla completa vía la policy
--    `Staff can read reservations` (app_is_staff()).

BEGIN;

-- 1) Eliminar policies peligrosas
DROP POLICY IF EXISTS "Public read reservations" ON public.reservations;
DROP POLICY IF EXISTS "Public read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public read extra_charges" ON public.extra_charges;

-- 2) Vista pública de disponibilidad (sólo para el landing)
CREATE OR REPLACE VIEW public.reservations_availability AS
SELECT
  room_id,
  check_in_target,
  check_out_target
FROM public.reservations
WHERE status IN ('pending', 'confirmed', 'checked_in');

GRANT SELECT ON public.reservations_availability TO anon, authenticated;

-- Comentario para el DBA futuro: esta vista se evalúa con los privilegios
-- del owner (por default), lo que permite que anon la lea aunque no tenga
-- SELECT sobre la tabla base. Sólo expone columnas no-PII.

COMMIT;
