BEGIN;

CREATE TABLE IF NOT EXISTS public.room_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  capacity INT NOT NULL DEFAULT 1 CHECK (capacity > 0),
  capacity_adults INT NOT NULL DEFAULT 1 CHECK (capacity_adults >= 0),
  capacity_children INT NOT NULL DEFAULT 0 CHECK (capacity_children >= 0),
  beds_configuration TEXT NOT NULL DEFAULT '1 Cama',
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT,
  image_url TEXT,
  base_price NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  half_day_price NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (half_day_price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS room_categories_name_lower_idx
  ON public.room_categories (lower(name));

CREATE INDEX IF NOT EXISTS room_categories_active_name_idx
  ON public.room_categories (is_active, name);

ALTER TABLE public.room_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read room categories" ON public.room_categories;
DROP POLICY IF EXISTS "Staff can insert room categories" ON public.room_categories;
DROP POLICY IF EXISTS "Staff can update room categories" ON public.room_categories;
DROP POLICY IF EXISTS "Staff can delete room categories" ON public.room_categories;

CREATE POLICY "Staff can read room categories"
ON public.room_categories
FOR SELECT
TO authenticated
USING (public.app_is_staff());

CREATE POLICY "Staff can insert room categories"
ON public.room_categories
FOR INSERT
TO authenticated
WITH CHECK (public.app_is_staff());

CREATE POLICY "Staff can update room categories"
ON public.room_categories
FOR UPDATE
TO authenticated
USING (public.app_is_staff())
WITH CHECK (public.app_is_staff());

CREATE POLICY "Staff can delete room categories"
ON public.room_categories
FOR DELETE
TO authenticated
USING (public.app_is_staff());

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS category_id INT REFERENCES public.room_categories(id);

CREATE INDEX IF NOT EXISTS rooms_category_id_idx
  ON public.rooms (category_id);

INSERT INTO public.room_categories (
  name,
  capacity,
  capacity_adults,
  capacity_children,
  beds_configuration,
  amenities,
  description,
  image_url,
  base_price,
  half_day_price,
  is_active
)
SELECT DISTINCT ON (lower(btrim(r.room_type)))
  btrim(r.room_type) AS name,
  COALESCE(r.capacity, 1) AS capacity,
  COALESCE(r.capacity_adults, GREATEST(COALESCE(r.capacity, 1), 1)) AS capacity_adults,
  COALESCE(r.capacity_children, 0) AS capacity_children,
  COALESCE(NULLIF(btrim(r.beds_configuration), ''), '1 Cama') AS beds_configuration,
  COALESCE(r.amenities, '[]'::jsonb) AS amenities,
  r.description,
  r.image_url,
  COALESCE(r.base_price, 0) AS base_price,
  COALESCE(r.half_day_price, COALESCE(r.base_price, 0)) AS half_day_price,
  COALESCE(r.is_active, true) AS is_active
FROM public.rooms r
WHERE btrim(r.room_type) <> ''
ORDER BY lower(btrim(r.room_type)), r.id
ON CONFLICT DO NOTHING;

UPDATE public.rooms r
SET category_id = rc.id
FROM public.room_categories rc
WHERE lower(btrim(r.room_type)) = lower(btrim(rc.name))
  AND (r.category_id IS NULL OR r.category_id <> rc.id);

CREATE OR REPLACE FUNCTION public.app_set_room_category_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_room_categories_updated_at ON public.room_categories;
CREATE TRIGGER trg_room_categories_updated_at
BEFORE UPDATE ON public.room_categories
FOR EACH ROW
EXECUTE FUNCTION public.app_set_room_category_updated_at();

CREATE OR REPLACE FUNCTION public.app_apply_room_category_to_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category public.room_categories%ROWTYPE;
BEGIN
  IF NEW.category_id IS NULL THEN
    RAISE EXCEPTION 'La habitacion debe tener una categoria asignada.' USING errcode = '23502';
  END IF;

  SELECT *
  INTO v_category
  FROM public.room_categories
  WHERE id = NEW.category_id;

  IF v_category.id IS NULL THEN
    RAISE EXCEPTION 'Categoria no encontrada.' USING errcode = 'P0002';
  END IF;

  NEW.room_type := v_category.name;
  NEW.capacity := v_category.capacity;
  NEW.capacity_adults := v_category.capacity_adults;
  NEW.capacity_children := v_category.capacity_children;
  NEW.beds_configuration := v_category.beds_configuration;
  NEW.amenities := v_category.amenities;
  NEW.description := v_category.description;
  NEW.image_url := v_category.image_url;
  NEW.base_price := v_category.base_price;
  NEW.half_day_price := v_category.half_day_price;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rooms_apply_category ON public.rooms;
CREATE TRIGGER trg_rooms_apply_category
BEFORE INSERT OR UPDATE OF category_id ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.app_apply_room_category_to_room();

CREATE OR REPLACE FUNCTION public.app_sync_rooms_from_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.rooms
  SET
    room_type = NEW.name,
    capacity = NEW.capacity,
    capacity_adults = NEW.capacity_adults,
    capacity_children = NEW.capacity_children,
    beds_configuration = NEW.beds_configuration,
    amenities = NEW.amenities,
    description = NEW.description,
    image_url = NEW.image_url,
    base_price = NEW.base_price,
    half_day_price = NEW.half_day_price
  WHERE category_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_room_categories_sync_rooms ON public.room_categories;
CREATE TRIGGER trg_room_categories_sync_rooms
AFTER UPDATE OF name, capacity, capacity_adults, capacity_children, beds_configuration, amenities, description, image_url, base_price, half_day_price
ON public.room_categories
FOR EACH ROW
EXECUTE FUNCTION public.app_sync_rooms_from_category();

UPDATE public.rooms r
SET
  room_type = rc.name,
  capacity = rc.capacity,
  capacity_adults = rc.capacity_adults,
  capacity_children = rc.capacity_children,
  beds_configuration = rc.beds_configuration,
  amenities = rc.amenities,
  description = rc.description,
  image_url = rc.image_url,
  base_price = rc.base_price,
  half_day_price = rc.half_day_price
FROM public.room_categories rc
WHERE r.category_id = rc.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rooms WHERE category_id IS NULL) THEN
    RAISE EXCEPTION 'No se pudo asignar una categoria a todas las habitaciones existentes.';
  END IF;
END;
$$;

ALTER TABLE public.rooms
  ALTER COLUMN category_id SET NOT NULL;

COMMIT;
