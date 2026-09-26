-- ─────────────────────────────────────────────────────────────────────────────
-- 118: habitaciones y categorias, solo el admin las escribe.
--
-- POR QUE. F0-7 (PR 138) dejo la pantalla y las acciones de Habitaciones y
-- Categorias solo para el admin, pero la base seguia dejando que cualquier
-- usuario del staff insertara, editara o borrara filas de rooms y
-- room_categories con su propia sesion. La categoria lleva el precio de la noche
-- y el del medio dia, y editar una habitacion reescribe su categoria: con la
-- sesion de recepcion se podia cambiar una tarifa salteando la pantalla. Esto
-- cierra la misma puerta en la base.
--
-- QUE CAMBIA. Solo las 6 policies de escritura (INSERT, UPDATE y DELETE de cada
-- tabla) pasan de app_is_staff a app_is_admin, con el mismo TO authenticated.
-- Las de lectura no se tocan: en rooms, Public read rooms, Staff can read rooms
-- y Maintenance can read rooms. En room_categories, Staff can read room
-- categories.
--
-- QUE NO CAMBIA. Check-in, check-out, walk-in, cambio de habitacion, limpieza,
-- mantenimiento, cancelacion y el trigger app_sync_rooms_from_category escriben
-- rooms desde funciones SECURITY DEFINER, que no pasan por estas policies. En
-- PROD no hay ninguna funcion sin SECURITY DEFINER que escriba estas dos tablas.
-- En la app, las unicas escrituras directas son las acciones de Habitaciones y
-- Categorias, que desde F0-7 ya exigen admin. Los GRANT de la 110 siguen igual:
-- el permiso de tabla queda, lo que decide quien escribe es la policy.
--
-- Los nombres de las policies viejas son los de PROD (pg_policies del 24/09,
-- reconfirmado el 25/09) y coinciden con los de las migs 17 y 26.
--
-- Idempotente: DROP IF EXISTS de las viejas y de las nuevas antes de crearlas,
-- se puede correr dos veces.
--
-- VOLVER ATRAS. Borrar las 6 nuevas y recrear las 6 viejas con app_is_staff, con
-- el mismo TO authenticated y las mismas clausulas que en las migs 17 y 26.
--
-- Aplicar DESPUES del deploy de F0-7 y ANTES de mergear este PR. Por exec_ddl va
-- lo que esta entre BEGIN y COMMIT, sin ellos y sin punto y coma final en la
-- llamada.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) rooms --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can insert rooms" ON public.rooms;
DROP POLICY IF EXISTS "Staff can update rooms" ON public.rooms;
DROP POLICY IF EXISTS "Staff can delete rooms" ON public.rooms;

DROP POLICY IF EXISTS "Admin can insert rooms" ON public.rooms;
DROP POLICY IF EXISTS "Admin can update rooms" ON public.rooms;
DROP POLICY IF EXISTS "Admin can delete rooms" ON public.rooms;

CREATE POLICY "Admin can insert rooms"
ON public.rooms
FOR INSERT
TO authenticated
WITH CHECK (public.app_is_admin());

CREATE POLICY "Admin can update rooms"
ON public.rooms
FOR UPDATE
TO authenticated
USING (public.app_is_admin())
WITH CHECK (public.app_is_admin());

CREATE POLICY "Admin can delete rooms"
ON public.rooms
FOR DELETE
TO authenticated
USING (public.app_is_admin());

-- 2) room_categories ----------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can insert room categories" ON public.room_categories;
DROP POLICY IF EXISTS "Staff can update room categories" ON public.room_categories;
DROP POLICY IF EXISTS "Staff can delete room categories" ON public.room_categories;

DROP POLICY IF EXISTS "Admin can insert room categories" ON public.room_categories;
DROP POLICY IF EXISTS "Admin can update room categories" ON public.room_categories;
DROP POLICY IF EXISTS "Admin can delete room categories" ON public.room_categories;

CREATE POLICY "Admin can insert room categories"
ON public.room_categories
FOR INSERT
TO authenticated
WITH CHECK (public.app_is_admin());

CREATE POLICY "Admin can update room categories"
ON public.room_categories
FOR UPDATE
TO authenticated
USING (public.app_is_admin())
WITH CHECK (public.app_is_admin());

CREATE POLICY "Admin can delete room categories"
ON public.room_categories
FOR DELETE
TO authenticated
USING (public.app_is_admin());

-- Registro
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('118_habitaciones_y_categorias_solo_admin.sql');
  END IF;
END
$do$;

COMMIT;
