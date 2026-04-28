-- Migration 47: configurable WhatsApp confirmation message template.

BEGIN;

ALTER TABLE public.hotel_settings
  ADD COLUMN IF NOT EXISTS confirmation_message_template TEXT;

COMMIT;
