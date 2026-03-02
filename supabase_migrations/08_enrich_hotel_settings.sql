-- Migration 08: Enrich hotel_settings with public website data

ALTER TABLE hotel_settings
ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT 'contacto@hotel.com',
ADD COLUMN IF NOT EXISTS contact_phone TEXT NOT NULL DEFAULT '+1 (555) 000-0000',
ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT 'Av. Principal 123, Ciudad',
ADD COLUMN IF NOT EXISTS hero_title TEXT NOT NULL DEFAULT 'Donde el lujo se encuentra con la tranquilidad.',
ADD COLUMN IF NOT EXISTS hero_subtitle TEXT NOT NULL DEFAULT 'Descubre nuestro exclusivo sistema de reservas flexibles diseñado para adaptarse a tu ritmo.';
