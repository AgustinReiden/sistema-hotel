# Migraciones

Las migraciones se aplican **a mano** contra Supabase. No hay CLI ni pipeline: se corre
el SQL con `select public.exec_ddl('...')` desde el conector de Supabase (que es
solo-SELECT, por eso todo pasa por esa función).

## Qué está aplicado

Lo dice la tabla `public.applied_migrations` (creada en la migración 91):

```sql
select filename, applied_at, source, notes
from public.applied_migrations
order by filename;
```

- `source = 'migracion'` → se anotó al aplicarla; `applied_at` es la fecha real.
- `source = 'backfill'` → se dedujo del estado de la base el 2026-09-08 cruzando cada
  archivo contra el catálogo (`pg_proc`, `pg_class`, `pg_constraint`, `pg_policies`,
  `information_schema`). Está aplicada, pero no sabemos cuándo. `applied_at` es NULL.

Antes de la 91 no había registro: `supabase_migrations.schema_migrations` (la tabla del
CLI) quedó congelada en la migración 42 y de la 43 en adelante no quedaba rastro.

## Cómo escribir una migración nueva

1. Numerala con el siguiente número libre. **Fijate que no exista ya**: hay dos
   archivos que empiezan con `59_` porque eso ya pasó una vez.
2. Arrancá con un comentario que explique **por qué**, no qué. El qué se lee en el SQL.
3. Envolvé todo en `BEGIN; ... COMMIT;`.
4. Hacela idempotente donde se pueda (`IF NOT EXISTS`, `CREATE OR REPLACE`,
   `DROP ... IF EXISTS`, `ON CONFLICT DO NOTHING`).
5. Terminá anotándola en el registro, justo antes del `COMMIT`:

```sql
DO $$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('NN_nombre_del_archivo.sql');
  END IF;
END $$;
```

El `IF` es para que el archivo siga corriendo tal cual en una base reconstruida desde
cero, donde las migraciones 01–90 corren antes de que exista `record_migration`.

## Cómo aplicarla

`exec_ddl` corre todo en **una sola transacción implícita**, así que:

- **No** incluyas `BEGIN;` / `COMMIT;` en lo que le pasás a `exec_ddl` — el archivo los
  tiene para cuando se corre con `psql`, pero por `exec_ddl` hay que sacarlos.
- Si un paso falla, se revierte todo. Es lo que querés.
- Usá un tag de dólar propio para el literal (`$mig92$ ... $mig92$`) y dejá `$$` y
  `$function$` para los bloques de adentro.

```sql
select public.exec_ddl($mig92$
  ... el contenido del archivo, sin BEGIN/COMMIT ...
$mig92$);
```

Para migraciones largas conviene partirlas en varias llamadas (datos primero, después
funciones, después constraints) y verificar entre una y otra. Si tocás datos, sacá una
foto de los totales antes y después.

## Reconstruir desde cero

Si hay que levantar la base de nuevo (restore, proyecto nuevo, mudanza de región), el
orden es:

1. **`00_bootstrap_exec_ddl.sql` a mano**, con psql o el SQL editor del panel de
   Supabase — nunca con `exec_ddl` ni con `apply-migration.mjs`, porque en una base
   recién creada ninguno de los dos existe todavía. Es el único archivo de esta carpeta
   con esa restricción: crea `run_sql` y `exec_ddl`, que son las funciones de las que
   dependen todos los pasos siguientes.
2. **`01` hasta la última, en orden numérico, vía `apply-migration.mjs`** (necesita
   `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`, ver `scripts/recuperacion/apply-migration.mjs`):

   ```bash
   for f in supabase_migrations/[0-9]*.sql; do
     [ "$f" = "supabase_migrations/00_bootstrap_exec_ddl.sql" ] && continue
     node scripts/recuperacion/apply-migration.mjs "$f" || break
   done
   ```

   Cada llamada es atómica (si un archivo falla, no aplica nada de ese archivo y el
   loop corta ahí — revisar el error antes de seguir). Las migraciones 01–90 corren
   antes de que exista `record_migration()` (llega recién en la 91); el
   `IF to_regprocedure(...)` que lleva cada migración desde la 91 está pensado
   exactamente para este caso — no falla, simplemente no anota nada hasta llegar a la 91.
3. **`node scripts/recuperacion/test-anon-sql-arbitrario.mjs`** para verificar permisos,
   no sólo datos.

**La lección de este repo, para no repetirla:** la mudanza de PROD Ohio → Brasil del
2026-06-19 clonó el esquema completo 1:1 y verificó los datos con hash MD5 tabla por
tabla — pero no los GRANTs. `run_sql` (que la migración 48 ya había cerrado a `anon` en
Ohio) volvió a quedar ejecutable por `anon` en Brasil y siguió así ~6 semanas, hasta la
migración 84 (la 85 explica por qué el `REVOKE ... FROM PUBLIC` de siempre no alcanzaba).
Después de cualquier restore, mudanza de proyecto o clonado de esquema: correr el paso 3
explícitamente. Clonar el esquema no garantiza clonar los permisos correctos.

## Deriva

Lo que se aplica directo a la base sin escribir el archivo **se pierde**. Ya pasó: tres
funciones de facturación de cuenta corriente vivían solo en PROD, y una de ellas dejó
`/admin/fiscal/consolidada` rota porque la app seguía llamando al nombre viejo (ver
migración 90).

Para detectar deriva, comparar el catálogo contra lo que declaran los archivos:

```sql
-- Funciones de la app que existen en la base (sacando las de extensiones)
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.proname not like 'gbt%'
order by 1;
```

y buscar cada nombre en `supabase_migrations/`. Si no aparece, es deriva.
