# Solapamiento entre Cuentas corrientes y Control de facturación

**Fecha:** 2026-09-18 · **Base auditada:** PROD (`xoqxbtlpppsyzccljjxp`, Brasil), sólo lectura
**Alcance:** las cuatro pantallas que hoy contestan "¿esto está facturado?", más el badge del menú.
**Método:** leer el código y **contar contra PROD**. Ningún número de este documento es una estimación.

---

## Veredicto

**El problema no es que haya cuatro pantallas. Es que cada una usa una ventana de fechas
distinta para el mismo dato, y ninguna avisa.**

En PROD hay 410 check-outs (desde 2026-07-01) y **286 estadías pendientes de facturar**. Esto
es lo que muestra hoy cada lugar, al mismo tiempo, sin tocar un solo filtro:

| Dónde | Ventana por defecto | Muestra hoy |
|---|---|---|
| `/admin/fiscal` → "Check-outs sin facturar" | 10 días, fija en SQL | **28** |
| `/admin/fiscal/control` → la tabla al abrir | mes en curso | **64** |
| Badge del menú "Control de facturación" | 60 días, y sólo `falta` | **165** |
| `/admin/fiscal/control` → aviso "histórico" | 3650 días | **286** |
| La realidad | todo el historial | **286** |

Un solo clic: el badge dice **165**, y la pantalla que ese badge abre dice **286** en su aviso
y **64** en su tabla. Tres números para la misma pregunta, en la misma pantalla.

La consecuencia concreta: **222 estadías pendientes no se ven al abrir el control**, porque
quedaron fuera del mes en curso. Una estadía sin facturar de hace cuatro meses —justo la que
hay que ver— es invisible en las cuatro pantallas salvo que alguien sepa cambiar el rango a
mano.

Esto ya se sabía. Está escrito en el código, en `src/app/admin/fiscal/control/page.tsx:82-84`:

> Cuánto falta facturar EN TODO EL HISTORIAL, no sólo en el rango que se ve. Sin esto, una
> estadía de hace cuatro meses no aparece en ninguna pantalla: el listado abre en el mes en
> curso y el badge del menú mira 60 días.

El parche fue **agregar una segunda consulta** cuyo único trabajo es decirte el número que no
podés ver. El arreglo es al revés: que el listado abra sobre lo que hay que ver, y que la
segunda consulta sobre.

---

## 1. Qué contesta cada pantalla hoy

### `/admin/fiscal` — "Facturación"

Está en la sección **Recepción** del menú (`src/app/admin/nav-links.ts:71`): la ven todos los
roles. Es la pantalla del que atiende el mostrador, no la del que controla.

| Bloque | Fuente | Ventana por defecto |
|---|---|---|
| "Pendientes y con error" | `rpc_list_pending_invoices()` | sin fechas; si no sos admin, sólo tu turno |
| "Check-outs sin facturar" | `rpc_list_invoiceable_checkouts()` | **10 días, hardcodeada en SQL** |
| "Emitidas" | query directa a `invoices` (`src/lib/data.ts:4133-4145`) | **1º del mes → hoy** |

La ventana del bloque del medio no viaja desde el front: la RPC no toma parámetros. Está en
`supabase_migrations/80_nota_credito_y_decision_facturacion.sql:806-809`:

```sql
AND (
  (public.app_is_admin() AND r.actual_check_out > NOW() - INTERVAL '10 days')
  OR r.checkout_cash_shift_id = public.app_current_open_shift()
)
```

Para un recepcionista eso es exactamente lo correcto: su turno abierto, su cola de trabajo.
Para un admin son 10 días que **nadie eligió y que la pantalla no dice**. Además el bloque sólo
mira `facturacion_modo = 'por_checkout'`, así que los clientes de consolidada no aparecen nunca.

El rango de "Emitidas" (`fiscal/page.tsx:39-42`) sí es un filtro de verdad, va en la URL
(`?desde=&hasta=`) y tiene presets.

### `/admin/fiscal/control` — "Control de facturación"

Admin únicamente (`control/page.tsx:56-59`). Hace **dos** consultas para el mismo concepto:

- El listado → `rpc_list_billing_control(p_from, p_to, p_client_kind, p_client_id)`, con default
  **1º → último día del mes** (`currentMonthRange()`, `control/page.tsx:33-40`). Nótese: hasta
  fin de mes, no hasta hoy — ni siquiera "mes en curso" significa lo mismo que en `/admin/fiscal`.
- El aviso "histórico" → `countBillingPending(3650)` (`DIAS_HISTORICO`, `control/page.tsx:21`),
  que suma `falta + pendiente_consolidada`.

Es la única pantalla con **todos sus filtros en la URL**: `desde`, `hasta`, `cliente`, `estado`,
`cobro`, `rastro` (`control/page.tsx:47-54`).

### `/admin/fiscal/consolidada` — "Factura consolidada"

Admin. → `rpc_list_cc_account_stays(kind, id, from, to)`, con default
`{from: "", to: ""}` = **"Todo"** (`ConsolidadaClient.tsx:112-113`) y filtro de estado
"pendientes". Es la **única de las cuatro que abre sin recorte temporal**, y es la que menos lo
necesita, porque ya está acotada a un cliente.

No es un listado de control: es el **taller de emisión** (elegir estadías, armar el detalle,
completar el receptor, emitir). Toma `?kind` e `?id` para preseleccionar el cliente.

### `/admin/cuentas` — "Cuenta Corriente"

Admin. → `getCtaCteAccounts()`, **sin ningún filtro de fechas**: suma todos los movimientos
históricos. El botón "Facturar" de cada fila no es una acción, es un link
(`CuentasClient.tsx:106`):

```tsx
<Link href={`/admin/fiscal/consolidada?kind=${a.kind}&id=${a.id}`}>Facturar</Link>
```

Eso ya es exactamente el patrón correcto: entrar a la pantalla dueña con el filtro puesto.

### El badge del menú

`src/app/admin/layout.tsx:73-76` llama `countBillingPending()` **sin argumento**, o sea su
default de 60 días, y se queda **sólo con `.falta`**, descartando `pendiente_consolidada`. El
título del badge lo dice literalmente (`nav-links.ts:94`): *"…en los últimos 60 días"*.

Es un quinto criterio, y es el que el dueño del hotel ve todo el día.

---

## 2. Qué se pisa, y cuál queda como fuente única

### Fuente única de "qué falta facturar": `/admin/fiscal/control`

Es la única que:

- **cubre toda estadía cerrada**. Las otras tres son subconjuntos estrictos: `/admin/fiscal`
  sólo `por_checkout` y 10 días; la consolidada arranca de `cuenta_corriente_movimientos`, así
  que sólo ve cuenta corriente de un cliente.
- **resuelve los siete estados** (`falta`, `pendiente_consolidada`, `facturado`,
  `facturado_consolidado`, `facturado_externo`, `en_proceso`, `no_corresponde`).
- **es deep-linkable por todos sus filtros**, ya hoy, sin tocar nada.
- tiene las acciones por fila (Facturar, Consolidar, Ya facturado), el marcado en lote y el CSV
  del contador.

Las otras tres pasan a entrar por link con el filtro puesto, o se quedan en su rol propio.

### Lo que NO se pisa, aunque lo parezca: "Emitidas" vs. la solapa "Facturas"

La intuición dice que `/admin/fiscal` → "Emitidas" y la solapa "Facturas" de la ficha del
cliente listan lo mismo con distinto filtro. **No es así**, y conviene dejarlo escrito para no
borrar algo que hace falta.

| | "Emitidas" | Solapa "Facturas" |
|---|---|---|
| Eje | por fecha de comprobante | por cliente |
| Estados | sólo `authorized` | **todos** (incluye pendientes y con error) |
| Alcance | todos los clientes | uno |
| Datos propios | neto, IVA, total, CUIT | cantidad de estadías, cobro imputado |
| Para qué | **libro de IVA ventas** (CSV para el contador) | **estado de cuenta del cliente** |

Son dos cortes de `invoices` para dos preguntas distintas. Borrar cualquiera de las dos pierde
una capacidad real. **Se quedan las dos, como están.**

---

## 3. Hallazgos secundarios

Ninguno de estos se toca en este cambio. Quedan documentados.

### 3.1 El control es el único sin la rama de rescate por `invoices`

El predicado canónico de "esta estadía ya está facturada" tiene dos mitades: una factura viva
en `invoices`, o un vínculo vivo en `invoice_reservations`.
`rpc_count_billing_pending` (mig 82:284) y `rpc_list_cc_account_stays` (mig 111:822) miran las
dos. `rpc_list_billing_control` (mig 83:290-303) mira **sólo la segunda**.

En teoría, una reserva con factura viva pero sin vínculo vivo saldría como `falta` en el
listado y a la vez no se contaría en el badge.

**Verificado contra PROD: 0 filas en esa situación.** El trigger
`app_sync_invoice_reservation_link` (mig 111:906) mantiene las dos tablas alineadas. Es una
divergencia **latente, no un bug activo**. Arreglarla es una migración sobre una RPC del
circuito de emisión; queda como seguimiento y fuera del alcance de este cambio.

### 3.2 `invoice_decision = 'no'` se trata distinto en cada lado

Una estadía donde el recepcionista eligió "no facturar" desaparece de
`rpc_list_invoiceable_checkouts`, pero **sigue sumando en el badge** y **sigue saliendo como
`falta`** en el control. Son **2 estadías** en PROD.

No es un error de código: son tres funciones que responden a preguntas distintas. Pero con el
control como dueño, esas 2 pasan a estar a la vista y a ser accionables ("Ya facturado", o
revisar la decisión).

### 3.3 `en_proceso` entra en un criterio y no en el otro

El grupo "pendiente" de la pantalla (`billingGrupo`, `src/lib/billing.ts:181`) incluye
`en_proceso`; `isPendingBilling` (`billing.ts:298`), que es el espejo declarado de
`rpc_count_billing_pending`, no. Hoy son **0** en PROD, así que los números cierran por
casualidad. La divergencia es estructural: por eso el número del encabezado del control tiene
que salir de `isPendingBilling`, que es el mismo que usa el badge.

### 3.4 Ninguna de las RPC tiene test

Las siete funciones que definen "facturado / no facturado" no están ejercitadas por ningún
test. Toda la cobertura del repo es de funciones puras de TS. La única validación que existe de
esos criterios es manual: `docs/auditoria-facturacion-fiscal.md` (dry runs abortados contra
PROD, 2026-09-08).

---

## 4. Qué se elimina, qué se convierte en link, qué se queda

| Se elimina | Se convierte en link | Se queda como está |
|---|---|---|
| `DIAS_HISTORICO = 3650` y su consulta `countBillingPending(3650)` en el control | `/admin/fiscal` → `/admin/fiscal/control?estado=pendiente`, sólo para admin | El bloque "Check-outs sin facturar" y su SQL: es la cola del turno |
| El aviso "histórico" y su botón "Ver todas" | "Facturar" de `/admin/cuentas` y de la ficha (ya lo eran) | "Emitidas" y la solapa "Facturas" (ver §2) |
| `currentMonthRange()` del control | "Consolidar" por fila del control (ya lo era) | La consolidada entera: es el taller de emisión |
| El botón "Factura consolidada" sin parámetros del control | | Toda migración y todo el circuito de emisión |
| El "60 días" del badge | | |

**Ninguna ruta se elimina**, así que no hace falta ningún redirect: los links guardados siguen
funcionando.

El saldo es **una consulta menos** por carga del control, y **un solo número**: el badge y la
pantalla que abre dicen los mismos 286.
