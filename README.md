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

No hay CLI ni pipeline de migraciones: se aplican a mano contra Supabase. Ver
[`supabase_migrations/README.md`](supabase_migrations/README.md) para el detalle
completo — cómo escribir una migración nueva, cómo aplicarla, qué está aplicado hoy
(tabla `public.applied_migrations`) y cómo reconstruir la base desde cero.

## Setup local

1. Instalar dependencias:

```bash
npm install
```

2. Configurar `.env.local`:

```env
# Supabase — requeridas. Se hornean en el build y llegan al navegador (NEXT_PUBLIC_).
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Facturacion electronica ARCA — opcionales. Sin ellas, /admin/fiscal queda
# deshabilitado (avisa por consola) pero el check-out sigue funcionando igual.
# Detalle y tramite del certificado en docs/facturacion-arca.md.
ARCA_CERT_B64=...
ARCA_KEY_B64=...
ARCA_INTERNAL_KEY=...

# Notificacion de reserva por WhatsApp via n8n — opcional. Sin ella no se manda
# el mensaje (avisa por consola), no rompe el flujo (src/lib/webhook.ts).
N8N_WEBHOOK_URL=...
```

`SUPABASE_SERVICE_ROLE_KEY` **no** va en el `.env.local` de la app: es sólo para
`scripts/recuperacion/*.mjs` (aplicar migraciones SQL a mano, ver
[`supabase_migrations/README.md`](supabase_migrations/README.md)). Vive únicamente en
el `.env.local` de quien corre esos scripts y **nunca** se prefija `NEXT_PUBLIC_` ni se
referencia desde `src/` — esas variables se hornean en el bundle que llega al navegador.

3. Ejecutar desarrollo:

```bash
npm run dev
```

## Calidad y gates

No hay CI: estos comandos se corren a mano antes de mergear.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`build` hace falta sobre todo si se tocaron dependencias o configuracion — es lo que
corre Coolify al deployar, así que si falla ahí falla el deploy. Objetivo: todos en
verde antes de mergear a `main`.

## Deploy

Sin CI ni staging: Coolify hace build y deploya automaticamente **al pushear a
`main`**. Por eso el trabajo se hace en una rama y PR — mergear a `main` es la acción
que dispara producción, no un paso aparte.

Las migraciones SQL no se aplican solas ni forman parte del deploy: se corren a mano
contra Supabase, por separado, en el orden que indique el PR respecto al momento del
merge (ver [`supabase_migrations/README.md`](supabase_migrations/README.md)).

## Flujo operativo resumido

- Nueva reserva: valida payload -> `rpc_create_reservation`.
- Walk-in: valida payload -> `rpc_assign_walk_in`.
- Check-out: `rpc_checkout_reservation` (reserva + habitacion en una sola transaccion).
- Medio dia: `rpc_apply_late_checkout` (extiende checkout + cargo idempotente).

## Notas de implementacion

- Persistencia de fechas en UTC (`timestamptz`).
- Render de moneda via `Intl.NumberFormat` usando `hotel_settings.currency` (ISO 4217, ej. `USD`, `ARS`).
- `src/lib/data.ts` es server-only y usa cliente Supabase SSR por request.
