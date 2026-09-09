-- Migration 99: record_migration() deja de ser ejecutable por anon y authenticated.
--
-- POR QUE: la verificacion post-auditoria del 2026-09-09 encontro en PROD que
-- public.record_migration(text, text) conservaba EXECUTE para PUBLIC y para
-- authenticated, aunque la migracion 91 escribe REVOKE ALL ... FROM PUBLIC y
-- GRANT ... TO service_role. Ninguna migracion posterior la toca: es deriva entre
-- el repo y la base (la 91 se aplico por partes y el REVOKE no llego, o se piso
-- despues a mano). Con ese permiso, cualquiera con la anon key (que viaja en el
-- bundle del navegador) podia llamar /rest/v1/rpc/record_migration y anotar
-- como "aplicada" una migracion que no lo esta, contaminando el unico registro
-- que usamos para detectar deriva. No toca datos del hotel, pero miente sobre
-- el estado de la base.
--
-- De paso se cierra lo mismo en la tabla: applied_migrations tenia el GRANT de
-- DML por default de Supabase para anon y authenticated. Hoy la RLS lo bloquea
-- (la unica policy es SELECT para admin), pero el patron del repo es no depender
-- de que nadie agregue una policy por error: sin grant, no hay escritura directa.
--
-- Idempotente: REVOKE no falla si el permiso no existe. Se puede correr de nuevo
-- despues de cualquier restore o mudanza, que es justamente cuando hace falta.

BEGIN;

-- 1) La funcion: solo service_role (y el owner). Las migraciones la invocan
--    desde exec_ddl, que corre como postgres, asi que nada de la app la necesita.
REVOKE ALL ON FUNCTION public.record_migration(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_migration(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_migration(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_migration(text, text) TO service_role;

-- 2) La tabla: anon sin nada; authenticated solo SELECT (la policy lo limita al admin).
REVOKE ALL ON TABLE public.applied_migrations FROM PUBLIC;
REVOKE ALL ON TABLE public.applied_migrations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.applied_migrations FROM authenticated;
GRANT SELECT ON TABLE public.applied_migrations TO authenticated;

-- 3) Verificacion dentro de la misma transaccion: si el REVOKE no alcanzo, que
--    la migracion falle aca y no quede a medias sin que nadie lo note.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.record_migration(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon sigue pudiendo ejecutar record_migration: revisar ACL (pg_proc.proacl).';
  END IF;
  IF has_function_privilege('authenticated', 'public.record_migration(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo ejecutar record_migration: revisar ACL (pg_proc.proacl).';
  END IF;
  IF has_table_privilege('anon', 'public.applied_migrations', 'INSERT') THEN
    RAISE EXCEPTION 'anon sigue con INSERT en applied_migrations.';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('99_revocar_record_migration_a_anon.sql');
  END IF;
END $$;

COMMIT;
