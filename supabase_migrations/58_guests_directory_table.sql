-- Migration 58: Tabla de huespedes (registro / directorio)
--
-- El "Directorio de huespedes" se armaba SOLO desde reservations. Esta tabla permite
-- pre-cargar un registro de huespedes (importado del Excel del hotel) y que el directorio
-- muestre tanto el registro como la gente que efectivamente se hospedo (ver getGuestDirectory,
-- que une ambas fuentes deduplicando por DNI/nombre). RLS igual que associated_clients:
-- staff lee, admin escribe.

BEGIN;

CREATE TABLE IF NOT EXISTS public.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  first_name text,
  last_name text,
  document_type text,
  document_id text,
  address text,
  locality text,
  nationality text,
  profession text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guests_document_id ON public.guests (document_id);
CREATE INDEX IF NOT EXISTS idx_guests_full_name ON public.guests (full_name);

ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read guests" ON public.guests;
CREATE POLICY "Staff can read guests" ON public.guests
  FOR SELECT TO authenticated USING (public.app_is_staff());

DROP POLICY IF EXISTS "Admin can insert guests" ON public.guests;
CREATE POLICY "Admin can insert guests" ON public.guests
  FOR INSERT TO authenticated WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS "Admin can update guests" ON public.guests;
CREATE POLICY "Admin can update guests" ON public.guests
  FOR UPDATE TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS "Admin can delete guests" ON public.guests;
CREATE POLICY "Admin can delete guests" ON public.guests
  FOR DELETE TO authenticated USING (public.app_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guests TO authenticated;

COMMIT;
