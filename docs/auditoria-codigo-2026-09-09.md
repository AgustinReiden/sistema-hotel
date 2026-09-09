# Auditoría de código de punta a punta — HotelSync

**Fecha:** 2026-09-09
**Rama auditada:** `claude/code-audit-end-to-end-1c218e` (equivalente a `main` en c7837fb)
**Estado al cierre del mismo día:** el crítico, los cinco altos y los veinte medios quedaron resueltos en los PRs #62 y #64 a #77, con las migraciones 95 a 98 aplicadas en PROD. La verificación fase por fase, el baseline final y los hallazgos nuevos que dejó la verificación (uno medio: `record_migration` ejecutable por anónimos en PROD) están en `docs/plan-fixes-auditoria-2026-09-09.md`, sección "Verificación del 2026-09-09 (noche)". Lo que sigue es el informe original, sin retocar.
**Método:** baseline automático (typecheck, lint, tests, `npm audit`) + seis revisiones paralelas con Sonnet 5 por área (capa de datos y server actions, base de datos y migraciones, lógica de negocio, facturación ARCA, UI/cliente, configuración y dependencias). Cada hallazgo alto o crítico fue re-verificado a mano contra el código antes de entrar en este informe. Dos hallazgos "ALTO" reportados por subagentes se rebajaron al verificarlos: la autorización de tarifa vieja sin chequeo de rol (la RPC valida `app_is_admin()` en la base) y el descarte de facturas "En verificación" (la UI no muestra el botón para ese estado; queda solo la RPC como defensa en profundidad, ver M-7b). Ambos siguen en el informe con la severidad corregida.

## Baseline

| Chequeo | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| `vitest run` | 16 archivos, 257 tests, todos pasan |
| `eslint` | 3 errores, 1 warning (`react-hooks/set-state-in-effect` en `ConsolidadaClient.tsx:121,126` y `CloseShiftModal.tsx:165`; `isValidCuit` sin uso en `RoomCard.tsx:27`) |
| `npm audit --omit=dev` | 5 vulnerabilidades: 1 crítica (next), 3 altas (postcss, sharp, nanoid), 1 moderada |
| CI | no existe `.github/workflows` |

## Veredicto general

El núcleo financiero y fiscal está bien defendido: las escrituras a dinero pasan por RPC `SECURITY DEFINER` que re-validan rol en Postgres, el solapamiento de reservas lo impide un `EXCLUDE` GiST, la numeración de facturas tiene un índice único como backstop, y los secretos de ARCA nunca tocan la base ni el bundle del cliente. Los problemas encontrados son concretos y acotados: una dependencia con CVE crítico, una inconsistencia de cálculo de noches que cobra mal en salidas anticipadas y extensiones con horarios no estándar, dos acciones admin sin chequeo de rol que además reportan éxito sin guardar, la imposibilidad de reconstruir la base desde el repo, y varias faltas de defensa en profundidad.

---

## CRÍTICO

### C-1. Next.js 16.2.10 con RCE no autenticado y bypass de proxy conocidos
- **Dónde:** `package.json:11`.
- **Qué:** `npm audit` reporta para esta versión RCE no autenticado vía Image Optimization con AVIF (GHSA-2xp9-vwfh-xw4), RCE en hosts Windows, bypass de middleware/proxy en App Router (corregido en 16.2.11), SSRF en Server Actions y confusión de caché. Todo corregido en `next@16.3.4`, sin cambio mayor.
- **Escenario:** `next.config.mjs` acepta imágenes de postimg.cc, imgur y unsplash, dominios que el hotel no controla. Un AVIF malicioso o un request que esquive `src/proxy.ts` compromete el servidor o expone `/admin`.
- **Fix:** `npm install next@16.3.4 eslint-config-next@16.3.4`, correr build y tests, deployar. Esto también resuelve postcss y sharp.

---

## ALTO

### A-1. Salida anticipada usa una fórmula de noches distinta a la que congeló el precio
- **Dónde:** creación: `supabase_migrations/59_guest_spine_reservation.sql:99` (`ceil(epoch / 86400)`) y `src/lib/pricing.ts:9-12`. Salida anticipada: `supabase_migrations/71_shift_close_guard_bi_and_fixes.sql:550-555` (diferencia de fechas calendario) y `src/lib/pricing.ts:41-47` (`countHotelNights`).
- **Qué:** al crear la reserva las noches se cuentan por duración real redondeada hacia arriba; al hacer salida anticipada se cuentan por días de calendario. Coinciden solo cuando la hora de salida es menor que la de entrada (14:00 a 10:00). El picker de `NewReservationModal` acepta cualquier hora (`DateTimePickerField.tsx:166`, `type="time"`). Hay una tercera fórmula: `rpc_extend_reservation` (`76_reservation_writes_via_rpc.sql:57`) divide el precio congelado por `round(epoch / 86400)`, ni `ceil` ni calendario.
- **Escenario:** entrada 03/07 09:00, salida 05/07 10:00. Creación: 49 h, 3 noches congeladas. Salida anticipada el 04/07: `originalNights` = 2, `perNight` = base × 3 / 2. El huésped paga 1.5 noches por una noche dormida. Ocurre igual en el preview de UI y en la RPC.
- **Fix:** unificar el criterio. Lo más simple es que la salida anticipada use las noches originales derivadas de `base_total_price / base_price` congelado, o que la creación cuente noches calendario como el resto del sistema. Agregar test con horarios no estándar en `pricing.test.ts`.

### A-2. Acciones de descuento sin chequeo de rol y con éxito falso
- **Dónde:** `src/app/admin/actions.ts:232-282` (`updateGuestDiscountAction`, `updateCompanyDiscountAction`) y `src/lib/data.ts:1128-1167`.
- **Qué:** son las únicas acciones admin-only sin `assertAdmin()` (guests, cuentas y asociados sí lo tienen). Dependen de RLS, pero un `UPDATE` bloqueado por RLS no devuelve error: afecta 0 filas y la acción responde `{ success: true }`.
- **Escenario:** un recepcionista invoca la acción (las Server Actions se resuelven por id global, no por página). La UI dice "guardado", el descuento no cambió, y el admin después cotiza confiando en un dato que nunca se aplicó.
- **Fix:** agregar `assertAdmin()` y verificar filas afectadas con `.select()` en las dos funciones de `data.ts`.

### A-3. `exec_ddl` y `run_sql` no están definidas en ningún archivo del repo
- **Dónde:** solo aparecen en `REVOKE`/`GRANT` (migraciones 48, 84, 85) y en `scripts/recuperacion/apply-migration.mjs`.
- **Qué:** el procedimiento de recuperación del README aplica todas las migraciones vía `select public.exec_ddl(...)`, pero ninguna migración crea esa función. Tras un restore desde cero no se puede aplicar ni la migración 01. La mudanza a Brasil ya mostró que este tipo de deriva pasa y tarda semanas en notarse.
- **Fix:** extraer `pg_get_functiondef` de PROD y guardarlo como `00_bootstrap.sql` con el `REVOKE` de la 84 incorporado.

### A-4. `CloseShiftModal` arrastra el resultado del cierre anterior al turno siguiente
- **Dónde:** `src/app/admin/caja/CloseShiftModal.tsx:122,163-166`; montado sin `key` en `CajaClient.tsx:275-285`.
- **Qué:** el estado `closed` nunca se resetea al cambiar de turno, y el efecto de carga se salta cuando `closed` es verdadero.
- **Escenario:** admin cierra turno A; recepcionista abre turno B en la misma sesión de navegador; admin vuelve a "Cerrar Turno" y ve el resultado del turno A. No puede llegar al arqueo del turno B sin recargar.
- **Fix:** `key={summary.shift.id}` en el modal, o resetear `closed`/`actualCash` en un efecto atado al id del turno.

### A-5. El módulo de emisión ARCA no tiene ningún test
- **Dónde:** `src/lib/arca/emitter.ts` (recovery, single-flight, barrido de estancadas, reintento por numeración). `arca.test.ts` importa `amounts`, `qr`, `wsaa`, `wsfe`, nunca `emitter`.
- **Qué:** es la pieza cuyo fallo es más caro y la única sin red automatizada.
- **Fix:** mockear `callWsfe` y los RPC; cubrir recovery con y sin CAE, timeout post-envío, rechazo 10016, colisión 23505 y single-flight.

---

## MEDIO

### Fechas y zona horaria
- **M-1.** `src/lib/validations.ts:390-395` (`publicBookingSchema`) calcula "hoy" con `new Date().setHours(0,0,0,0)` en el servidor (UTC). Entre las 21:00 y 24:00 hora Argentina rechaza reservas públicas para hoy como "fecha pasada". Mismo defecto en `src/app/components/PublicSearchForm.tsx:201-206` (fecha por defecto salta a mañana y cambia al hidratar). Fix: `hotelDateKey` como en `arrivals.ts`.
- **M-2.** `src/lib/message-templates.ts:47-57` formatea fechas de WhatsApp sin `timeZone`; `src/lib/calendar.ts:15-24` usa `startOfDay` de date-fns con la zona del runtime. Ambos contradicen la regla del proyecto documentada en `analytics.ts`. Fix: reutilizar los helpers de `time.ts`.
- **M-3.** `src/lib/data.ts:1003` (`getReservationHistory`) calcula la ventana de 60 días con `Date.now()` del servidor en lugar de la zona del hotel.

### Integridad financiera en la base
- **M-4.** `payments.amount` (mig 09) no tiene `CHECK`. Es la única tabla de dinero sin guarda; la validación vive solo en `rpc_register_payment`. Fix: `CHECK (amount > 0)`.
- **M-5.** `payments.reservation_id` tiene `ON DELETE CASCADE` (mig 09:15). Un `DELETE` de reserva por `service_role` borra los pagos en cascada. `invoices` usa RESTRICT y `cuenta_corriente_movimientos` SET NULL. Fix: cambiar a RESTRICT.
- **M-6.** Las tablas fiscales (`invoices`, `fiscal_settings`, `arca_ta`, `fiscal_private`, `cuenta_corriente_movimientos`) nunca recibieron `REVOKE INSERT, UPDATE, DELETE FROM anon, authenticated`. La migración 77 afirma que sí, pero la 72 solo hizo RLS con policies de SELECT. Hoy no explotable, pero es el patrón que la 77 cerró para `reservations`/`payments`. Fix: aplicar el mismo REVOKE.
- **M-7.** `rpc_staff_checkout_reservation` fue reescrita completa en 9 migraciones y ya produjo una regresión financiera silenciosa (mig 64 pisó `checkout_cash_shift_id`, arreglada en 66). No hay test funcional automatizado post-migración. Fix: extender `test-anon-sql-arbitrario.mjs` a un flujo abrir turno, check-in, check-out, cerrar turno.

### Facturación ARCA
- **M-7b.** `rpc_discard_invoice` (`79_facturacion_cuenta_corriente.sql`, líneas 25-44) permite descartar una factura `processing` con más de 2 minutos y `cbte_nro` asignado sin consultar `FECompConsultar`: pone `discarded` y libera el número. Si ARCA ya había autorizado el CAE y el proceso murió antes de persistirlo, ese comprobante queda sin registro local y la reserva vuelve a ser facturable. La UI no expone este camino: `FiscalClient.tsx:177` solo muestra la papelera para `rejected` y `pending`, y "Reintentar" reconcilia bien (`emitter.ts:248-296`). Queda como defensa en profundidad para la Server Action `discardInvoiceAction`, que cualquier staff autenticado puede invocar por id. Fix: en la RPC, rechazar el descarte cuando `status='processing'` y `cbte_nro IS NOT NULL`, con mensaje que indique usar "Reintentar".
- **M-8.** Condición de venta siempre "Contado": `src/app/admin/factura/[invoiceId]/page.tsx:169-171` y `FchVtoPago = hoy` en mig 72:472-476, también para consolidadas de cuenta corriente. Defecto formal frente a RG 1415.
- **M-9.** Una consolidada trabada en `processing` queda invisible: `sweepStaleProcessing` (`emitter.ts:176-199`) solo corre cuando se emite otra factura, y no hay cron ni endpoint que lo dispare solo. Que el recepcionista no vea consolidadas en `rpc_list_pending_invoices` es intencional (comentario 6.4 de la migración 79); el problema es que nadie la reconcilia hasta que un admin entra a `/admin/fiscal`.
- **M-10.** `ensureTa` (`emitter.ts:57-86`) sin lock: dos emisiones concurrentes cerca del vencimiento del TA pueden disparar dos `loginWsaa` y ARCA rechaza el segundo. Ambas fallan con mensaje claro y reintentable; molesto, no catastrófico.

### Capa de datos y errores
- **M-11.** `getManagementDashboardData` (`data.ts:2103-2197`) chequea `error` en 6 de 12 consultas. Si falla `roomsRes`, `activeRooms` queda en 0 y ocupación, ADR y RevPAR dan `Infinity`/`NaN` sin aviso.
- **M-12.** `src/lib/error-utils.ts:17-34` deja pasar el SQLSTATE `42501` a propósito porque las RPC lanzan "Acceso denegado" en español con ese código. Pero una denegación de RLS pura (por ejemplo el INSERT de huésped nuevo en `setGuestPersonalDiscount`) llega con el texto crudo de Postgres en inglés y con nombre de tabla. Fix: enmascarar solo cuando el mensaje contiene "row-level security".

### Configuración y proceso
- **M-14.** `npm run lint` falla con 3 errores preexistentes (ver baseline). El README dice "todos en verde antes de deploy".
- **M-15.** No hay CI. Los 257 tests, lint y typecheck solo corren si alguien se acuerda. Fix: workflow mínimo lint + typecheck + test + build en PR a `main`.
- **M-16.** CSP en `Report-Only` desde hace ~2 meses (`next.config.mjs:9-23`) sin `report-to`, así que no bloquea ni reporta nada útil.
- **M-17.** `useSearchParams()` sin `Suspense` en `PublicSearchForm.tsx:199`; no hay ningún `<Suspense>` en `src/app`. Puede romper el build o el pre-render estático de la landing en una actualización de Next.
- **M-18.** `@supabase/ssr` 0.8.0 contra 0.12.7 disponible. Es el paquete que maneja las cookies de sesión en el proxy.

### Defensa en profundidad (no explotable hoy, la RPC o el middleware bloquean)
- **M-19.** `src/app/admin/mantenimiento/actions.ts` y `src/app/admin/settings/actions.ts:89-133` (`updateProfileAction`, que puede ascender a admin) no llaman `assertAdmin()`. Las RPC `rpc_authorize_old_tariff` (mig 69) y `rpc_admin_update_profile` sí validan `app_is_admin()`, y el middleware bloquea `/admin/settings`. Conviene igualar el patrón de los módulos hermanos.
- **M-20.** `src/app/admin/layout.tsx` no redirige si `!user`; depende del matcher de `src/proxy.ts`. `maintenance/layout.tsx` sí lo hace.

---

## BAJO

- Código muerto: `checkRoomAvailability` (`data.ts:1322-1337`), `computeAmounts` (`arca/amounts.ts:9-18`, solo lo usa el test), `isValidCuit` importado sin uso en `RoomCard.tsx:27`.
- `getRoomsNeedingCleaning` (`data.ts:2934`) ignora el `error` de la consulta de últimas reservas.
- `calculateReservationPriceBreakdown` no acota el total a cero si el descuento supera 100% (`pricing.ts:104-164`); la validación vive solo en zod.
- `GuestModal.tsx:36-78` muestra un frame con los datos del huésped anterior al cambiar de `guestId`.
- Parseo de montos con `parseFloat(v.replace(",", "."))` en `CloseShiftModal.tsx:181`, `EditReservationModal.tsx:105`, `ExtraChargesModal.tsx:41`. Hoy protegidos por `type="number"`; "1.500,00" daría 1.5 si cambia el input.
- `DiscountsManager.tsx:104-107`: Enter repetido llama `handleSave()` sin guard de `saving`.
- `src/app/login/page.tsx:21` llama `login()` sin try/catch: los errores de credenciales vuelven como `{ error }` y se muestran bien, pero una excepción de red deja el botón en "Verificando..." sin aviso. `rpc_open_cash_shift` en `login/actions.ts:36` no lanza (el cliente de Supabase devuelve `{ error }`), así que ahí no hay problema.
- `associated_clients` permite `DELETE` directo por RLS (mig 63) en lugar de vía RPC, inconsistente con el resto. **Revisado en Fase 12 (2026-09-09): queda pendiente a propósito.** No es un agujero (la policy exige `app_is_admin()`, igual que las RPC del resto del sistema) — es una inconsistencia de patrón. Pasarlo a RPC implica tocar `src/app/admin/asociados/actions.ts` (que hoy borra con `supabase.from("associated_clients").delete()` directo) y sumar una migración nueva; mejor hacerlo junto con la próxima migración de ese módulo en lugar de una migración de una sola línea.
- `supabase_schema.sql` describe el MVP inicial (110 líneas, sin `payments`, `invoices`, `guests`); `README.md` raíz lista migraciones hasta la 13 y omite `ARCA_*` y `N8N_WEBHOOK_URL`. `supabase_migrations/README.md` sí está al día.
- `.claude/settings.local.json` trackeado en git; sin secretos, pero expone rutas locales.
- `sanitizeDetalleLine` (`billing.ts:82-89`) puede cortar un emoji a mitad de par subrogado en el límite de 80/200 caracteres.
- `formatMoney` (`format.ts:1-15`) cae a USD en silencio si la moneda es inválida.
- Accesibilidad: modales sin `role="dialog"`/Escape (`BookingModal`, `CloseShiftModal`, `CalendarClient`); barras del calendario solo con mouse.
- Cobertura: `fiscalSettingsSchema` sin tests; `time.ts` solo cubierto parcialmente.
- Warning de Turbopack por lockfiles duplicados en el worktree; `@supabase/supabase-js` declarado en `dependencies` pero solo lo usan los scripts.

---

## Lo que está bien hecho

- Escrituras a `reservations`, `payments`, `cash_shifts` e `invoices` solo vía RPC `SECURITY DEFINER` que validan rol y estado en Postgres; sin GRANT de escritura a `anon`/`authenticated` (mig 76/77).
- `EXCLUDE` GiST contra solapamiento de reservas (mig 03); índice único `invoices_number_uq` como backstop de numeración; locks con orden documentado (mig 78); apertura de caja idempotente.
- Certificado y clave ARCA solo en env server-only, nunca en la base ni en logs; doble candado `app_is_staff()` + `ARCA_INTERNAL_KEY` hasheada; clasificación de errores de red que habilita recovery seguro con `FECompConsultar`; ningún texto libre del usuario llega al XML de WSFE.
- `analytics.ts` hace toda la aritmética temporal sobre claves de fecha en zona del hotel; `arrivals.ts` resuelve bien el no-show; `csv.ts` neutraliza inyección de fórmulas; `isValidCuit` implementa módulo 11 correctamente.
- Vista `reservations_availability` sin PII para el booking anónimo; allowlist de hosts de imágenes en el `RoomCard` público.
- Guardas anti doble click en casi todos los botones que disparan server actions; `ThermalAutoPrint` bien resuelto contra copias extra.
- Autoauditoría de deriva: registro de migraciones (mig 91), captura de funciones fantasma (mig 90), restitución de CHECK perdidos (mig 92), test de regresión `test-anon-sql-arbitrario.mjs` nacido de un incidente real.

## Orden sugerido de acción

1. C-1: subir Next a 16.3.4 (una tarde, sin cambios de API).
2. A-2: chequeo de rol y filas afectadas en las acciones de descuento.
3. A-1: decidir el criterio único de noches y aplicarlo en SQL y TypeScript con test.
4. A-3: `00_bootstrap.sql` con `exec_ddl`/`run_sql` desde PROD.
5. A-4, M-14, M-17: arreglos de UI puntuales y dejar lint en verde.
6. M-15: CI mínimo para que lo anterior no vuelva a degradarse.
7. M-4, M-5, M-6, M-7b en una sola migración de guardas de base.

El plan de ejecución por sesiones, con prompts y modelo sugerido, está en `docs/plan-fixes-auditoria-2026-09-09.md`.
