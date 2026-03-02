-- Migration 14: Dynamic Hero Image Setup

BEGIN;

ALTER TABLE public.hotel_settings
ADD COLUMN IF NOT EXISTS hero_image_url text DEFAULT 'https://images.unsplash.com/photo-1545642412-ea820db826a7?auto=format&fit=crop&q=80&w=2000';

COMMIT;
