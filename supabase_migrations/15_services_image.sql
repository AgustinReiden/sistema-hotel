-- Migration 15: Add dynamic services image url

BEGIN;

ALTER TABLE public.hotel_settings
ADD COLUMN IF NOT EXISTS services_image_url text DEFAULT 'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&q=80&w=1200';

COMMIT;
