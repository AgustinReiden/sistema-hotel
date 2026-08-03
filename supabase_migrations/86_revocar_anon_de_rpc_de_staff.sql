-- ─────────────────────────────────────────────────────────────────────────────
-- 86: sacarle a `anon` el EXECUTE sobre todas las funciones de `public` menos la
--     única que la reserva pública necesita.
--
-- POR QUÉ, si ninguna era explotable: todas arrancan con `app_is_staff()` /
-- `app_is_admin()` y sin sesión `auth.uid()` es NULL, así que hoy devuelven
-- "Acceso denegado". Esto es defensa en profundidad: la guarda deja de ser lo
-- ÚNICO que separa a un anónimo de un RPC de caja o de facturación. Si mañana
-- alguien escribe un RPC y se olvida la guarda, el permiso ya no lo espera.
--
-- POR QUÉ LAS MIGRACIONES ANTERIORES NO ALCANZARON (la parte que importa):
-- todas hacen `REVOKE ALL ON FUNCTION ... FROM PUBLIC` — el idioma correcto —
-- y aun así `anon` seguía pudiendo ejecutarlas. El motivo es que Supabase tiene
-- un `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role`, así que cada función nace con un grant
-- EXPLÍCITO a `anon`, y revocarle a PUBLIC no toca un grant explícito a un rol.
-- El REVOKE de esas migraciones estaba, se ejecutó, y no servía para nada.
-- La migración 85 sacó a `anon` de ese default, así que de acá en adelante el
-- idioma `REVOKE ... FROM PUBLIC` que ya usa el repo alcanza solo. Esta 86
-- limpia lo que quedó de antes.
--
-- QUÉ NO TOCA:
--   - `rpc_public_create_reservation`: es la reserva desde la web pública, la
--     única RPC que un visitante sin sesión invoca de verdad (verificado: fuera
--     de /admin la única otra llamada es `rpc_open_cash_shift` en el login, y
--     corre DESPUÉS de autenticar, o sea como `authenticated`).
--   - Funciones que devuelven `trigger`: no son invocables directamente y sus
--     disparos no chequean EXECUTE del usuario. Se excluyen por prudencia.
--   - **Funciones de extensiones.** `btree_gist` vive en `public` y aporta 188
--     de las 250 funciones que `anon` puede ejecutar. Son comparadores que usa
--     la maquinaria de índices GiST por dentro, sin acceso a datos: revocarlas
--     no suma seguridad y sí puede romper índices. Se filtran por `pg_depend`
--     (deptype 'e'). Quedan 62, que son las de la app — el objetivo real.
--   - `authenticated` y `service_role`: conservan su grant explícito. Revocarle
--     a PUBLIC no los afecta.
--
-- SEGURO PARA LA WEB PÚBLICA: las únicas policies de RLS que alcanzan a `anon`
-- son `Public read hotel_settings` y `Public read rooms`, ambas `USING (true)`,
-- sin llamadas a funciones. (Importa porque las policies se evalúan con el rol
-- de quien consulta: una policy que llamara a un helper se rompería si `anon`
-- perdiera el EXECUTE sobre ese helper.)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $mig$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS firma
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prorettype <> 'pg_catalog.trigger'::regtype
      AND p.proname <> 'rpc_public_create_reservation'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      -- Excluir lo que pertenece a una extensión (btree_gist): ver cabecera.
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.firma);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.firma);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Revocado EXECUTE a anon en % funciones de public.', n;
END
$mig$;

COMMIT;
