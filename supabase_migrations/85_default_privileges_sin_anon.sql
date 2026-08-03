-- ─────────────────────────────────────────────────────────────────────────────
-- 85: que una función nueva deje de nacer con un grant EXPLÍCITO a `anon`, para
--     que el `REVOKE ... FROM PUBLIC` que el repo ya escribe en cada migración
--     por fin sirva para algo.
--
-- POR QUÉ (historia real, no teoría): la migración 48 cerró `run_sql` a `anon`
-- en la base vieja de Ohio. El 2026-06-19 PROD se mudó a Brasil recreando el
-- esquema en un proyecto nuevo; las funciones nacieron de cero y agarraron el
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role` que Supabase deja puesto. `run_sql` volvió a
-- quedar abierta para `anon` y siguió así ~6 semanas, hasta la migración 84.
-- La mudanza verificó los datos con hash MD5 tabla por tabla; los GRANTs no.
--
-- EL BUG DE FONDO, que explica un montón: TODAS las migraciones del repo hacen
-- `REVOKE ALL ON FUNCTION ... FROM PUBLIC` + `GRANT EXECUTE ... TO
-- authenticated`. Es el idioma correcto. Y sin embargo ~90 funciones quedaron
-- ejecutables por `anon`. El motivo es que revocarle a PUBLIC **no toca un grant
-- explícito a un rol**, y el default de Supabase le da a `anon` un grant
-- explícito a cada función nueva. O sea: ese REVOKE estaba escrito, se ejecutó,
-- y no hacía nada. Sacando `anon` del default, el mismo REVOKE pasa a alcanzar.
--
-- LO QUE ESTA MIGRACIÓN **NO** LOGRA — probado en PROD, para que nadie lo
-- asuma: `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
-- NO saca el grant a PUBLIC. PostgreSQL arranca del default hard-wired (que
-- incluye `EXECUTE TO PUBLIC` en toda función) y le **mergea** lo de
-- pg_default_acl; el merge suma privilegios, no los resta. Verificado creando
-- una función descartable después de aplicar ese REVOKE: quedó con ACL
-- `{=X/postgres, postgres=X, authenticated=X, service_role=X}` — el grantee
-- vacío de `=X` es PUBLIC — y `anon`, que es miembro de PUBLIC como cualquier
-- rol, la seguía pudiendo ejecutar. Se deja la sentencia igual porque es inocua
-- y documenta el intento, pero **no reemplaza al REVOKE explícito por función**.
--
-- ENTONCES, EL IDIOMA QUE SÍ FUNCIONA de acá en adelante (dos líneas, y hacen
-- falta las dos si la función es sensible):
--     REVOKE ALL ON FUNCTION public.mi_rpc(...) FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION public.mi_rpc(...) TO authenticated;
-- Comprobado sobre una función de prueba creada después de esta migración: con
-- sólo ese REVOKE FROM PUBLIC quedó `{postgres=X, authenticated=X,
-- service_role=X}` → `anon` afuera, `authenticated` adentro. Antes de esta
-- migración, lo mismo dejaba `anon=X` colgado.
--
-- NO es retroactivo: las funciones que ya existen conservan sus permisos tal
-- cual. Esta migración por sí sola no cierra nada — la 84 cerró los dos
-- agujeros reales y la 86 limpia el resto. Ésta evita que se vuelvan a abrir.
--
-- CONTRAPARTIDA: si en el futuro se agrega un RPC accesible SIN sesión (hoy el
-- único es `rpc_public_create_reservation`), hay que ponerle su
-- `GRANT EXECUTE ON FUNCTION ... TO anon;` explícito. Si se olvida, la reserva
-- pública tira 42501 — falla ruidosa y de una línea de arreglo, que es lo
-- contrario de un agujero silencioso.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Inocua (ver arriba): no saca el grant hard-wired a PUBLIC. Queda por claridad.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Ésta es la que hace el trabajo: saca el grant EXPLÍCITO a `anon` que ponía
-- Supabase, y con eso el `REVOKE ... FROM PUBLIC` de cada migración alcanza.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

COMMIT;
