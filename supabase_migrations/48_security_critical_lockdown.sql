-- Migración 48 — Cierre de agujeros críticos de seguridad
-- C1: public.run_sql(text) era ejecutable por anon → SQL arbitrario como dueño de la DB.
-- C2: handle_new_user tomaba el rol del metadata (escalada a admin) y defaulteaba a receptionist.
-- A1: get_today_extra_income filtraba ingresos del día a anónimos.

-- ── C1: cerrar run_sql al público (queda solo service_role / postgres) ──
REVOKE EXECUTE ON FUNCTION public.run_sql(text) FROM anon, authenticated, PUBLIC;
ALTER FUNCTION public.run_sql(text) SET search_path = '';

-- ── C2: alta de usuarios segura ──
-- Default 'client' e ignorar el rol del metadata. Los staff se crean en el dashboard
-- de Supabase y se promueven desde Ajustes → Usuarios (rpc_admin_update_profile).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    'client'::public.user_role,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      SPLIT_PART(NEW.email, '@', 1),
      'User'
    )
  );
  RETURN NEW;
END;
$$;

-- ── A1: ingresos del día solo para staff ──
CREATE OR REPLACE FUNCTION public.get_today_extra_income()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'No autorizado.' USING errcode = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(SUM(amount), 0)
    FROM public.extra_charges
    WHERE charge_type = 'half_day'
      AND (created_at AT TIME ZONE (SELECT COALESCE(timezone, 'UTC') FROM public.hotel_settings ORDER BY id LIMIT 1))::date
        = (NOW() AT TIME ZONE (SELECT COALESCE(timezone, 'UTC') FROM public.hotel_settings ORDER BY id LIMIT 1))::date
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_today_extra_income() FROM anon, PUBLIC;
