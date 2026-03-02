-- Migration 17: Room Management RLS Policies

BEGIN;

DROP POLICY IF EXISTS "Staff can insert rooms" ON public.rooms;
CREATE POLICY "Staff can insert rooms" 
ON public.rooms FOR INSERT TO authenticated
WITH CHECK (public.app_is_staff());

DROP POLICY IF EXISTS "Staff can update rooms" ON public.rooms;
CREATE POLICY "Staff can update rooms" 
ON public.rooms FOR UPDATE TO authenticated
USING (public.app_is_staff())
WITH CHECK (public.app_is_staff());

DROP POLICY IF EXISTS "Staff can delete rooms" ON public.rooms;
CREATE POLICY "Staff can delete rooms" 
ON public.rooms FOR DELETE TO authenticated
USING (public.app_is_staff());

COMMIT;
