-- Migration 63: Policy de DELETE para associated_clients (empresas/convenios)
--
-- La tabla tenía RLS para SELECT (staff) e INSERT/UPDATE (admin), pero NO para DELETE, así que
-- borrar una empresa desde la app quedaba bloqueado por RLS. Se agrega el permiso de borrado
-- solo para admin, igual que ya tiene la tabla guests (migración 58).
--
-- Efecto del borrado (por las FKs existentes): company_passengers se borra en CASCADE y
-- reservations.associated_client_id queda en NULL (SET NULL). El historial de reservas no se
-- pierde, pero esas reservas dejan de estar asociadas a la empresa.

BEGIN;

DROP POLICY IF EXISTS "Admin can delete associated clients" ON public.associated_clients;
CREATE POLICY "Admin can delete associated clients" ON public.associated_clients
  FOR DELETE TO authenticated USING (public.app_is_admin());

COMMIT;
