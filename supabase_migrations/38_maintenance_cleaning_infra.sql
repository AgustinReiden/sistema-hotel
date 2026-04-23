-- Migration 38: Infraestructura del rol maintenance y flujo de limpieza
--
-- (El valor 'maintenance' ya se agregó al enum user_role en la migración 37,
-- en una transacción separada, porque Postgres no permite usar un valor
-- recién agregado dentro de la misma transacción donde se creó.)
--
-- Nuevas reglas:
-- 1) El rol `maintenance` puede ver rooms + room_cleaning_log y marcar
--    habitaciones como limpias. No toca reservas, pagos, ni otras tablas.
-- 2) Una vez que una habitación pasa a `cleaning` post check-out, ni el
--    recepcionista puede ocuparla de vuelta. Sólo admin o maintenance pueden
--    volverla a `available`.
-- 3) Auditoría: cada "marca como limpia" queda en room_cleaning_log con
--    room_id, cleaned_at, cleaned_by, cleaner_name, previous_status, notes.
-- 4) rpc_set_room_maintenance queda restringido a admin.

BEGIN;

-- 1) Helper: es_maintenance?
CREATE OR REPLACE FUNCTION public.app_is_maintenance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'maintenance'
  );
$$;

REVOKE ALL ON FUNCTION public.app_is_maintenance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_is_maintenance() TO authenticated;

-- 3) Tabla de auditoría de limpieza
CREATE TABLE IF NOT EXISTS public.room_cleaning_log (
  id BIGSERIAL PRIMARY KEY,
  room_id INT NOT NULL REFERENCES public.rooms(id),
  cleaned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleaned_by UUID NOT NULL REFERENCES auth.users(id),
  cleaner_name TEXT,
  previous_status TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS room_cleaning_log_room_id_idx
  ON public.room_cleaning_log(room_id);
CREATE INDEX IF NOT EXISTS room_cleaning_log_cleaned_at_idx
  ON public.room_cleaning_log(cleaned_at DESC);

ALTER TABLE public.room_cleaning_log ENABLE ROW LEVEL SECURITY;

-- Lee log: admin y maintenance (cualquier staff lee solo para auditoría)
DROP POLICY IF EXISTS "Admin and maintenance read cleaning log" ON public.room_cleaning_log;
CREATE POLICY "Admin and maintenance read cleaning log"
  ON public.room_cleaning_log FOR SELECT TO authenticated
  USING (public.app_is_admin() OR public.app_is_maintenance() OR public.app_is_staff());

-- 4) RPC: marcar habitación como limpia (admin o maintenance)
CREATE OR REPLACE FUNCTION public.rpc_mark_room_clean(
  p_room_id INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_current_status public.room_status;
  v_cleaner_name TEXT;
BEGIN
  IF NOT (public.app_is_admin() OR public.app_is_maintenance()) THEN
    RAISE EXCEPTION 'Solo admin o mantenimiento pueden marcar una habitacion como limpia.' USING errcode = '42501';
  END IF;

  SELECT status INTO v_current_status
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Habitacion no encontrada.' USING errcode = 'P0002';
  END IF;

  IF v_current_status <> 'cleaning' AND v_current_status <> 'maintenance' THEN
    RAISE EXCEPTION 'La habitacion no requiere limpieza (estado actual: %).', v_current_status::text USING errcode = '22023';
  END IF;

  -- Obtenemos nombre del que limpia para auditoría
  SELECT full_name INTO v_cleaner_name
  FROM public.profiles
  WHERE id = v_user_id;

  INSERT INTO public.room_cleaning_log (room_id, cleaned_by, cleaner_name, previous_status, notes)
  VALUES (p_room_id, v_user_id, v_cleaner_name, v_current_status::text, NULLIF(BTRIM(p_notes), ''));

  UPDATE public.rooms
  SET status = 'available'
  WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'room_id', p_room_id,
    'cleaned_by', v_user_id,
    'previous_status', v_current_status,
    'new_status', 'available'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mark_room_clean(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_mark_room_clean(INT, TEXT) TO authenticated;

-- 5) rpc_set_room_maintenance: ahora admin-only (antes cualquier staff)
CREATE OR REPLACE FUNCTION public.rpc_set_room_maintenance(p_room_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo admin puede marcar una habitacion en mantenimiento.' USING errcode = '42501';
  END IF;

  UPDATE public.rooms
  SET status = 'maintenance'
  WHERE id = p_room_id;
END;
$$;

-- 6) Policy: maintenance puede leer rooms (ya lo hace staff), pero NO reservas.
--    Necesita leer rooms para su dashboard. No agregamos nada nuevo —
--    `Staff can read rooms` no cubre maintenance (app_is_staff excluye maintenance).
--    Creamos policy específica para el rol maintenance.
DROP POLICY IF EXISTS "Maintenance can read rooms" ON public.rooms;
CREATE POLICY "Maintenance can read rooms"
  ON public.rooms FOR SELECT TO authenticated
  USING (public.app_is_maintenance());

-- Mantenimiento NO lee hotel_settings sensibles; lee rooms y room_cleaning_log
-- (ya cubierto arriba).

COMMIT;
