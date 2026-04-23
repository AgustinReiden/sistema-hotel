-- Migration 35: RPCs de gestión de usuarios por admin
--
-- El admin necesita un panel en /admin/settings para:
-- 1) Listar profiles existentes con email (join a auth.users)
-- 2) Editar full_name y role de cualquier usuario
--
-- Crear nuevos usuarios sigue siendo responsabilidad de Supabase Auth
-- (dashboard o signup público). Por eso NO hay RPC para crear.

BEGIN;

-- 1) Listar profiles con email (admin only)
CREATE OR REPLACE FUNCTION public.rpc_admin_list_profiles()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role public.user_role,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    u.email::text AS email,
    p.full_name,
    p.role,
    p.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY
    CASE p.role
      WHEN 'admin' THEN 0
      WHEN 'receptionist' THEN 1
      ELSE 2
    END,
    p.full_name NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_profiles() TO authenticated;

-- 2) Editar full_name + role de un profile (admin only, con protección anti-lockout)
CREATE OR REPLACE FUNCTION public.rpc_admin_update_profile(
  p_user_id uuid,
  p_full_name text,
  p_role public.user_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := nullif(btrim(p_full_name), '');
  v_current_role public.user_role;
  v_remaining_admins int;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'El nombre no puede estar vacio.' USING errcode = '22023';
  END IF;

  SELECT role INTO v_current_role
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado.' USING errcode = 'P0002';
  END IF;

  -- Protección anti-lockout: si estamos degradando a un admin,
  -- verificar que quede al menos otro admin.
  IF v_current_role = 'admin' AND p_role <> 'admin' THEN
    SELECT COUNT(*) INTO v_remaining_admins
    FROM public.profiles
    WHERE role = 'admin' AND id <> p_user_id;

    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'No podes quitar el rol admin al ultimo administrador del sistema.' USING errcode = '22023';
    END IF;
  END IF;

  UPDATE public.profiles
  SET full_name = v_name,
      role = p_role,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'full_name', v_name,
    'role', p_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_update_profile(uuid, text, public.user_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_profile(uuid, text, public.user_role) TO authenticated;

COMMIT;
