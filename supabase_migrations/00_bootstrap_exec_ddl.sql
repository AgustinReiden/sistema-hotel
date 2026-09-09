-- ─────────────────────────────────────────────────────────────────────────────
-- 00: crea `run_sql` y `exec_ddl`, las dos funciones con las que se aplica TODO
--     lo demás de esta carpeta (ver README.md, sección "Cómo aplicarla").
--
-- POR QUÉ EXISTE ESTE ARCHIVO: ninguna otra migración del repo las crea. Nacieron
-- a mano contra la base en algún momento anterior a la migración 01 -- nunca se
-- versionaron -- y sobrevivieron intactas a la mudanza Ohio -> Brasil del
-- 2026-06-19 porque esa mudanza clonó el esquema completo 1:1 (ver migración 85).
-- Consecuencia real: reconstruyendo la base SOLO desde `supabase_migrations/`, no
-- hay forma de aplicar ni la 01. `apply-migration.mjs` y el flujo a mano que
-- describe este README dependen de `exec_ddl`, que sin este archivo no existiría.
--
-- CÓMO SE CORRE -- a mano, PRIMERO y antes que cualquier otra migración, con
-- psql o el SQL editor del panel de Supabase (ambos corren como el owner,
-- `postgres`, así que no necesitan que `exec_ddl` exista de antemano). Es el
-- ÚNICO archivo de esta carpeta que no se aplica vía `exec_ddl` ni vía
-- `apply-migration.mjs` -- ese es justamente el problema que resuelve.
--
-- NO se anota en `public.applied_migrations`: `record_migration()` se crea
-- recién en la migración 91, muchísimo después de esta en la secuencia real de
-- reconstrucción. Ver la sección "Reconstruir desde cero" en README.md.
--
-- Definiciones capturadas TAL CUAL de PROD (`supabase-sistema-hotel-prod`,
-- proyecto `xoqxbtlpppsyzccljjxp`) el 2026-09-09, vía el conector MCP de solo
-- lectura, con:
--
--   select p.proname, pg_get_functiondef(p.oid), r.rolname as owner, p.proacl
--   from pg_proc p join pg_roles r on r.oid = p.proowner join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('exec_ddl','run_sql');
--
-- Los REVOKE/GRANT de abajo reproducen el ACL real verificado en PROD --
-- `{postgres=X/postgres,service_role=X/postgres}` para las dos, owner
-- `postgres` -- que es el estado que dejó la migración 84: ni PUBLIC ni anon ni
-- authenticated tienen EXECUTE, sólo el owner y `service_role`.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ---------------------------------------------------------------------------
-- run_sql: solo-lectura "de facto", no por diseño. Envuelve el input en
-- `SELECT json_agg(t) FROM (<input>) t` y lo corre como el owner (postgres) --
-- un DDL/DML metido en el subselect lo ejecuta igual, saltando RLS por
-- completo. Por eso queda con el mismo candado que exec_ddl, no uno más suave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_sql(query text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result json;
BEGIN
  EXECUTE 'SELECT json_agg(t) FROM (' || query || ') t' INTO result;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_sql(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_sql(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- exec_ddl: EXECUTE de cualquier string como el owner (postgres). Es la vía
-- por la que se aplica TODO lo demás de supabase_migrations/ (ver README.md).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exec_ddl(p_sql text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.exec_ddl(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_ddl(TEXT) TO service_role;

COMMIT;
