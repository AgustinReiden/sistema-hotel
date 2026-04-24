-- Migration 45: split public hotel contact phones into WhatsApp and 24h fixed phone.

BEGIN;

ALTER TABLE public.hotel_settings
  ADD COLUMN IF NOT EXISTS contact_whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_fixed_phone TEXT;

UPDATE public.hotel_settings
SET contact_whatsapp_phone = COALESCE(NULLIF(BTRIM(contact_whatsapp_phone), ''), contact_phone)
WHERE contact_whatsapp_phone IS NULL OR BTRIM(contact_whatsapp_phone) = '';

COMMIT;
