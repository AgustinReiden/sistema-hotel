# HotelSync - Sistema de Gestion Hotelera

HotelSync es un MVP para operacion de recepcion hotelera, construido con **Next.js 16 (App Router)** y **Supabase (PostgreSQL + Auth + RLS)**.

## Stack tecnico

- Framework: Next.js 16, React 19, TypeScript.
- UI: Tailwind CSS 4, Lucide React, Sonner.
- Backend: Server Components + Server Actions.
- Datos: Supabase PostgreSQL + RPC + Row Level Security.
- Validacion: Zod.

## Modelo de seguridad

### 1) Acceso a rutas

- Se usa `src/proxy.ts` (convencion Next.js 16).
- `/admin/*` requiere sesion valida + rol staff.
- Usuarios autenticados sin rol staff se redirigen a `/forbidden`.
- `/login` redirige automaticamente:
  - staff -> `/admin`
  - no staff -> `/forbidden`

### 2) Roles y autorizacion

Roles soportados en `profiles.role`:

- `admin`
- `receptionist`
- `client`

Funciones SQL de apoyo:

- `app_is_staff()`
- `app_is_admin()`

Politicas RLS:

- Lectura/operacion hotelera (`rooms`, `reservations`, `extra_charges`, `hotel_settings`) para staff.
- Update de `hotel_settings` solo para `admin`.
- Lectura de `profiles` para usuario propietario o staff.

## Logica de negocio clave

### Disponibilidad anti-colision

Las reservas activas (`pending`, `confirmed`, `checked_in`) no pueden solaparse por habitacion.  
Se enforcea en DB con constraint `EXCLUDE USING gist` sobre `tstzrange(check_in_target, check_out_target, '[)')`.

### Operaciones atomicas por RPC

Las mutaciones criticas se ejecutan dentro de funciones SQL transaccionales:

- `rpc_create_reservation(...)`
- `rpc_assign_walk_in(...)`
- `rpc_checkout_reservation(...)`
- `rpc_apply_late_checkout(...)`

### Medio dia idempotente

`half_day` se cobra como maximo una vez por reserva mediante indice unico parcial:

- `extra_charges_one_half_day_per_reservation`

## Estructura de proyecto

```text
/src
  /app
    /admin
      /guests
      /settings
      /timeline
    /forbidden
    /login
  /lib
    /supabase
    data.ts
    validations.ts
    types.ts
    error-utils.ts
/supabase_migrations
```

## Migraciones SQL

Orden recomendado:

1. `01_financial_rpc.sql` (historica, inicial)
2. `02_security_roles_rls.sql`
3. `03_integrity_constraints.sql`
4. `04_indexes.sql`
5. `05_reservation_rpcs.sql`
9. `09_finance_module.sql`
10. `10_payment_methods.sql`
11. `11_security_lockdown.sql`
12. `12_financial_fixes.sql`
13. `13_schema_unification.sql`

Importante: si ya tienes datos legacy, corre primero un chequeo de duplicados/solapamientos antes de aplicar constraints de la fase 03.

Prechecks sugeridos:

```sql
-- Solapamientos activos por habitacion.
select r1.id as reservation_a, r2.id as reservation_b, r1.room_id
from reservations r1
join reservations r2
  on r1.room_id = r2.room_id
 and r1.id < r2.id
 and r1.status in ('pending', 'confirmed', 'checked_in')
 and r2.status in ('pending', 'confirmed', 'checked_in')
 and tstzrange(r1.check_in_target, r1.check_out_target, '[)') &&
     tstzrange(r2.check_in_target, r2.check_out_target, '[)');

-- Duplicados de half_day por reserva.
select reservation_id, charge_type, count(*)
from extra_charges
where charge_type = 'half_day'
group by reservation_id, charge_type
having count(*) > 1;
```

## Setup local

1. Instalar dependencias:

```bash
npm install
```

2. Configurar `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

3. Ejecutar desarrollo:

```bash
npm run dev
```

## Calidad y gates

Comandos de verificacion:

```bash
npm run lint
npm run typecheck
npm run build
```

Objetivo: todos en verde antes de deploy.

## Flujo operativo resumido

- Nueva reserva: valida payload -> `rpc_create_reservation`.
- Walk-in: valida payload -> `rpc_assign_walk_in`.
- Check-out: `rpc_checkout_reservation` (reserva + habitacion en una sola transaccion).
- Medio dia: `rpc_apply_late_checkout` (extiende checkout + cargo idempotente).

## Notas de implementacion

- Persistencia de fechas en UTC (`timestamptz`).
- Render de moneda via `Intl.NumberFormat` usando `hotel_settings.currency` (ISO 4217, ej. `USD`, `ARS`).
- `src/lib/data.ts` es server-only y usa cliente Supabase SSR por request.
