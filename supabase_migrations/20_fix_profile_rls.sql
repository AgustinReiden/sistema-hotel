-- Migration 20: Fix Profile Read Policy

BEGIN;

DROP POLICY IF EXISTS "Users can read own profile or staff can read all" ON public.profiles;

CREATE POLICY "Users can read own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Staff can read all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.app_is_staff());

COMMIT;
