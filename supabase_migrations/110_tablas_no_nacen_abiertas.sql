-- ─────────────────────────────────────────────────────────────────────────────
-- 110: que una TABLA nueva deje de nacer con TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
--      para `anon` y `authenticated`, y sacarles retroactivamente lo que ya tienen.
--
-- ESTO COMPLETA LA MIGRACIÓN 85, QUE QUEDÓ A MITAD DE CAMINO. La 85 arregló el
-- default de Supabase para FUNCIONES (`ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS`)
-- y nunca tocó el de TABLAS ni el de SEQUENCES. El que lea la 85 y crea que el
-- tema está cerrado se equivoca: siguió vivo el `grant all on tables to anon,
-- authenticated, service_role` que Supabase deja puesto en cada proyecto nuevo,
-- así que toda tabla creada en `public` siguió naciendo abierta.
--
-- EVIDENCIA, LEÍDA DE PROD (pg_class.relacl, 2026-09-17, antes de esta migración):
--
--   cuenta_corriente_movimientos, invoices, invoice_reservations, payments,
--   reservations, cash_shifts, arca_ta, fiscal_private:
--     {postgres=arwdDxtm/postgres, anon=rDxtm/postgres,
--      authenticated=rDxtm/postgres, service_role=arwdDxtm/postgres}
--   fiscal_settings:  anon=rwDxtm  authenticated=rwDxtm
--   admin_alerts, associated_clients, company_passengers, extra_charges, guests,
--   hotel_settings, profiles, reservation_cancellations, room_categories,
--   room_cleaning_log, rooms, y la vista reservations_availability:
--     anon=arwdDxtm  authenticated=arwdDxtm   ← el default crudo, intacto
--   Las 10 sequences de public: anon=rwU  authenticated=rwU
--
--   En esas letras: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, D=TRUNCATE,
--   x=REFERENCES, t=TRIGGER, m=MAINTAIN, U=USAGE.
--
-- POR QUÉ IMPORTA: las migraciones 77 y 97 hicieron lo correcto —
-- `REVOKE INSERT, UPDATE, DELETE ... FROM anon, authenticated`— sobre las tablas
-- de dinero y fiscales, pero eso deja D/x/t/m colgando, y **la RLS no filtra
-- TRUNCATE**. Una policy de SELECT no protege absolutamente nada contra un
-- TRUNCATE: no se evalúa fila por fila, se vacía la tabla entera. Lo mismo vale
-- para MAINTAIN y para TRIGGER (poder colgarle un trigger a una tabla ajena).
-- Y la mitad de las tablas nunca pasó ni por la 77 ni por la 97: `guests`,
-- `rooms`, `profiles`, `extra_charges` y compañía conservan el `arwdDxtm` crudo,
-- o sea también INSERT/UPDATE/DELETE por PostgREST con sólo la anon key.
--
-- POR QUÉ NO ES UNA EMERGENCIA (verificado, no asumido): hoy no hay camino
-- conocido para que anon o authenticated emitan un TRUNCATE. La 84 cerró el SQL
-- arbitrario (`run_sql`/`exec_ddl`) y PostgREST no expone TRUNCATE ni forma de
-- llamarlo. El DML directo que PostgREST sí expone está tapado por RLS: las 21
-- tablas de public tienen RLS activa y las únicas policies que alcanzan a `anon`
-- son los dos `Public read` (rooms, hotel_settings). Esto es defensa en
-- profundidad: sacar el privilegio para que el día que alguien agregue una policy
-- `FOR ALL TO public` de más, o aparezca otra vía de ejecución, no haya nada
-- abajo esperando. La urgencia es la de una deuda, no la de un incendio.
--
-- LO QUE SÍ FUNCIONA EN EL DEFAULT (a diferencia de la 85): la 85 documenta que
-- su `REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` resultó INOCUO, porque el default
-- hard-wired de PostgreSQL incluye `EXECUTE TO PUBLIC` en toda función y
-- pg_default_acl se le MERGEA (suma, no resta). Para TABLAS el default
-- hard-wired NO le da nada a PUBLIC: lo único que las abre es el GRANT EXPLÍCITO
-- a anon/authenticated que puso Supabase, y a un grant explícito sí se le puede
-- hacer REVOKE. Es el mismo caso que el `REVOKE ... FROM anon` de la 85, que sí
-- funcionó (hoy el default de funciones en PROD es `postgres=X | authenticated=X
-- | service_role=X`, sin anon).
--
-- COMPROBADO EN PROD AL APLICAR ESTA MIGRACIÓN (2026-09-17), porque la 85 existe
-- justamente por dar un REVOKE por sentado. Creando una tabla y una sequence
-- descartables después de la sección 1:
--     zz_prueba_acl      → {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--     zz_prueba_acl_seq  → {postgres=rwU/postgres, service_role=rwU/postgres}
-- Ni anon ni authenticated. El REVOKE del default SÍ alcanza para TABLES y para
-- SEQUENCES, al revés que el de FUNCTIONS FROM PUBLIC de la 85. Las dos pruebas
-- se borraron; el procedimiento quedó escrito en la verificación de abajo.
--
-- NO ALCANZA CON EL DEFAULT: `ALTER DEFAULT PRIVILEGES` no es retroactivo, sólo
-- rige para objetos creados DESPUÉS. Por eso la sección 2 repite tabla por tabla.
--
-- LO QUE ESTA MIGRACIÓN NO CUBRE, a propósito: el esquema `storage` tiene su
-- propio default igual de abierto, y hay una segunda entrada en pg_default_acl
-- otorgada por `supabase_admin` (no por `postgres`) que rige para los objetos que
-- cree ESE rol. Las dos son territorio de Supabase, no de la app; nuestras tablas
-- las crea `postgres` vía exec_ddl.
--
-- LO QUE CAMBIA PARA LA PRÓXIMA MIGRACIÓN QUE CREE UNA TABLA: desde acá, una
-- tabla nueva nace SIN permisos para anon ni authenticated. Hay que escribirle su
-- GRANT mínimo, como ya hace la 109 con `cc_pago_imputaciones`:
--     REVOKE ALL ON public.mi_tabla FROM anon, authenticated;
--     GRANT SELECT ON public.mi_tabla TO authenticated;
-- El REVOKE se sigue escribiendo aunque el default ya no otorgue nada: es
-- idempotente, documenta la intención y protege si el default se vuelve a abrir
-- (una mudanza de proyecto lo reinstala, como pasó con Ohio → Brasil). Si alguien
-- olvida el GRANT, la pantalla tira 42501 — falla ruidosa, de una línea de
-- arreglo, que es lo contrario de un agujero silencioso.
--
-- CÓMO SE DECIDIÓ EL GRANT MÍNIMO DE CADA TABLA (sección 2): se revisó
-- `src/lib/data.ts` y `src/app/**/actions.ts` buscando toda escritura directa que
-- hoy funciona, para no romper ninguna. Quedaron exactamente seis:
--   associated_clients  INSERT/UPDATE/DELETE  (src/app/admin/asociados/actions.ts,
--                                              src/lib/data.ts:1461)
--   guests              INSERT/UPDATE/DELETE  (src/app/admin/guests/actions.ts,
--                                              src/lib/data.ts:1428 y 1444)
--   room_categories     INSERT/UPDATE/DELETE  (src/app/admin/categorias/actions.ts,
--                                              src/app/admin/rooms/actions.ts)
--   rooms               INSERT/UPDATE/DELETE  (src/app/admin/rooms/actions.ts)
--   hotel_settings      UPDATE                (src/app/admin/settings/actions.ts)
--   fiscal_settings     UPDATE                (updateFiscalSettings,
--                                              src/lib/data.ts:3767; la 97 ya lo
--                                              conservaba a propósito)
-- Todo el resto de las escrituras pasa por RPC SECURITY DEFINER, que corren como
-- `postgres` y no dependen de estos grants. Se verificó en el catálogo que NINGUNA
-- función de la app es SECURITY INVOKER: las únicas invoker en `public` son
-- helpers puros (app_is_valid_cuit, app_sanitize_detalle, app_is_bank_payment_method,
-- app_default_stay_description) y las *_dist de btree_gist.
--
-- Y `anon` conserva SELECT sólo en las tres relaciones que la landing pública lee
-- sin sesión: rooms, hotel_settings y la vista reservations_availability (las dos
-- primeras tienen su policy `Public read`; la vista corre con los permisos de su
-- dueño `postgres`, por eso anon no necesita SELECT sobre `reservations`).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- Sección 1: que las tablas y sequences NUEVAS no nazcan abiertas.
-- Sólo rige hacia adelante. La sección 2 limpia lo que ya existe.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Sección 2: las tablas que ya existen. Siempre el mismo idioma —
--   REVOKE ALL FROM anon, authenticated;  y después el GRANT mínimo real.
-- REVOKE no falla si el grant no estaba, así que todo el bloque es idempotente.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Sólo lectura de staff: todo lo que escribe pasa por RPC SECURITY DEFINER ──
REVOKE ALL ON public.admin_alerts FROM anon, authenticated;
GRANT SELECT ON public.admin_alerts TO authenticated;

REVOKE ALL ON public.applied_migrations FROM anon, authenticated;
GRANT SELECT ON public.applied_migrations TO authenticated;

REVOKE ALL ON public.cash_shifts FROM anon, authenticated;
GRANT SELECT ON public.cash_shifts TO authenticated;

REVOKE ALL ON public.company_passengers FROM anon, authenticated;
GRANT SELECT ON public.company_passengers TO authenticated;

REVOKE ALL ON public.cuenta_corriente_movimientos FROM anon, authenticated;
GRANT SELECT ON public.cuenta_corriente_movimientos TO authenticated;

REVOKE ALL ON public.extra_charges FROM anon, authenticated;
GRANT SELECT ON public.extra_charges TO authenticated;

REVOKE ALL ON public.invoice_reservations FROM anon, authenticated;
GRANT SELECT ON public.invoice_reservations TO authenticated;

REVOKE ALL ON public.invoices FROM anon, authenticated;
GRANT SELECT ON public.invoices TO authenticated;

REVOKE ALL ON public.payments FROM anon, authenticated;
GRANT SELECT ON public.payments TO authenticated;

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;

REVOKE ALL ON public.reservation_cancellations FROM anon, authenticated;
GRANT SELECT ON public.reservation_cancellations TO authenticated;

REVOKE ALL ON public.reservations FROM anon, authenticated;
GRANT SELECT ON public.reservations TO authenticated;

REVOKE ALL ON public.room_cleaning_log FROM anon, authenticated;
GRANT SELECT ON public.room_cleaning_log TO authenticated;

-- ── Ni siquiera lectura: la app nunca las consulta por tabla, sólo por RPC ────
-- arca_ta guarda el ticket de acceso de ARCA y fiscal_private la clave privada
-- del certificado. Ninguna de las dos aparece en un `.from(...)` del código.
REVOKE ALL ON public.arca_ta FROM anon, authenticated;
REVOKE ALL ON public.fiscal_private FROM anon, authenticated;

-- ── Escritura directa que hoy funciona y NO se puede romper ───────────────────
REVOKE ALL ON public.associated_clients FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.associated_clients TO authenticated;

REVOKE ALL ON public.guests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guests TO authenticated;

REVOKE ALL ON public.room_categories FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_categories TO authenticated;

-- fiscal_settings conserva UPDATE a propósito (updateFiscalSettings, mig 97).
REVOKE ALL ON public.fiscal_settings FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.fiscal_settings TO authenticated;

-- ── Lo que la landing pública lee sin sesión: anon conserva SELECT ────────────
REVOKE ALL ON public.hotel_settings FROM anon, authenticated;
GRANT SELECT ON public.hotel_settings TO anon;
GRANT SELECT, UPDATE ON public.hotel_settings TO authenticated;

REVOKE ALL ON public.rooms FROM anon, authenticated;
GRANT SELECT ON public.rooms TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;

-- La vista corre con los permisos de su dueño (postgres): por eso puede exponer
-- disponibilidad sin que anon tenga SELECT sobre `reservations`.
REVOKE ALL ON public.reservations_availability FROM anon, authenticated;
GRANT SELECT ON public.reservations_availability TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Sección 3: sequences. Tenían rwU para anon y authenticated — `w` es UPDATE, o
-- sea setval: poder reescribir el próximo número de recibo, de remito o de turno
-- de caja. Ninguna RLS mira una sequence.
--
-- Sólo dos hacen falta: las de las dos tablas donde `authenticated` inserta
-- directo (rooms, room_categories) y el id sale del DEFAULT nextval. Las otras
-- ocho (recibo_numero, remito_numero, cash_shift_number, admin_alerts,
-- extra_charges, hotel_settings, reservation_cancellations, room_cleaning_log)
-- sólo las toca un RPC SECURITY DEFINER, que corre como `postgres`.
--
-- El loop es para que no quede ninguna afuera hoy ni cuando se agregue otra.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  s RECORD;
BEGIN
  FOR s IN
    SELECT c.oid::regclass AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated', s.seq);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.rooms_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.room_categories_id_seq TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('110_tablas_no_nacen_abiertas.sql');
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN POST-APLICACIÓN
--
-- 1) Ninguna tabla ni vista de public conserva D/x/t/m para anon o authenticated.
--    Debe devolver 0 filas:
--
--    SELECT c.relname, array_to_string(c.relacl, ' | ') AS acl
--    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
--      AND EXISTS (
--        SELECT 1 FROM aclexplode(c.relacl) a
--        WHERE pg_get_userbyid(a.grantee) IN ('anon','authenticated')
--          AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
--      );
--
-- 2) `anon` sólo puede leer las tres relaciones públicas. Debe devolver
--    exactamente hotel_settings, reservations_availability y rooms, todas SELECT:
--
--    SELECT table_name, privilege_type
--    FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_schema = 'public' ORDER BY 1, 2;
--
-- 3) El default quedó cerrado — lo que la 85 nunca comprobó para tablas. En PROD,
--    donde no hay homologación, se hace con una tabla descartable y se borra:
--
--    CREATE TABLE public.zz_prueba_acl (id int);
--    CREATE SEQUENCE public.zz_prueba_acl_seq;
--    SELECT relname, array_to_string(relacl, ' | ') FROM pg_class
--     WHERE relname LIKE 'zz_prueba_acl%';
--    -- Esperado: sólo postgres y service_role. Si aparece anon o authenticated,
--    -- el REVOKE del default NO alcanzó: anotarlo acá arriba como hizo la 85 con
--    -- las funciones, en vez de dejar creer que el tema quedó cerrado.
--    DROP TABLE public.zz_prueba_acl; DROP SEQUENCE public.zz_prueba_acl_seq;
--
-- 4) Que la app siga andando (son los caminos que tocan los grants que quedaron):
--    landing pública con y sin búsqueda de fechas · alta/edición/borrado de
--    huésped · alta/edición/borrado de cliente asociado · alta/edición/baja de
--    habitación y de categoría · guardar configuración del hotel · guardar datos
--    fiscales · check-in, cobro, check-out y emisión de factura (van por RPC).
-- ─────────────────────────────────────────────────────────────────────────────
