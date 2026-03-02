-- Migration 07: Enrich rooms table with management fields

-- 1. Añadir columnas a tabla rooms
ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS capacity_adults INT NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS capacity_children INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS beds_configuration TEXT NOT NULL DEFAULT '1 Cama',
ADD COLUMN IF NOT EXISTS amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Populate some dummy valid data purely for development showcase
UPDATE rooms
SET 
  capacity_adults = CASE 
    WHEN room_type ILIKE '%suite%' THEN 2 
    WHEN room_type ILIKE '%matrimonial%' THEN 2 
    ELSE 1 
  END,
  capacity_children = CASE 
    WHEN room_type ILIKE '%suite%' THEN 2 
    ELSE 0 
  END,
  beds_configuration = CASE 
    WHEN room_type ILIKE '%suite%' THEN '1 Cama King + 1 Sofá Cama' 
    WHEN room_type ILIKE '%matrimonial%' THEN '1 Cama Queen' 
    ELSE '1 Cama Individual' 
  END,
  amenities = '["wifi", "tv", "air_conditioning"]'::jsonb
WHERE true;
