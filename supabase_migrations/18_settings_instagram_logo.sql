-- Migration 18: Add Logo and Instagram to Settings

BEGIN;

ALTER TABLE public.hotel_settings 
ADD COLUMN IF NOT EXISTS logo_url text,
ADD COLUMN IF NOT EXISTS contact_instagram text;

COMMIT;
