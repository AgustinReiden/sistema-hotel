-- ─────────────────────────────────────────────────────────────────────────────
-- 84: cierra los dos agujeros de SQL arbitrario alcanzables desde el navegador.
--
-- `public.exec_ddl(text)` y `public.run_sql(text)` son SECURITY DEFINER con
-- owner `postgres`, y estaban GRANTeadas a `anon` y `authenticated`.
-- La anon key se hornea en el bundle de Next y viaja al navegador en CADA carga
-- de HotelSync: no es un secreto. Cualquiera que abriera la app publica podia
-- sacarla del bundle y, con un POST a /rest/v1/rpc/, hacer:
--
--   exec_ddl : EXECUTE de cualquier string como postgres. Control total de la
--              base — DROP TABLE, crear un usuario admin, leer o borrar todo.
--
--   run_sql  : envuelve el input en `SELECT json_agg(t) FROM (<input>) t` y lo
--              ejecuta como el owner. Parece de solo lectura, pero como corre
--              como `postgres` **saltea RLS por completo**: devuelve cualquier
--              tabla en JSON. O sea, fuga total de DNIs, telefonos, domicilios,
--              pagos, cuenta corriente y datos fiscales del hotel.
--
-- NO se dropean: son la via por la que se aplican las migraciones a PROD.
-- Quedan solo para `service_role`, cuya clave NUNCA va al navegador (vive en el
-- conector MCP y en el server). El owner (`postgres`) conserva sus permisos
-- siempre, asi que el SQL editor del panel de Supabase sigue funcionando.
--
-- Verificado antes de aplicar: la app no llama a ninguna de las dos
-- (grep sobre `src/` = 0 matches), asi que revocarlas no toca ningun flujo.
--
-- EFECTO COLATERAL BUSCADO: `scripts/recuperacion/apply-migration.mjs` usaba la
-- anon key y a partir de aca necesita SUPABASE_SERVICE_ROLE_KEY en .env.local.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

REVOKE ALL ON FUNCTION public.exec_ddl(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_ddl(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.exec_ddl(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.exec_ddl(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.run_sql(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_sql(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.run_sql(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_sql(TEXT) TO service_role;

COMMIT;
