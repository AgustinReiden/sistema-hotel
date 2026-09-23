# Reorden de UX del panel — plan de implementación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o superpowers:subagent-driven-development). Un PR por sesión: tomá una ficha, escribí su plan detallado si hace falta, implementá, abrí el PR y no lo mergees.

**Goal:** que recepción y el dueño encuentren todo en menos lugares y con menos errores. El menú del admin pasa de 17 entradas a 7 secciones y el de recepción queda en 4. Suma un buscador global, una sola ficha de cliente, cobro en varios medios y una campana de avisos. Antes de eso se arreglan los errores que hoy hacen perder plata o facturas: el medio de pago preseleccionado, el DNI que traba la factura, la consolidada sin revisión y el aviso de habitación ocupada que no se cierra.

**Architecture:** no cambia ninguna URL. Cada sección del menú agrupa con pestañas las rutas que ya existen. Una ruta nueva solo entra si la vieja redirige con los mismos filtros. Las migraciones arrancan en la 117 y cada una tiene su número fijo en la tabla de [Numeración de migraciones](#numeración-de-migraciones): no inventes otro. El orden va por riesgo: primero la base (P), después lo que hoy hace perder plata o facturas (F0), el menú y la navegación (F1), el cobro y los formularios (F2), clientes y cuenta corriente (F3), Hoy, la tarjeta de habitación y mantenimiento (F4) y al final el sistema visual y los textos (F5). El trabajo se reparte en carriles: dentro de un carril los PRs van en fila porque tocan los mismos archivos, y los carriles distintos avanzan en paralelo.

**Tech Stack:** Next.js 16 (App Router, server components, server actions) · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres, RLS, RPCs SECURITY DEFINER) · Zod · Sonner · Vitest + Testing Library.

**Informe de la auditoría:** https://claude.ai/artifact/4ZUTS8XuHeLY4cYJgBYxue · **Decisión previa:** `docs/solapamiento-cuentas-facturacion.md`.

**Menú objetivo**
- **Admin (7):** Hoy · Reservas (Calendario · Solicitudes · Por llegar · Historial) · Caja (Turno · Rendiciones) · Facturación (Por facturar con chip "Últimos 10 días" · Con error · Emitidas · Remitos) · Clientes · Tablero (General · Por habitación · Cobros del día · Limpiezas) · Configuración (Hotel y mensajes · Habitaciones y tarifas · ARCA · Usuarios). Arriba: buscador global y campana.
- **Recepción (4):** Hoy · Reservas · Caja · Facturación (Con error). No ve Historial, Por facturar, Emitidas, Remitos, Clientes, Tablero ni Configuración.
- **Celular del admin:** Hoy · Reservas · Caja · Tablero · Más.

## Decisiones del dueño (23/09/2026)

1. El saldo de una empresa es SOLO el de cuenta corriente; "reservas − cobrado" pasa al Tablero como "facturado contra cobrado" (el nombre final es Q5).
2. "Sin facturar (10 días)" pasa a ser un atajo "Últimos 10 días" dentro de Facturación › Por facturar (actualiza `docs/solapamiento-cuentas-facturacion.md` §4).
3. Recepción cobra en varios medios en el check-out y puede registrar un cobro a cuenta o una seña antes del check-out.
4. Buscador global (nombre, DNI, CUIT, habitación) para admin y recepción; recepción ve un resumen de solo lectura (descuento, si debe, última estadía, reserva activa).
5. Mantenimiento: "Reportar desperfecto" (llega a la campana del admin), link "Ver como mantenimiento", y su pantalla se actualiza sola.
6. Orden por riesgo, PRs chicos e independientes (1-2 días), plan en `docs/plans/`.

## Reglas de este repo (leer antes de empezar)

- **Ramas y PRs:** una rama por PR, siempre desde `origin/main`. Se abre el PR y NUNCA se mergea: mergea Agustín, y al mergear Coolify despliega a PROD.
- **Repo público:** nada de nombres de clientes, CUIT, emails, IDs ni la URL de Supabase en archivos versionados. Los tests usan nombres ficticios y CUIT inventados pero válidos.
- **Windows + CRLF:** se edita con la herramienta de edición, no con `sed`.
- **Comandos:** `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Los cuatro últimos en verde antes de abrir el PR (el check "ci" corre lint en GitHub Actions).
- **Base de PROD:** el conector MCP `supabase-sistema-hotel-prod` es solo lectura. El DDL va con `select public.exec_ddl($mNNN$ ... $mNNN$)`, sin `BEGIN`/`COMMIT`, sin `;` final y sin comillas en los comentarios SQL. Se aplica SOLO con OK explícito de Agustín, ANTES del deploy del código que la usa, y después se verifica su fila en `public.applied_migrations` (columna `filename`). Toda migración nueva llama a `public.record_migration()`.
- **Deriva con PROD:** si una migración cambia una función que ya existe, se parte de `pg_get_functiondef` en PROD y no del archivo del repo.
- **Verificar en el navegador:** en `npm run dev` los client components de página no hidratan. Se verifica con `npm run build && npm start` o en PROD después del deploy.
- **Tests con Testing Library:** buscar por texto o `aria-label`; `getByRole` sobre toda la pantalla es lento en jsdom y ya causó timeouts (PR #131).
- 👤 **AGUSTÍN:** en cada ficha, esta marca dice lo que hace él y nadie más: dar el OK para aplicar una migración, contestar las preguntas del cuestionario (Q1-Q11), mergear y probar con recepción.

**Restricciones de producto (valen para todos los PRs)**
- No cambia ninguna URL: secciones con pestañas sobre las rutas actuales; ruta nueva solo si la vieja redirige con los mismos filtros.
- Control de facturación es la pantalla dueña de "qué falta facturar". "Emitidas" y la solapa "Facturas" de la ficha no se fusionan.
- A la consolidada se entra siempre con el cliente puesto.
- La campana muestra solo `admin_alerts` (RLS de admin); los avisos de recepción siguen en Hoy.
- Recepción no gana el poder de cancelar estadías cerradas.
- Estética: menú oscuro slate + verde de la marca; el color primario es `brand-700`.

## Ya hecho

- **PR #129 (mergeado 23/09): Finanzas solo para el admin.** Recepción veía el efectivo del día en `/admin/finances`. Ahora lo cierran la página (`src/app/admin/finances/page.tsx`), el middleware (`src/lib/supabase/middleware.ts`) y el test `src/__tests__/middleware-roles.test.ts`.
- **PR #130 (mergeado 23/09): montos a la argentina.** `parseArMoney` (`src/lib/format.ts`) toma "43.700" como 43.700 pesos y no como 43,7. `ParsedAmountHint` muestra "= $X" en vivo mientras se escribe el monto. El arqueo de `CloseShiftModal` pide "Contaste $X ¿Confirmás?" antes de cerrar. `PaymentModal` pasó a `type=text` para aceptar el punto de miles.
- **PR #133 (mergeado 23/09): P1.** "Regularizar" cierra el aviso de habitación ocupada (mig 117, aplicada en PROD el 23/09) y la 106 de PROD entró a main. Falta probarlo con el próximo aviso real.
- Fuera de este plan también se mergearon el #132 (rendición impresa: Transferencia y Cta. cte. siempre visibles, en `caja/rendiciones/[id]/page.tsx`) y el #134 (documentación de remitos). Las líneas citadas en las fichas son de `a918c70`: al abrir cada PR, volver a ubicarlas sobre `origin/main`.

## Mapa de PRs

Solo los PRs activos y en curso, ordenados por fase. "Días" es el esfuerzo estimado de cada PR.

| Id | Título | Fase | Carril | Depende de | Migración | Días | Estado |
|---|---|---|---|---|---|---|---|
| P0 | Plan maestro: orden, carriles, numeración de migraciones y cuestionario único (docs/plans/2026-09-23-reorden-ux-plan.md) | P | 0 | — | — | 0,5 | en curso |
| P1 | Aviso de habitación ocupada: mig 117 (el CHECK de admin_alerts acepta "regularizada") + cherry-pick de d97589a (mig 106 de PROD que falta en main) | P | 0 | — | 117 + 106 (ya en PROD) | 1 | hecho (#133) |
| P2 | Sacar el host de Supabase escrito en next.config.mjs (el CSP lo toma solo de la variable de entorno) | P | 0 | — | — | 0,25 | activo |
| F0-1 | Factura consolidada: pantalla de revisión antes de mandar a ARCA, y se entra siempre con el cliente puesto | F0 | K | — | — | 1,25 | activo |
| F0-2 | Cuenta corriente: al habilitarla, la facturación pasa a Consolidada (con aviso si la cambian) | F0 | B | — | — | 0,5 | activo |
| F0-3 | Check-out: el medio de pago arranca vacío (Cta. Cte. marcada en empresas con cuenta), aviso claro y remito que no se pierde | F0 | A | — | — | 1,25 | activo |
| F0-4 | Factura post check-out: la X pregunta y el recibo sale después de decidir | F0 | A | F0-3 | — | 1 | activo |
| F0-5 | Caja: reimprimir el remito de cuenta corriente del turno (con leyenda "REIMPRESIÓN") | F0 | C | F0-3 | — | 0,5 | activo |
| F0-6 | Noches y pasajeros: stepper − / + tolerante y botón final "N noches · sale el dd/mm" | F0 | B | — | — | 1,5 | activo |
| F0-7 | Habitaciones, Categorías y Limpiezas: solo admin (página, middleware y acciones) | F0 | D | — | — | 0,5 | activo |
| F0-8 | Mig 118: la RLS de rooms y room_categories solo deja escribir al admin | F0 | 0 | F0-7 | 118 | 0,5 | activo |
| F0-9 | DNI inválido para facturar: corregirlo ahí mismo, sin "Corregilo en la reserva" | F0 | A | F0-4 | — | 1,75 | activo |
| F0-10 | Reserva nueva: primero las fechas y aviso cuando la habitación elegida deja de estar libre | F0 | B | F0-6 | — | 0,5 | activo |
| F1-1a | Menú de 7 secciones: modelo de secciones, pantalla activa en el menú lateral y cajón del celular (sin barra de pestañas) | F1 | D | F2-8 | — | 1,25 | activo |
| F1-1b | Barra de arriba con las pestañas de la sección; fuera las pastillas duplicadas y títulos nuevos | F1 | D | F1-1a, F0-7, F0-9 | — | 1 | activo |
| F1-2 | Barra inferior del celular según el rol (admin: Hoy · Reservas · Caja · Tablero · Más) | F1 | D | F1-1a | — | 1 | activo |
| F1-3 | Campana de avisos del admin (reemplaza el panel de Mantenimiento) | F1 | D | P1, F1-1b | — | 1,5 | activo |
| F1-4 | Recepción ve la respuesta del admin a su pedido de tarifa (mig 120) | F1 | A | F2-5a | 120 | 1,5 | activo |
| F1-5a | Buscador global, parte 1: búsqueda, resumen y acción del servidor (sin pantalla) | F1 | D | — | — | 1 | activo |
| F1-5b | Buscador global, parte 2: caja de búsqueda arriba, lupa en el celular y tarjeta de resumen | F1 | D | F1-5a, F1-1b, F1-2 | — | 1 | activo |
| F1-6 | Hoy se actualiza solo (hook único useAutoRefresh, cada 30 s) | F1 | E | P1 | — | 0,75 | activo |
| F1-7 | "Sin facturar" pasa a ser el atajo "Últimos 10 días" en Por facturar | F1 | D | F1-1b, F0-9 | — | 1 | activo |
| F1-8 | Reservas › Por llegar visible para recepción, en solo lectura | F1 | D | F1-1a | — | 0,5 | activo |
| F1-9 | Tablero: "Cobros del día" y "Limpiezas" del mes con el período rotulado | F1 | D | F0-7, F1-1a | — | 1 | activo |
| F1-10 | Configuración con pestañas: Hotel y mensajes, Habitaciones y tarifas, ARCA, Usuarios | F1 | D | F1-1b, F0-7 | — | 1,5 | activo |
| F2-2 | Vista previa del precio al editar fechas y al ampliar | F2 | A | F0-6, F2-3, F2-8 | — | 1,5 | activo |
| F2-3 | Recepción puede cobrar a cuenta o una seña antes del check-out | F2 | A | F0-3, F0-4, F0-6 | — | 1 | activo |
| F2-4 | Mig 119: check-out con varios pagos (RPC y capa de datos, sin pantalla) | F2 | A | — | 119 | 1,5 | activo |
| F2-5a | Cobrar el check-out en varios medios: renglones de medio + monto en PaymentModal y RoomCard | F2 | A | F2-4, F2-3, F0-3, F0-4 | — | 1,5 | activo |
| F2-5b | Recibo agrupado de un check-out cobrado en varios medios | F2 | A | F2-5a | — | 1 | activo |
| F2-7a | Sacar el flujo de check-out de RoomCard a CheckoutFlow, sin cambiar el comportamiento | F2 | A | F0-3, F0-4, F1-4, F2-5a, F2-2 | — | 1 | activo |
| F2-7b | Hacer el check-out sin salir del cierre de caja (CheckoutFlow dentro de CloseShiftModal) | F2 | A | F2-7a, F2-8 | — | 1,25 | activo |
| F2-8 | Traspaso forzado: "No soy yo / Cerrar sesión" y nombre de quien entró | F2 | C | — | — | 0,5 | activo |
| F2-9 | Los botones principales dicen qué falta en vez de quedar grises | F2 | B | F0-2, F0-10 | — | 1 | activo |
| F2-10 | Tipo de documento DNI / CUIT / Pasaporte con validación al cargar | F2 | B | F2-9 | — | 1,5 | activo |
| F2-11 | Pago de cuenta corriente: se carga "Lo que entró" y las retenciones juntas, sin medio preseleccionado | F2 | H | F3-1 | — | 1,25 | activo |
| F2-13 | Mig 122: editar fechas conserva la tarifa y el descuento de la reserva, como Ampliar | F2 | 0 | F2-2 | 122 | 1 | activo |
| F3-1 | Ficha: medio de pago legible y "Aplicar" en vez de "imputar" | F3 | H | — | — | 0,5 | activo |
| F3-2 | Pagos: botón "Aplicar a facturas" para la plata que quedó a cuenta | F3 | H | F3-1, F2-11 | — | 1 | activo |
| F3-3a | Un solo saldo: cta-cte.ts para lista y ficha, fuera el "Saldo (deuda)" del ledger y la ficha se abre desde Empresas | F3 | H | F3-2, F3-9 | — | 1 | activo |
| F3-3b | Una sola ficha: FichaClienteModal pasa a clientes/ClienteFicha y suma la solapa Estadías | F3 | H | F3-3a | — | 1,25 | activo |
| F3-4 | Datos editables dentro de la ficha: el descuento se cambia en un solo lugar | F3 | H | F3-3b, F2-10 | — | 1,5 | activo |
| F3-5a | Lista única en /admin/clientes con filtros (Todos · Personas · Empresas · Con saldo · Con descuento · Archivadas) | F3 | H | F3-3b, F1-1b | — | 1 | activo |
| F3-5b | Ficha por URL (?ficha=kind:id) y CSV de "Con saldo" | F3 | H | F3-5a | — | 1 | activo |
| F3-6 | Las cuatro pantallas viejas llevan a Clientes con el mismo filtro | F3 | H | F3-4, F3-5b, F1-8 | — | 1 | activo |
| F3-7 | Pasajeros de empresa y huéspedes sin ficha: que se puedan abrir ("Viaja por <empresa>") | F3 | H | F3-5b | — | 1 | activo |
| F3-8 | Notas pegadas de empresas → campos, y pista "Parece un CUIT" | F3 | H | F3-4, F3-5b | — | 1 | activo |
| F3-9 | Tablero: lo que sale de la ficha de empresa ("reservas − cobrado") pasa a la tarjeta de Cobranzas, por empresa | F3 | H | — | — | 0,5 | activo |
| F4-1a | Hoy: una sola lista "Para atender" con los avisos que ya existen | F4 | E | P1, F1-3, F1-6 | — | 1,25 | activo |
| F4-1b | Hoy: "Facturas que no salieron" y "Sale hoy con saldo" en Para atender | F4 | E | F4-1a, F1-1a | — | 1 | activo |
| F4-2 | Un solo diálogo para cancelar: motivos fijos, lo que se deja de cobrar a la vista y WhatsApp solo cuando corresponde | F4 | A | F2-7a, F2-3 | — | 1,5 | activo |
| F4-3 | Tarjeta de habitación: una acción principal por estado, pasajero primero y empresa en chip | F4 | A | F4-2 | — | 1,5 | activo |
| F4-4 | Tarjeta de habitación: fila de secundarios, menú "⋯" y un solo camino para el medio día | F4 | A | F4-3, F2-2 | — | 1,5 | activo |
| F4-5 | Hoy: contadores que filtran la grilla (Libres · Llegan hoy · Salen hoy · Ocupadas · Por limpiar) | F4 | E | F4-1b | — | 1 | activo |
| F4-6 | Hoy: línea de pulso para el dueño (Cobrado hoy · Ocupación 30 días · Falta facturar · Cuenta corriente) | F4 | E | F4-5, F1-9 | — | 1 | activo |
| F4-7 | Mantenimiento: el modal no queda tapado por el teclado, la pantalla se actualiza sola y "Ver como mantenimiento" | F4 | G | F1-6, F0-7, F1-9 | — | 0,75 | activo |
| F4-8 | Mantenimiento: "Reportar desperfecto" que llega a la campana del admin (mig 121) | F4 | G | F4-7, F1-3, F4-1a | 121 | 1,5 | activo |
| F4-9 | Calendario: nombres que se leen, sin letra de 7 px, leyenda de 4 estados y animación que respeta "reducir movimiento" | F4 | I | F2-3, F4-2 | — | 1 | activo |
| F5-1 | Un solo formateador de plata: Finanzas deja "en-US" y se borran 4 copias locales | F5 | J | F2-7b, F1-9, F4-6 | — | 1 | activo |
| F5-2 | Fechas sin zona horaria: mover los formateos sueltos a lib/time.ts | F5 | J | F3-3b, F4-2, F2-10 | — | 1 | activo |
| F5-3 | Barrido de plata inline: Reservas y Habitaciones | F5 | J | F5-1, F4-9, F2-2, F2-10 | — | 1,5 | activo |
| F5-4 | Barrido de plata inline: Clientes y Tablero | F5 | J | F5-3, F3-6 | — | 1,5 | activo |
| F5-5 | Barrido de plata inline: web pública de reservas (sin PaymentModal) | F5 | J | F5-3 | — | 0,5 | activo |
| F5-6 | Regla de ESLint: prohibir formateo suelto de plata y fecha en src/app (último PR del plan) | F5 | J | F5-1, F5-2, F5-3, F5-4, F5-5, F5-12, F5-16, F5-13d | — | 1 | activo |
| F5-7 | Componentes base en src/components/ui/: Button, StatusPill, EmptyState | F5 | J | — | — | 1,5 | activo |
| F5-8a | Modal compartido (src/components/ui/Modal.tsx) + WalkInModal | F5 | J | F5-7, F2-10 | — | 1 | activo |
| F5-8b | Modal compartido: NewReservationModal | F5 | J | F5-8a, F5-2 | — | 0,5 | activo |
| F5-8c | Modal compartido: EditReservationModal | F5 | J | F5-8a, F2-2 | — | 0,5 | activo |
| F5-8d | Modal compartido: ChangeRoomModal | F5 | J | F5-8a, F1-4 | — | 0,5 | activo |
| F5-8e | Modal compartido: ExtraChargesModal | F5 | J | F5-8a | — | 0,5 | activo |
| F5-9a | Modal compartido: InvoicePromptModal (multi-paso, conserva el paso) | F5 | J | F5-8a, F2-7b, F0-9 | — | 0,75 | activo |
| F5-9b | Modal compartido: CloseShiftModal | F5 | J | F5-8a, F2-7b, F5-1 | — | 0,5 | activo |
| F5-9c | Modal compartido: CompanyCheckInModal y EarlyCheckoutModal | F5 | J | F5-8a, F2-10, F2-7a | — | 0,5 | activo |
| F5-10a | DataTable compartido + PageHeader en Caja y Facturación | F5 | J | F5-7, F2-7b, F1-7 | — | 0,75 | activo |
| F5-10b | PageHeader en Reservas (calendario, solicitudes, por llegar, historial) | F5 | J | F5-10a, F4-9, F1-8 | — | 0,5 | activo |
| F5-10c | PageHeader en Clientes | F5 | J | F5-10a, F3-8 | — | 0,5 | activo |
| F5-10d | PageHeader en Tablero, Configuración y Limpiezas | F5 | J | F5-10a, F1-10, F4-7, F4-6 | — | 0,5 | activo |
| F5-11a | Contraste y foco: inputClass compartido + texto slate-500 en Caja y Facturación | F5 | J | F5-7, F2-7b | — | 0,75 | activo |
| F5-11b | Contraste y foco: Reservas, calendario y tarjeta de habitación | F5 | J | F5-11a, F4-4, F4-9 | — | 0,5 | activo |
| F5-11c | Contraste y foco: Clientes | F5 | J | F5-11a, F3-8 | — | 0,5 | activo |
| F5-11d | Contraste y foco: Mantenimiento, Tablero y Configuración | F5 | J | F5-11a, F4-8, F1-10 | — | 0,5 | activo |
| F5-12 | KPIs sin degradé y sin desbordar: tarjetas blancas + @container | F5 | J | F5-1, F5-3, F4-6 | — | 1,5 | activo |
| F5-13a | Letra mínima 12 px: Caja y Facturación | F5 | J | F5-11a | — | 0,5 | activo |
| F5-13b | Letra mínima 12 px: Reservas y calendario (11 px solo en las barras) | F5 | J | F5-11b | — | 0,5 | activo |
| F5-13c | Letra mínima 12 px: Clientes | F5 | J | F5-11c | — | 0,5 | activo |
| F5-13d | Letra mínima 12 px: Mantenimiento, Tablero y Configuración | F5 | J | F5-11d, F5-18a | — | 0,5 | activo |
| F5-14 | Tablas en celular: lista de Clientes, historial y por llegar, y la fila que desborda en Solicitudes | F5 | J | F5-10a, F3-6, F4-2 | — | 1 | activo |
| F5-15 | Guía de textos + recibo impreso con tildes + test anti-sin-tilde | F5 | J | F2-5b | — | 1,25 | activo |
| F5-16 | Confirmaciones propias en lugar de confirm() + etiquetas de medio de pago desde payment-methods.ts | F5 | J | F5-8a, F3-1, F3-6, F1-7 | — | 1,5 | activo |
| F5-18a | Usuarios: labels accesibles y fuera la opción "Cliente" del selector de rol | F5 | J | F1-10 | — | 0,5 | activo |

**Total: 85,75 días** de trabajo en 90 PRs (88 activos y 2 en curso), si se hicieran uno detrás de otro. Con 2 o 3 carriles en paralelo el calendario se acorta. Con todos los carriles a la vez el piso queda en unos 37 días, porque el carril J (sistema visual) espera a los demás. No están en la tabla: F2-1 y F2-6 (fusionados en F0-3/F2-11 y en F0-9), F1-11 y F4-10 (descartados), y F2-12, F5-17 y F5-18b (postergados hasta Q4, Q10 y Q11).

## Carriles de trabajo

Dentro de un carril los PRs se mergean en el orden indicado. Los días de cada carril suman solo los PRs activos y en curso.

### 0 · Base: plan maestro, diferencia con PROD y migraciones sueltas
**Orden (3,25 días):** P0 → P1 → P2 → F0-8 → F2-13

P1 ya está mergeado (#133, 23/09) y la 117 está aplicada en PROD, así que los carriles E y G ya no esperan por P1. P2 y F0-8 (mig 118) no tocan pantallas y van en paralelo. F2-13 (mig 122) va solo si Q3 dice "conservar", y después de F2-2.

### A · Check-out y cobro (RoomCard, PaymentModal, InvoicePromptModal)
**Orden (18,75 días):** F0-3 → F0-4 → F0-9 → F2-3 → F2-4 → F2-5a → F2-5b → F1-4 → F2-2 → F2-7a → F2-7b → F4-2 → F4-3 → F4-4

Es el carril más disputado: va estrictamente en fila. Diferencia con la lista del crítico: F2-3 va antes de F2-5a, porque F2-5 usa el paymentMode que crea F2-3. F2-4 (mig 119) no toca pantallas: se prepara desde el día 1 y se mergea con la 119 aplicada y verificada. Cruces con otros carriles: F2-3 y F2-2 esperan a F0-6 (B); F2-2 y F2-7b esperan a F2-8 (C); F1-4 (mig 120) y F4-2 tocan una línea de admin/page.tsx (rebase contra E); F4-2 cierra CalendarClient antes de F4-9 (I). F2-12 postergado.

### B · Formularios de carga (walk-in, reserva nueva, editar reserva, fichas)
**Orden (5 días):** F0-2 → F0-6 → F0-10 → F2-9 → F2-10

F0-6 va primero porque F2-3 y F2-2 del carril A lo esperan (modal Ampliar). F0-2, F2-9 y F2-10 comparten GuestModal y AssociatedClientModal, así que van en fila. F2-10 destraba F3-4 (H). F0-7 (D) cambia un texto de WalkInModal: el que llegue después rebasea.

### C · Caja (CajaClient, CloseShiftModal, layout)
**Orden (1 día):** F0-5 → F2-8

F0-5 espera a F0-3 (print-window.ts). F2-8 se mergea antes de F1-1a porque toca layout.tsx; si F0-3 se atrasa, F2-8 puede ir primero. Después, CloseShiftModal queda para F2-2 y F2-7b (A), y recién al final para F5.

### D · Menú, permisos y Facturación del admin
**Orden (11,25 días):** F0-7 → F1-1a → F1-1b → F1-3 → F1-2 → F1-7 → F1-8 → F1-10 → F1-5a → F1-5b → F1-9

F0-7 arranca ya y es el único PR que toca el middleware y los guards de mantenimiento. F1-1a espera a F2-8 (layout) y F1-1b a F0-9 (FiscalClient). F1-3 se adelanta respecto del orden del crítico (va apenas después de F1-1b) porque destraba los carriles E y G; espera a P1. MobileNav lo tocan F1-1a, F1-3, F1-2 y F1-5b, en ese orden. F1-5a no toca pantallas y se puede preparar en paralelo. F1-7 toca una línea de admin/actions.ts (revalidatePath): rebase contra A. F1-11 descartado.

> Nota: F1-9 cierra el carril D, pero lo esperan F4-6 (E) y F4-7 (G). Solo depende de F0-7 y F1-1a, así que si esos carriles llegan antes conviene adelantarlo.

### E · Hoy (admin/page.tsx)
**Orden (5 días):** F1-6 → F4-1a → F4-1b → F4-5 → F4-6

F1-6 arranca cuando entra P1, y F4-1a espera a F1-3. F4-1b usa facturasConError() de F1-1a. F4-6 espera a F1-9 (finances/page.tsx). admin/page.tsx también lo tocan P1, F1-1b (título), F1-3, F1-4 y F4-2, con cambios chicos: el que llega después rebasea.

### G · Mantenimiento
**Orden (2,25 días):** F4-7 → F4-8

F4-7 espera al hook de F1-6 y a la cabecera de Limpiezas de F1-9. F4-8 espera a F1-3 (AdminAlertsList), a F4-1a (attention.ts) y a que la 121 esté aplicada y verificada en applied_migrations.

### H · Clientes y cuenta corriente
**Orden (12 días):** F3-1 → F2-11 → F3-2 → F3-9 → F3-3a → F3-3b → F3-4 → F3-5a → F3-5b → F3-6 → F3-7 → F3-8

F3-1 crea payment-methods.ts. F3-1, F2-11 y F3-2 tocan RegisterPaymentModal, así que van en fila. F3-9 va antes de F3-3a para que "reservas − cobrado" nunca quede sin lugar (el nombre es Q5). F3-4 espera a F2-10 (B). F3-5a espera a F1-1b (D) y a Q6. F3-6 espera a F1-8 (D) y redirige solo al admin.

### I · Calendario
**Orden (1 día):** F4-9

Espera a F2-3 y F4-2 (CalendarClient). Letra mínima de 12 px, con 11 px solo en las barras. La leyenda depende de Q8.

### K · Factura consolidada
**Orden (1,25 días):** F0-1

Solo toca fiscal/consolidada/*: arranca ya, en paralelo con todo. Incluye el redirect cuando falta el cliente y tests con un CUIT válido.

### J · Sistema visual y textos (al final)
**Orden (25 días):** F5-7 → F5-15 → F5-1 → F5-2 → F5-3 → F5-4 → F5-5 → F5-8a → F5-8b → F5-8c → F5-8d → F5-8e → F5-9a → F5-9b → F5-9c → F5-16 → F5-10a → F5-10b → F5-10c → F5-10d → F5-14 → F5-11a → F5-11b → F5-11c → F5-11d → F5-12 → F5-18a → F5-13a → F5-13b → F5-13c → F5-13d → F5-6

F5-7 arranca ya, porque solo crea archivos nuevos. El resto espera a que cada carril funcional cierre sus archivos, y cada lista se rehace con grep sobre main al abrir el PR: F5-15 va después de F2-5b; F5-1 después de F2-7b, F1-9 y F4-6; F5-4, F5-14 y F5-16 después de F3-6; F5-18a después de F1-10. Va un modal por PR (F5-8a a F5-8e, F5-9a a F5-9c) y los barridos se parten por carpeta (F5-10, F5-11, F5-13). F5-17 y F5-18b quedan postergados (Q10 y Q11). F5-6 (ESLint) va último de todo el plan.

## Numeración de migraciones

Cada número se confirma al aplicar, contra `select filename from public.applied_migrations` y `ls supabase_migrations`. El nombre final va en `record_migration()`. El repo ya tiene números repetidos (59, 106 y 112): no se renombran, porque `applied_migrations` los registra por nombre de archivo.

| N.º | Archivo | PR | Qué hace | Cuándo se aplica |
|---|---|---|---|---|
| 106 | `106_el_cobro_de_la_pieza_usada_lo_decide_el_admin.sql` | P1 | Ya está aplicada en PROD desde el 17/09, pero no está en main. Hace que `rpc_list_room_occupancy_alerts` devuelva también los avisos resueltos de las últimas 48 h (con decision y resolved_notes), y que `rpc_regularize_occupied_room` exija admin. Entra al repo por cherry-pick de d97589a con su nombre, y queda un segundo 106 junto a `106_numeracion_recibos_y_remitos`. | No se aplica: antes de mergear P1 solo se confirma su fila en `public.applied_migrations` (confirmada el 23/09). |
| 117 | `117_admin_alerts_admite_regularizada.sql` | P1 | DROP CONSTRAINT `admin_alerts_decision_check` y ADD CONSTRAINT CHECK (decision IS NULL OR decision IN ('authorized','rejected','regularizada')), más record_migration. Sin esto, el cierre del aviso falla (23514) y el aviso queda abierto aunque la estadía se haya cargado. | **Aplicada en PROD el 23/09/2026 (17:40 UTC)** con OK de Agustín; CHECK verificado y fila anotada en applied_migrations. Falta mergear #133 y hacer una regularización real que quede con decision = 'regularizada'. |
| 118 | `118_habitaciones_y_categorias_solo_admin.sql` | F0-8 | Las policies INSERT/UPDATE/DELETE de rooms y room_categories pasan de `app_is_staff()` a `app_is_admin()`; las de SELECT no cambian. | Con OK de Agustín (Q2), después del deploy de F0-7 y antes de mergear F0-8. Ningún código depende de ella. Justo después de aplicarla, probar check-in, check-out y walk-in como recepción. Para volver atrás se recrean las 6 policies con `app_is_staff()`. |
| 119 | `119_cobro_en_varios_medios.sql` | F2-4 | Vía de menos riesgo (por defecto): una `rpc_staff_checkout_split(p_reservation_id, p_payments jsonb, p_early boolean)` nueva. En una sola transacción inserta los N-1 primeros pagos con la lógica de `rpc_register_payment` (turno abierto, sin cuenta corriente, sin vale blanco) y llama a la RPC de check-out actual con el último pago por el saldo exacto. No hay DROP ni se copian cuerpos. Además, CREATE OR REPLACE de `rpc_shift_checkout_export` ordenado por monto, para que el CSV tome el medio principal, y record_migration. | Con OK de Agustín, antes de mergear F2-4 (y por lo tanto antes de F2-5a). Partir de `pg_get_functiondef` de PROD y no del repo, porque ya hay deriva. Si PostgREST no ve la firma nueva: `NOTIFY pgrst, 'reload schema'`. |
| 120 | `120_respuesta_de_tarifa_visible_para_recepcion.sql` | F1-4 | `rpc_list_tariff_requests()` SECURITY DEFINER para staff: devuelve solo el kind `room_change_keep_old_tariff_request` de reservas confirmed o checked_in, con la decisión y los montos. No toca la RLS de admin_alerts. | Con OK de Agustín, antes de mergear F1-4. Como defensa, el código la llama con `.catch(() => [])`. |
| 121 | `121_reportar_desperfecto.sql` | F4-8 | `rpc_report_maintenance_issue(p_room_id, p_description, p_urgent)`: inserta en admin_alerts el kind `maintenance_issue`, sin tablas ni RLS nuevas. La descripción va de 3 a 500 letras, y el mismo reporte no se duplica dentro de 10 minutos. | Con OK de Agustín, antes de mergear F4-8; si no, el botón falla con "function not found". |
| 122 | `122_editar_fechas_conserva_tarifa.sql` (reservada) | F2-13 | Solo si Q3 dice "conservar": `rpc_update_reservation` deja de re-tarifar al precio de hoy y conserva la tarifa y el descuento congelados, como Ampliar. | Con OK de Agustín, antes de mergear F2-13. Si Q3 dice que no, el número queda sin usar. |
| 123 | `123_notas_importadas_a_domicilio.sql` (reservada) | F3-8 | Solo si Agustín prefiere la vía en lote al botón "Usar como domicilio": completa el domicilio a partir de notes (hoy es 1 fila), sin borrar notes. | Por defecto no se usa. Si se elige, va con OK y después de ver el SELECT de preview; da igual si es antes o después del deploy. |

## Fase P — Base (antes que nada)

**P0 · Plan maestro** es este documento (`docs/plans/2026-09-23-reorden-ux-plan.md`): un PR solo de documentación, de 0,5 días, en curso. Reemplaza los planes por fase que F1-1 y F2 escribían dentro de PRs de código, fija la tabla de migraciones 117-123 y junta las ~50 preguntas de las 6 fases en un cuestionario único de 11 (Q1-Q11) con sus valores por defecto. No toca código ni base.

### P1 · Aviso de habitación ocupada: mig 117 (el CHECK de admin_alerts acepta "regularizada") + cherry-pick de d97589a (mig 106 de PROD que falta en main)
**Rama:** `claude/alerta-regularizada-117` · **Carril:** 0 · **Depende de:** — · **Migración:** 117 (nueva) + 106 (ya aplicada en PROD, solo entra al repo) · **Esfuerzo:** 1 día

**Por qué.** Hoy "Regularizar" carga la estadía pero no puede cerrar el aviso: queda abierto con un mensaje de éxito parcial, y el dueño no sabe si esa pieza ya se regularizó. Además main le muestra a recepción como abiertos avisos que PROD ya cerró, con un botón que la base rechaza.

**Archivos**
- Create: `supabase_migrations/117_admin_alerts_admite_regularizada.sql` — amplía el CHECK y llama a `record_migration()`.
- Create: `supabase_migrations/106_el_cobro_de_la_pieza_usada_lo_decide_el_admin.sql` — cherry-pick de d97589a, tal como corre en PROD.
- Modify: `src/app/admin/OccupiedRoomAlertBanner.tsx` — se parte en dos bloques. Los abiertos tienen el botón solo para el admin y "Lo resuelve el administrador" para el resto. Los cerrados de las últimas 48 h van en gris con el resultado ("se cargó la estadía" o "se cerró sin cobrar").
- Modify: `src/app/admin/actions.ts` — `regularizeOccupiedRoomAction` pasa de `assertStaff` a `assertAdmin`.
- Modify: `src/app/admin/page.tsx` — le pasa `isAdmin` al banner.
- Modify: `src/lib/types.ts` — `AdminAlertDecision` ("authorized" | "rejected" | "regularizada"); `resolved_at` y `decision` en `RoomOccupancyAlert` y `AdminAlert`.
- Modify: `src/lib/data.ts` — comentario de `listRoomOccupancyAlerts` (abiertos + cerrados de 48 h).
- Modify: `supabase_migrations/README.md` — anota los números repetidos (59, 106, 112).
- Create: `src/__tests__/regularize-occupied-room.test.ts`, `src/app/admin/OccupiedRoomAlertBanner.test.tsx`.

**Pasos**
1. Confirmar en PROD que la 106 está en `applied_migrations` (hecho el 23/09: está).
2. Cherry-pick de d97589a sobre `origin/main` (hecho: 028677a).
3. Escribir la 117 idempotente (DROP IF EXISTS + ADD), los tipos y los tests (hecho: 55e10eb). El PR #133 está abierto.
4. `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` en verde.
5. Pedir el OK a Agustín y aplicar la 117 con `exec_ddl`: solo lo que está entre BEGIN y COMMIT, sin ellos, sin `;` final y sin comillas en los comentarios (hecho el 23/09 a las 17:40 UTC, con OK).
6. Verificar la fila de la 117 y el CHECK nuevo (hecho). Recién después Agustín mergea.
7. Después del deploy, hacer una regularización real como admin.

> **Estado al 23/09:** hecho. PR #133 mergeado y la 117 aplicada en PROD. Falta solo probarlo con el próximo aviso real.

**Base de datos.** El CHECK `admin_alerts_decision_check` (mig 69) solo acepta `authorized` y `rejected`. `rpc_regularize_occupied_room` (mig 105, línea 447, y también la 106 de PROD) escribe `decision = 'regularizada'`, así que el cierre del aviso viola el CHECK (23514). **La estadía sí se carga**: el walk-in es una llamada anterior. Lo que falla es solo el cierre del aviso, y `regularizeOccupiedRoomAction` (`actions.ts:231-237`) lo informa como éxito parcial (`alertPendiente`). Es un bug latente: los 19 avisos que hay en PROD se cerraron todos antes del 17/09, cuando la 105 creó el botón, así que este bug no explica que ninguno tenga estadía vinculada. La 117 hace DROP y ADD del CHECK con `'regularizada'`, no toca RLS y llama a `record_migration('117_admin_alerts_admite_regularizada.sql')`. Las decisiones que hay hoy en PROD son solo null y rejected, así que ninguna fila queda afuera. La 106 no se vuelve a aplicar.

**Aceptación**
- [ ] Como admin, "Regularizar" carga la estadía, el aviso pasa a cerrados con "se cargó la estadía" y no aparece el mensaje de éxito parcial.
- [ ] Recepción ve el aviso abierto con "Lo resuelve el administrador" y sin botón.
- [ ] Todos ven los avisos cerrados de las últimas 48 h, en gris, con su resultado.
- [ ] Un aviso ya cerrado en PROD no aparece como abierto en Hoy.

**Tests** (Vitest)
- `regularize-occupied-room.test.ts`: con el `assertAdmin` real, recepción corta antes de cargar nada. Un 23514 al cerrar el aviso da éxito parcial sin cargar la estadía dos veces. También cubre los mensajes de la RPC.
- `OccupiedRoomAlertBanner.test.tsx`: abiertos y cerrados separados, botón solo para el admin y texto para recepción. Buscar por texto, no con `getByRole` sobre toda la pantalla.

**Verificación en PROD**
- `select filename from public.applied_migrations where filename like '106_el_cobro%' or filename like '117_%'` → 2 filas.
- `select pg_get_constraintdef(oid) from pg_constraint where conname = 'admin_alerts_decision_check'` → incluye `regularizada`.
- Después de la primera regularización: `select decision, related_reservation_id from public.admin_alerts where kind = 'room_occupied_without_active_reservation' order by resolved_at desc nulls last limit 5` → `regularizada` con la reserva vinculada.

👤 **AGUSTÍN:** dar el OK para aplicar la 117 antes del merge. Mergear #133 cuando la fila esté en `applied_migrations`. Hacer (o mirar) la primera regularización real, y avisarle a recepción que ese botón ahora es solo del admin: si el pasajero sigue en la pieza, se hace un walk-in normal desde la tarjeta.

**Riesgos.** Recepción pierde el botón de cargar la estadía desde el aviso. El repo queda con un segundo 106, que no se renombra. P1 bloquea F1-3, F1-6 y F4-1a: si se atrasa, los carriles E y G no arrancan. Queda pendiente fuera de este PR: cuando hay éxito parcial, el mensaje dice "intentá de nuevo, no la vuelvas a cargar", pero no hay un botón para cerrar el aviso sin volver a cargar la estadía. Lo resuelve F1-3, con las acciones de la campana.

### P2 · Sacar el host de Supabase escrito en next.config.mjs
**Rama:** `claude/csp-sin-host-fijo` · **Carril:** 0 · **Depende de:** — · **Migración:** no · **Esfuerzo:** 0,25 días

**Por qué.** El repo es público y `next.config.mjs` tiene escrito el host del proyecto de Supabase como valor de respaldo del CSP. Tiene que salir solo de la variable de entorno.

**Archivos**
- Modify: `next.config.mjs` (líneas 1-4) — `supabaseHost` sale solo de `NEXT_PUBLIC_SUPABASE_URL`. Si falta, el CSP no suma ningún host de Supabase y el build avisa por consola.

**Pasos**
1. Reemplazar el respaldo escrito por `null`, y armar `img-src` y `connect-src` sin el host cuando es `null`.
2. Revisar con grep que el host no aparezca en ningún otro archivo versionado (`src/`, `docs/`, `scripts/`, `automatizaciones/`).
3. `npm run build` con la variable definida (como en Coolify) y sin definirla.

**Aceptación**
- [ ] El host del proyecto no aparece en ningún archivo del repo.
- [ ] En PROD, el login, las imágenes de habitaciones y el panel funcionan igual que antes.

**Tests** (Vitest)
- No hace falta un test nuevo: alcanza con el build con y sin la variable.

**Verificación en PROD**
- Después del deploy, entrar al panel, abrir una habitación con imagen y mirar la consola: sin violaciones nuevas del CSP (sigue en modo solo reporte).

👤 **AGUSTÍN:** confirmar que `NEXT_PUBLIC_SUPABASE_URL` está definida en Coolify para el build, y mergear.

**Riesgos.** Si la variable no está al momento del build, el CSP deja de listar Supabase. Como está en modo solo reporte, no rompe nada, pero ensucia la consola.

---

## Fase 0 — Urgente: plata y facturas

Cierra los agujeros por donde hoy se pierde plata o sale mal un papel: la consolidada que se emite con un click, lo fiado que nunca llega a la consolidada, el cobro que arranca en Efectivo, el remito o el recibo que no salen, las noches mal tipeadas y la recepción que puede cambiar precios escribiendo una URL. Le sirve a recepción (cobro del check-out, factura de mostrador, remito del turno) y a Agustín (consolidada, cuentas corrientes y precios). Son 10 PRs en seis carriles, y las fichas van en ese orden: 0 (F0-8, la mig 118), A (F0-3 → F0-4 → F0-9), B (F0-2, F0-6 → F0-10), C (F0-5), D (F0-7) y K (F0-1). Los que no esperan a nadie (F0-1, F0-2, F0-3, F0-6 y F0-7) arrancan el día 1.

### F0-8 · Mig 118: la RLS de rooms y room_categories solo deja escribir al admin
**Rama:** `claude/mig118-rls-habitaciones` · **Carril:** 0 · **Depende de:** F0-7 · **Migración:** 118 · **Esfuerzo:** 0,5 días

**Por qué.** F0-7 cierra la pantalla y las acciones, pero la base todavía deja que cualquier usuario del staff inserte, edite o borre habitaciones y categorías (precios) con su propia sesión. Esto cierra la misma puerta en la base.

> Nota: en el plan de F0 esta migración era la 117. El crítico la renumeró a 118 porque la 117 es la de P1 (`admin_alerts` acepta "regularizada").

**Archivos**
- Create: `supabase_migrations/118_habitaciones_y_categorias_solo_admin.sql` — policies de escritura de `rooms` y `room_categories` con `app_is_admin()`, más `record_migration`.

**Pasos**
1. En PROD (conector, solo SELECT), sacar los nombres reales: `select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('rooms','room_categories') order by 1,3;`. Los de las migs 17 y 26 del repo pueden no coincidir con PROD.
2. En `public.rooms`: DROP de las 3 policies de INSERT/UPDATE/DELETE de staff y CREATE de "Admin can insert/update/delete rooms" con `public.app_is_admin()` (INSERT en WITH CHECK, DELETE en USING, UPDATE en los dos). Las SELECT ("Public read rooms", "Staff can read rooms", "Maintenance can read rooms") no se tocan.
3. Lo mismo en `public.room_categories`. La SELECT de staff queda.
4. Al final, el bloque DO que llama a `public.record_migration('118_habitaciones_y_categorias_solo_admin.sql')` si existe, igual que la 116.
5. Aparte, sin versionar, preparar la versión para PROD: `select public.exec_ddl($m118$ ... $m118$)`, sin BEGIN/COMMIT, sin `;` final y sin comillas en los comentarios.
6. Confirmar el número contra `select filename from public.applied_migrations order by 1 desc` y `ls supabase_migrations`. La 117 tiene que ser la de P1.

**Base de datos.** Solo cambia las 6 policies de escritura de `rooms` y `room_categories`, de `app_is_staff()` a `app_is_admin()`. Las funciones que escriben `rooms` (check-in, check-out, walk-in, cambio de habitación, limpieza, mantenimiento, cancelación y `app_sync_rooms_from_category`) son SECURITY DEFINER, así que no cambian. Se aplica con exec_ddl, con OK de Agustín (Q2), después del deploy de F0-7 y antes de mergear este PR. Ningún código depende de ella.

**Aceptación**
- [ ] El admin sigue creando, editando, activando y desactivando habitaciones y categorías.
- [ ] Recepción hace check-in, check-out, walk-in y cambio de habitación como siempre, y mantenimiento marca "lista" desde /maintenance.
- [ ] La base rechaza una escritura directa de recepción sobre `rooms` o `room_categories`.

**Tests** (Vitest)
- El repo no tiene tests de SQL, así que la prueba se hace en PROD (abajo). `npm test` sigue en verde porque el PR no toca código.

**Verificación en PROD**
- `select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('rooms','room_categories') order by 1,3;` → INSERT, UPDATE y DELETE con `app_is_admin()`. Las SELECT, igual que antes.
- `select filename, applied_at from public.applied_migrations where filename like '118%';` → una fila.
- Justo después de aplicarla: un check-in, un check-out y un walk-in como recepción, y "Marcar lista" desde /maintenance.

👤 **AGUSTÍN:** contestar Q2 (cerrar también en la base) y dar OK para aplicar la 118 con exec_ddl después del deploy de F0-7. Mergear recién cuando la fila esté en `applied_migrations`.

**Riesgos.** Si hubiera una función SECURITY INVOKER que escribe `rooms` y no apareció en la búsqueda en `pg_proc`, recepción vería "No tenés permiso". Por eso se prueban check-in, check-out y walk-in apenas se aplica. Volver atrás es recrear las 6 policies con `app_is_staff()`.

### F0-3 · Check-out: el medio de pago arranca vacío (Cta. Cte. marcada en empresas con cuenta), aviso claro y remito que no se pierde
**Rama:** `claude/checkout-ctacte-remito` · **Carril:** A · **Depende de:** — · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** Hoy el cobro arranca en Efectivo. Si la recepcionista no toca el medio, una tarjeta o lo fiado de una empresa quedan como efectivo y el arqueo no cuadra (3 de los 21 cierres con diferencia fueron por el medio). Además, el remito que firma el pasajero se abre sin reintento: si el navegador bloquea la ventana, no sale y nadie se entera.

> Absorbe la parte de PaymentModal de F2-1, porque los dos cambiaban la línea 88 con reglas opuestas. La parte de RegisterPaymentModal de F2-1 va en F2-11.

**Archivos**
- Create: `src/lib/print-window.ts` — `openPrintWindow(path, name): boolean` (window.open con `width=420,height=720`; da false si no abrió). Lo reusan F0-4 y F0-5.
- Create: `src/app/admin/PrintBlockedModal.tsx` — cuadro "falta el papel" `{ titulo, detalle, botonLabel, onPrint, onClose }`, con el diseño de ReciboPendiente (`cuentas/RegisterPaymentModal.tsx:787-840`).
- Modify: `src/app/components/PaymentModal.tsx` — medio inicial (88), validación sin medio (97-110), grupo de medios (253-296), props `defaultMethod` y `accountHolderName`, textos de Cta. Cte. (132, 224, 336).
- Modify: `src/app/admin/RoomCard.tsx` — `openAccountVoucher` (90-97) con openPrintWindow, remito bloqueado en `submitCheckoutPayment` (352-359) y props al PaymentModal (754-772).

**Pasos**
1. PaymentModal: `useState<PaymentMethod | null>`. Arranca en `'cuenta_corriente'` solo si llegan `defaultMethod='cuenta_corriente'` y `accountCreditEnabled` en modo check-out. En todo lo demás arranca en `null`, también en el pago suelto de `guests/GuestsClientTable.tsx`.
2. handleSubmit: sin medio, muestra "Elegí cómo paga: efectivo, tarjeta, transferencia o Mercado Pago", pone el foco en el grupo (`role="radiogroup"` con id) y no llama a ninguna acción.
3. Con Cta. Cte.: rótulo "Monto a cuenta corriente", recuadro violeta "Queda a cuenta de {accountHolderName}. Sale el remito para que firme el pasajero.", botón "Cargar a la cuenta y cerrar" y toast "Check-out hecho. Queda a cuenta de {accountHolderName}."
4. RoomCard: `defaultMethod = room.billedToCompany && room.accountCreditEnabled ? 'cuenta_corriente' : undefined` y `accountHolderName = reservationCompany?.display_name ?? room.client`.
5. RoomCard: si el remito no abre, guardar `remitoBloqueado = { movementId, holder }` y mostrar PrintBlockedModal: "El check-out quedó hecho y la estadía quedó a cuenta de X. Falta el remito: el navegador bloqueó la ventana", con el botón "Imprimir remito". El estado vive en RoomCard, que no se desmonta con el revalidate (igual que `invoicePrompt`).

**Aceptación**
- [ ] En el check-out de una empresa con cuenta corriente, el cobro abre con "Cta. Cte." marcada, dice "Queda a cuenta de {empresa}" y el botón es "Cargar a la cuenta y cerrar".
- [ ] En cualquier otro cobro (particular, particular con cuenta o "Cargar Pago") no hay ningún medio marcado. Si se aprieta cobrar sin elegir, aparece "Elegí cómo paga" y no se registra nada.
- [ ] Al fiar, el aviso dice "Check-out hecho. Queda a cuenta de {empresa}." y sale el remito.
- [ ] Si el navegador bloquea la ventana, aparece un cuadro con "Imprimir remito" que no se cierra solo.

**Tests** (Vitest)
- Create `src/app/components/PaymentModal.test.tsx` (mockea sonner y `@/app/admin/finances/actions`): al montar sin defaultMethod, ningún radio está checked.
- Mismo archivo: un submit sin medio muestra el error y no llama a `registerPaymentAction` ni a `onSubmitPayment`.
- Mismo archivo: con Transferencia elegida, enviar llama a `registerPaymentAction(id, monto, 'bank_transfer')`.
- Mismo archivo: con `defaultMethod='cuenta_corriente'`, `accountCreditEnabled` y onSubmitPayment, Cta. Cte. está marcada, el botón dice "Cargar a la cuenta y cerrar" y el toast recibe "Queda a cuenta de Empresa Ficticia SA".
- Mismo archivo: con `accountCreditEnabled=false`, aunque venga el defaultMethod, no hay ningún medio marcado.
- Create `src/__tests__/print-window.test.ts`: da false si window.open devuelve null, y true si devuelve una ventana.

**Verificación en PROD**
- Próximo check-out de una empresa que fía: Cta. Cte. marcada, "Queda a cuenta de …" y sale el remito. En el de un particular, ningún medio marcado.
- `select payment_method, count(*) from public.payments where created_at > '<deploy>' group by 1 order by 2 desc;` → tarjeta, transferencia y MP siguen apareciendo.
- `select tipo, amount, remito_numero, created_at from public.cuenta_corriente_movimientos where tipo = 'cargo' and created_at > now() - interval '1 day' order by created_at desc;` → el cargo tiene número de remito, y ese check-out no tiene un pago en efectivo.

👤 **AGUSTÍN:** revisar y mergear. Avisarle a recepción que ahora siempre hay que elegir el medio: en empresas con cuenta corriente ya viene Cta. Cte., y si el pasajero paga de su bolsillo, se cambia. Contar los clicks del check-out fiado antes y después (métrica 3).

**Riesgos.** Suma un click en cada cobro, a propósito. Si un pasajero de empresa paga en caja, el medio se cambia a mano; lo cubren el recuadro violeta y el texto del botón. PaymentModal y RoomCard son los archivos más disputados del plan: F0-4 va inmediatamente después, y F2-3 y F2-5a esperan a este PR.

### F0-4 · Factura post check-out: la X pregunta y el recibo sale después de decidir
**Rama:** `claude/factura-salir-y-recibo` · **Carril:** A · **Depende de:** F0-3 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Hoy la X del "¿Emitir factura?" cierra sin decidir: la estadía queda sin facturar y recepción ya no la ve. Además, el recibo se abre en otra ventana al mismo tiempo y tapa la pregunta.

**Archivos**
- Modify: `src/lib/billing.ts` — `InvoiceStep` (línea 40) suma `'confirmSalir'`.
- Modify: `src/app/admin/InvoicePromptModal.tsx` — `pedirCierre()` y paso confirmSalir. La X (278-282) y el "Cancelar" del paso tipo (463-474) pasan por ahí.
- Modify: `src/app/components/PaymentModal.tsx` — en modo check-out ya no llama a `openReceipt` (131-137).
- Modify: `src/app/admin/RoomCard.tsx` — cola de impresión en `submitCheckoutPayment` (352-359), que se vacía en el onClose del InvoicePromptModal (774-778).

**Pasos**
1. InvoicePromptModal: estado `stepAntesDeSalir` y `pedirCierre()`. Con `startAtTipo` (el admin en Facturación y en Control) cierra directo, como hoy. Sin él (post check-out), guarda el paso y pasa a `confirmSalir`.
2. confirmSalir: "¿Salir sin facturar?" y "Queda pendiente para el administrador. Vos ya no la vas a ver en tu pantalla." Si la factura es obligatoria, agrega "Se cobró por medio bancario: la factura se tiene que emitir igual". Botones "Volver a la factura" y "Salir sin facturar" (onClose, sin `declineInvoiceAction`).
3. Después de emitir (`handleOutcome`) o de "No facturar" (`confirmNo`) sigue cerrando directo.
4. PaymentModal: con `onSubmitPayment` no abre el recibo, lo abre el padre. El pago suelto no cambia.
5. RoomCard: estado `colaImpresion: string[]`. Si va a salir la pregunta de factura, el recibo (`/admin/recibo/{paymentId}?autoprint=1&copy=original`) y el remito de F0-3 se encolan. Si no hay pregunta, se abren enseguida con `openPrintWindow`.
6. onClose del InvoicePromptModal: `setInvoicePrompt(null)` y vaciar la cola. Si alguna ventana se bloquea, sale PrintBlockedModal (F0-3). F2-5a reusa esta cola para el recibo de varios pagos.

**Aceptación**
- [ ] Después del check-out, con la pregunta de factura en pantalla, la X no cierra: pregunta "¿Salir sin facturar? Queda pendiente para el administrador".
- [ ] "Volver a la factura" deja todo como estaba. "Salir sin facturar" cierra, y la estadía le aparece al admin en Por facturar.
- [ ] Mientras la pregunta está abierta, el recibo no aparece. Sale al emitir, al elegir NO o al salir.
- [ ] Sin pregunta de factura (fiscal apagado, vale blanco o cuenta corriente), el recibo y el remito salen como hoy.
- [ ] En /admin/fiscal y en Control, la X del admin cierra directo.

**Tests** (Vitest)
- Create `src/app/admin/InvoicePromptModal.test.tsx` (mockea `./fiscal/actions` y sonner): sin startAtTipo, la X muestra "¿Salir sin facturar?" y no llama a onClose.
- Mismo archivo: "Salir sin facturar" llama 1 vez a onClose y 0 veces a declineInvoiceAction. "Volver a la factura" vuelve a mostrar SÍ/NO.
- Mismo archivo: con startAtTipo, la X llama directo a onClose. Con mandatory, el "Cancelar" del paso tipo lleva a la confirmación y menciona el medio bancario.
- `PaymentModal.test.tsx`: si onSubmitPayment sale bien y devuelve paymentId, `window.open` (spy) no se llama. En el pago suelto sí, con `/admin/recibo/`.

**Verificación en PROD**
- Un check-out cobrado en efectivo: la pregunta sale sin ninguna ventana encima, la X pregunta antes de cerrar y el recibo sale al resolver.
- `select r.id from public.reservations r where r.status = 'checked_out' and r.actual_check_out > now() - interval '1 day' and not exists (select 1 from public.invoice_reservations ir join public.invoices i on i.id = ir.invoice_id where ir.reservation_id = r.id and i.status = 'authorized');` → tiene que coincidir con Control › Por facturar.

👤 **AGUSTÍN:** revisar y mergear después de F0-3. Probar un check-out real con recepción y ver si se entiende el orden (primero la factura, después el recibo). Por defecto, si se cobró con tarjeta, transferencia o MP, recepción puede salir sin facturar después de confirmar, y la estadía te queda en Por facturar.

**Riesgos.** El recibo sale recién cuando se resuelve la pregunta. Si la PC de recepción bloquea las ventanas emergentes, aparece PrintBlockedModal; su botón es un click del usuario, así que abre bien. InvoicePromptModal también lo toca F0-9, que va después.

### F0-9 · DNI inválido para facturar: corregirlo ahí mismo, sin "Corregilo en la reserva"
**Rama:** `claude/dni-corregir-en-el-lugar` · **Carril:** A · **Depende de:** F0-4 · **Migración:** no · **Esfuerzo:** 1,75 días

**Por qué.** El mensaje manda a "corregirlo en la reserva", pero recepción no puede editar una estadía cerrada desde ningún lado. Y si falla el borrador, ni siquiera queda una factura con "Corregir DNI". En 120 días hubo 33 reservas de persona con documento de 9 o 10 dígitos, y con eso la Factura B no sale.

> Absorbe F2-6 (la misma `fixReservationDniAction` y el mismo bloque en InvoicePromptModal), con sus tests.

**Archivos**
- Modify: `src/lib/arca/amounts.ts` — `DNI_INVALIDO_MSG` (línea 56) y `humanizarErrorFiscal(raw)`.
- Modify: `src/lib/error-utils.ts` y `src/lib/arca/emitter.ts` (catch, ~500-530) — P0022 de DNI → `DNI_INVALIDO_MSG`.
- Modify: `src/app/admin/fiscal/actions.ts` — nueva `fixReservationDniAction(reservationId, dni)`.
- Modify: `src/app/admin/InvoicePromptModal.tsx` — estado `dniActual`, bloque "Corregir DNI" en confirmar (385-394) y en formB (502-514), y paso `corregirDni`.
- Modify: `src/app/admin/fiscal/FiscalClient.tsx` — `last_error` humanizado (381-385) y mini-form que se abre sola.
- Modify: `src/__tests__/arca.test.ts`, `src/__tests__/error-utils.test.ts` y `src/app/admin/InvoicePromptModal.test.tsx` (lo crea F0-4).

**Pasos**
1. amounts.ts: `DNI_INVALIDO_MSG = 'El DNI no sirve para facturar: tiene que tener 7 u 8 dígitos (sin puntos).'`, usado en `parseDniForArca`. `humanizarErrorFiscal` cambia el texto viejo de la base por "Usá «Corregir DNI»." y deja pasar el resto.
2. `parseActionError` y emitter traducen SOLO si `code === 'P0022'` y además el mensaje coincide con `/DNI/i`. P0022 también sale por CUIT inválido, por condición de IVA faltante y por el documento en la consolidada: esos mensajes quedan como vienen.
3. `fixReservationDniAction`: assertStaff, `fixReservationDniForInvoice` sin reintentar ninguna emisión, y revalidar las vistas fiscales. P0023 (turno ajeno) → "Pedile al administrador". P0020 → ya facturada.
4. InvoicePromptModal: `dniActual` arranca con `data.clientDni`. Donde hoy dice "Corregilo en la reserva" va un campo numérico de hasta 8 dígitos con el botón "Guardar DNI". Si sale bien: toast "DNI corregido", se actualiza el DNI a la vista y se habilita "Confirmar y emitir". En formB, un link chico "¿El DNI está mal? Corregilo acá".
5. `emitPending` (158-170): si vuelve un P0022 de DNI, no cierra; pasa a `corregirDni` y después vuelve a confirmar. Cualquier otro error se muestra y cierra como hoy.
6. FiscalClient › Con error: la fila muestra `humanizarErrorFiscal(p.last_error)`. Si el reintento vuelve con el error de DNI, se abre la mini-form de esa fila (`setDniEditId`) con el toast "Corregí el DNI acá abajo y se reintenta solo."

**Aceptación**
- [ ] Si el DNI no tiene 7 u 8 dígitos, la pantalla de factura muestra "Corregir DNI". Al guardar uno válido, "Confirmar y emitir" se habilita sin salir del modal.
- [ ] Ninguna pantalla dice "Corregilo en la reserva".
- [ ] Si la estadía no es de su turno, la recepcionista lee "Pedile al administrador" y el DNI no cambia.
- [ ] Una Factura A con el CUIT mal cargado sigue diciendo que el problema es el CUIT, y no abre el campo de DNI.
- [ ] En Facturación › Con error, una factura trabada por DNI dice "Usá «Corregir DNI»" y el campo está en la misma fila.

**Tests** (Vitest)
- `error-utils.test.ts`: un P0022 con el texto viejo del DNI devuelve `DNI_INVALIDO_MSG`. Un P0022 con mensaje de CUIT devuelve el mensaje original.
- `arca.test.ts`: `parseDniForArca('12345')` no dice "en la reserva". `humanizarErrorFiscal` reemplaza el texto viejo, deja pasar los demás y con null devuelve null.
- `InvoicePromptModal.test.tsx`: con clientDni '301234567' (9 dígitos) aparece "Corregir DNI" y "Confirmar y emitir" está deshabilitado.
- Mismo archivo: tipear 30123456 y apretar "Guardar DNI" llama a `fixReservationDniAction('res-1','30123456')`, cambia el DNI a la vista y habilita el botón. Si devuelve P0023, aparece "Pedile al administrador" y el DNI no cambia.
- Mismo archivo: si `emitInvoiceForReservationAction` devuelve `{ success: false, code: 'P0022' }` con un mensaje de DNI, el modal no se cierra y muestra el campo. Con un P0022 de CUIT, no aparece el campo.

**Verificación en PROD**
- Hoy no hay facturas pendientes ni rechazadas: verificar que /admin/fiscal?view=pendientes carga bien.
- En el próximo check-out con el DNI mal tipeado, corregirlo desde la pregunta y emitir. PROD emite facturas reales: se prueba con un caso real, no con uno inventado.
- `select count(*) from public.invoices where status in ('pending','rejected') and created_at > '<deploy>';` y `select count(*) from public.invoices where last_error ilike '%en la reserva%';` → seguimiento de las métricas 9 y 10.

👤 **AGUSTÍN:** revisar y mergear después de F0-4. Por defecto, recepción corrige el DNI de una estadía de su propio turno (la base lo permite desde la mig 73). Si no lo querés, avisá antes del merge.

**Riesgos.** Recepción gana en la pantalla un camino para cambiar el DNI de una reserva cerrada, que es lo mismo que la RPC ya le permitía (turno propio y sin CAE). El texto viejo sigue en tres RPCs (migs 73, 98 y 112) y se traduce en la UI: no vale la pena reescribir funciones en PROD por un texto. En FiscalClient este PR va primero (F0-9, F1-1b, F1-7, F5-16).

### F0-2 · Cuenta corriente: al habilitarla, la facturación pasa a Consolidada (con aviso si la cambian)
**Rama:** `claude/ctacte-modo-consolidada` · **Carril:** B · **Depende de:** — · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Una empresa nueva con cuenta corriente nace en "Factura por cada check-out": cada estadía fiada se factura al cerrarla, o queda sin factura, y nunca entra en la consolidada. Hoy hay 3 empresas y 3 huéspedes así, con 21 cargos fiados sin factura.

**Archivos**
- Modify: `src/lib/billing.ts` — helpers puros nuevos `modoFacturacionAlCambiarCtaCte` y `avisoModoFacturacion`.
- Modify: `src/app/admin/asociados/AssociatedClientModal.tsx` — onChange de cuenta corriente (244-254) y nota o aviso bajo Facturación (265-283).
- Modify: `src/app/admin/guests/GuestModal.tsx` — la misma lógica (201-230).
- Modify: `src/__tests__/billing.test.ts`. Create: `src/app/admin/asociados/AssociatedClientModal.test.tsx`.

**Pasos**
1. `modoFacturacionAlCambiarCtaCte(modoActual, habilitada)`: si se habilita y el modo es `'por_checkout'`, devuelve `'consolidada'`; en cualquier otro caso deja el modo como estaba. `avisoModoFacturacion(habilitada, modo)`: devuelve texto solo con cuenta habilitada y `'por_checkout'`.
2. AssociatedClientModal: al poner Cuenta corriente = Sí se aplica el helper. Si el modo cambió solo, sale una nota verde: "Pasó a Factura consolidada: lo fiado se junta en una factura. Si esta empresa quiere factura en cada check-out, cambialo acá". Con Sí y "por cada check-out" elegido a mano, sale un aviso ámbar que no bloquea: "Con cuenta corriente y factura por check-out, cada estadía fiada se factura al cerrarla y no entra en la consolidada".
3. GuestModal: lo mismo.
4. El DEFAULT de la columna no se toca, porque las actions siempre mandan `facturacion_modo`.

**Aceptación**
- [ ] Al crear o editar una empresa y poner Cuenta corriente = Sí, Facturación pasa sola a "Factura consolidada" y aparece la nota.
- [ ] Si se vuelve a "Factura por cada check-out", aparece el aviso ámbar y se puede guardar igual.
- [ ] Con Cuenta corriente = No, nada cambia. En la ficha de un huésped pasa lo mismo.

**Tests** (Vitest)
- `billing.test.ts`: habilitar con `'por_checkout'` da `'consolidada'`, con `'no_factura'` queda `'no_factura'`, y deshabilitar no cambia el modo.
- `billing.test.ts`: `avisoModoFacturacion(true,'por_checkout')` devuelve texto; `(true,'consolidada')` y `(false,'por_checkout')` devuelven null.
- `AssociatedClientModal.test.tsx` (mockea `./actions` y sonner): poner "Sí" deja elegida "Factura consolidada" y muestra la nota. Volver a "por cada check-out" muestra el aviso.

**Verificación en PROD**
- /admin/asociados → Nueva empresa → Cuenta corriente = Sí: Facturación pasa a Consolidada. Cancelar sin guardar.
- Qué fichas cambiar (se corre en el conector y no se copia al repo): `select 'empresa' tipo, id, display_name from public.associated_clients where cuenta_corriente_habilitada and facturacion_modo = 'por_checkout' union all select 'huesped', id, full_name from public.guests where cuenta_corriente_habilitada and facturacion_modo = 'por_checkout';`
- La consulta 2 de "Cómo medir" hoy da 21. Después de corregir las fichas tiene que dar 0, o solo las que decidiste dejar así.

👤 **AGUSTÍN:** revisar y mergear. Contestar Q1 y, después del deploy, cambiar las fichas una por una desde la UI (Empresas → Editar → Facturación = Consolidada; Huéspedes → Editar). Sus estadías fiadas dejan de figurar en Por facturar como check-out y pasan a la consolidada.

**Riesgos.** Si alguna ficha estaba en "por check-out" a propósito, cambiarla a ciegas mueve sus estadías a la consolidada. Por eso la corrección la hacés vos, ficha por ficha. GuestModal y AssociatedClientModal los tocan después F2-9 y F2-10, en este mismo carril.

### F0-6 · Noches y pasajeros: stepper − / + tolerante y botón final "N noches · sale el dd/mm"
**Rama:** `claude/stepper-noches` · **Carril:** B · **Depende de:** — · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Si se borra el campo, vuelve a 1, y si se tipea 3, queda 13. Así se cargan mal las noches y el precio: fue la causa de 4 de los 21 cierres con diferencia. El botón final muestra noches y fecha de salida, así el error se ve antes de confirmar.

**Archivos**
- Create: `src/lib/stepper.ts` — `parseStepperDraft`, `clampStepper` y `nochesLabel`.
- Create: `src/app/admin/NumberStepper.tsx` — [−] campo [+], con una entrada que tolera el tipeo.
- Modify: `src/app/admin/WalkInModal.tsx` — noches y pasajeros (546-575) y botón final (638-644).
- Modify: `src/app/admin/RoomCard.tsx` — "Noches adicionales" del modal Ampliar (874-884) y su botón (900-906).
- Modify: `src/app/admin/NewReservationModal.tsx` — pasajeros (623-644) y botón final (699-705).
- Modify: `src/app/admin/EditReservationModal.tsx` — pasajeros (241-257).

**Pasos**
1. `parseStepperDraft(draft, min, max)` devuelve null si está vacío o fuera de rango. `clampStepper(n, min, max)` ajusta al rango. `nochesLabel(n)` da "1 noche" o "N noches".
2. NumberStepper `{ id, label, value, onChange, min?, max, hint? }`:
   - Botones de 44 px.
   - Campo `type="text"` con `inputMode="numeric"`, que selecciona todo al tomar el foco (así, tipear 3 da 3).
   - Borrador local de hasta 2 dígitos, que puede quedar vacío mientras se escribe.
   - Al salir del campo, si está vacío o es inválido, vuelve al último valor válido (no a 1); lo que se pasa del rango queda en el límite.
   - − se deshabilita en el mínimo y + en el máximo.
3. Los límites son los del servidor (`src/lib/validations.ts`): noches 1-30 y pasajeros 1-20.
4. Walk-in: "Asignar · 3 noches · sale el 26/09", con `departureKeyFor` y `dayLabel`, que ya existen en WalkInModal. En medio día: "Asignar · medio día". Sin reloj del hotel: "Asignar · 3 noches".
5. Ampliar: "Ampliar 2 noches · sale el 27/09", con `addDaysToDateKey(hotelDateKey(room.check_out_target, timezone), extendNights)` de `@/lib/time`.
6. Reserva nueva: "Crear reserva · N noches · sale el dd/mm", cuando hay `pricePreview`.

**Aceptación**
- [ ] Si se borra "Cantidad de noches" y se sale del campo, vuelve el número que estaba.
- [ ] Con el campo en 1, hacer click y tipear 3 deja 3, no 13. Las letras no entran.
- [ ] − y + cambian de a uno y no pasan de 1 ni de 30 noches (pasajeros: 20).
- [ ] Los botones dicen "Asignar · 3 noches · sale el 26/09", "Ampliar 2 noches · sale el 27/09" y "Crear reserva · 2 noches · sale el 26/09".

**Tests** (Vitest)
- Create `src/__tests__/stepper.test.ts`: `parseStepperDraft('',1,30)` → null, `('3',1,30)` → 3, `('0',1,30)` y `('45',1,30)` → null. `clampStepper(45,1,30)` → 30. `nochesLabel(1)` → "1 noche" y `nochesLabel(3)` → "3 noches".
- Create `src/app/admin/NumberStepper.test.tsx`: borrar y salir del campo restaura el valor, y onChange no recibe 1. Con foco, cambiar a "3" llama a onChange(3). + en el máximo y − en el mínimo están deshabilitados. Tipear "a" no cambia nada.
- Create `src/app/admin/WalkInModal.test.tsx` (mockea `./actions` y sonner; `vi.setSystemTime` a una tarde en hora de Tucumán): con 3 noches, el botón dice "Asignar · 3 noches · sale el dd/mm" con la fecha esperada.

**Verificación en PROD**
- Hoy → habitación libre → "Hacer Check-In": borrar las noches, tipear 3 y usar + y −. El botón dice las noches y la salida. Probar lo mismo en "Ampliar Reserva".
- Consulta 12 de "Cómo medir" (más de 10 noches desde el deploy): revisar a mano que no haya un "13 en vez de 3".

👤 **AGUSTÍN:** revisar y mergear. Probarlo 5 minutos con recepción en la PC del mostrador y en el celular.

**Riesgos.** Después de este PR, el modal Ampliar de RoomCard lo reescriben F2-3, F2-2, F4-3 y F4-4, en ese orden. Por eso este va primero y se mergea antes de que el carril A llegue a F2-3. WalkInModal también lo toca F0-7 (un texto): el que llega segundo rebasea. El formulario público (`src/app/components/BookingModal.tsx:360`) tiene el mismo bug de pasajeros, pero queda afuera.

### F0-10 · Reserva nueva: primero las fechas y aviso cuando la habitación elegida deja de estar libre
**Rama:** `claude/reserva-fechas-primero` · **Carril:** B · **Depende de:** F0-6 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** El selector de habitación está arriba de Entrada y Salida. Si al cambiar las fechas la habitación elegida deja de estar libre, se borra sin avisar, y la recepcionista cree que reservó la que había elegido en el calendario.

**Archivos**
- Modify: `src/app/admin/NewReservationModal.tsx` — el bloque Habitación (552-604) pasa abajo de las fechas (606-621); estado `habitacionQuitada` en el efecto de disponibilidad (168-198); aviso junto al selector.
- Create: `src/app/admin/NewReservationModal.test.tsx`.

**Pasos**
1. El formulario queda en este orden: cliente, fechas, habitación, pasajeros.
2. En el efecto de disponibilidad (188-192), si `current.roomId` no está en la lista nueva, antes de vaciarlo se guarda `{ numero, desde, hasta }`. El número se busca en el prop `rooms`.
3. Aviso ámbar con `role="alert"`, pegado al selector: "La Hab. 5 no está libre del 12 oct al 14 oct. Elegí otra o cambiá las fechas." Se limpia al elegir otra habitación. También cubre el caso de entrar desde el calendario con una habitación ocupada en las fechas por defecto.

**Aceptación**
- [ ] Al abrir "Nueva reserva", Entrada y Salida están arriba de Habitación.
- [ ] Si con una habitación elegida se cambian las fechas y deja de estar libre, aparece el aviso junto al selector. El selector queda vacío y la reserva no se puede crear hasta elegir otra.
- [ ] Al elegir otra habitación, el aviso desaparece.

**Tests** (Vitest)
- `NewReservationModal.test.tsx` (mockea `./actions`, sonner y, si hace falta, `./ClientSearch`): "Entrada" aparece antes que "Habitación" en el DOM (`compareDocumentPosition`).
- Mismo archivo: con `initialValues.roomId=5` y un `fetchAvailableRoomsAction` que no trae la 5, aparece "La Hab. 5 no está libre" y el select queda vacío.
- Mismo archivo: elegir otra habitación saca el aviso. Buscar por texto o aria-label y no con getByRole sobre toda la pantalla (PR #131).

**Verificación en PROD**
- Calendario → click en una celda → cambiar la salida para que choque con otra reserva: aparece el aviso junto al selector. Es solo de pantalla, así que no hace falta SELECT.

👤 **AGUSTÍN:** revisar y mergear después de F0-6.

**Riesgos.** Toca el mismo archivo que F0-6 (pasajeros y botón final), por eso F0-6 se mergea primero. Después, F2-9 vuelve a tocar este modal (el botón que dice qué falta).

### F0-5 · Caja: reimprimir el remito de cuenta corriente del turno (con leyenda "REIMPRESIÓN")
**Rama:** `claude/caja-reimprimir-remito` · **Carril:** C · **Depende de:** F0-3 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Si el remito no salió o se trabó el papel, hoy solo el admin lo puede reimprimir, desde la ficha del cliente. La recepcionista termina rindiendo el turno sin el papel firmado.

**Archivos**
- Modify: `src/lib/data.ts` — `remito_numero` en el select del fiado del turno (3217-3222) y en `normalizeShiftCreditCharge` (3146-3160).
- Modify: `src/lib/types.ts` — `ShiftCreditChargeRow` (806-813) suma `remito_numero: number | null`.
- Create: `src/app/admin/caja/CreditChargesList.tsx` — la lista que hoy está en `CajaClient.tsx:242-256`, con el número y el botón "Reimprimir".
- Modify: `src/app/admin/caja/CajaClient.tsx` — usa CreditChargesList.
- Modify: `src/app/admin/comprobante-cc/[movementId]/page.tsx` — con `?reimpresion=1` imprime "REIMPRESIÓN" debajo de "COMPROBANTE CTA. CTE.".

**Pasos**
1. Cada fila muestra "Remito R-000017" con `numeroVisible` de `@/lib/remito-codigo`, el mismo formato del papel. (El plan de F0 decía `formatShiftCode`, pero ese es el formato del número de turno.) Al lado va el botón "Reimprimir", con ícono Printer y aria-label "Reimprimir remito de {cliente}".
2. El botón llama a `openPrintWindow('/admin/comprobante-cc/{id}?autoprint=1&reimpresion=1', 'comprobante-cc-{id}')`, que viene de F0-3. Si devuelve false, toast.error: "El navegador bloqueó la ventana. Permití ventanas emergentes para este sitio y volvé a apretar."
3. La página del remito lee `reimpresion` y agrega la leyenda. El número y el QR no cambian, así que la Ingesta de remitos firmados lo sigue reconociendo.
4. Lo ven recepción y el admin: todo el staff ya puede leer los movimientos por RLS.

**Aceptación**
- [ ] En Caja, si hubo un check-out a cuenta corriente en el turno, la fila del fiado muestra el número de remito y el botón "Reimprimir".
- [ ] Al apretarlo, sale el mismo remito (mismo número y mismo QR) con la leyenda "REIMPRESIÓN".
- [ ] Lo ven recepción y el admin. El remito del check-out (F0-3) sale sin leyenda.

**Tests** (Vitest)
- Create `src/app/admin/caja/CreditChargesList.test.tsx`: muestra "R-000017" y el cliente ficticio.
- Mismo archivo: "Reimprimir" llama a `window.open` (spy) con `/admin/comprobante-cc/{id}?autoprint=1&reimpresion=1`. Si window.open devuelve null, llama a `toast.error`.
- `CloseShiftModal.test.tsx`: tiene que pasar el typecheck con el campo nuevo (los fixtures usan `[]`).

**Verificación en PROD**
- Como recepción, en /admin/caja, con un fiado en el turno: "Reimprimir" saca el remito con la leyenda.
- `select remito_numero, count(*) from public.cuenta_corriente_movimientos where tipo = 'cargo' group by 1 having count(*) > 1;` → 0 filas: reimprimir no crea movimientos.

👤 **AGUSTÍN:** revisar y mergear después de F0-3. La leyenda "REIMPRESIÓN" va por defecto; si preferís que el papel salga igual al original, avisá antes del merge.

**Riesgos.** Si el reimpreso también se firma y se escanea, remitos firmados (mig 116) guarda dos versiones del mismo movimiento (UNIQUE cc_movimiento_id + version); la deuda no se duplica. CajaClient y CloseShiftModal los tocan después F2-8, F2-2, F2-7b y F5, y este PR va primero. Si F0-3 se atrasa, F2-8 se puede mergear antes que este.

### F0-7 · Habitaciones, Categorías y Limpiezas: solo admin (página, middleware y acciones)
**Rama:** `claude/config-solo-admin` · **Carril:** D · **Depende de:** — · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Hoy cualquier usuario del staff que escriba /admin/rooms o /admin/categorias entra. Las acciones aceptan 'receptionist' a propósito (`rooms/actions.ts:9-11` y `categorias/actions.ts:8-10`), así que recepción puede cambiar el precio de una categoría o activar y desactivar habitaciones. /admin/mantenimiento muestra avisos que son del admin.

**Archivos**
- Modify: `src/lib/supabase/middleware.ts` — suma /admin/rooms, /admin/categorias y /admin/mantenimiento a la condición de solo admin (99-105).
- Modify: `src/app/admin/rooms/page.tsx` y `src/app/admin/categorias/page.tsx` — guard con `getCurrentUserRole()` + `redirect('/forbidden')` (como `remitos/page.tsx:23-24`), en lugar de leer el perfil a mano.
- Modify: `src/app/admin/mantenimiento/page.tsx` — el mismo guard, al principio (103).
- Modify: `src/app/admin/rooms/actions.ts` (9-11) y `src/app/admin/categorias/actions.ts` (8-10) — solo admin.
- Modify: `src/app/admin/WalkInModal.tsx` — texto del medio día sin precio (585-590).
- Modify: `src/__tests__/middleware-roles.test.ts`. Create: `src/__tests__/rooms-actions-roles.test.ts`.

**Pasos**
1. middleware: `isAdminOnlyConfigPath` (startsWith de las tres rutas) entra en la condición de 99-105. Es el único PR que toca el middleware y el guard de /admin/mantenimiento: F1-9 ya no lo repite.
2. Páginas: guard de rol. `isAdmin` queda en true.
3. Actions: `canManageRooms` y `canManageRoomCategories` pasan a aceptar solo `'admin'` (o se reemplazan por `assertAdmin` de `@/lib/server-auth`), con el mensaje "Solo el administrador puede modificar habitaciones y tarifas."
4. WalkInModal: "Cargalo en Categorías/Habitaciones" pasa a "Avisale al administrador: falta el precio de medio día de esta habitación."

**Aceptación**
- [ ] Una recepcionista que escribe /admin/rooms, /admin/categorias o /admin/mantenimiento termina en Hoy (pasa por /forbidden, que la devuelve a /admin).
- [ ] El admin entra a las tres como hoy, y mantenimiento sigue yendo a /maintenance.
- [ ] Si una recepcionista dispara la acción de editar una habitación o una categoría, lee "Solo el administrador puede modificar habitaciones y tarifas." y no cambia nada.

**Tests** (Vitest)
- `middleware-roles.test.ts`, describe nuevo: receptionist en /admin/rooms, /admin/categorias, /admin/mantenimiento y /admin/mantenimiento?page=2 → /forbidden. Admin en las tres → null. Maintenance en /admin/rooms → /maintenance. Receptionist en /admin, /admin/caja y /admin/fiscal sigue en null.
- `rooms-actions-roles.test.ts` (mockea `@/lib/supabase/server` con perfil 'receptionist'): `updateRoomAction`, `setRoomActiveAction` y `updateRoomCategoryAction` devuelven success:false y no llaman a `update`. Con 'admin' siguen de largo.

**Verificación en PROD**
- Como recepción, tipear /admin/rooms: vuelve a Hoy. Como admin, entra.
- Foto antes y después del deploy: `select id, room_number, is_active, category_id from public.rooms order by room_number;` y `select id, name, base_price, half_day_price from public.room_categories order by id;` → no cambió nada.

👤 **AGUSTÍN:** revisar y mergear; este PR arranca ya. Q2: si recepción usa /admin/rooms para algo (por ejemplo, marcar una habitación fuera de servicio), avisá antes del merge y le dejamos ese botón en otro lugar.

**Riesgos.** Si recepción usaba /admin/rooms para mirar cómo están las habitaciones, lo pierde, aunque no hay ningún link a esa pantalla en su menú. WalkInModal también lo toca F0-6, del carril B: el que llega segundo rebasea. Este PR resuelve la pregunta 6 de F1, que sale del cuestionario.

### F0-1 · Factura consolidada: pantalla de revisión antes de mandar a ARCA, y se entra siempre con el cliente puesto
**Rama:** `claude/consolidada-confirmar` · **Carril:** K · **Depende de:** — · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** Hoy "Emitir factura consolidada" manda una factura real (PROD está en producción, PV 8) con un solo click y sin mostrar a quién ni por cuánto. Una factura mal emitida no se borra: se anula con nota de crédito. Además, sin `?kind=&id=` la pantalla abre un selector vacío, y eso va contra la regla de entrar siempre con el cliente puesto.

**Archivos**
- Modify: `src/app/admin/fiscal/consolidada/page.tsx` — redirige a /admin/fiscal/control si faltan `kind` o `id`, y le pasa a ConsolidadaClient el prop `fiscal` (environment, punto_venta, dias_vto_cuenta_corriente) (73-80).
- Create: `src/app/admin/fiscal/consolidada/ConsolidadaConfirmModal.tsx` — el cuadro "Revisá antes de emitir".
- Modify: `src/app/admin/fiscal/consolidada/ConsolidadaClient.tsx` — cliente sin selector (508-525), `emit()` (427-493) partido en `revisar()` y `emitConfirmado()`, y botón de la barra (951-959).
- Modify: `src/app/admin/fiscal/consolidada/ConsolidadaClient.test.tsx` — tests nuevos, y ajuste de los que emitían o cambiaban de cliente.

**Pasos**
1. page.tsx: si falta `kind` o `id`, o no son válidos, `redirect('/admin/fiscal/control')`. Los links de hoy (Control, Cuentas y la ficha) ya mandan los dos.
2. ConsolidadaClient: el select del cliente se reemplaza por un encabezado de solo lectura (nombre, si es empresa o huésped, y saldo), con un link "Elegir otro cliente" que lleva a Control.
3. ConsolidadaConfirmModal (letra, receptorNombre, documento, condicionIvaLabel, estadias, total, periodo, conceptoUnico, nota, fueraDePagina, environment, diasVto, emitting, onConfirm y onCancel) sigue el estilo del paso "confirmar" de InvoicePromptModal (342-415). Muestra "Se va a emitir Factura X", a nombre de quién, el CUIT con `formatCuit` o el DNI, N estadías, el período, el total grande, "Condición de venta: cuenta corriente · vence a N días" y la forma del detalle.
4. En producción, banda roja: "PRODUCCIÓN: es una factura real ante ARCA. Si sale mal, se anula con nota de crédito". En homologación, banda ámbar "PRUEBA". Si hay estadías tildadas en otras páginas, el aviso se repite en el cuadro.
5. `revisar()` hace las validaciones de 428-439 y abre el cuadro. `emitConfirmado()` hace lo de 441-492, con `if (emitting) return`. Si es un huésped con DNI que no tiene 7 u 8 dígitos, aviso rojo y "Confirmar" deshabilitado.
6. El botón de la barra pasa a decir "Revisar y emitir factura consolidada". El cuadro tiene "Volver" y "Confirmar y emitir en ARCA".

**Aceptación**
- [ ] /admin/fiscal/consolidada sin cliente lleva a Control. Con cliente, se ve su nombre y no hay selector.
- [ ] El botón de la barra no emite: abre "Revisá antes de emitir" con la letra, la razón social, el CUIT con guiones (o el DNI), las estadías, el período, el total y el vencimiento. En PROD, con la banda roja.
- [ ] "Volver" cierra sin emitir, y la selección y los textos editados siguen ahí.
- [ ] "Confirmar y emitir en ARCA" emite una sola vez aunque se haga doble click, y después abre el impreso como hoy.
- [ ] Un huésped con DNI inválido ve el aviso y no puede confirmar.

**Tests** (Vitest)
- Nuevo: "Revisar y emitir" no llama a `emitConsolidatedInvoiceAction` y muestra "Factura A", el CUIT 30-12345678-1 (ficticio y con dígito verificador válido; el plan de F0 usaba 30-12345678-9, que es inválido), "3 estadías" y el total.
- Nuevo: "Volver" cierra y no llama a la acción. "Confirmar y emitir en ARCA" la llama 1 vez, también con doble click.
- Nuevo: con `environment='produccion'` aparece PRODUCCIÓN, y con `'homologacion'`, PRUEBA.
- Ajustar los tests que emitían con el primer click (~381, y el helper de "forma del detalle", ~417-422) y los dos que cambian de cliente con el selector (140 y 155), que pasan a montar de nuevo con otro `preselectId`.

**Verificación en PROD**
- Abrir /admin/fiscal/consolidada sin parámetros: lleva a Control.
- Control → "Facturar consolidada" de una empresa → "Revisar y emitir": aparecen el cuadro y la banda roja. "Volver" no emite nada.
- `select kind, status, count(*) from public.invoices where created_at > now() - interval '1 hour' group by 1,2;` → abrir y cerrar el cuadro no crea filas.

👤 **AGUSTÍN:** revisar y mergear. Arranca ya, porque solo toca fiscal/consolidada/*. En la próxima consolidada real, leer el cuadro antes de confirmar y avisar si falta algún dato. Cronometrar el cierre de mes (métrica 11).

**Riesgos.** Si no se ajustan, se rompen los tests que emitían o cambiaban de cliente (están listados arriba). Si quedara algún link a la consolidada sin cliente, ahora lleva a Control en lugar de a un selector vacío.

### Fusionados o descartados
- De F0 no se fusionó ni se descartó ningún PR. En cambio, F0 absorbe dos de F2, que siguen listados allá: F2-1 (su parte de PaymentModal entra en F0-3, y la de RegisterPaymentModal va a F2-11) y F2-6 (entra entero en F0-9, con sus tests).
- Quedan afuera a propósito, sin PR:
  - Reescribir en las RPCs el texto "Corregilo en la reserva": se resuelve en la UI (F0-9).
  - Reimprimir remitos de turnos ya cerrados: F0-5 cubre el turno abierto.
  - El bug de pasajeros del formulario público (`BookingModal.tsx:360`).
  - Unificar ReciboPendiente con PrintBlockedModal.

---

## Fase 1 — Menú de 7 secciones, buscador y campana

F1 ordena el panel en 7 secciones para el dueño y 4 para recepción sin cambiar ninguna URL: menú lateral con la pantalla activa, pestañas arriba, campana de avisos para el admin, buscador global para los dos roles, Hoy que se actualiza solo y Configuración con una pestaña por formulario. Gana recepción, que encuentra las cosas sin escribir direcciones y ve lo que le toca (Por llegar, la respuesta a su pedido de tarifa, el resumen de un cliente), y gana el dueño, que deja de pasar por Mantenimiento para ver sus avisos. Son 12 PRs activos (13 días) repartidos en tres carriles, en este orden: carril A (F1-4, que va en la fila del check-out y es el único con migración, la 120), carril D (F1-1a, F1-1b, F1-3, F1-2, F1-7, F1-8, F1-10, F1-5a, F1-5b y F1-9: menú, permisos y Facturación) y carril E (F1-6, Hoy, detrás de P1).

### F1-4 · Recepción ve la respuesta del admin a su pedido de tarifa (mig 120)
**Rama:** `claude/tarifa-respuesta-recepcion` · **Carril:** A · **Depende de:** F2-5a · **Migración:** 120 · **Esfuerzo:** 1,5 días

**Por qué.** Cuando recepción cambia de habitación por "habitación defectuosa", el pedido le llega al admin y ahí se corta: la recepcionista no sabe si se mantuvo la tarifa anterior y puede cobrar el check-out con la nueva antes de que el admin conteste (después, la autorización ya no se puede aplicar).

**Archivos**
- Create: `supabase_migrations/120_respuesta_de_tarifa_visible_para_recepcion.sql` — `rpc_list_tariff_requests()` para staff.
- Modify: `src/lib/types.ts` — tipo `TariffRequest`. Modify: `src/lib/data.ts` — `listTariffRequests()`.
- Create: `src/lib/tariff-requests.ts` — `latestTariffRequestByReservation(reqs)` y `tariffRequestNotice(req)` (puros).
- Modify: `src/app/admin/page.tsx` — una línea en el Promise.all (80-90) con `.catch(() => [])` y el campo `tariffRequest` en `DashboardRoom`, mapeado por `reservationId`.
- Modify: `src/app/admin/RoomCard.tsx` — chip debajo del huésped y aviso en el `noteText` del cobro (~766).
- Modify: `src/app/admin/ChangeRoomModal.tsx` (~130) — toast de "room_defective".
- Create: `src/__tests__/tariff-requests.test.ts`.

**Pasos**
1. Escribir la 120 y pedir el OK para aplicarla; confirmar el número contra `applied_migrations` y `ls supabase_migrations` al abrir la rama.
2. Tipos, lectura y lib puro con tests. Textos: "Tarifa: esperando al admin", "El admin mantuvo la tarifa anterior ($X)", "El admin dejó la tarifa nueva ($Y)".
3. `admin/page.tsx`: rebase contra el carril E (es una línea del Promise.all).
4. Cobro con el pedido pendiente: "El admin todavía no respondió si se mantiene la tarifa anterior. Si cobrás ahora se cobra la nueva y la autorización ya no se va a poder aplicar." Avisa y deja cobrar (no bloquea). Con los renglones de F2-5a va una sola vez, arriba; se concatena con la nota de salida anticipada.
5. Toast: "… Se avisó al admin. Su respuesta la vas a ver en la tarjeta de la habitación."

**Base de datos.** Crea `public.rpc_list_tariff_requests()` RETURNS TABLE (alert_id, reservation_id, room_number, created_at, decision, resolved_at, old_total, new_total), STABLE SECURITY DEFINER, `SET search_path = public`, que arranca con `IF NOT public.app_is_staff() THEN RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501'`. Devuelve solo el kind `room_change_keep_old_tariff_request` de reservas `confirmed` o `checked_in`; los montos salen de `payload->>'old_total_price'` y `'new_total_price'`, y `room_number` es la habitación actual; ORDER BY created_at DESC LIMIT 50. REVOKE a PUBLIC y anon, GRANT a authenticated. No toca la RLS de `admin_alerts`. Llama a `record_migration('120_respuesta_de_tarifa_visible_para_recepcion.sql')`. Se aplica con `select public.exec_ddl($m120$ ... $m120$)` (sin BEGIN/COMMIT, sin `;` final, sin comillas en comentarios), con OK de Agustín y ANTES del merge.

**Aceptación**
- [ ] Después de un cambio por habitación defectuosa, la tarjeta de la habitación nueva dice "Tarifa: esperando al admin" en ámbar.
- [ ] Si el dueño autoriza, dice "El admin mantuvo la tarifa anterior ($X)" en verde y el total ya es el anterior; si rechaza, "El admin dejó la tarifa nueva ($Y)".
- [ ] Con el pedido pendiente, el cobro del check-out avisa antes de confirmar.
- [ ] Una estadía cerrada no muestra nada.

**Tests** (Vitest)
- `tariff-requests.test.ts`: con dos pedidos de la misma reserva gana el más nuevo; `tariffRequestNotice` da `amber` con decision null, `emerald` con `authorized` (incluye el total anterior con `formatAmount`) y `slate` con `rejected` (incluye el nuevo).
- Chip: si RoomCard es pesado de montar, extraer `TariffRequestChip` y probarlo por texto (no `getByRole` sobre toda la pantalla).

**Verificación en PROD**
- `SELECT filename FROM public.applied_migrations WHERE filename LIKE '120%';` → 1 fila.
- `SELECT prosecdef, has_function_privilege('anon', oid, 'EXECUTE'), has_function_privilege('authenticated', oid, 'EXECUTE') FROM pg_proc WHERE proname = 'rpc_list_tariff_requests';` → true, false, true.
- Contar los pedidos de reservas `confirmed`/`checked_in` y compararlos con los chips de Hoy; abrir Hoy como recepción sin errores.

👤 **AGUSTÍN:** dar el OK para aplicar la 120 antes del merge, verificar su fila en `applied_migrations`, mergear y probarlo con recepción en el próximo cambio por habitación defectuosa.

**Riesgos.** Si se mergea sin la 120, Hoy abre igual (por el catch) pero sin chip; ya pasó que migraciones sin aplicar rompieron PROD, así que primero la base. Toca RoomCard en el carril más disputado: va en su lugar de la fila (después de F2-5b y antes de F2-2), y F2-7a lo arrastra a CheckoutFlow sin cambiarlo.

### F1-1a · Menú de 7 secciones: modelo de secciones, pantalla activa en el menú lateral y cajón del celular (sin barra de pestañas)
**Rama:** `claude/menu-secciones` · **Carril:** D · **Depende de:** F2-8 · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** Hoy son 18 links planos en dos bloques y el menú de escritorio no marca dónde estás. El dueño pasa a ver 7 secciones y recepción 4, con la pantalla activa resaltada, sobre las mismas URLs.

**Archivos**
- Modify: `src/app/admin/nav-links.ts` — `NavSection`/`NavTab` (con `match`, `adminOnly`, `badge`); `getNavSections(role, state)`, `sectionHref`, `findActiveNav(sections, pathname, searchParams)`, `sectionBadge`; `NavState` suma `solicitudesPendientes` y `facturasConError`. `getReceptionItems` e `isNavItemActive` quedan como derivados hasta F1-2.
- Modify: `src/app/admin/Sidebar.tsx` — pasa a cliente; secciones, activa con `aria-current="page"`, sub-ítems de la sección activa.
- Modify: `src/app/admin/MobileNav.tsx` — el cajón de `MobileTopBar` lista secciones con pestañas y marca la activa (`MobileTabBar` no cambia).
- Modify: `src/app/admin/layout.tsx` (82-92, 101-134) — un Promise.all con los conteos, `navState` y `<Suspense>`.
- Modify: `src/lib/data.ts` (3919) — `getPendingSolicitudesCount` con React `cache()`.
- Modify: `src/lib/billing.ts` — `facturasConError(rows, now)`. Modify: `src/lib/remitos.ts` — `remitosParaRevisar(salud)`.
- Modify: `src/app/admin/remitos/page.tsx` y `RemitosClient.tsx` — línea "Para revisar" con el número del menú y `?ver=a_revisar`.
- Modify: `src/__tests__/nav-links.test.ts`, `mobile-nav-print.test.tsx` (mock de `useSearchParams`), `billing.test.ts`, `remitos.test.ts`; Create: `src/__tests__/sidebar.test.tsx`.

**Pasos**
1. Contenido según el menú objetivo. Reservas: Calendario, Solicitudes (badge), Por llegar (`/admin/guests?view=por_llegar`, solo admin hasta F1-8), Historial (admin). Caja: Turno/"Mi turno" y Rendiciones/"Mis rendiciones". Facturación: Por facturar (`/admin/fiscal/control`, también marca `/admin/fiscal/consolidada` y `?view=sin_facturar`), Con error (`?view=pendientes`), Emitidas y Remitos. Clientes: Directorio, Empresas y convenios, Cuenta corriente (ícono `HandCoins`, distinto de Caja), Descuentos. Tablero: General, Por habitación, Cobros del día (`/admin/finances`), Limpiezas (`/admin/mantenimiento`). Configuración: Ajustes y Habitaciones y tarifas (marca `/admin/categorias`). `/admin/fiscal` sin view: admin → Por facturar (hoy abre Sin facturar), recepción → Con error (F1-7 lo unifica).
2. `findActiveNav`: gana el path más largo; con param compara el valor, `isDefault` vale sin param; `/admin/recibo/*` → null.
3. `facturasConError(rows, now)`: `rejected`, o `pending`/`processing` con `last_attempt_at ?? created_at` de más de 15 minutos. El menú usa `.length` y F4-1b las filas; ya no se usa `listPendingInvoices().length`.
4. Remitos (hueco del crítico): el badge sigue siendo `a_revisar + piezas_abiertas` de todo el historial (para que no se olvide un remito viejo) y el panel muestra arriba "Para revisar: N remitos y M piezas" con el mismo helper; "Ver los N a revisar" abre `?ver=a_revisar` (rango `BILLING_EPOCH`..hoy, solo ese estado). Lo que dice el menú es lo que se ve al abrir.
5. layout.tsx: unbilled y remitos (solo admin), solicitudes y facturas con error (los dos roles), cada uno con `.catch(() => 0)`. Sidebar y MobileTopBar en `<Suspense>`.
6. Sin barra de arriba todavía: las pestañas de la sección activa van como sub-ítems del menú lateral, así nadie pierde Rendiciones, Descuentos o Limpiezas. No se escribe plan por fase: vive en P0.

**Aceptación**
- [ ] Recepción ve 4 secciones (Hoy, Reservas, Caja, Facturación) y la que está usando queda resaltada.
- [ ] El dueño ve 7; en Clientes ve debajo Directorio, Empresas y convenios, Cuenta corriente y Descuentos.
- [ ] Todo marcador viejo (`/admin/cuentas`, `/admin/fiscal?view=emitidas`) abre la misma pantalla con su sección marcada.
- [ ] El número de Remitos es el que se ve al abrir el panel.

**Tests** (Vitest)
- `nav-links.test.ts`: recepción → exactamente [hoy, reservas, caja, facturacion], sin Historial, Emitidas, Por facturar ni Remitos; admin → 7 en orden. `findActiveNav`: `/admin` solo marca hoy; `/admin/caja/rendiciones/abc` → caja; `/admin/fiscal/consolidada?kind=company&id=x` → por_facturar; `/admin/categorias` → configuracion; `/admin/recibo/1` → null. `sectionBadge`: alert antes que warn. Íconos de Caja y Cuenta corriente distintos.
- `billing.test.ts`: `rejected` cuenta siempre; `processing` de hace 20 min sí, de hace 2 min no. `remitos.test.ts`: `remitosParaRevisar` suma los dos.
- `sidebar.test.tsx` (pathname, searchParams y LogoutButton mockeados; buscar por texto): en `/admin/cuentas` Clientes tiene `aria-current`; recepción no tiene Clientes.

**Verificación en PROD**
- Recorrer las secciones como admin y como recepción.
- `SELECT count(*) FROM public.reservations WHERE status = 'pending';` = badge de Solicitudes.
- `SELECT count(*) FROM public.invoices WHERE status = 'rejected' OR (status IN ('pending','processing') AND coalesce(last_attempt_at, created_at) < now() - interval '15 minutes');` = badge de Con error del admin.

👤 **AGUSTÍN:** mergear después de F2-8 (los dos tocan layout.tsx) y mostrarle el menú a una recepcionista.

**Riesgos.** El layout envuelve todo el panel: un error en Sidebar rompe todas las pantallas (no hace fetch; tests de los dos roles). `useSearchParams` sin Suspense rompe `npm run build`: verificar con `npm run build && npm start`, no con dev. Los badges no se recalculan en la navegación suave (igual que hoy).

### F1-1b · Barra de arriba con las pestañas de la sección; fuera las pastillas duplicadas y títulos nuevos
**Rama:** `claude/menu-pestanas-arriba` · **Carril:** D · **Depende de:** F1-1a, F0-7, F0-9 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Cada sección muestra sus pestañas en un solo lugar, arriba, y desaparecen las filas de pastillas repetidas dentro de Facturación, Huéspedes y Tablero. Los títulos dicen dónde estás.

**Archivos**
- Create: `src/app/admin/SectionTabs.tsx` — pestañas de la sección activa (cliente), `aria-current="page"` (brand-700 con borde inferior), badge y `keepParams`.
- Create: `src/app/admin/AdminTopBar.tsx` — fila `h-12 bg-white border-b print:hidden`: sección y pestañas a la izquierda, slot `actions` a la derecha (campana en F1-3, buscador en F1-5b).
- Modify: `src/app/admin/layout.tsx` — AdminTopBar dentro de `<main>`, antes de `OpenShiftAgeAlert` y fuera del wrapper que scrollea, en `<Suspense>`.
- Modify: `src/app/admin/Sidebar.tsx` — en escritorio deja de mostrar los sub-ítems de F1-1a (ahora están arriba); el cajón del celular los conserva.
- Modify: `src/app/admin/nav-links.ts` — `keepParams`: Tablero `from`/`to`; Facturación `desde`/`hasta`/`tipo`/`q`.
- Modify: `src/app/admin/fiscal/FiscalClient.tsx` — borrar las pastillas (329-346) y `buildHref` (207) si queda sin uso.
- Modify: `src/app/admin/guests/page.tsx` — borrar las pastillas (136-152), "Ver cancelados" se queda; título por vista (112): "Por llegar", "Historial de reservas" o "Directorio de huéspedes".
- Modify: `src/app/admin/analytics/DashboardNav.tsx` — borrar las pestañas (23-53); quedan el filtro y los presets.
- Modify: `src/app/admin/page.tsx` (213) — "Hoy · {fecha}". Es el único PR que cambia ese título.
- Modify: `src/app/admin/categorias/page.tsx` (21) — "Categorías de habitaciones"; `src/app/admin/rooms/page.tsx` (35) — "Gestionar categorías".
- Create: `src/__tests__/section-tabs.test.tsx`.

**Pasos**
1. SectionTabs y AdminTopBar. Con una sola pestaña no se dibuja la fila (recepción en Facturación ve solo el nombre). En el celular, solo la fila de pestañas con `overflow-x-auto`, si hay dos o más.
2. Sacar las pastillas y ajustar títulos. Rebasear contra F0-9 (FiscalClient) y F0-7 (guard de rooms y categorías).

**Aceptación**
- [ ] En Facturación, Huéspedes y Tablero hay una sola fila de pestañas, arriba.
- [ ] En el Tablero, pasar de General a Por habitación conserva el rango; en Facturación, pasar de Con error a Emitidas conserva el período.
- [ ] Al reimprimir un recibo o una factura, la barra no sale en el papel.
- [ ] Hoy se titula "Hoy · {fecha}".

**Tests** (Vitest)
- `section-tabs.test.tsx`: en `/admin/fiscal?view=pendientes` como admin hay 4 pestañas y "Con error" tiene `aria-current`; como recepción no hay fila; el contenedor tiene `print:hidden`; en `/admin/analytics?from=2026-09-01&to=2026-09-10` el href de "Por habitación" conserva `from` y `to`.

**Verificación en PROD**
- Recorrer Facturación, Directorio y Tablero como admin: una sola fila de pestañas.
- Reimprimir un recibo desde Caja: el papel sale sin barras.

👤 **AGUSTÍN:** mirarlo en un monitor de 768 px de alto y mergear.

**Riesgos.** Son 48 px más de alto, pero reemplazan las pastillas internas: el neto es casi cero en Facturación, Huéspedes y Tablero. En FiscalClient va segundo (F0-9, F1-1b, F1-7, F5-16); si F0-9 movió mucho el archivo, el borrado se rehace a mano.

### F1-3 · Campana de avisos del admin (reemplaza el panel de Mantenimiento)
**Rama:** `claude/campana-avisos` · **Carril:** D · **Depende de:** P1, F1-1b · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Los avisos del admin (autorizar tarifa, sobrepagos, turnos con salida vencida, habitación ocupada) están escondidos en Mantenimiento, y "Marcar leída" falla con los de habitación ocupada porque la base exige una nota (mig 105). Con la campana el dueño los ve y los resuelve desde cualquier pantalla.

**Archivos**
- Create: `src/lib/admin-alerts.ts` — `ALERT_KIND_LABEL` (5 kinds más un rótulo genérico) y `alertActionKind(kind)`: 'tarifa' | 'ocupada' | 'leida'.
- Create: `src/app/admin/AdminAlertsList.tsx` — lista con acciones por tipo (sale de `mantenimiento/AlertsPanel.tsx`).
- Create: `src/app/admin/AdminAlertsBell.tsx` — campana, conteo y panel `role="dialog" aria-modal="true"`; escucha `admin:abrir-avisos`.
- Create: `src/app/admin/OpenAlertsButton.tsx` — dispara el evento.
- Modify: `src/app/admin/mantenimiento/actions.ts` — `listAdminAlertsAction()` con `assertAdmin`.
- Delete: `src/app/admin/mantenimiento/AlertsPanel.tsx` (F4-8 ya no lo toca). Modify: `src/app/admin/mantenimiento/page.tsx` — sin AlertsPanel (161) ni `listAdminAlerts` (127).
- Modify: `src/app/admin/page.tsx` (268-274) — el cartel ámbar dice "Ver avisos" y abre la campana.
- Modify: `src/app/admin/layout.tsx`, `src/app/admin/AdminTopBar.tsx` (lo crea F1-1b) y `src/app/admin/MobileNav.tsx` — conteo solo para admin; campana en el slot derecho y a la izquierda de la hamburguesa.
- Modify: `src/lib/data.ts` (3910) — se mantiene `getUnresolvedAdminAlertsCount`, ahora con `cache()` (la usan layout y Hoy).
- Create: `src/__tests__/admin-alerts.test.ts`, `src/app/admin/AdminAlertsBell.test.tsx`.

**Pasos**
1. Rebasear sobre P1 (117 aplicada y 106 en main): con eso "Regularizar" funciona y es solo del admin.
2. AdminAlertsList: tarifa → "Autorizar tarifa anterior" y "Rechazar"; ocupada → link "Regularizar en Hoy" (`/admin`) y "Cerrar sin cargar", que despliega una nota obligatoria y llama `resolveAdminAlertAction(id, nota)`; el resto → "Marcar leída". Al terminar: toast y `router.refresh()`.
3. Campana: badge con `99+` (la RPC tiene LIMIT 100); al abrir llama la acción y el conteo pasa a ser el largo de la lista. Popover en escritorio, hoja completa en el celular.
4. Va apenas después de F1-1b dentro del carril D porque destraba los carriles E y G.

**Aceptación**
- [ ] El dueño ve una campana arriba, en cualquier pantalla, con los avisos sin revisar; recepción no la ve.
- [ ] Autoriza o rechaza un pedido de tarifa desde la campana y el número baja sin recargar.
- [ ] Un aviso de habitación ocupada ofrece "Regularizar en Hoy" y "Cerrar sin cargar"; lo segundo no confirma sin nota.
- [ ] El cartel ámbar de Hoy dice "Ver avisos" y abre la campana; Limpiezas ya no muestra alertas.

**Tests** (Vitest)
- `admin-alerts.test.ts`: `alertActionKind` da 'tarifa', 'ocupada' y 'leida' (kind desconocido); rótulo en español para los 5 kinds y genérico para otro.
- `AdminAlertsBell.test.tsx` (acciones mockeadas; buscar por texto o aria-label): `initialCount=3` muestra "3", con 0 no hay badge; abrir llama la acción una vez; "Confirmar cierre" deshabilitado sin nota y con nota llama `resolveAdminAlertAction(id, 'nota')`; el evento `admin:abrir-avisos` (clic en "Ver avisos") abre el panel.

**Verificación en PROD**
- `SELECT kind, count(*) FROM public.admin_alerts WHERE resolved_at IS NULL GROUP BY kind;` = número de la campana.
- Abrir la campana vacía sin errores; Limpiezas sin bloque de alertas.

👤 **AGUSTÍN:** confirmar que P1 está mergeado, mergear y resolver el próximo pedido de tarifa desde la campana.

**Riesgos.** Con la campana abierta no se ven avisos nuevos hasta reabrirla. Borrar AlertsPanel sin campana dejaría al admin sin acciones: por eso van en el mismo PR.

### F1-2 · Barra inferior del celular según el rol (admin: Hoy · Reservas · Caja · Tablero · Más)
**Rama:** `claude/barra-celular-rol` · **Carril:** D · **Depende de:** F1-1a · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Hoy el dueño ve en el celular los mismos 5 accesos que recepción y para llegar al Tablero tiene que abrir la hamburguesa. Pasa a Hoy · Reservas · Caja · Tablero · Más; recepción queda con Hoy · Reservas · Caja · Facturación.

**Archivos**
- Modify: `src/app/admin/nav-links.ts` — `getMobileBarSections(role, state)`; borrar `getReceptionItems` e `isNavItemActive` si quedan sin uso.
- Create: `src/app/admin/MobileMenuContext.tsx` — provider `{ isOpen, open, close }`.
- Modify: `src/app/admin/MobileNav.tsx` (173-217) — `MobileTabBar({ role, ...navState })`: 5 columnas para admin con botón "Más" (`aria-haspopup="dialog"`) y 4 para recepción; `MobileTopBar` usa el contexto en vez de su `useState` (40-42).
- Modify: `src/app/admin/layout.tsx` (101, 134) — provider y props de `MobileTabBar`.
- Modify: `src/__tests__/mobile-nav-print.test.tsx`; Create: `src/__tests__/mobile-tab-bar.test.tsx`.

**Pasos**
1. Activo por sección con `findActiveNav`, punto de badge con `sectionBadge`, `aria-label="Accesos rápidos"`, `print:hidden`.
2. MobileTopBar conserva el cierre al navegar y el Escape.
3. MobileNav lo tocan F1-1a, F1-3, F1-2 y F1-5b, en ese orden.

**Aceptación**
- [ ] En el celular, recepción ve abajo Hoy, Reservas, Caja y Facturación, con la activa en verde.
- [ ] El dueño ve Hoy, Reservas, Caja, Tablero y Más; Más abre el mismo menú que la hamburguesa.
- [ ] En Por llegar queda marcada Reservas; Caja muestra el punto verde con turno abierto y ámbar sin turno.

**Tests** (Vitest)
- `mobile-tab-bar.test.tsx`: recepción → 4 links (Hoy, Reservas, Caja, Facturación); admin → 4 links (Hoy, Reservas, Caja, Tablero) y el botón "Más"; "Más", dentro del provider junto a MobileTopBar, muestra el nav "Menú del panel"; con `/admin/guests?view=por_llegar`, Reservas tiene `aria-current`.
- `mobile-nav-print.test.tsx`: la barra sigue con `print:hidden` y el aria-label nuevo.

**Verificación en PROD**
- Desde un celular, entrar como recepción y como admin y comparar las barras.
- Reimprimir un recibo desde el celular: la barra no sale en el papel.

👤 **AGUSTÍN:** probarlo en tu celular y en el de una recepcionista, y mergear.

**Riesgos.** Si el provider queda afuera de uno de los dos componentes, "Más" no hace nada: lo cubre el test que los renderiza juntos. Con 5 columnas, las etiquetas cortas tienen que entrar en unos 11 caracteres (`shortLabel`).

### F1-7 · "Sin facturar" pasa a ser el atajo "Últimos 10 días" en Por facturar
**Rama:** `claude/facturacion-ultimos-10-dias` · **Carril:** D · **Depende de:** F1-1b, F0-9 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Hay dos listas de "qué falta facturar" con criterios distintos: la solapa de 10 días (solo por check-out) y el Control. Queda una sola, la del Control, con el atajo de 10 días que el dueño usaba (decisión 2), y el barrido de facturas trabadas deja de depender de abrir `/admin/fiscal`.

**Archivos**
- Modify: `src/lib/date-range.ts` — primer preset "Últimos 10 días" en `buildBillingPresets` y `sinFacturarRedirectHref(todayKey)`.
- Modify: `src/app/admin/fiscal/views.ts` — `FiscalView = 'pendientes' | 'emitidas'`; default 'pendientes' también para el admin.
- Modify: `src/app/admin/fiscal/page.tsx` — `?view=sin_facturar` del admin redirige; sin `listInvoiceableCheckouts` (66-68) ni la prop `invoiceable`.
- Modify: `src/app/admin/fiscal/FiscalClient.tsx` — borrar la sección Check-outs sin facturar (483-553) y lo que quede sin uso.
- Modify: `src/app/admin/fiscal/control/page.tsx` — `after(sweepStaleInvoices())` para el admin (sigue también en `/admin/fiscal`).
- Modify: `src/app/admin/nav-links.ts` — fuera el alias `sin_facturar`; `/admin/fiscal` sin view marca "Con error" para los dos roles.
- Modify: `src/app/admin/actions.ts` (67) y `src/app/admin/finances/actions.ts` (45) — fuera `revalidatePath('/admin/timeline')` (viene de F1-11).
- Modify: `docs/solapamiento-cuentas-facturacion.md` — §4 ("se elimina de /admin/fiscal; es el atajo Últimos 10 días del control; su SQL se queda por el cierre de caja"), punto 3 de "En una carilla" y nota fechada 2026-09-23.
- Create: `src/__tests__/date-range.test.ts`, `src/__tests__/fiscal-views.test.ts`; Modify: `src/__tests__/nav-links.test.ts`.

**Pasos**
1. `sinFacturarRedirectHref('2026-09-23')` → `/admin/fiscal/control?desde=2026-09-14&hasta=2026-09-23&estado=pendiente`.
2. El chip "Últimos 10 días" cuenta con `isPendingBilling` (lo que falta más lo que espera la consolidada), igual que el número rojo del menú.
3. NO borrar `listInvoiceableCheckouts` ni su RPC: la usa el cierre de caja (`getCloseShiftBlockers`, data.ts:3416). `InvoicePromptModal` se queda si otra acción lo usa. La página `/admin/timeline` no se toca (ya es un redirect).

**Aceptación**
- [ ] En Facturación › Por facturar hay un botón "Últimos 10 días" con las acciones de siempre (Facturar, Consolidar, Ya facturado).
- [ ] Un marcador viejo a "Sin facturar" abre Por facturar con "Últimos 10 días" elegido.
- [ ] `/admin/fiscal` ya no tiene la solapa Sin facturar, y la recepcionista sigue entrando a "Con error".
- [ ] Una consolidada trabada en ARCA se reconcilia también cuando el dueño abre Por facturar.

**Tests** (Vitest)
- `date-range.test.ts`: el primer preset es { 'Últimos 10 días', '2026-09-14', '2026-09-23' }; cruce de mes ('2026-10-03' → from '2026-09-24'); el href exacto del redirect.
- `fiscal-views.test.ts`: `parseFiscalView(undefined, true)` es 'pendientes'; `('emitidas', false)` es 'pendientes'; `FISCAL_VIEWS` no tiene 'sin_facturar'.
- `nav-links.test.ts`: `/admin/fiscal` sin view marca "Con error" para los dos roles.

**Verificación en PROD**
- Antes del merge, anotar cuántas filas muestra Sin facturar; después, `/admin/fiscal?view=sin_facturar` redirige y la cantidad no es menor (ahora suma las consolidadas).
- `SELECT count(*) FROM public.invoices WHERE status = 'processing' AND created_at < now() - interval '10 minutes';` → 0 un rato después de abrir Por facturar.

👤 **AGUSTÍN:** anotar el número de la solapa vieja, mergear y probar el atajo con un caso real.

**Riesgos.** El atajo cuenta días del hotel (hoy y los 9 anteriores) y la solapa vieja usaba `NOW() - 10 días` solo por check-out: los números no coinciden exacto. En FiscalClient va tercero (F0-9, F1-1b, F1-7, F5-16).

### F1-8 · Reservas › Por llegar visible para recepción, en solo lectura
**Rama:** `claude/por-llegar-recepcion` · **Carril:** D · **Depende de:** F1-1a · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** La recepcionista no puede ver las próximas llegadas en una lista: `/admin/guests` la manda a `/forbidden`. Pasa a verla en solo lectura, sin acceso al Historial (que deja cancelar estadías cerradas).

**Archivos**
- Create: `src/lib/upcoming.ts` — `resolveGuestsView(view, role)` y `upcomingStatus(guest, todayKey, tz)`.
- Modify: `src/app/admin/guests/page.tsx` (46-84) — gate por vista en lugar de por rol; recepción solo consulta `getUpcomingGuests`.
- Modify: `src/app/admin/guests/UpcomingGuestsTable.tsx` (57-60) — estado real por fila.
- Modify: `src/app/admin/nav-links.ts` — Por llegar deja de ser adminOnly.
- Create: `src/__tests__/upcoming.test.ts`; Modify: `src/__tests__/nav-links.test.ts`.

**Pasos**
1. Recepción siempre cae en `por_llegar` (redirige a `/admin/guests?view=por_llegar`, conservando `q` y `page`); el admin sigue con Directorio por defecto.
2. Estado por fila: "Solicitud web" (pending), "Confirmada" y "Atrasada (no vino)" si la entrada es anterior a hoy en hora del hotel (hoy son 6 de 22).
3. El buscador de la página se mantiene; la tabla no tiene botones de acción.
4. Desde acá recepción entra a `/admin/guests?view=por_llegar`: F3-6 redirige a Clientes solo si el rol es admin.

**Aceptación**
- [ ] La recepcionista entra a Reservas › Por llegar y ve la lista sin botones para editar ni cancelar.
- [ ] Si abre Historial o Directorio por URL, termina en Por llegar.
- [ ] Las que no llegaron dicen "Atrasada (no vino)" y las web sin confirmar, "Solicitud web".
- [ ] El dueño sigue viendo Directorio e Historial como antes.

**Tests** (Vitest)
- `upcoming.test.ts`: `resolveGuestsView('historial', 'receptionist')` y `(undefined, 'receptionist')` redirigen a por_llegar; `('historial', 'admin')` no redirige; `(undefined, 'admin')` → directorio. `upcomingStatus`: ayer → 'atrasada'; hoy o futura → 'confirmada'; pending → 'solicitud'.
- `nav-links.test.ts`: recepción ve Reservas › Por llegar y no Historial.

**Verificación en PROD**
- Como recepción, abrir Por llegar y probar `/admin/guests?view=historial`: redirige.
- `SELECT count(*) FILTER (WHERE (check_in_target AT TIME ZONE 'America/Argentina/Tucuman')::date < (now() AT TIME ZONE 'America/Argentina/Tucuman')::date) AS atrasadas, count(*) FROM public.reservations WHERE status IN ('pending','confirmed');` = rótulos de la lista.

👤 **AGUSTÍN:** mergear y avisarle a recepción que las "Atrasadas" son no-show para revisar con vos.

**Riesgos.** La lista muestra nombre y DNI, que recepción ya ve en Hoy y en el Calendario: no hay exposición nueva. Los no-show viejos siguen en `confirmed` (decisión previa): ahora se ven marcados, pero no se cierran solos.

### F1-10 · Configuración con pestañas: Hotel y mensajes, Habitaciones y tarifas, ARCA, Usuarios
**Rama:** `claude/configuracion-pestanas` · **Carril:** D · **Depende de:** F1-1b, F0-7 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Ajustes es una página larga con tres formularios y tres Guardar mezclados, y habitaciones y categorías están en otro lado. Cada cosa pasa a tener su pestaña, su único Guardar y un aviso si te vas con cambios sin guardar.

**Archivos**
- Create: `src/app/admin/settings/tabs.ts` — `parseSettingsTab(value)`: 'hotel' | 'arca' | 'usuarios' (default 'hotel').
- Modify: `src/app/admin/settings/page.tsx` — pestaña por `?tab=`, los tres paneles siempre montados (los que no corresponden con `hidden`), título por pestaña y guard de rol en la página.
- Create: `src/app/admin/settings/useUnsavedChangesGuard.ts` — `beforeunload` y clic en captura sobre `a[href]` que salga de `/admin/settings`.
- Modify: `src/app/admin/settings/SettingsForm.tsx` y `FiscalSettingsPanel.tsx` — `onDirtyChange` y leyenda "Cambios sin guardar".
- Modify: `src/app/admin/settings/UsersPanel.tsx` — solo `onDirtyChange` (ya tiene `isDirty` por fila); los labels y la opción "Cliente" quedan para F5-18a.
- Modify: `src/app/admin/nav-links.ts` — Hotel y mensajes (`/admin/settings`), Habitaciones y tarifas (`/admin/rooms`, marca `/admin/categorias`), ARCA (`?tab=arca`), Usuarios (`?tab=usuarios`).
- Create: `src/app/admin/rooms/RoomsSubNav.tsx` — "Habitaciones | Categorías y tarifas"; reemplaza el link "Gestionar categorías".
- Modify: `src/app/admin/rooms/page.tsx` — RoomsSubNav y "N activas · M inactivas" en lugar de "Total: 15 habitaciones" (hueco del crítico). Modify: `src/app/admin/categorias/page.tsx` — RoomsSubNav.
- Create: `src/lib/rooms-count.ts` — `roomsCountLabel(rooms)` (puro).
- Create: `src/__tests__/settings-tabs.test.ts`, `src/__tests__/unsaved-changes-guard.test.tsx`, `src/__tests__/rooms-count.test.ts`, `src/app/admin/settings/SettingsForm.test.tsx`.

**Pasos**
1. SettingsForm: estado sucio comparando `new URLSearchParams(new FormData(form)).toString()` con la foto inicial; se resetea al guardar bien.
2. Cambiar de pestaña dentro de Configuración no pregunta (los paneles siguen montados).
3. No tocar la lógica de guardado de FiscalSettingsPanel: PROD emite facturas reales.

**Aceptación**
- [ ] En Configuración hay cuatro pestañas y cada una tiene un solo Guardar.
- [ ] Si el dueño cambia el mensaje de confirmación, pasa a ARCA y vuelve, lo tipeado sigue ahí.
- [ ] Si intenta irse con cambios sin guardar, le pregunta "Tenés cambios sin guardar. ¿Salir igual?".
- [ ] Habitaciones dice "14 activas · 1 inactiva" (lo que haya) y arriba "Habitaciones | Categorías y tarifas".
- [ ] `/admin/settings`, `/admin/rooms` y `/admin/categorias` siguen funcionando.

**Tests** (Vitest)
- `settings-tabs.test.ts`: undefined → 'hotel'; 'arca' → 'arca'; 'cualquiera' → 'hotel'. `rooms-count.test.ts`: 14 activas y 1 inactiva → "14 activas · 1 inactiva"; sin inactivas no la menciona.
- `unsaved-changes-guard.test.tsx`: con dirty, `beforeunload` queda con preventDefault; un clic a `/admin` pregunta y, si se cancela, queda `defaultPrevented`; a `/admin/settings?tab=arca` no pregunta; sin dirty nunca pregunta.
- `SettingsForm.test.tsx` (acción mockeada): tipear llama `onDirtyChange(true)`; guardar bien, `onDirtyChange(false)`.

**Verificación en PROD**
- Cambiar la dirección en Hotel y mensajes, guardar, volverla a su valor y mirar `SELECT address FROM public.hotel_settings;`.
- Abrir `/admin/settings?tab=arca` y ver "producción" con el punto de venta actual, sin tocar nada.

👤 **AGUSTÍN:** probar el aviso con un cambio sin guardar y mergear.

**Riesgos.** El guard por clic no cubre `router.push` programático: aceptable en esta pantalla. FiscalSettingsPanel maneja la facturación real: revisar el diff con cuidado.

### F1-5a · Buscador global, parte 1: búsqueda, resumen y acción del servidor (sin pantalla)
**Rama:** `claude/buscador-global-datos` · **Carril:** D · **Depende de:** — · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Para saber si alguien tiene descuento, si debe o dónde está alojado hay que pasar por cuatro pantallas, y recepción no llega a la mitad. Este PR deja lista la búsqueda del lado del servidor, con lo que cada rol puede ver (decisión 4).

**Archivos**
- Create: `src/lib/global-search.ts` — `normalizeSearchText`, `classifySearchTerm` (habitación ≤ 3 dígitos, DNI 7-8, CUIT 11), `matchesClient`, `buildClientSummary`.
- Modify: `src/lib/data.ts` — `searchGlobal(term)`.
- Modify: `src/lib/types.ts` — `GlobalSearchResult`, `GlobalSearchHit`, `ClientSummary`.
- Create: `src/app/admin/search-actions.ts` — `globalSearchAction(term)` con `assertStaff`.
- Create: `src/__tests__/global-search.test.ts`, `src/__tests__/search-actions.test.ts`.

**Pasos**
1. `searchGlobal` trae los datos chicos (habitaciones activas, guests, associated_clients por nombre, razón social y CUIT, company_passengers) y filtra en memoria con las reglas del lib; para personas sin ficha, `reservations` por `client_name`/`client_dni` con `ilike` y `sanitizeSearchTerm` (data.ts:1296), limit 8. Tope de 5 por grupo.
2. Para los encontrados: reserva activa (checked_in o confirmed futura), última estadía (checked_out más reciente) y saldo.
3. Saldo: SOLO cuenta corriente (decisión 1), el mismo número que Cuenta corriente (`getCtaCteAccounts`, data.ts:401); null si no opera a cuenta. F3-3a lo mueve después a cta-cte.ts.
4. La acción exige 2 caracteres o más (salvo número de habitación). Para recepción devuelve `debe: boolean`, sin monto y sin `href`. El admin recibe el monto y links con el filtro puesto (`/admin/guests?view=directorio&q=`, `/admin/asociados?q=`, `/admin/cuentas`); cuando exista `?ficha=` (F3-5b) se cambian.
5. No toca pantallas: se puede preparar en paralelo con el resto del carril.

**Aceptación**
- [ ] (Por test) un DNI con o sin puntos y un CUIT con o sin guiones encuentran a la persona o a la empresa.
- [ ] (Por test) para recepción la respuesta no trae montos ni links.

**Tests** (Vitest, datos ficticios)
- `global-search.test.ts`: `classifySearchTerm('30.123.456')` → DNI con dígitos '30123456'; '20-30123456-7' → CUIT; '7' → habitación; `normalizeSearchText('JOSÉ  Pérez')` es igual a `normalizeSearchText('jose perez')`; `buildClientSummary` con saldo 0 → "No debe", con 1500 → con monto, con null → no menciona la cuenta corriente.
- `search-actions.test.ts` (data mockeada): como recepción no hay `href` ni monto; como admin sí; con una letra no busca.

**Verificación en PROD**
- No hay pantalla: la prueba real es la de F1-5b.
- Antes del merge: `SELECT tablename, policyname, qual FROM pg_policies WHERE cmd = 'SELECT' AND tablename IN ('guests','associated_clients','company_passengers','reservations','cuenta_corriente_movimientos');` tiene que mostrar lectura para staff (migs 58, 25, 61, 02 y 64).

👤 **AGUSTÍN:** revisar y mergear (no cambia nada visible).

**Riesgos.** Filtrar en memoria alcanza hasta unos pocos miles de filas (hoy 213 huéspedes, 8 empresas, 39 pasajeros). Si otra fase cambia la RLS de esas tablas, la búsqueda de recepción puede quedar vacía sin error: el test de la acción no ve la RLS.

### F1-5b · Buscador global, parte 2: caja de búsqueda arriba, lupa en el celular y tarjeta de resumen
**Rama:** `claude/buscador-global-pantalla` · **Carril:** D · **Depende de:** F1-5a, F1-1b, F1-2 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** La recepcionista escribe un nombre, DNI, CUIT o número de habitación arriba y ve en un paso el descuento, si debe, la última estadía y la reserva activa, sin botones (decisión 4). El dueño ve lo mismo con el monto y links.

**Archivos**
- Create: `src/app/admin/GlobalSearch.tsx` — input "Buscar huésped, DNI, CUIT o habitación" con hint `/`, resultados agrupados (Habitaciones, Huéspedes, Empresas, Pasajeros) como combobox/listbox y tarjeta de resumen.
- Modify: `src/app/admin/AdminTopBar.tsx` (lo crea F1-1b) — buscador en el slot derecho, para los dos roles, al lado de la campana del admin.
- Modify: `src/app/admin/MobileNav.tsx` — lupa en MobileTopBar que abre el buscador a pantalla completa.
- Create: `src/app/admin/GlobalSearch.test.tsx`.

**Pasos**
1. Debounce de 250 ms; descarta respuestas viejas por id de pedido; ↑ ↓ y Enter; Esc limpia y cierra.
2. `/` enfoca, salvo con el foco en input, textarea, select o contenteditable, o con Ctrl, Meta o Alt apretado.
3. Tarjeta: descuento %, "Debe" / "No debe" (admin: "Debe $X en cuenta corriente"), última estadía (fecha y habitación) y reserva activa (habitación, entrada y salida). Para recepción, sin links ni botones.
4. En MobileNav va después de F1-2.

**Aceptación**
- [ ] Con `/` o un clic arriba, la recepcionista busca un DNI con o sin puntos y ve descuento, si debe, última estadía y reserva activa, sin ningún botón.
- [ ] Escribiendo "7" aparece la habitación 7 con su estado y quién está alojado.
- [ ] El dueño ve además el monto y links a Directorio, Empresas o Cuenta corriente con el filtro puesto.
- [ ] Escribir `/` dentro de otro campo (por ejemplo una fecha) no mueve el foco al buscador.
- [ ] En el celular, la lupa abre el buscador a pantalla completa.

**Tests** (Vitest, acción mockeada, fake timers; buscar por texto o aria-label)
- `/` con el foco en el body enfoca el input; dentro de otro `<input>` no.
- Tipear "per" llama la acción una sola vez a los 250 ms; una respuesta vieja que llega tarde no pisa la nueva.
- Un resultado sin `href` (recepción) muestra la tarjeta sin links ni botones; con `href` (admin) muestra el link. Esc limpia y cierra.

**Verificación en PROD**
- Como recepción, buscar un DNI conocido del mostrador (no anotarlo en el repo) y comparar descuento y "Debe" con la ficha del admin.
- Como admin, comparar el "Debe $X" de una empresa con Cuenta corriente, y buscar una habitación ocupada y compararla con Hoy.

👤 **AGUSTÍN:** probar como admin con 3 casos reales (persona con descuento, empresa con deuda, habitación ocupada), mergear y contarle a recepción el atajo `/`.

**Riesgos.** Los links del admin llevan el DNI o el nombre en `?q=`, como ya hace el Directorio. Con hamburguesa, campana y lupa, la barra de arriba del celular queda justa: probar en 360 px de ancho.

### F1-9 · Tablero: "Cobros del día" y "Limpiezas" del mes con el período rotulado
**Rama:** `claude/tablero-cobros-limpiezas` · **Carril:** D · **Depende de:** F0-7, F1-1a · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Los contadores de Limpiezas suman todo el historial sin decirlo, y "Saldos Por Cobrar" de Finanzas mezcla lo que deben los alojados con reservas futuras que todavía no llegaron. Pasan a ser pestañas del Tablero con el período a la vista y los dos números separados.

**Archivos**
- Modify: `src/lib/date-range.ts` — `resolveCleaningRange(sp, todayKey)`: sin parámetros, del 1° del mes a hoy ("Mes en curso: 01/09/2026 al 23/09/2026"); `todo=1` → "Todo el historial"; from/to → "Del … al …".
- Modify: `src/app/admin/mantenimiento/page.tsx` — el mismo rango para contadores y tabla; título "Limpiezas" con el período de subtítulo; tarjetas "En el período".
- Modify: `src/app/admin/mantenimiento/CleaningLogFilters.tsx` — botones "Mes en curso" y "Todo el historial"; "Limpiar" vuelve al mes.
- Modify: `src/app/admin/finances/page.tsx` — título "Cobros del día" (142) con subtítulo "Lo cobrado en el día elegido, por medio de pago"; "Saldos Por Cobrar" (112-113, 206-219) se parte en "Deben los alojados" (checked_in) y "Reservado sin seña" (confirmed que todavía no llegaron).
- Create: `src/lib/saldos-por-cobrar.ts` — `partirSaldosPorCobrar(rows)` (puro).
- Modify: `src/__tests__/date-range.test.ts` (lo crea F1-7); Create: `src/__tests__/saldos-por-cobrar.test.ts`.

**Pasos**
1. NO toca `src/lib/supabase/middleware.ts` ni el guard de `/admin/mantenimiento` (son de F0-7), ni los links "Ver como mantenimiento" y "Volver al panel" (son de F4-7).
2. Los montos nuevos usan `formatAmount` de `src/lib/format.ts`; el resto de "en-US" lo barre F5-1 (que rehace su lista con grep).
3. La lista de deudas de abajo lleva un chip "Alojado" o "Por llegar" por fila.
4. Si Q5 elige otro nombre para lo reservado (por ejemplo "Reservado sin cobrar"), usar el mismo acá.

**Aceptación**
- [ ] En Tablero › Limpiezas el dueño ve "Mes en curso: 01/09/2026 al 23/09/2026", y los contadores y la tabla son de ese período; con "Todo el historial" ve el acumulado, rotulado así.
- [ ] Tablero › Cobros del día muestra lo mismo que la vieja Finanzas, con "Deben los alojados" y "Reservado sin seña" en tarjetas separadas.

**Tests** (Vitest)
- `date-range.test.ts`: `resolveCleaningRange({}, '2026-09-23')` → '2026-09-01' a '2026-09-23' sin isAll; `{ todo: '1' }` → isAll y "Todo el historial"; from/to inválidos → mes en curso.
- `saldos-por-cobrar.test.ts`: un checked_in con deuda va a alojados, un confirmed a reservado y uno pagado no suma.

**Verificación en PROD**
- `SELECT cleaning_category, outcome, count(*) FROM public.room_cleaning_log WHERE cleaned_at >= (date_trunc('month', now() AT TIME ZONE 'America/Argentina/Tucuman') AT TIME ZONE 'America/Argentina/Tucuman') GROUP BY 1, 2;` = tarjetas de Limpiezas.
- `SELECT status, sum(total_price - paid_amount) FROM public.reservations WHERE status IN ('confirmed','checked_in') AND total_price > paid_amount GROUP BY status;` = las dos tarjetas de saldos.

👤 **AGUSTÍN:** mergear y revisar un mes cerrado con el rango manual.

**Riesgos.** Cambia el default de la tabla de Limpiezas (antes, todo el historial): para buscar una limpieza vieja hay que apretar "Todo el historial". La cabecera de `/admin/mantenimiento` la toca después F4-7: F1-9 va antes.

### F1-6 · Hoy se actualiza solo (hook único useAutoRefresh, cada 30 s)
**Rama:** `claude/refresco-automatico` · **Carril:** E · **Depende de:** P1 · **Migración:** no · **Esfuerzo:** 0,75 días

**Por qué.** Si la mucama marca una habitación limpia o otra PC hace un check-out, la recepcionista no lo ve hasta que recarga. Hoy pasa a actualizarse sola cada 30 segundos y al volver a la ventana, sin interrumpir a quien está escribiendo.

**Archivos**
- Create: `src/app/admin/useAutoRefresh.ts` — `useAutoRefresh({ intervalMs = 30000, paused = false })` y `shouldSkipRefresh(doc)`. Es el único hook del plan: F4-7 lo importa con `intervalMs: 60000`.
- Create: `src/app/admin/AutoRefresh.tsx` — wrapper cliente que devuelve null.
- Modify: `src/app/admin/page.tsx` — monta `<AutoRefresh />`.
- Create: `src/__tests__/use-auto-refresh.test.tsx`.

**Pasos**
1. `shouldSkipRefresh`: saltea si `document.hidden`, si existe `[aria-modal="true"]` (ya lo tienen CloseShiftModal y CalendarClient) o si el foco está en input, textarea, select o contenteditable.
2. `setInterval` más los eventos `focus` y `visibilitychange` (al volver a visible refresca) y `router.refresh()`, el mismo patrón que CajaClient.tsx:57-68.
3. NO toca modales (el `aria-modal` del resto llega con F5-8), ni MaintenanceDashboard (F4-7), ni CajaClient.
4. Arranca cuando entra P1 (los dos tocan `admin/page.tsx`); en el carril E va antes de F4-1a.

**Aceptación**
- [ ] Con Hoy abierto, si la mucama marca una habitación limpia en el celular, la tarjeta cambia sola en 30 segundos como máximo.
- [ ] Mientras la recepcionista escribe en un campo, la pantalla no se recarga ni pierde lo tipeado.
- [ ] Al volver a la pestaña después de un rato, Hoy se pone al día enseguida.

**Tests** (Vitest, fake timers, router mockeado)
- A los 30 s llama `router.refresh` una vez y a los 60 s dos; con `paused` no lo llama.
- Con un `<div aria-modal="true">` en el documento no refresca; con el foco en un `<input>` tampoco; al quitarlos vuelve a refrescar.
- `focus` refresca en el momento; al desmontar no quedan intervalos ni listeners.

**Verificación en PROD**
- Con la PC de recepción y el celular de mantenimiento abiertos, marcar una habitación limpia y ver que Hoy cambia solo.
- Abrir el cobro de un check-out, escribir un monto, esperar 60 s y confirmar que sigue intacto.

👤 **AGUSTÍN:** mergear y preguntarle a recepción al día siguiente si notó algún parpadeo o algo que se cerró solo.

**Riesgos.** Hasta F5-8, un modal de Hoy sin `aria-modal` no pausa el refresco si el foco no está en un campo: `router.refresh` conserva el estado del cliente, así que lo elegido no se pierde, pero el modal puede mostrar un dato recién actualizado. Con 2 o 3 PCs y un celular son unas 8 recargas por minuto contra Supabase.

### Fusionados o descartados
- **F1-11 · /admin/timeline: redirect en next.config y fuera los revalidatePath** — descartado. Aporta poco: `/admin/timeline` ya es solo un redirect y la página se queda como está. El borrado de `revalidatePath('/admin/timeline')` (admin/actions.ts:67 y finances/actions.ts:45) pasa a F1-7, y sacar el host de Supabase escrito en `next.config.mjs` pasa a P2. Estimado original: 0,25 días.
- Partidos, no descartados: F1-1 (16 archivos, no entraba en 2 días) quedó en F1-1a y F1-1b, y F1-5 (backend e interfaz juntos) en F1-5a y F1-5b. La pregunta 6 de la fase (habitaciones solo admin) sale del cuestionario: la resuelve F0-7.

---

## Fase 2 — Cobro en varios medios, cobro a cuenta y datos de entrada

Esta fase le da a recepción lo que hoy no puede hacer en el sistema (decisión 3): cobrar una seña o un pago a cuenta antes del check-out, cobrar la salida en dos o más medios con un solo recibo, ver el precio nuevo antes de confirmar un cambio de fechas y hacer el check-out sin salir del cierre de caja. Al dueño le deja la caja cuadrada por medio, documentos que sirven para facturar y el pago de cuenta corriente cargado tal como entró. Se reparte en cinco carriles y las fichas siguen ese orden: 0 (F2-13, mig 122, solo si Q3 dice "conservar" y siempre después de F2-2), A (cobro y check-out, de F2-3 a F2-7b, en fila; F2-4 con la mig 119 no toca pantallas y se prepara desde el día 1), B (formularios: F2-9 y F2-10), C (traspaso de caja: F2-8) y H (cuenta corriente: F2-11).

### F2-13 · Mig 122: editar fechas conserva la tarifa y el descuento de la reserva, como Ampliar
**Rama:** `claude/editar-fechas-conserva-tarifa` · **Carril:** 0 · **Depende de:** F2-2 · **Migración:** 122 · **Esfuerzo:** 1 día

> Condicional: se hace solo si Q3 dice "conservar". Si dice que no, se descarta y el número 122 queda sin usar.

**Por qué.** Hoy, si se mueve una fecha en Editar reserva, se recalcula toda la estadía al precio de hoy de la habitación y, en las reservas de persona, se borra el descuento del huésped. Ampliar, en cambio, respeta la tarifa con la que se reservó. Con este PR las dos puertas cobran igual y se cumple la regla de siempre: la tarifa se congela al crear. En PROD hay 10 reservas de persona con descuento.

**Archivos**
- Create: `supabase_migrations/122_editar_fechas_conserva_tarifa.sql`: CREATE OR REPLACE de `rpc_update_reservation` (misma firma) + bloque de `record_migration`.
- Modify: `src/lib/pricing.ts`: `previewDateChange` (la crea F2-2) pasa a reflejar la regla nueva.
- Modify: `src/__tests__/pricing.test.ts`: casos de tarifa congelada y de descuento conservado.
- Modify: `src/app/admin/EditReservationModal.tsx`: la vista previa dice "tarifa de la reserva" en lugar de "tarifa de hoy".

**Pasos**
1. Bajar `pg_get_functiondef('public.rpc_update_reservation'::regproc)` de PROD con el conector de solo lectura y compararlo con la mig 101 (desde la línea 210). Si difieren, se parte de PROD y no del repo.
2. En la rama `ELSIF v_dates_changed` (mig 101, 332-335), reemplazar `app_calculate_reservation_pricing` por la cuenta de `rpc_extend_reservation` (mig 101, 157-173). La tarifa por noche es la base vieja dividida por las noches viejas de `app_hotel_nights`, y la base nueva es esa tarifa por las noches nuevas. `discount_percent` queda el de la reserva, `discount_amount` = round(base × % / 100, 2) y el total = base − descuento + recargos. El guard "menor a lo pagado" no cambia.
3. En la rama del override con fechas cambiadas, los campos de registro usan la misma base congelada. El total sigue siendo el override.
4. Cerrar con el bloque DO de `record_migration('122_editar_fechas_conserva_tarifa.sql')`, como en las migs 110-116. Los comentarios van sin comillas.
5. Ajustar `previewDateChange` y el texto de la vista previa para que den lo mismo que la función nueva.

**Base de datos.** Cambia solo el cuerpo de `rpc_update_reservation`: CREATE OR REPLACE, sin DROP, con los mismos permisos y sin tocar RLS. Se aplica con `select public.exec_ddl($m122$ … $m122$)`, sin BEGIN/COMMIT, sin `;` final y sin comillas en los comentarios. Va con OK de Agustín y ANTES del deploy de este PR. Después se verifica la fila en `public.applied_migrations`.

**Aceptación**
- [ ] En una reserva de persona con 10 % de descuento, correr la salida un día suma una noche a la tarifa de la reserva y el descuento sigue en 10 %.
- [ ] En una reserva de empresa, el total nuevo usa la tarifa con la que se reservó, no la de hoy.
- [ ] La vista previa de F2-2 coincide con el total guardado (no sale el aviso de diferencia).
- [ ] Ampliar sigue dando lo mismo que antes.

**Tests** (Vitest)
- `pricing.test.ts`: `previewDateChange` en una reserva de persona con descuento conserva el porcentaje (antes daba 0).
- `pricing.test.ts`: pasar de 2 a 3 noches con base $100.000 da base $150.000, aunque hoy la habitación valga otra cosa.
- `pricing.test.ts`: acortar la estadía por debajo de lo pagado sigue marcando `belowPaid`.

**Verificación en PROD**
- `select filename from public.applied_migrations where filename = '122_editar_fechas_conserva_tarifa.sql'`: tiene que dar una fila.
- Editar las fechas de una reserva de prueba con descuento y comparar `base_total_price`, `discount_percent` y `total_price` con la vista previa.

👤 **AGUSTÍN:** contesta Q3. Si es "conservar", da el OK para aplicar la 122 antes del merge, mergea y prueba editar fechas en una reserva con descuento.

**Riesgos.** Copiar un cuerpo viejo pisa lo que ya corre en PROD (la deriva ya rompió una pantalla), por eso se parte de `pg_get_functiondef`. Si cambia el SQL y `pricing.ts` no, la vista previa muestra otro número; el aviso de diferencia de F2-2 lo delata.

### F2-3 · Recepción puede cobrar a cuenta o una seña antes del check-out
**Rama:** `claude/cobro-a-cuenta-recepcion` · **Carril:** A · **Depende de:** F0-3, F0-4, F0-6 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Es la decisión 3. Hoy recepción cobra solo en el check-out y todo junto: de las 272 reservas con pagos, ninguna tiene más de uno. La seña o la plata que entra antes queda en el aire o anotada en un papel. Con este PR queda en su caja, con recibo, y el check-out cobra solo lo que falta.

**Archivos**
- Modify: `src/app/admin/RoomCard.tsx`: botón "Cobrar" en la fila Extra / Cambiar / Editar (551-578), estado `paymentMode: "partial" | "checkout"` y render del `PaymentModal` (754-772) según el modo.
- Modify: `src/app/components/PaymentModal.tsx`: modo parcial con título, ayuda, tope contra lo que falta y sin Vale Blanco (278-284).
- Modify: `src/app/admin/calendario/CalendarClient.tsx`: "Cobrar seña / a cuenta" en el detalle de la reserva, junto al bloque de Saldo (~790-818).
- Create: `src/app/components/PaymentModal.test.tsx`: casos del modo parcial. No existe en main; si F0-3 ya lo creó, es Modify.

**Pasos**
1. RoomCard: el botón "Cobrar" (ícono `DollarSign`) aparece solo si `debt > 0`. Abre `PaymentModal` sin `onSubmitPayment`, con `reservationId`, `totalPrice` y `paidAmount`.
2. PaymentModal en modo parcial: título "Cobrar a cuenta" y ayuda "Queda en tu caja. Lo que falte se cobra en el check-out". El medio arranca vacío (regla de F0-3).
3. Si el monto supera lo que falta, muestra "No puede superar lo que falta ($X)" y no llama a la acción. En este modo no hay Vale Blanco, porque tiene que cubrir el total de una vez.
4. CalendarClient: el botón aparece en las reservas `confirmed` o `checked_in` con saldo > 0, y `onSuccess` hace `router.refresh()`. El detalle es `z-[60]`, así que el `PaymentModal` tiene que quedar encima.
5. No hace falta migración: `rpc_register_payment` (mig 89) ya exige staff y caja abierta (P0003) y rechaza pasarse del total. El recibo ya muestra "Saldo restante".

**Aceptación**
- [ ] Con una habitación ocupada que debe $43.700, la recepcionista aprieta Cobrar, carga $20.000 en efectivo y sale el recibo con "Saldo restante $23.700".
- [ ] La tarjeta pasa a mostrar "Pendiente $23.700" y el check-out cobra solo eso.
- [ ] En el calendario, una reserva confirmada con saldo tiene "Cobrar seña / a cuenta".
- [ ] Si carga más de lo que falta, el modal lo dice y no registra nada.
- [ ] Con la caja cerrada, ve "Caja cerrada · Ir a Caja".

**Tests** (Vitest)
- `PaymentModal.test.tsx`: en modo parcial, un monto mayor a lo que falta muestra el error y `registerPaymentAction` (mock) no se llama.
- `PaymentModal.test.tsx`: en modo parcial no aparece Vale Blanco, aunque `paidAmount` sea 0.
- `PaymentModal.test.tsx`: si la acción devuelve `{ paymentId }`, abre `/admin/recibo/<id>?autoprint=1&copy=original`.
- `PaymentModal.test.tsx`: con el código P0003 aparece "Caja cerrada".

**Verificación en PROD**
- Hoy › tarjeta ocupada con saldo › Cobrar un monto chico: sale el recibo.
- `select reservation_id, count(*), string_agg(payment_method, '+') from public.payments group by 1 having count(*) > 1`: aparece la primera reserva con dos pagos.
- `select count(*) from public.payments where created_at > '<deploy>' and cash_shift_id is null`: tiene que dar 0.

👤 **AGUSTÍN:** mergea y le explica a recepción que "Cobrar" es para una seña o un pago a cuenta, y que el resto se cobra en el check-out.

**Riesgos.** `rpc_register_payment` no mira el estado de la reserva; la pantalla ofrece el botón solo en `confirmed` y `checked_in`, y el guard en la base queda postergado. Una seña de una reserva que después se cancela no se devuelve sola, igual que hoy. RoomCard lo tocan después F2-5a, F2-2, F4-3 y F4-4 (F4-4 reubica este "Cobrar"). CalendarClient lo tocan después F4-2 y F4-9.

### F2-4 · Mig 119: check-out con varios pagos (RPC y capa de datos, sin pantalla)
**Rama:** `claude/checkout-varios-pagos-db` · **Carril:** A · **Depende de:** — · **Migración:** 119 · **Esfuerzo:** 1,5 días

**Por qué.** Si un huésped paga una parte en efectivo y otra con tarjeta, tiene que quedar cargado así, sin meter todo en un medio y descuadrar la caja. Los pagos entran en la misma transacción que cierra la estadía: o entra todo o no entra nada.

**Archivos**
- Create: `supabase_migrations/119_cobro_en_varios_medios.sql`: `rpc_staff_checkout_split` nueva, `rpc_shift_checkout_export` ordenada por monto y `record_migration`.
- Modify: `src/lib/data.ts`: `doCheckoutSplit({ reservationId, payments, early })` nueva. `doCheckout` (1774) y `doEarlyCheckout` (1798) no cambian.
- Modify: `src/lib/validations.ts`: `checkoutPaymentsSchema`.
- Modify: `src/app/admin/actions.ts`: `handleCheckOutSplit` (assertStaff + schema). `handleCheckOut` (124) y `handleEarlyCheckOut` (154) no cambian.
- Modify: `src/__tests__/validations.test.ts`: casos del schema.

**Pasos**
1. Bajar de PROD `pg_get_functiondef` de `rpc_register_payment`, `rpc_staff_checkout_reservation`, `rpc_staff_early_checkout` y `rpc_shift_checkout_export`. La referencia es PROD, porque ya hay deriva con el repo.
2. `rpc_staff_checkout_split(p_reservation_id uuid, p_payments jsonb, p_early boolean)`, SECURITY DEFINER, exige staff. Valida que sea un array de 2 a 4 elementos, cada `method` de la lista (sin `cuenta_corriente` ni `vale_blanco`) y cada `amount` > 0 con 2 decimales como máximo. Si algo falla, error en español (22023).
3. En la misma transacción inserta los N−1 primeros pagos con la lógica de `rpc_register_payment` (turno abierto, sin cta. cte., sin vale blanco). Después llama a la RPC de check-out actual con el último pago (`p_early` elige cuál). Esa RPC recalcula y exige el saldo exacto: si la suma no da justo, se deshace todo. Así también sirve para la salida anticipada.
4. Devuelve `payment_ids` en orden y `payment_id` = el primero. REVOKE ALL a PUBLIC y anon; GRANT EXECUTE a authenticated.
5. `rpc_shift_checkout_export`: CREATE OR REPLACE con el LATERAL de pagos ordenado por `amount DESC, created_at DESC, id` (mig 71, ~831), así el CSV toma el medio principal.
6. Bloque DO de `record_migration('119_cobro_en_varios_medios.sql')`.
7. data.ts y actions.ts: la acción nueva devuelve `{ paymentIds, paymentId, movementId: null }`. Un solo medio y la cta. cte. siguen por el camino de hoy.

**Base de datos.** Es una función nueva. No hay DROP ni se copian los cuerpos de 4.527 y 7.365 caracteres, así que las dos RPC de check-out quedan intactas. `rpc_shift_checkout_export` va con CREATE OR REPLACE y la misma firma. No toca tablas ni RLS. Se aplica con `select public.exec_ddl($m119$ … $m119$)`, sin BEGIN/COMMIT ni `;` final. Va con OK de Agustín y ANTES de mergear F2-4 (y por lo tanto antes de F2-5a). Si PostgREST no ve la firma: `NOTIFY pgrst, 'reload schema'`.

**Aceptación**
- [ ] Después de aplicar, los check-outs de siempre (un medio, cta. cte., salida anticipada) andan igual que antes.
- [ ] La base rechaza con un mensaje claro una suma que no da el saldo, un vale blanco o una cta. cte. combinados, y más de 4 medios.
- [ ] Todos los pagos de un check-out partido quedan con el mismo `created_at` y el mismo turno.

**Tests** (Vitest)
- `validations.test.ts`: `checkoutPaymentsSchema` acepta `[{cash, 20000}, {credit_card, 23700}]`.
- `validations.test.ts`: rechaza 1 elemento, más de 4, `cuenta_corriente`, `vale_blanco`, un monto 0 y un monto con 3 decimales.
- La prueba de punta a punta es el primer check-out partido de F2-5a, porque desde exec_ddl no se puede simular un usuario staff.

**Verificación en PROD**
- `select filename from public.applied_migrations where filename = '119_cobro_en_varios_medios.sql'`
- `select proname, pg_get_function_identity_arguments(oid), array_to_string(proacl, ',') from pg_proc where proname = 'rpc_staff_checkout_split'`: authenticated sí, anon no.
- El primer check-out normal de un solo medio después de aplicar sale igual que siempre.

👤 **AGUSTÍN:** da el OK para aplicar la 119 con exec_ddl antes del merge. Confirma las dos consultas y recién ahí mergea.

**Riesgos.** La función nueva llama a las RPC viejas: si una cambia de firma, esta se rompe (se anota en el comentario de la migración). En la salida anticipada, la pantalla tiene que mandar el saldo recalculado; si no coincide, la RPC vieja lo rechaza y no se pierde nada. En la v1 la cta. cte. no se combina con otros medios (default).

### F2-5a · Cobrar el check-out en varios medios: renglones de medio + monto en PaymentModal y RoomCard
**Rama:** `claude/checkout-varios-medios-ui` · **Carril:** A · **Depende de:** F2-4, F2-3, F0-3, F0-4 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Hoy no se puede cargar al huésped que paga una parte en efectivo y otra con tarjeta: la recepcionista mete todo en un medio y la caja descuadra (fue la causa de 3 de los 21 cierres con diferencia). Con renglones de medio + monto y un "Da justo" en vivo, la caja cuadra por medio.

**Archivos**
- Create: `src/lib/split-payment.ts`: `SplitRow` y `analyzeSplit(rows, balance)`.
- Modify: `src/app/components/PaymentModal.tsx`: modo check-out con renglones, botón "Débito", confirmación y el contrato nuevo de `onSubmitPayment`. Los 6 `toLocaleString` sueltos (172-215) pasan a `formatAmount` de `src/lib/format.ts` (F5-5 ya no toca este archivo).
- Modify: `src/lib/billing.ts`: `isInvoiceMandatory(methods[])`, `hasValeBlanco(methods[])` y `shouldPromptInvoice({ fiscalEnabled, facturacionModo, methods })`.
- Modify: `src/app/admin/RoomCard.tsx`: las reglas de 259-278 pasan a billing.ts; `submitCheckoutPayment` (334-362) manda `payments`.
- Create: `src/__tests__/split-payment.test.ts`.
- Modify: `src/__tests__/billing.test.ts` y `src/app/components/PaymentModal.test.tsx`.

**Pasos**
1. `analyzeSplit` es puro y devuelve `{ payments, sum, remaining, issues, ready }`. Los issues posibles son `sin_medio(i)`, `monto_ilegible(i)`, `monto_cero(i)`, `falta`, `sobra` y `vale_combinado`. Usa `parseArMoney` y redondea a centavos.
2. Renglones: el primero trae el saldo, sin medio. "+ Agregar otro medio" suma hasta 4, y cada renglón nuevo trae lo que falta. Una línea en vivo dice "Falta cobrar $X", "Sobran $X" o "Da justo", y cada monto tiene su `ParsedAmountHint`. Medios: Efectivo, Tarjeta, Débito (nuevo, `debit_card`), Transferencia y Mercado Pago.
3. Vale Blanco solo con un renglón y `paidAmount` 0. "Todo a cuenta corriente" (la Cta. Cte. de F0-3) oculta los renglones.
4. El botón siempre está activo: si hay issues, los muestra y enfoca el primer renglón con problema. Con 2 o más renglones, pide confirmar: "Efectivo $20.000 + Tarjeta $23.700 = $43.700 ¿Confirmás?".
5. Contrato `onSubmitPayment({ payments })`. En RoomCard, con 1 renglón o cta. cte. se usa el `handleCheckOut`/`handleEarlyCheckOut` de hoy; con 2 o más, `handleCheckOutSplit` (F2-4). `buildInvoicePrompt` recibe los medios.
6. Los recibos entran en la cola de impresión de F0-4, que se vacía al cerrar la pregunta de factura; no se abren directo. Hasta F2-5b sale un recibo por pago.
7. El texto de PaymentModal:248 pasa a "Tiene que dar justo el saldo. Si paga con dos medios, agregá otro renglón".

**Base de datos.** Usa la 119, que tiene que estar aplicada y verificada en `applied_migrations` antes de mergear.

**Aceptación**
- [ ] Saldo $43.700: la recepcionista carga Efectivo $20.000 y agrega Tarjeta, que ya trae $23.700. Ve "Da justo", confirma y el check-out queda hecho.
- [ ] Si carga $40.000 en total, ve "Falta cobrar $3.700" y no se cierra nada.
- [ ] Si uno de los medios es bancario, la pregunta de factura no ofrece "No".
- [ ] En la rendición, el efectivo esperado suma solo la parte en efectivo, y el débito aparece como débito.
- [ ] Salvo el botón Débito, el check-out de un solo medio y el de cta. cte. se ven y andan igual que antes.

**Tests** (Vitest)
- `split-payment.test.ts`: `[cash 20.000, credit_card 23.700]` sobre 43.700 da `ready`; con 40.000 da `falta` y `remaining` 3.700.
- `split-payment.test.ts`: un renglón sin medio da `sin_medio(0)`; "43.700" se lee como 43700 (#130); un vale blanco con 2 renglones da `vale_combinado`.
- `billing.test.ts`: `isInvoiceMandatory(['cash','mercado_pago'])` es true; `shouldPromptInvoice` con cta. cte. y modo consolidada es false.
- `PaymentModal.test.tsx`: agregar un renglón, completar y confirmar llama a `onSubmitPayment` con dos elementos. Con una suma corta muestra "Falta cobrar" y no llama. "Todo a cuenta corriente" manda `[{ cuenta_corriente, saldo }]`.

**Verificación en PROD**
- Hacer un check-out partido en dos medios, con montos chicos acordados con Agustín.
- `select reservation_id, created_at, string_agg(payment_method || ':' || amount, ' + ' order by recibo_numero) from public.payments where created_at > '<deploy>' group by 1, 2 having count(*) > 1`
- Caja › Rendiciones › el turno: la suma por medio coincide con lo cobrado.

👤 **AGUSTÍN:** confirma que la 119 está aplicada, mergea y hace el primer check-out partido junto a recepción.

**Riesgos.** Es el cambio más delicado de la fase. Por eso la lógica vive en `split-payment.ts` (puro y con tests) y el camino de un solo medio no cambia. Entre F2-5a y F2-5b sale un recibo por pago: es correcto, pero gasta papel, así que F2-5b va enseguida. El CSV muestra el medio de mayor monto (default).

### F2-5b · Recibo agrupado de un check-out cobrado en varios medios
**Rama:** `claude/recibo-agrupado` · **Carril:** A · **Depende de:** F2-5a · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Que el huésped se lleve un solo papel con todo lo que pagó y el total, en lugar de un recibo por medio.

**Archivos**
- Create: `src/lib/receipt.ts`: `groupReceiptPayments(rows)`, que ordena por `recibo_numero`, suma y arma el rango de números.
- Modify: `src/app/admin/recibo/[paymentId]/page.tsx`: busca los pagos hermanos, y `ReceiptCopy` (46) lista "Medio · Nro · $monto".
- Modify: `src/app/admin/RoomCard.tsx`: la cola de impresión encola un solo recibo (`paymentIds[0]`).
- Create: `src/__tests__/receipt.test.ts`.

**Pasos**
1. En la consulta de la página (~195), traer los pagos con la misma `reservation_id` y el mismo `created_at`. El check-out partido los inserta en una sola transacción, con el mismo NOW().
2. Si hay más de uno: lista con medio, número y monto; "TOTAL PAGADO" es la suma y el número de recibo pasa a ser el rango. Con un solo pago, el recibo queda exactamente igual.
3. El original y el duplicado siguen saliendo en dos trabajos (el corte de la comandera es intencional).
4. RoomCard encola solo `paymentIds[0]`.

**Aceptación**
- [ ] Un check-out con efectivo y tarjeta imprime un solo recibo (original y duplicado) con los dos medios, sus montos y el total.
- [ ] Un pago de un solo medio imprime lo mismo que hoy.
- [ ] Si se abre el recibo desde cualquiera de los dos pagos, se ve el mismo recibo agrupado.

**Tests** (Vitest)
- `receipt.test.ts`: dos pagos con el mismo `created_at` se agrupan, se suman y quedan ordenados por número.
- `receipt.test.ts`: un pago solo da un grupo de uno, sin cambios.
- `receipt.test.ts`: una seña anterior (con otro `created_at`) no entra en el grupo del check-out.

**Verificación en PROD**
- Reimprimir el recibo del primer check-out partido y compararlo con la consulta de F2-5a.
- Imprimir en la comandera del mostrador y fijarse que la lista no corra las columnas.

👤 **AGUSTÍN:** mergea y mira en papel el primer recibo agrupado.

**Riesgos.** Agrupar por `created_at` supone que los pagos del check-out comparten el mismo instante, y eso lo garantiza la 119 (una sola transacción). Las tildes del recibo ("Huesped:", "Habitacion:") no cambian acá: son de F5-15.

### F2-2 · Vista previa del precio al editar fechas y al ampliar
**Rama:** `claude/vista-previa-precio` · **Carril:** A · **Depende de:** F0-6, F2-3, F2-8 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Hoy el total nuevo aparece recién en un toast después de guardar (EditReservationModal:139-152), y al ampliar no se ve nunca. 4 de los 21 cierres con diferencia fueron por precio o noches mal cargados: quien cobra tiene que ver el número antes de confirmar.

**Archivos**
- Modify: `src/lib/pricing.ts`: `previewExtension` y `previewDateChange`, con `calculateReservationNights`.
- Modify: `src/lib/data.ts`: `getReservationPricingSnapshot` y el tipo `ReservationPricingSnapshot`.
- Modify: `src/app/admin/actions.ts`: `handleLoadPricingSnapshot`, con assertStaff.
- Modify: `src/app/admin/EditReservationModal.tsx`: vista previa en vivo (268-279) y aviso de diferencia al guardar (139-152).
- Modify: `src/app/admin/RoomCard.tsx`: vista previa en el modal Ampliar (841-911), sobre el stepper de F0-6.
- Modify: `src/app/admin/caja/CloseShiftModal.tsx`: vista previa en "Sigue alojado: ampliar" (~576-630).
- Modify: `src/__tests__/pricing.test.ts`; Create: `src/app/admin/EditReservationModal.test.tsx`.

**Pasos**
1. `previewExtension` refleja `rpc_extend_reservation` (mig 101, 157-173): tarifa congelada = base / noches, conserva los recargos y quita el medio día. Devuelve `{ nightsBefore, nightsAfter, newTotal, halfDayRemoved, newBalance }`.
2. `previewDateChange` refleja `rpc_update_reservation` tal como está HOY (mig 101, 289-341): tarifa de hoy, descuento solo de empresa, recargos conservados, medio día quitado si la salida se corre, y `belowPaid`. Si Q3 dice "conservar", lo cambia F2-13.
3. El snapshot junta la reserva, `rooms(base_price, half_day_price)`, `associated_clients(discount_percent, is_active)`, la suma de medio día en `extra_charges` y la timezone. Staff ya puede leer todo eso: no hay migración.
4. EditReservationModal muestra "Total actual $X → Nuevo total $Y (N noches × $tarifa, descuento Z %, recargos $R)", avisa si se quita el medio día y muestra un aviso rojo si queda por debajo de lo pagado. Con override, muestra el override. Si el total guardado no coincide, `toast.warning` para que llamen al admin.
5. Ampliar (en la tarjeta y en el cierre de caja) muestra "Noches 2 → 3 · Nuevo total $X · Falta cobrar $Y"; en medio día, "Se suman $X".

**Aceptación**
- [ ] En Editar reserva, al mover la salida se ve el nuevo total (noches, tarifa y descuento) antes de apretar Guardar.
- [ ] Si el nuevo total queda por debajo de lo pagado, se ve el aviso rojo antes de guardar.
- [ ] En Ampliar (tarjeta y cierre de caja) se ven "Nuevo total" y "Falta cobrar" antes de confirmar, y si se quita el medio día, lo dice.
- [ ] El total guardado coincide con la vista previa; si no, aparece el aviso.

**Tests** (Vitest)
- `pricing.test.ts`: `previewExtension` de 2 a 3 noches con base congelada: la noche nueva vale base/2, no el precio de hoy. También conserva un recargo de minibar y quita un medio día.
- `pricing.test.ts`: `previewDateChange` con una empresa al 10 % usa la tarifa de hoy y suma los recargos. En una reserva de persona con descuento devuelve descuento 0, igual que el servidor hoy.
- `pricing.test.ts`: si la salida se adelanta, se respeta el medio día; si se atrasa, se quita. `belowPaid` es true si el total queda por debajo de lo pagado.
- `EditReservationModal.test.tsx`: con el snapshot y la fila mockeados, cambiar la salida muestra "Nuevo total $…" antes de guardar.

**Verificación en PROD**
- Calendario › reserva confirmada › Editar › mover la salida: el total de la vista previa es igual a `total_price` después de guardar.
- Hoy › Ampliar en una ocupada: el "Nuevo total" mostrado es igual a `total_price` después de ampliar.

👤 **AGUSTÍN:** contesta Q3 antes del merge (si es "conservar", F2-13 va después). Mergea y prueba Editar y Ampliar en una reserva real.

**Riesgos.** La vista previa reproduce en TypeScript dos RPC: si alguien cambia el SQL sin tocar `pricing.ts`, los números se separan (el aviso al guardar lo delata). En el modal Ampliar va después de F0-6 y F2-3 y antes de F4-3 y F4-4. En CloseShiftModal va después de F2-8 y antes de F2-7b.

### F2-7a · Sacar el flujo de check-out de RoomCard a CheckoutFlow, sin cambiar el comportamiento
**Rama:** `claude/checkout-flow-extraido` · **Carril:** A · **Depende de:** F0-3, F0-4, F1-4, F2-5a, F2-2 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Para poder hacer el check-out desde el cierre de caja (F2-7b) sin duplicar la parte más delicada del sistema. Es un refactor: recepción no ve ningún cambio.

**Archivos**
- Create: `src/app/admin/checkout/CheckoutFlow.tsx`: salida anticipada (`EarlyCheckoutModal`), `PaymentModal` en modo check-out, confirmación con saldo 0, pregunta de factura, remito de cta. cte., cola de impresión y `PrintBlockedModal`.
- Modify: `src/lib/types.ts`: tipo `CheckoutSubject`.
- Modify: `src/app/admin/RoomCard.tsx`: reemplaza el flujo (hoy en 101-362 y 754-839, que para entonces ya incluye F0-3, F0-4, F1-4 y F2-5a) por `<CheckoutFlow>`.
- Create: `src/app/admin/checkout/CheckoutFlow.test.tsx`.

**Pasos**
1. `CheckoutSubject = { reservationId, clientName, clientDni, checkInTarget, checkOutTarget, baseTotalPrice, discountPercent, discountAmount, totalPrice, paidAmount, accountCreditEnabled, facturacionModo, invoicePrefill, priorPaymentMethods, accountHolderName, tariffRequest }`.
2. Props de `CheckoutFlow`: `subject`, `timezone`, `fiscalEnabled`, `onDone()` y `onCancel()`.
3. Mover el código tal cual: `invoicePrompt`, `colaImpresion`, `remitoBloqueado`, `submitCheckoutPayment` y el aviso de tarifa de F1-4 en `noteText`.
4. RoomCard arma el subject con lo que ya tiene y monta `<CheckoutFlow>` adentro suyo, así el estado sobrevive al `router.refresh()`, como hoy.
5. No se cambian textos ni orden: nada de mejoras en este PR.

**Aceptación**
- [ ] Hacer el check-out desde Hoy se ve y anda exactamente igual que antes: con un medio, con varios, con cta. cte., con salida anticipada, con saldo 0 y con factura.
- [ ] El recibo y el remito salen en el mismo momento que antes.

**Tests** (Vitest)
- Los tests de `PaymentModal.test.tsx` quedan en verde sin tocarlos. RoomCard no tiene tests en main: lo que se mueve lo cubre `CheckoutFlow.test.tsx`.
- `CheckoutFlow.test.tsx`: con saldo > 0 abre PaymentModal; con saldo 0 abre la confirmación.
- `CheckoutFlow.test.tsx`: con `checkOutTarget` futuro abre `EarlyCheckoutModal`.
- `CheckoutFlow.test.tsx`: al cerrar la pregunta de factura se vacía la cola de impresión.

**Verificación en PROD**
- Antes del PR, probar en `npm run build && npm start`, porque en dev los client components de página no hidratan.
- Después del deploy, tres check-outs reales (efectivo, tarjeta y empresa con cta. cte.) con el mismo comportamiento de antes.

👤 **AGUSTÍN:** mergea un día tranquilo y mira los primeros check-outs con recepción.

**Riesgos.** Es la pantalla más usada. Si `CheckoutFlow` se desmonta con el `router.refresh()`, se pierde la pregunta de factura, así que tiene que quedar colgado de RoomCard, que no se desmonta.

### F2-7b · Hacer el check-out sin salir del cierre de caja (CheckoutFlow dentro de CloseShiftModal)
**Rama:** `claude/cierre-con-checkout` · **Carril:** A · **Depende de:** F2-7a, F2-8 · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** Hoy "Se fue: hacer check-out" cierra el modal y manda al tablero (CloseShiftModal:316-320 y 578-587): la recepcionista pierde el hilo del cierre y a veces no vuelve. Con este PR hace el check-out ahí mismo y sigue con el arqueo.

**Archivos**
- Modify: `src/lib/data.ts`: `getCheckoutSubject(reservationId)`, que reusa `resolveBillingContextByReservation` (1109) y `resolvePriorPaymentMethods` (1017) para una reserva `checked_in`.
- Modify: `src/app/admin/actions.ts`: `loadCheckoutSubjectAction(reservationId)`, con assertStaff, devuelve `{ subject, fiscalEnabled, timezone }`.
- Modify: `src/app/admin/caja/CloseShiftModal.tsx`: `startCheckout` reemplaza a `goToCheckout` (316-320); cambian el botón (578-587) y el guard del Escape (196-212).
- Modify: `src/app/admin/caja/CloseShiftModal.test.tsx`.

**Pasos**
1. `startCheckout(b.reservation_id)` carga el subject y monta `CheckoutFlow` encima del cierre.
2. Mientras el check-out está abierto, el Escape del cierre no hace nada.
3. En `onDone`: `fetchBlockers()` y `router.refresh()`, así se actualizan los totales por medio.
4. Traspaso forzado (`context === "handover"`): "Se fue: hacer check-out" aparece solo si `balance_due === 0`. Con saldo se ve "Tiene saldo: ampliá o reportalo; se cobra con tu caja abierta" (default).

**Aceptación**
- [ ] En Cerrar turno, con una salida vencida, "Se fue: hacer check-out" abre el cobro ahí mismo. Al terminar, la habitación sale de la lista y se sigue con el arqueo.
- [ ] Si el huésped se fue antes, aparece el mismo recálculo de salida anticipada que en Hoy y, si corresponde, la pregunta de factura.
- [ ] En el traspaso forzado, el check-out se ofrece solo si la habitación no debe nada.
- [ ] Los totales por medio del arqueo incluyen lo que se acaba de cobrar.

**Tests** (Vitest)
- `CloseShiftModal.test.tsx`: el clic en "Se fue: hacer check-out" llama a `loadCheckoutSubjectAction` con el id, muestra el cobro y NO llama a `router.push('/admin')`.
- `CloseShiftModal.test.tsx`: en handover, con `balance_due > 0` el botón no aparece; con 0, sí.
- `CloseShiftModal.test.tsx`: al terminar vuelve a llamar a `getCloseShiftBlockersAction`; el Escape con el check-out abierto no cierra el cierre.

**Verificación en PROD**
- Caja › Cerrar turno con una salida vencida: check-out desde el modal y cierre completo sin pasar por Hoy.
- `select checkout_cash_shift_id from public.reservations where id = '<la cerrada>'`: es el mismo turno que se rindió.

👤 **AGUSTÍN:** mergea y prueba un cierre real con una salida vencida.

**Riesgos.** Hay modales apilados (z-index y Escape): probarlo en `npm run build && npm start`. Después, CloseShiftModal solo lo toca F5-9b.

### F2-9 · Los botones principales dicen qué falta en vez de quedar grises
**Rama:** `claude/botones-dicen-que-falta` · **Carril:** B · **Depende de:** F0-2, F0-10 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Hoy "Asignar", "Crear Reserva", "Hacer Check-In", "Guardar" y "Crear Empresa" quedan deshabilitados sin decir por qué (WalkInModal:638, NewReservationModal:701, CompanyCheckInModal:194, GuestModal:368, AssociatedClientModal:412), y la recepcionista no sabe qué completar. Con este PR el botón le dice qué falta y la lleva al campo.

**Archivos**
- Create: `src/lib/form-checks.ts`: `FieldCheck`, `pendingFields` y `missingMessage` ("Falta completar: Nombre, DNI").
- Create: `src/app/admin/components/MissingFieldsNotice.tsx`: recuadro `role="alert"` + `focusFirst(pending)`.
- Modify: `src/app/admin/WalkInModal.tsx`: checks, reemplazo de los toasts de 228-250 y el botón (636-642).
- Modify: `src/app/admin/NewReservationModal.tsx`: fechas, habitación y cliente (317-343 y 699-705).
- Modify: `src/app/admin/CompanyCheckInModal.tsx` (56-71 y 192-199) y `src/app/admin/guests/GuestModal.tsx` (83-102 y 368; el nombre recibe `id="guest-full-name"`).
- Modify: `src/app/admin/asociados/AssociatedClientModal.tsx`: nombre y documento, antes del chequeo de duplicados (84-96 y 410-414).
- Create: `src/__tests__/form-checks.test.ts`, `src/app/admin/WalkInModal.test.tsx`, `src/app/admin/CompanyCheckInModal.test.tsx` y `src/app/admin/asociados/AssociatedClientModal.test.tsx`.

**Pasos**
1. En cada modal se arma `checks` con un estado `attempted`. En el submit, si hay pendientes, se marca `attempted`, se enfoca el primero y se sale.
2. El botón queda `disabled` solo con `isSubmitting`. Los inputs llevan `aria-invalid` y borde rojo si `attempted && !ok`, y el form lleva `noValidate`.
3. WalkIn: nombre, apellido y DNI (persona), o empresa + pasajero. El medio día sin precio pasa a ser un check con su mensaje.
4. NewReservation: empieza por las fechas (foco en `checkIn`, respetando el orden de F0-10).
5. En los tests, buscar por texto o aria-label, no con `getByRole` sobre toda la pantalla (PR #131).

**Aceptación**
- [ ] Con el formulario vacío, "Asignar" está activo. Al apretarlo aparece "Falta completar: Nombre, Apellido, DNI", los campos se marcan en rojo y el cursor queda en Nombre.
- [ ] Pasa lo mismo en Crear reserva (empieza por las fechas), en el check-in de empresa, en Editar huésped y en Crear empresa.
- [ ] El aviso queda en el formulario; no es un toast que se va.

**Tests** (Vitest)
- `form-checks.test.ts`: `pendingFields` respeta el orden y `missingMessage` une con comas.
- `WalkInModal.test.tsx`: el submit vacío muestra el aviso, el foco queda en `clientFirstName` y `onSubmit` (mock) no se llama. En modo empresa sin pasajero, el foco va al nombre del pasajero.
- `CompanyCheckInModal.test.tsx`: sin DNI, `onConfirm` no se llama y el foco va a `checkInPassengerDni`.
- `AssociatedClientModal.test.tsx`: con el formulario vacío, `findCompaniesByDocumentAction` no se llama y el foco va al nombre.

**Verificación en PROD**
- Hoy › Hacer Check-In › Asignar con todo vacío: aparece el aviso y el cursor va al primer campo.
- En el celular (ancho 375), el aviso se ve arriba del botón.

👤 **AGUSTÍN:** mergea y lo mira con una recepcionista.

**Riesgos.** Toca cinco modales que también tocan F0-2, F0-6, F0-10 y F2-10, por eso van en fila en el carril B. F0-7 cambia un texto de WalkInModal (585-590): el que llegue después rebasea.

### F2-10 · Tipo de documento DNI / CUIT / Pasaporte con validación al cargar
**Rama:** `claude/documento-tipo-y-validacion` · **Carril:** B · **Depende de:** F2-9 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** En 120 días entraron 33 reservas de persona con documentos de 9 o 10 dígitos, que no sirven para una Factura B. Además, los CUIT de ejemplo de los placeholders tienen mal el dígito verificador y no se puede cargar un pasaporte. Con este PR el error se frena al cargar, no al facturar.

**Archivos**
- Create: `src/lib/documents.ts`: `DocType`, `validateDocument`, `inferDocType` y `validateCompanyDocument`.
- Create: `src/app/admin/DocumentField.tsx`: selector [DNI][CUIT][Pasaporte] + input, con el error en línea.
- Modify: `src/app/admin/GuestRegistryFields.tsx`: opción Pasaporte y prop `hideDocType` (105-119).
- Modify: `src/app/admin/WalkInModal.tsx`, `src/app/admin/NewReservationModal.tsx`, `src/app/admin/CompanyCheckInModal.tsx` y `src/app/admin/guests/GuestModal.tsx`: pasan a usar `DocumentField`.
- Modify: `src/app/admin/guests/actions.ts`: `updateGuestAction` valida según `documentType`.
- Modify: `src/app/admin/asociados/AssociatedClientModal.tsx`: valida el CUIT en línea antes de buscar duplicados y usa un placeholder válido.
- Modify: `src/lib/validations.ts`: `superRefine` por tipo; `associatedClientSchema` (263-274) usa `validateCompanyDocument`.
- Create: `src/__tests__/documents.test.ts`; Modify: `src/__tests__/validations.test.ts`.

**Pasos**
1. `validateDocument(type, raw)`: el DNI tiene 7-8 dígitos (acepta puntos y espacios); el CUIT tiene 11 dígitos y pasa `isValidCuit` (`src/lib/arca/amounts.ts:91`); el pasaporte cumple `^[A-Z0-9]{6,20}$` después de pasar a mayúsculas y sacar espacios y guiones.
2. `inferDocType(raw)`: 11 dígitos con CUIT válido es CUIT; 7-8 dígitos, DNI; con letras, Pasaporte; si no, DNI. Se usa al elegir un huésped o un pasajero del padrón.
3. El tipo viaja en `registry.guestDocType` (ya llega a `p_guest_doc_type`) o en `documentType`.
4. En el servidor, `superRefine` en `assignWalkInSchema`, `createReservationSchema` y `checkInSchema`, solo si viene el tipo. Sin tipo sigue el `min(6)`, así la web pública no cambia.
5. Placeholders: DNI "Ej. 30123456", CUIT "11 números", Pasaporte "Ej. AAB123456" y empresa "Ej. 30-12345678-1" (ficticio y válido). Se sacan los ejemplos de CUIT de los campos de DNI (NewReservationModal:477 y GuestModal:152).

**Aceptación**
- [ ] Al cargar un huésped se elige DNI, CUIT o Pasaporte. Un DNI de 9 dígitos se marca en rojo con "El DNI tiene 7 u 8 números" y no deja asignar.
- [ ] Un CUIT con el verificador mal dice "revisá el último número".
- [ ] Un pasaporte con letras se acepta.
- [ ] Al crear una empresa con un CUIT inválido, el error se ve antes de guardar.

**Tests** (Vitest)
- `documents.test.ts`: `validateDocument('DNI','30.123.456')` da ok con "30123456"; "301234567" da error.
- `documents.test.ts`: los CUIT "20-12345678-6" y "30-12345678-1" dan ok y "20-12345678-3" da error (son ficticios, verificados con el algoritmo).
- `documents.test.ts`: el pasaporte "aab 123456" da "AAB123456"; `inferDocType` de "20123456786", "30123456" y "AAB123456".
- `validations.test.ts`: `assignWalkInSchema` con `guestDocType` "DNI" y 9 dígitos se rechaza; con "Pasaporte" y "AAB123456" pasa; sin tipo sigue aceptando "123456".
- WalkInModal: con un CUIT inválido muestra el error y `onSubmit` no se llama.

**Verificación en PROD**
- Hoy › Hacer Check-In: un DNI de 9 dígitos se rechaza y un pasaporte se acepta.
- `select coalesce(guest_doc_type,'(null)'), count(*) filter (where length(regexp_replace(coalesce(client_dni,''),'\D','','g')) in (9,10)) from public.reservations where created_at > '<deploy>' and associated_client_id is null group by 1`: 0 con 9-10 dígitos.

👤 **AGUSTÍN:** mergea y le avisa a recepción que ahora se elige el tipo de documento.

**Riesgos.** Los pasajeros viejos con el documento mal cargado se marcan en rojo al elegirlos, así que el mensaje tiene que decir que se corrige ahí mismo. Con pasaporte no sale la Factura B por ahora (default: queda para una fase fiscal) y la estadía queda en Por facturar. Este PR deja GuestModal y AssociatedClientModal listos para F3-4 (carril H).

### F2-8 · Traspaso forzado: "No soy yo / Cerrar sesión" y nombre de quien entró
**Rama:** `claude/traspaso-no-soy-yo` · **Carril:** C · **Depende de:** — · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Si quedó abierta la sesión equivocada, el traspaso forzado no deja salir: el modal no se puede cerrar (ForcedShiftHandover, layout.tsx:44-69) y no dice con qué usuario se entró. Con este PR, la recepcionista ve "Entraste como {nombre}" y puede cerrar sesión sin rendir.

**Archivos**
- Modify: `src/app/admin/layout.tsx`: `select('role, full_name')` (25-28), la prop `currentUserName` y `openedByName` (50) con el nombre nuevo del campo.
- Modify: `src/app/admin/caja/ForcedShiftHandover.tsx`: prop `currentUserName`, que le pasa `identity` al modal.
- Modify: `src/app/admin/caja/CloseShiftModal.tsx`: prop `identity?: { name: string }` y el bloque "¿No sos vos?".
- Modify: `src/lib/data.ts`: `getAuthUserEmail` (3164) pasa a `getProfileName`, y `openedByEmail`/`closedByEmail` (3255-3271) a `openedByName`/`closedByName`.
- Modify: `src/lib/types.ts`: `ShiftSummary` (832-833).
- Modify: `src/app/admin/caja/CajaClient.tsx` (132) y `src/app/admin/caja/rendiciones/[id]/page.tsx` (287-312): solo el renombre.
- Modify: `src/app/admin/caja/CloseShiftModal.test.tsx`.

**Pasos**
1. En layout, traer `full_name` y pasarlo a `ForcedShiftHandover`.
2. En CloseShiftModal, el encabezado de los pasos 1, 2 y 2b muestra "Entraste como {name}. ¿No sos vos?" con el botón "Cerrar sesión", que llama al `logout()` ya importado (línea 34). Anda aunque `dismissable` sea false.
3. ForcedShiftHandover ya tiene el aviso "La caja la dejó abierta {quien}"; solo se suma `identity`.
4. El renombre no cambia el comportamiento: `getAuthUserEmail` ya devuelve `full_name`.

**Aceptación**
- [ ] La recepcionista que se encuentra con la caja de otro ve "Entraste como {su nombre}" y puede cerrar sesión sin rendir.
- [ ] El aviso muestra el nombre de quien dejó la caja abierta, no un email.

**Tests** (Vitest)
- `CloseShiftModal.test.tsx`: con `identity` y `dismissable=false` aparece "Cerrar sesión", y el clic llama al mock de `logout`.
- `CloseShiftModal.test.tsx`: sin `identity` no aparece.

**Verificación en PROD**
- Entrar como la recepcionista B con la caja abierta por A: se ve "Entraste como B", y "Cerrar sesión" vuelve al login.
- `select role, count(*) filter (where coalesce(btrim(full_name),'') = '') from public.profiles where role in ('admin','receptionist') group by 1`: 0 sin nombre.

👤 **AGUSTÍN:** lo mergea antes de F1-1a. Si algún usuario nuevo no tiene nombre, lo completa en Configuración › Usuarios.

**Riesgos.** Toca `layout.tsx`, el mismo archivo que F1-1a, así que se mergea antes. Si F0-3 se atrasa, puede ir antes que F0-5 (solo comparten líneas chicas de CajaClient). Después, CloseShiftModal queda para F2-2 y F2-7b.

### F2-11 · Pago de cuenta corriente: se carga "Lo que entró" y las retenciones juntas, sin medio preseleccionado
**Rama:** `claude/cc-pago-lo-que-entro` · **Carril:** H · **Depende de:** F3-1 · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** Hoy primero se pide "Monto que cancela" (con las retenciones incluidas) y las retenciones van más abajo (RegisterPaymentModal:379-441). Quien tiene el extracto del banco en la mano tipea lo que entró como si fuera lo que cancela, y la deuda baja de menos. Además, el medio arranca en Efectivo (190), así que una transferencia queda cargada como efectivo.

**Archivos**
- Modify: `src/lib/cc-pagos.ts`: `cancelaDesdeLoQueEntro({ entro, retencionGanancias, retencionIibb })`.
- Modify: `src/app/admin/cuentas/RegisterPaymentModal.tsx`: `amount` pasa a `entro` (187-189); el método arranca vacío (190) con la opción "Elegí…" (404-415); cambia el orden de los bloques (379-441); se calcula lo que cancela en los `useMemo` (234-270) y en el envío (311-326).
- Modify: `src/app/admin/cuentas/actions.ts`: `registerAccountPaymentAction` (198) rechaza el método vacío con un mensaje en español.
- Modify: `src/__tests__/cc-pagos.test.ts` y `src/app/admin/cuentas/RegisterPaymentModal.test.tsx`.

**Pasos**
1. `cancelaDesdeLoQueEntro` = lo que entró + las retenciones, redondeado (puro).
2. El primer campo pasa a ser "Lo que entró (a la cuenta o en mano)", sin precarga. Justo debajo van Ganancias, IIBB y el certificado (se mueve el componente `Retenciones`, 657).
3. "Cancela de deuda: $X" se calcula, es de solo lectura y va en letra grande. `amount` = lo que cancela, y eso usan `resumenPago`, `problemasDelPago`, el reparto y el envío.
4. El chip "Paga todo el saldo" completa lo que entró con max(0, saldo − retenciones).
5. "Cómo entró" arranca vacío y la lista amarilla suma "Elegí cómo entró el pago" (la parte de F2-1). Las etiquetas de cada medio salen de `src/lib/payment-methods.ts` (F3-1).

**Aceptación**
- [ ] La empresa transfirió $90.000 y retuvo $10.000 de Ganancias. El admin tipea 90.000 y 10.000, lee "Cancela $100.000 de deuda" y el recibo sale por $100.000 con "entraron $90.000".
- [ ] "Paga todo el saldo", con las retenciones ya cargadas, completa lo que tuvo que entrar.
- [ ] Sin medio elegido, la lista amarilla dice "Elegí cómo entró el pago" y no se guarda.

**Tests** (Vitest)
- `cc-pagos.test.ts`: `cancelaDesdeLoQueEntro(90000, 10000, 0)` = 100000.
- `RegisterPaymentModal.test.tsx`: con "Lo que entró" 90.000 y Ganancias 10.000, el resumen dice "Cancela $ 100.000" y la acción recibe `amount` 100000.
- `RegisterPaymentModal.test.tsx`: "Paga todo el saldo" con saldo 150.000 e IIBB 5.000 completa 145.000.
- `RegisterPaymentModal.test.tsx`: sin método aparece el problema y no envía. El helper `abrir()` pasa a elegir el método, y los tests de imputación se adaptan al campo nuevo.

**Verificación en PROD**
- Cuentas › Registrar pago a cuenta con una retención real, junto con Agustín.
- `select amount, retencion_ganancias, retencion_iibb from public.cuenta_corriente_movimientos where tipo = 'pago' and created_at > '<deploy>'`: amount = lo que entró + las retenciones.

👤 **AGUSTÍN:** mergea y carga el próximo pago real con retención mirando el resumen. Si las empresas pagaron desde julio y no se cargó (Q6), carga esos cobros con este modal antes de F3-5a.

**Riesgos.** Le cambia la costumbre al admin, así que el título del campo y el resumen tienen que ser inequívocos. No hay migración: `rpc_register_account_payment` (mig 114) sigue recibiendo amount = lo que cancela (regla de la mig 109). Va después de F3-1 y antes de F3-2, porque los tres tocan RegisterPaymentModal.

### Fusionados o descartados
- **F2-1 · Cobrar sin "Efectivo" preseleccionado:** fusionado. La parte de PaymentModal pasó a F0-3 (el medio arranca vacío, salvo Cta. Cte. en una empresa con cuenta), y la de RegisterPaymentModal y `registerAccountPaymentAction` pasó a F2-11. F2-3 ahora depende de F0-3. Estimado original: 0,5 días.
- **F2-6 · Corregir el DNI dentro del prompt de factura, antes de emitir:** fusionado en F0-9, porque los dos creaban la misma `fixReservationDniAction` y el mismo bloque en InvoicePromptModal. Sus tests (DNI de 9 dígitos, P0023 de otro turno) pasan a F0-9. Estimado original: 0,5 días.
- **F2-12 · Walk-in: cobrar por adelantado, como paso opcional:** postergado. No está confirmado que se use y suma un clic a cada walk-in. Vuelve solo si Q4 dice que es común. Estimado original: 0,5 días.

---

## Fase 3 — Clientes: una lista, una ficha, un saldo

Hoy el dueño busca a un cliente en cuatro pantallas (Directorio de huéspedes, Empresas / Convenios, Cuenta Corriente y Descuentos) y, según por dónde entre, ve dos saldos distintos para la misma empresa. F3 deja una sola lista en `/admin/clientes`, una sola ficha por cliente con un único saldo (el de cuenta corriente, decisión 1) y el vocabulario de pagos en castellano llano ("Aplicar" en vez de "imputar"). Es todo del admin (recepción no gana ni pierde nada), son 11 PRs y 10,75 días, y va entero en el carril H, en fila porque todos tocan la ficha o `RegisterPaymentModal` (F2-11 se mete entre F3-1 y F3-2); cruza a otros carriles en tres puntos: F3-4 espera a F2-10 (B), F3-5a a F1-1b (D) y F3-6 a F1-8 (D).

### F3-1 · Ficha: medio de pago legible y "Aplicar" en vez de "imputar"
**Rama:** `claude/ficha-vocabulario` · **Carril:** H · **Depende de:** — · **Migración:** no · **Esfuerzo:** 0,5 día

**Por qué.** La ficha de cuenta corriente y el CSV que se le manda al cliente dicen `bank_transfer`, y "imputar / desimputar" no lo entiende nadie. Es solo texto: no mueve plata.

**Archivos**
- Create: `src/lib/payment-methods.ts` — `PAYMENT_METHOD_META` con `{ label, icon, tone }` por medio (cash, bank_transfer, mercado_pago, credit_card, debit_card, cheque, vale_blanco, cuenta_corriente, other; `icon` es un `LucideIcon`, sin JSX) y `paymentMethodLabel(method: string | null)`. Es el único archivo de etiquetas: F5-16 solo reemplaza las otras cinco copias.
- Modify: `src/app/admin/cuentas/FichaClienteModal.tsx` — `paymentMethodLabel` en Movimientos (317), en el Concepto del CSV (81) y en `FilaPago` (766); borrar `METODO_LABEL` y `metodoLabel` (590-629); exportar `buildMovementsCsv`; textos de Pagos (747, 827, 833, 860, 885-886, 895-897, 903).
- Modify: `src/app/admin/cuentas/actions.ts` — errores 185-333 (imputación → aplicación, desimputar → quitar); el JSDoc de `registerAccountPaymentAction` vuelve a su lugar (159-171 → 198).
- Modify: `src/app/admin/cuentas/RegisterPaymentModal.tsx` — aria-label de la 642: "Importe aplicado a …".
- Modify: `src/app/admin/recibo-cc/[movementId]/page.tsx` — papel: 199 "Aplicado a" y 214 "(quitada)".
- Modify: `src/app/admin/cuentas/CuentasClient.test.tsx` — los 5 tests de desimputar (498-559) buscan "Quitar aplicación"; tests nuevos de etiqueta y CSV.
- Create: `src/__tests__/payment-methods.test.ts`.

**Pasos**
1. Test de `payment-methods.ts` en rojo, después el archivo.
2. Cambiar las etiquetas de la ficha y del CSV; exportar `buildMovementsCsv`.
3. Textos de la solapa Pagos: "Aplicado a"; "A cuenta, sin aplicar a ninguna factura ni estadía."; "quitada"; botón "Quitar aplicación"; placeholder "Por qué se quita (obligatorio)"; toast "Se quitaron $X. Quedan $Y a cuenta."
4. Errores de `cuentas/actions.ts`, aria-label y recibo impreso. `npm run lint && npm run typecheck && npm test`.

**Aceptación**
- [ ] En Movimientos, un pago por transferencia dice "Pago a cuenta · Transferencia", nunca `bank_transfer`.
- [ ] El CSV de movimientos trae "Transferencia" en la columna Concepto.
- [ ] En Pagos no aparece "imputar" ni "desimputar": el botón dice "Quitar aplicación" y sigue pidiendo el motivo.
- [ ] El recibo de cobranza impreso dice "Aplicado a", con los mismos importes.

**Tests** (Vitest)
- `payment-methods.test.ts`: `bank_transfer` → "Transferencia"; `null` → "Sin método"; `"xyz"` → "xyz"; todo valor de `PaymentMethod` tiene label e icon.
- `CuentasClient.test.tsx`: un movimiento `bank_transfer` muestra "Transferencia"; `buildMovementsCsv` contiene `;Transferencia;`; los 5 tests de desimputar pasan con el aria-label nuevo, sin cambiar lo que verifican.

**Verificación en PROD**
- `select payment_method, count(*) from public.cuenta_corriente_movimientos where tipo = 'pago' group by 1;` — cada valor tiene etiqueta (hoy hay 0 pagos: se mira con el primero que se cargue).
- Reimprimir un recibo de cobranza viejo: dice "Aplicado a" y los importes no cambian.

👤 **AGUSTÍN:** mergear. El papel dice "Aplicado a" por defecto; si no lo querés, avisá antes del merge.

**Riesgos.** Las reimpresiones de recibos viejos cambian la palabra, no los importes. Los mensajes de las RPC de las migs 109, 111 y 114 siguen diciendo "imputar" (diferido): las validaciones en TypeScript los atajan antes.

### F3-2 · Pagos: botón "Aplicar a facturas" para la plata que quedó a cuenta
**Rama:** `claude/aplicar-pago-a-facturas` · **Carril:** H · **Depende de:** F3-1, F2-11 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Un pago que entró sin aplicar (un adelanto, o uno al que se le quitó la aplicación) hoy no se puede aplicar después desde ninguna pantalla: `addPaymentImputacionesAction` (cuentas/actions.ts:307) existe y nadie la llama.

**Archivos**
- Create: `src/app/admin/cuentas/AplicarADeudas.tsx` — `DeudasAplicables` y el hook `useDeudasDelCliente(kind, id)`, extraídos de RegisterPaymentModal (helpers 74-137, `DeudasImputables` y `GrupoDeDeudas` 508-656, carga 204-224; volver a buscar las líneas, porque F2-11 las mueve).
- Modify: `src/app/admin/cuentas/RegisterPaymentModal.tsx` — importa lo extraído, sin cambiar el comportamiento.
- Modify: `src/app/admin/cuentas/FichaClienteModal.tsx` — `FilaPago` (718) recibe `account` y suma el panel.
- Modify: `src/app/admin/cuentas/CuentasClient.test.tsx` — bloque "Aplicar a facturas".

**Pasos**
1. Rebasear sobre F2-11 y extraer; los 12 tests de `RegisterPaymentModal.test.tsx` tienen que pasar sin tocarlos.
2. En `FilaPago`, si `pago.sin_imputar > 0`: "Hay $X de este pago sin aplicar" y el botón "Aplicar a facturas".
3. El botón abre un panel en la misma fila: `DeudasAplicables` con techo = lo sin aplicar, "Aplicar a lo más viejo primero" (`repartirMasViejoPrimero`, cc-pagos.ts:229) y el resumen en vivo "Aplicás $A · quedan $B a cuenta".
4. "Confirmar" queda gris, con el motivo a la vista, si no hay nada tildado o si se pasa del techo (`problemasDelPago`, cc-pagos.ts:354).
5. Confirmar llama `addPaymentImputacionesAction({ movementId, imputaciones })`. Si sale bien: toast "Se aplicaron $X. Quedan $Y a cuenta." y relee Pagos. Si falla: toast con el error y no relee.
6. Ayuda: "Aplicar no cambia el saldo de la cuenta (el pago ya lo bajó): solo dice qué factura quedó pagada."

**Base de datos.** Sin migración: usa `rpc_add_payment_imputaciones` (migs 111 y 114, ya en `applied_migrations` de PROD).

**Aceptación**
- [ ] Un pago con plata sin aplicar muestra "Hay $X de este pago sin aplicar" y el botón; uno aplicado entero no lo muestra.
- [ ] No se puede confirmar más de lo que quedó sin aplicar ni más de lo que debe cada factura o estadía, y se ve por qué.
- [ ] Al confirmar, la factura aparece bajo "Aplicado a" y el "sin aplicar" baja, sin cerrar la ficha.

**Tests** (Vitest)
- Los 12 tests existentes de `RegisterPaymentModal.test.tsx`, sin cambios.
- Ofrece "Aplicar a facturas" solo si `sin_imputar > 0`; no deja pasar el techo.
- Una estadía viaja como `cargoMovimientoId` y una factura como `invoiceId`.
- Después de aplicar relee los pagos; si la action rechaza, muestra el error y no relee.

**Verificación en PROD**
- Pagos con plata sin aplicar (hoy 0): `select count(*) from public.cuenta_corriente_movimientos m where tipo = 'pago' and m.amount > coalesce((select sum(i.amount) from public.cc_pago_imputaciones i where i.movimiento_id = m.id and i.revertida_at is null), 0) + 0.005;`
- Después del primer uso: `select movimiento_id, invoice_id, cargo_movimiento_id, amount, created_at from public.cc_pago_imputaciones order by created_at desc limit 5;`

👤 **AGUSTÍN:** mergear. La primera vez que quede un pago sin aplicar, probarlo desde la ficha.

**Riesgos.** En PROD no hay datos para ejercitarlo todavía: lo cubren los tests y la RPC, que bloquea la factura (P0038/P0043).

### F3-9 · Tablero: lo que sale de la ficha de empresa ("reservas − cobrado") pasa a la tarjeta de Cobranzas, por empresa
**Rama:** `claude/tablero-cobranzas-por-empresa` · **Carril:** H · **Depende de:** — · **Migración:** no · **Esfuerzo:** 0,5 día

**Por qué.** F3-3a saca de la ficha de empresa el número "reservas − cobrado" (decisión 1). El Tablero ya lo muestra sumado en "Reservas activas": lo único que se pierde es el desglose por empresa, y este PR lo pone ahí antes, así el número nunca queda sin lugar.

**Archivos**
- Modify: `src/lib/data.ts` — en `getManagementDashboardData`, la consulta `receivableRes` (2724 y 2874-2882) suma `associated_client_id` y `associated_clients(display_name)`; `ManagementDashboardData` gana `receivableByCompany`.
- Modify: `src/lib/analytics.ts` — `agruparReservadoSinCobrar(rows)` (pura): suma por empresa solo los saldos positivos; top 5, "Otras empresas" si hay más, y "Particulares".
- Modify: `src/app/admin/analytics/page.tsx` — tarjeta de Cobranzas (296-316): lista chica por empresa debajo de "Reservas activas".
- Modify: `src/lib/metric-glossary.ts` — texto de `accountsReceivable` (82-86). Nota: el tooltip vive acá, no en `analytics/shared.ts` como decía la fase.
- Modify: `src/__tests__/analytics.test.ts`.

**Pasos**
1. Test de `agruparReservadoSinCobrar` en rojo, después la función.
2. Ampliar la consulta y el tipo; pintar la lista.
3. Etiqueta y tooltip según Q5. El PR no inventa el nombre: sin respuesta, la tarjeta sigue diciendo "Reservas activas".

**Aceptación**
- [ ] En el Tablero, bajo "Reservas activas", el dueño ve cuánto hay reservado sin cobrar por empresa y en "Particulares".
- [ ] La suma del desglose da el total de la tarjeta.

**Tests** (Vitest)
- `analytics.test.ts`: `agruparReservadoSinCobrar` ignora saldos ≤ 0, junta las reservas sin empresa en "Particulares", corta en 5 (el resto va a "Otras empresas") y la suma coincide con `accountsReceivable`.

**Verificación en PROD**
- `select a.display_name, round(sum(greatest(r.total_price - r.paid_amount, 0)), 2) from public.reservations r left join public.associated_clients a on a.id = r.associated_client_id where r.status in ('confirmed', 'checked_in') group by 1 order by 2 desc;` — coincide con el desglose.

👤 **AGUSTÍN:** contestar Q5 (recomendación: "Reservado sin cobrar") y mergear antes que F3-3a.

**Riesgos.** F1-9 parte "Saldos por cobrar" de Cobros del día en "Deben los alojados" y "Reservado sin seña": conviene que las dos pantallas usen la misma palabra. Si Q5 elige otra, se cambia en las dos.

### F3-3a · Un solo saldo: cta-cte.ts para lista y ficha, fuera el "Saldo (deuda)" del ledger y la ficha se abre desde Empresas
**Rama:** `claude/saldo-unico-cta-cte` · **Carril:** H · **Depende de:** F3-2, F3-9 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Hoy la misma empresa tiene dos saldos: la ficha de Empresas calcula "reservas − cobrado" y la de Cuenta Corriente suma movimientos, y en PROD no se parecen. Decisión 1: el saldo de una empresa es solo el de cuenta corriente.

**Archivos**
- Create: `src/lib/cta-cte.ts` — `saldoDeMovimientos(movs)` y `saldosPorCliente(movs)` (puras; reemplazan a `signedMovement` suelto, data.ts:394).
- Modify: `src/lib/data.ts` — `getCtaCteAccounts` (401-470), `getCtaCteMovements` (473-507) y el saldo del recibo de cobranza (~897) usan `cta-cte.ts`; `getAssociatedClientLedger` (306-380) deja de calcular facturado, cobrado y saldo.
- Modify: `src/lib/types.ts` — `AssociatedClientLedger` (590) sin `facturado`, `cobrado` ni `saldo`.
- Modify: `src/app/admin/asociados/AssociatedClientLedgerModal.tsx` — fuera las tarjetas "Total facturado / Cobrado / Saldo (deuda)" (104-123). El bloque de cuenta corriente (125-150) queda como único saldo, y "Gestionar" (link a /admin/cuentas) pasa a "Abrir cuenta corriente", que abre `FichaClienteModal` ahí mismo.
- Modify: `src/app/admin/asociados/AssociatedClientsClientTable.tsx` — el título del botón (143) deja de decir "historial y saldo".
- Create: `src/__tests__/cta-cte.test.ts`, `src/app/admin/asociados/AssociatedClientLedgerModal.test.tsx` (lo borra F3-3b junto con el modal; sus casos pasan a `ClienteFicha.test.tsx`).

**Pasos**
1. Test de `cta-cte.ts` en rojo, después el archivo; pasar las tres sumas de data.ts.
2. Sacar las tres tarjetas y los campos del tipo. La columna "Saldo" por estadía del historial queda hasta F3-3b, que la cambia por la pastilla de cobro.
3. "Abrir cuenta corriente" monta `FichaClienteModal` con `{ kind: "company", id, name, document_id, balance }`.

**Aceptación**
- [ ] La ficha de una empresa ya no muestra "Total facturado", "Cobrado" ni "Saldo (deuda)".
- [ ] El único saldo dice "debe" o "a favor" y es igual al que muestra Cuenta Corriente para ese cliente.
- [ ] Desde Empresas se abre la misma ficha de cuenta corriente que desde Cuenta Corriente.
- [ ] Una empresa sin cuenta corriente ve su historial de estadías sin ningún número de deuda.

**Tests** (Vitest)
- `cta-cte.test.ts`: un pago con retenciones cancela su `amount` entero; `saldosPorCliente` separa empresa y persona; redondeo a 2 decimales.
- `AssociatedClientLedgerModal.test.tsx`: nunca renderiza "Total facturado" ni "Saldo (deuda)"; "Abrir cuenta corriente" abre la ficha.
- Los tests de `CuentasClient.test.tsx` siguen verdes.

**Verificación en PROD**
- Abrir 2 o 3 empresas y comparar con `select coalesce(associated_client_id::text, guest_id::text) as cliente, round(sum(case when tipo = 'cargo' then amount else -amount end), 2) as saldo from public.cuenta_corriente_movimientos group by 1 order by 2 desc;`
- Probar con `npm run build && npm start` o en PROD: en dev los client components de página no hidratan.

👤 **AGUSTÍN:** tener F3-9 mergeado y Q5 contestada; mergear y abrir la empresa con más estadías: ya no aparece la "deuda" de reservas y sí el saldo de cuenta corriente.

**Riesgos.** Sin F3-9, el número "reservas − cobrado" desaparece de todos lados: por eso la dependencia.

### F3-3b · Una sola ficha: FichaClienteModal pasa a clientes/ClienteFicha y suma la solapa Estadías
**Rama:** `claude/ficha-unica-cliente` · **Carril:** H · **Depende de:** F3-3a · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** Una sola ficha para personas y empresas, que se abre igual desde Empresas, Cuenta Corriente y el Directorio, con estadías, cuenta, facturas y pagos en solapas, y solo las que tienen algo.

**Archivos**
- Create: `src/lib/clientes.ts` — `ClienteRef`, `parseClienteRef("company:<uuid>")` (mismo formato que el control y remitos), `SolapaFicha`, `solapasVisibles(h)`, `estadoCobroEstadia(row)`.
- Modify: `src/lib/data.ts` — `getClienteFichaHeader(ref)` y `listClientStays(ref)`; borrar `getAssociatedClientLedger`. `src/lib/types.ts`: `ClienteFichaHeader`, `ClienteStayRow`; borrar `AssociatedClientLedger`.
- Create: `src/app/admin/clientes/actions.ts` — `loadClienteFichaAction(ref)` y `loadClientStaysAction(ref)`, con `assertAdmin`.
- Create (git mv): `src/app/admin/cuentas/FichaClienteModal.tsx` → `src/app/admin/clientes/ClienteFicha.tsx`, más encabezado, Datos (lectura), Estadías y Remitos.
- Create (git mv): `src/app/admin/cuentas/CuentasClient.test.tsx` → `src/app/admin/clientes/ClienteFicha.test.tsx`. Create: `src/__tests__/clientes.test.ts`.
- Delete: `src/app/admin/asociados/AssociatedClientLedgerModal.tsx` (y su test de F3-3a); `loadAssociatedClientLedgerAction` en `src/app/admin/asociados/actions.ts` (143-154).
- Modify: `src/app/admin/cuentas/CuentasClient.tsx` (146-152), `src/app/admin/asociados/AssociatedClientsClientTable.tsx` (139-145, 211-214) y `src/app/admin/guests/GuestDirectoryTable.tsx` (botón "Ver ficha" en filas con id, 122-140): abren `ClienteFicha`.

**Pasos**
1. Primer commit: solo los `git mv`, sin cambios, para que la revisión de las 942 líneas muestre solo diferencias.
2. `clientes.ts` con tests: Datos siempre; Estadías si hay; Cuenta corriente si está habilitada o tiene movimientos; Facturas, Pagos y Remitos si hay. `estadoCobroEstadia`: 'cta_cte' | 'pagada' | 'debe' | 'por_llegar' | 'cancelada'; el cargo en cuenta corriente gana sobre `paid_amount`, porque en PROD lo fiado cuenta como pagado.
3. Datos: empresa por `reservations.associated_client_id`; persona por `guest_id = id` o (sin `guest_id` y mismo DNI normalizado); pasajero con la regla legacy "Pasajero:" (data.ts:356-360).
4. Encabezado: nombre, Persona/Empresa, documento, pastilla de descuento, "Archivada", y saldo con `BalanceTag` solo si tiene cuenta. Acciones: "Registrar pago" (relee encabezado y Pagos), "Facturar" → `/admin/fiscal/consolidada?kind=&id=` (siempre con el cliente puesto) y "Ver qué falta facturar" → `/admin/fiscal/control?cliente=kind:id`.
5. Solapas: Datos (lectura + "Editar", que abre GuestModal o AssociatedClientModal), Estadías (paginada, con pastilla de cobro), Cuenta corriente (la actual "Movimientos"), Facturas (igual: no se fusiona con Emitidas), Pagos (vacío: "Los cobros se cargan con Registrar pago, arriba") y Remitos (link a `/admin/remitos?cliente=kind:id`).

**Aceptación**
- [ ] Desde Empresas, Cuenta Corriente y el Directorio se abre la MISMA ficha.
- [ ] Una persona sin cuenta corriente ve Datos y Estadías, sin solapas vacías.
- [ ] En Estadías, una fiada dice "A cuenta corriente" (no "Pagada") y una futura "Por llegar".
- [ ] "Registrar pago" se hace desde la ficha y el saldo del encabezado se actualiza sin cerrarla; "Facturar" abre la consolidada con el cliente puesto.

**Tests** (Vitest)
- `clientes.test.ts`: `parseClienteRef` rechaza un kind inventado; `solapasVisibles` con cada combinación de conteos; `estadoCobroEstadia` (cargo en cuenta corriente gana aunque `paid_amount` = total; confirmada = por_llegar; cancelada).
- `ClienteFicha.test.tsx`: los tests mudados de Movimientos, Facturas y Pagos pasan; nunca renderiza "Saldo (deuda)"; "Registrar pago" relee el encabezado; "Facturar" lleva `kind` e `id`.

**Verificación en PROD**
- Estadías de una empresa: `select count(*) from public.reservations where associated_client_id = '<id>';` igual al conteo de la solapa.
- Con `npm run build && npm start` antes del merge, o en PROD después del deploy.

👤 **AGUSTÍN:** mergear; abrir la misma empresa desde Empresas y desde Cuenta Corriente y ver que es la misma ficha.

**Riesgos.** Es el PR más grande de la fase: sin `git mv` la revisión no se puede leer. Una factura vieja de persona sin `guest_id` en la reserva puede no aparecer en Facturas (igual que hoy). Como borra `AssociatedClientLedgerModal`, F5-4 y F5-9c lo sacan de sus listas.

### F3-4 · Datos editables dentro de la ficha: el descuento se cambia en un solo lugar
**Rama:** `claude/ficha-datos-editables` · **Carril:** H · **Depende de:** F3-3b, F2-10 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Hoy el descuento se edita en tres pantallas (GuestModal, AssociatedClientModal y Descuentos). Con esto se cambia en la ficha, junto con los datos fiscales, el modo de facturación y la cuenta corriente.

**Archivos**
- Create: `src/app/admin/guests/GuestForm.tsx` y `src/app/admin/asociados/CompanyForm.tsx` — el cuerpo de cada modal (`{ initial, onSubmit, submitLabel }`); CompanyForm conserva el aviso de CUIT repetido (mig 94, AssociatedClientModal.tsx:71-99).
- Delete: `src/app/admin/guests/GuestModal.tsx` si no le queda uso (si no, queda como wrapper de GuestForm).
- Modify: `src/app/admin/asociados/AssociatedClientModal.tsx` — usa CompanyForm y queda solo para "Nueva empresa".
- Modify: `src/app/admin/clientes/ClienteFicha.tsx` — solapa Datos editable y guarda de cambios sin guardar; `src/app/admin/clientes/ClienteFicha.test.tsx`.
- Modify: `src/app/admin/asociados/AssociatedClientsClientTable.tsx` y `src/app/admin/guests/GuestDirectoryTable.tsx` — el lápiz abre la ficha en Datos.
- Modify: `src/app/admin/guests/actions.ts` (127) y `src/app/admin/asociados/actions.ts` (29-33) — suman `revalidatePath("/admin/cuentas")` y `revalidatePath("/admin/descuentos")`.

**Pasos**
1. Rebasear sobre F2-10: los formularios extraídos llevan el tipo de documento con validación (F2-10), la nota "Pasó a Factura consolidada" al habilitar cuenta corriente (F0-2) y los botones que dicen qué falta (F2-9). Sus tests se mudan, no se borran.
2. Extraer los formularios sin cambiar el payload (`GuestRecordPayload`, `AssociatedClientFormPayload`).
3. Datos por secciones: Contacto; Descuento ("Se aplica al elegirlo en una reserva nueva; las reservas ya hechas no cambian"); Facturación (IVA, CUIT, razón social, domicilio fiscal, modo); Cuenta corriente; N° en Robinet; Notas (empresa). Barra fija "Guardar cambios" → toast "Datos guardados" → relee el encabezado.
4. Con cambios sin guardar, cambiar de solapa o cerrar pregunta "Tenés cambios sin guardar. ¿Salir igual?".
5. Al pie: "Archivar / Reactivar" (empresa) y "Borrar", con los `confirm()` de hoy (AssociatedClientsClientTable.tsx:34-69, GuestDirectoryTable.tsx:28-46). F5-16 los cambia después por un diálogo propio, apuntando a ClienteFicha.

**Aceptación**
- [ ] El dueño cambia el descuento de una empresa en su ficha, toca "Guardar cambios", ve "Datos guardados" y la pastilla del encabezado muestra el % nuevo.
- [ ] Si cierra la ficha con cambios sin guardar, el sistema le pregunta antes de perderlos.
- [ ] Un CUIT que ya tiene otra empresa sigue pidiendo confirmación (mig 94), no se rechaza.

**Tests** (Vitest)
- GuestForm y CompanyForm: el payload sale igual que el de los modales actuales.
- Datos: guardar llama a la action según `kind`, muestra el toast y relee el encabezado.
- Cerrar con cambios pide confirmación; al cancelar, los cambios quedan.
- CUIT repetido: el primer submit avisa y el segundo guarda.

**Verificación en PROD**
- Cambiar y devolver el descuento de un cliente: `select discount_percent, updated_at from public.associated_clients where id = '<id>';` (o en `public.guests`).
- Reserva nueva para ese cliente: el % aparece en la vista previa del precio.

👤 **AGUSTÍN:** mergear; cambiar y devolver un descuento desde la ficha.

**Riesgos.** Es el cuarto PR que toca GuestModal y AssociatedClientModal (después de F0-2, F2-9 y F2-10): si la extracción pierde uno de esos cambios, lo agarran sus tests mudados. Hasta F3-6, la pantalla Descuentos sigue editando por su lado.

### F3-5a · Lista única en /admin/clientes con filtros (Todos · Personas · Empresas · Con saldo · Con descuento · Archivadas)
**Rama:** `claude/lista-clientes` · **Carril:** H · **Depende de:** F3-3b, F1-1b · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Una sola lista para encontrar a cualquier cliente, persona o empresa, por nombre o documento, y ver quién debe. Convive unos días con las pantallas viejas antes de F3-6.

**Archivos**
- Modify: `src/lib/data.ts` — `buildGuestDirectory` (pura, extraída de `getGuestDirectory` 1304-1446, sin cambiar la firma que usa `searchGuestsAction`) y `getClientList()`, que suma `getAssociatedClients` y `saldosPorCliente`; la consulta de reservas gana `associated_client_id`.
- Modify: `src/lib/clientes.ts` — `ClientesVer`, `parseVer`, `filtrarClientes(rows, ver, q)` (sin acentos, por nombre y por los dígitos del documento), `resumenSaldos(rows)`. `src/lib/types.ts`: `ClienteListRow`.
- Create: `src/app/admin/clientes/page.tsx` — solo admin (redirect a /forbidden), `?ver=&q=`; chips que conservan `q`; en "Con saldo", "Deudores: N · Deuda total: $X"; botón "Nueva empresa".
- Create: `src/app/admin/clientes/ClientesTable.tsx` — Cliente (con documento), Tipo (Persona / Empresa y etiqueta "Cta cte"), Descuento, Saldo (`BalanceTag` si tiene cuenta), Estadías y última visita, Acciones ("Ver ficha"; en Con saldo también "Registrar pago" y "Facturar"). Paginada con `usePagination`.
- Modify: `src/app/admin/nav-links.ts` — pestaña "Clientes" (`/admin/clientes`) primera de la sección Clientes del modelo de F1-1a, y `findActiveNav` la reconoce. No se toca `getAdminItems`.
- Modify: `src/lib/supabase/middleware.ts` — `/admin/clientes` solo admin, junto a `isAdminOnlyFinancesPath` (57).
- Modify: `src/__tests__/middleware-roles.test.ts`, `src/__tests__/nav-links.test.ts`, `src/__tests__/clientes.test.ts`. Create: `src/app/admin/clientes/ClientesTable.test.tsx`.

**Pasos**
1. Tests de `filtrarClientes` y `resumenSaldos` en rojo, después el código.
2. `getClientList`, página y tabla; la ficha se abre con estado local (la URL llega en F3-5b).
3. Pestaña y middleware (rebase contra F0-7 y F1-1b). "Archivadas" es solo de empresas: las personas se siguen borrando del padrón (default).

**Aceptación**
- [ ] El dueño busca "perez" o un DNI con puntos y lo encuentra, sea persona o empresa.
- [ ] En "Con saldo" ve cuántos deudores hay y la deuda total, igual que en Cuenta Corriente.
- [ ] Clic en un cliente abre su ficha.
- [ ] Recepción no ve la pestaña y, si escribe la URL, va a /forbidden.

**Tests** (Vitest)
- `clientes.test.ts`: cada `ver`; "jose" encuentra "José"; "20.123.456" encuentra 20123456; las archivadas no salen en "todos"; `resumenSaldos` no suma los saldos a favor a la deuda.
- `ClientesTable.test.tsx`: los chips conservan `q`; en con_saldo aparecen "Registrar pago" y "Facturar".
- `middleware-roles.test.ts`: recepción → /forbidden, admin entra. `nav-links.test.ts`: la pestaña es solo del admin.

**Verificación en PROD**
- `?ver=con_saldo` contra `with s as (select coalesce(associated_client_id::text, guest_id::text) as c, sum(case when tipo = 'cargo' then amount else -amount end) as saldo from public.cuenta_corriente_movimientos group by 1) select count(*) filter (where saldo > 0), sum(saldo) filter (where saldo > 0) from s;` (el 23/09: 11 deudores).
- `?ver=empresas` contra `select count(*) from public.associated_clients where is_active;`, y `?ver=con_descuento` contra los `discount_percent > 0` de `guests` más los de `associated_clients`.

👤 **AGUSTÍN:** contestar Q6 antes (si las empresas pagaron, cargar esos cobros con el modal de F2-11); mergear y usar Clientes unos días junto a las pantallas viejas.

**Riesgos.** Sin Q6, "Deuda total" puede mostrar deudores que ya pagaron. Toca `middleware.ts` y `nav-links.ts`, que son del carril D: rebase contra lo último que haya entrado ahí.

### F3-5b · Ficha por URL (?ficha=kind:id) y CSV de "Con saldo"
**Rama:** `claude/ficha-por-url` · **Carril:** H · **Depende de:** F3-5a · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** El link a la ficha de un cliente se puede copiar, mandar o abrir desde otra pantalla, y "Atrás" la cierra. Y el listado de deudores se baja en CSV desde Clientes, como hoy desde Cuenta Corriente.

**Archivos**
- Modify: `src/app/admin/clientes/page.tsx` — acepta `?ficha=kind:id` (con `parseClienteRef`); un ref roto se ignora.
- Modify: `src/app/admin/clientes/ClientesTable.tsx` — abrir la ficha hace `window.history.pushState` con `?ficha=` (Next lo sincroniza con `useSearchParams`) sin volver a correr `getClientList`; cerrar saca el parámetro; "Atrás" la cierra. CSV en "Con saldo" con las columnas de `CuentasClient.tsx:19-24` (Cliente, Tipo, DNI/CUIT, Saldo), sobre lo filtrado.
- Modify: `src/app/admin/clientes/ClientesTable.test.tsx`, `src/__tests__/clientes.test.ts`.
- Modify (solo si F1-5a ya está en main): `src/app/admin/search-actions.ts` — los links del admin pasan a `/admin/clientes?ficha=kind:id`.

**Pasos**
1. Tests en rojo: clic agrega `?ficha=company:<id>`; cerrar lo saca; `popstate` cierra.
2. Con `?ficha=` en la URL, la ficha arranca abierta aunque el cliente no esté en el filtro elegido (carga con `loadClienteFichaAction`).
3. CSV con `DownloadCsvButton` y `buildCsv`.

**Aceptación**
- [ ] Clic en un cliente abre su ficha y cambia la dirección; el link copiado abre la misma ficha en otra pestaña.
- [ ] "Atrás" del navegador cierra la ficha sin salir de Clientes.
- [ ] En "Con saldo" se baja el CSV de deudores con las mismas columnas que hoy.

**Tests** (Vitest)
- `ClientesTable.test.tsx`: `pushState` con `?ficha=`; cerrar lo saca; `popstate` cierra; el CSV respeta el filtro.
- `clientes.test.ts`: `parseClienteRef` con un ref roto da `null` (la página no se cae).

**Verificación en PROD**
- Abrir una ficha, copiar el link y abrirlo en otra pestaña: es la misma. Probarlo antes con `npm run build && npm start` (dev no hidrata).
- El CSV de "Con saldo" tiene tantas filas como deudores dice el resumen.

👤 **AGUSTÍN:** mergear; probar copiar el link de una ficha y el "Atrás".

**Riesgos.** Si se usa `router.push` en vez de `pushState`, cada ficha vuelve a pedirle la lista entera al servidor. El contrato `?ficha=` queda fijo: lo usa también el buscador global.

### F3-6 · Las cuatro pantallas viejas llevan a Clientes con el mismo filtro
**Rama:** `claude/clientes-redirects` · **Carril:** H · **Depende de:** F3-4, F3-5b, F1-8 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Los links guardados siguen andando, la sección Clientes queda con una sola pantalla y el descuento se cambia de verdad en un solo lugar.

**Archivos**
- Modify: `src/lib/clientes.ts` — `legacyClientesHref(route, params)`: `/admin/asociados?q=x` → `/admin/clientes?ver=empresas&q=x`; `/admin/cuentas` → `?ver=con_saldo`; `/admin/descuentos` → `?ver=con_descuento`; `/admin/guests` sin view o con `view=directorio` → `?ver=personas&q=x`; historial y por_llegar → `null`.
- Modify: `src/app/admin/asociados/page.tsx`, `src/app/admin/cuentas/page.tsx`, `src/app/admin/descuentos/page.tsx` — solo `redirect(legacyClientesHref(...))` después del chequeo de rol.
- Modify: `src/app/admin/guests/page.tsx` y `src/lib/upcoming.ts` (lo crea F1-8) — el directorio redirige SOLO si `role === "admin"`; recepción sigue por `resolveGuestsView` (Por llegar) y nunca cae en /forbidden.
- Modify: `src/app/admin/nav-links.ts` — fuera las pestañas Directorio, Empresas y convenios, Cuenta corriente y Descuentos.
- Delete: `src/app/admin/asociados/AssociatedClientsClientTable.tsx`, `src/app/admin/cuentas/CuentasClient.tsx`, `src/app/admin/descuentos/DiscountsManager.tsx`, `src/app/admin/guests/GuestDirectoryTable.tsx`.
- Modify: `src/app/admin/actions.ts` — borrar `updateGuestDiscountAction` y `updateCompanyDiscountAction` (273-324); `src/lib/data.ts` — borrar `setGuestPersonalDiscount`, `setCompanyDiscount` y `getDiscountedClients` (1619-1709) si quedan sin uso.
- Modify: `revalidatePath("/admin/clientes")` junto a cada ruta vieja en `src/app/admin/actions.ts` (142, 172, 294), `src/app/admin/asociados/actions.ts` (32), `src/app/admin/cuentas/actions.ts` (264, 294, 330), `src/app/admin/fiscal/consolidada/actions.ts` (21) y `src/app/admin/guests/actions.ts` (127, 142). Los viejos pueden quedar.
- Modify: `src/__tests__/nav-links.test.ts`, `src/__tests__/clientes.test.ts` y el test de `resolveGuestsView` de F1-8.

**Pasos**
1. Tabla de `legacyClientesHref` en test, en rojo; después la función.
2. Redirects; en guests/page.tsx la rama de recepción no cambia.
3. Menú; borrar lo que queda sin uso (grep antes de cada borrado) y sumar los `revalidatePath`.

**Aceptación**
- [ ] Un link viejo a /admin/cuentas abre Clientes en "Con saldo"; /admin/asociados?q=x abre Empresas con x buscado; /admin/descuentos abre "Con descuento".
- [ ] /admin/guests?view=historial y ?view=por_llegar siguen igual, y recepción que entra a /admin/guests sigue viendo Por llegar.
- [ ] El menú del admin muestra Clientes sin las cuatro pestañas viejas, y el descuento solo se cambia desde la ficha.

**Tests** (Vitest)
- `clientes.test.ts`: `legacyClientesHref` para las 4 rutas, con y sin `q`, e historial/por_llegar → `null`.
- `resolveGuestsView`: admin sin view → Clientes; recepción sin view → por_llegar.
- `nav-links.test.ts`: el admin tiene `/admin/clientes` y no `/admin/asociados`, `/admin/descuentos` ni `/admin/cuentas`.

**Verificación en PROD**
- Como admin, visitar las 4 URLs viejas y ver a dónde llevan.
- Como recepción: /admin/guests abre Por llegar y /admin/cuentas sigue en /forbidden.

👤 **AGUSTÍN:** confirmar que ya usaste Clientes sin problemas; mergear; pedirle a recepción que abra Por llegar desde el menú.

**Riesgos.** Borra 4 componentes que F5-4, F5-14 y F5-16 tenían en sus listas: se rehacen con grep al abrirlos. Los links del buscador (F1-5a) a las rutas viejas siguen andando por el redirect.

### F3-7 · Pasajeros de empresa y huéspedes sin ficha: que se puedan abrir ("Viaja por <empresa>")
**Rama:** `claude/clientes-sin-ficha` · **Carril:** H · **Depende de:** F3-5b · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Hoy 19 personas aparecen "de reservas" sin nada para abrir. En PROD las 19 son pasajeros de empresas: lo útil es llevar a la ficha de la empresa que pagó.

**Archivos**
- Modify: `src/lib/clientes.ts` — `viajaPor(estadias): { id; name } | null`: la empresa si todas las estadías fueron por empresa (con varias, la más reciente).
- Modify: `src/lib/data.ts` — `getClientList` agrega `viaja_por` a las personas sin ficha.
- Modify: `src/app/admin/clientes/ClientesTable.tsx` — "Viaja por <Empresa>" y "Ver empresa" (abre `?ficha=company:<id>` en Estadías); desaparece el "de reservas" gris (hoy en GuestDirectoryTable.tsx:140-144).
- Modify: `src/app/admin/guests/actions.ts` — `createGuestFromReservationsAction(dni)`.
- Modify: `src/__tests__/clientes.test.ts`, `src/app/admin/clientes/ClientesTable.test.tsx`.

**Pasos**
1. Test de `viajaPor` en rojo, después la función y la fila nueva.
2. Si no viaja por empresa (hoy 0 casos): "Crear ficha" toma la reserva más reciente con ese DNI normalizado, vuelve a chequear en el servidor que no haya un guest con ese DNI, inserta en `public.guests` (nombre, documento, tipo, teléfono, localidad, nacionalidad, domicilio, profesión) y abre la ficha.
3. No se toca `reservations.guest_id`: la ficha de persona ya busca también por DNI.

**Base de datos.** Sin migración: INSERT en `public.guests` con la sesión del admin (la misma RLS que ya usa `setGuestPersonalDiscount`).

**Aceptación**
- [ ] Ningún cliente de la lista queda sin algo para abrir.
- [ ] Un pasajero de empresa dice "Viaja por <Empresa>" y "Ver empresa" abre la ficha de esa empresa en Estadías.
- [ ] "Crear ficha" no duplica a alguien que ya tiene ficha con el DNI escrito distinto (con o sin puntos).

**Tests** (Vitest)
- `viajaPor`: todas por empresa; una sin empresa → `null`; dos empresas → la más reciente.
- `createGuestFromReservationsAction` con Supabase mockeado: si el DNI normalizado ya existe, no inserta y devuelve ese id.
- `ClientesTable.test.tsx`: una fila con `viaja_por` muestra "Viaja por X" y no "de reservas".

**Verificación en PROD**
- Personas sin ficha (el 23/09: 19, todas por empresa): `with r as (select 'dni:' || upper(regexp_replace(client_dni, '[^a-zA-Z0-9]', '', 'g')) as k, associated_client_id from public.reservations where status in ('checked_in', 'checked_out') and regexp_replace(coalesce(client_dni, ''), '[^a-zA-Z0-9]', '', 'g') <> ''), g as (select 'dni:' || upper(regexp_replace(document_id, '[^a-zA-Z0-9]', '', 'g')) as k from public.guests where document_id is not null) select count(distinct k), count(distinct k) filter (where associated_client_id is not null) from r where k not in (select k from g);`
- En Clientes › Personas, esas 19 dicen "Viaja por".

👤 **AGUSTÍN:** mergear (default: los 19 abren la ficha de su empresa).

**Riesgos.** Quien viajó una vez por empresa y otra por su cuenta queda con "Crear ficha". Es correcto, y el texto del botón lo tiene que aclarar.

### F3-8 · Notas pegadas de empresas → campos, y pista "Parece un CUIT"
**Rama:** `claude/clientes-notas-cuit` · **Carril:** H · **Depende de:** F3-4, F3-5b · **Migración:** no (la 123 queda reservada) · **Esfuerzo:** 1 día

**Por qué.** Tres empresas tienen el domicilio y la localidad enterrados en la nota importada ("CUIT | Dir | Loc | Nac | Prof"), y hay 6 huéspedes cargados con CUIT de empresa (3 con cuenta corriente) que nadie detecta.

**Archivos**
- Create: `src/lib/client-notes.ts` — `parseImportedNote(notes)`: `{ cuit?, dir?, loc?, nac?, prof?, resto } | null`, solo si hay "|" y al menos 2 etiquetas conocidas.
- Create: `src/lib/cuit-hint.ts` — `cuitHint(documentId, { hasCuit })`: 'empresa' | 'persona' | null. Exige 11 dígitos y verificador válido (`isValidCuit`, src/lib/arca/amounts.ts:91); 30/33/34 → empresa; 20/23/24/27 → persona solo si el CUIT de facturación está vacío.
- Modify: `src/app/admin/clientes/ClientesTable.tsx` — "Domicilio · Localidad" en vez de la nota cruda, y pastilla "¿Empresa?".
- Modify: `src/app/admin/clientes/ClienteFicha.tsx` — bloque "Datos que vinieron en la nota", "Usar como domicilio" y pistas de CUIT; `src/app/admin/clientes/ClienteFicha.test.tsx`.
- Create: `src/__tests__/client-notes.test.ts`, `src/__tests__/cuit-hint.test.ts` (CUIT ficticios de verificador válido, como 30-12345678-1 y 20-12345678-6; nunca de PROD).

**Pasos**
1. Tests de los dos helpers en rojo, después el código.
2. Ficha › Datos (empresa): cada dato de la nota por separado. Si falta el domicilio y hay Dir, "Usar como domicilio" llena el campo con "Dir, Loc"; se guarda recién con "Guardar cambios". La nota no se toca; Nacionalidad y Profesión quedan solo en ella.
3. Persona con pista 'empresa': "Parece el CUIT de una empresa" y "Crear empresa con estos datos" → AssociatedClientModal precargado, con el texto "La historia de este huésped queda donde está. Desde ahora, al reservar, elegí la empresa." No se busca ni se une nada por CUIT (mig 94).
4. Persona con pista 'persona': "¿Es su CUIT? Copiarlo al campo CUIT de facturación".

**Base de datos.** Por defecto ninguna. La 123 (`123_notas_importadas_a_domicilio.sql`) queda reservada por si Agustín prefiere completar en lote (hoy 1 fila): UPDATE del domicilio desde `notes` sin borrar `notes`, con `record_migration`, por `select public.exec_ddl($m123$ ... $m123$)` y solo con OK después de ver el SELECT de preview. Ningún código depende de ella. (La fase la numeraba 117; el plan maestro la pasa a 123.)

**Aceptación**
- [ ] La lista de empresas ya no muestra "CUIT … | Dir: … | Loc: …" pegado, sino domicilio y localidad.
- [ ] En la empresa sin domicilio aparece "Usar como domicilio": llena el campo y no guarda hasta "Guardar cambios".
- [ ] Un huésped con CUIT 30-… muestra "Parece el CUIT de una empresa" y puede crear la empresa; su historia no se mueve.
- [ ] Un huésped con documento 20-… y sin CUIT cargado ofrece copiarlo.

**Tests** (Vitest)
- `client-notes.test.ts`: nota de 5 partes → 5 campos; nota libre → `null`; sin Loc → `loc` undefined; mayúsculas y espacios raros.
- `cuit-hint.test.ts`: verificador inválido → `null`; 30 → empresa; 20 con CUIT cargado → `null`; 8 dígitos → `null`.
- `ClienteFicha.test.tsx`: "Usar como domicilio" no llama a la action hasta guardar; "Crear empresa con estos datos" abre el modal precargado.

**Verificación en PROD**
- `select count(*) from public.associated_clients where notes like '%|%';` (hoy 3): mirar esas 3 fichas.
- `select count(*) from public.guests where length(regexp_replace(coalesce(document_id, ''), '\D', '', 'g')) = 11 and left(regexp_replace(document_id, '\D', '', 'g'), 2) in ('30', '33', '34');` (hoy 6): las 6 muestran la pista.

👤 **AGUSTÍN:** mergear y completar a mano el domicilio de la empresa que no lo tiene (o pedir la 123 y dar el OK).

**Riesgos.** Crear la empresa sin mover la historia deja por un tiempo la cuenta corriente de ese cliente partida en dos (huésped viejo y empresa nueva). Es a propósito: mover historia sería una migración de datos aparte.

**Fusionados o descartados**
- Ninguno de F3. F3-3 y F3-5 se partieron por tamaño (crítico): F3-3a/F3-3b y F3-5a/F3-5b.
- Quedan fuera de F3: fusionar "Emitidas" con la solapa Facturas (restricción); una "Nueva consolidada" con formulario vacío (la ficha enlaza siempre con el cliente puesto); cambiar los mensajes de las RPC que dicen "imputar" (migs 109, 111 y 114); mover la historia de un huésped que en realidad es empresa; crearles ficha a los 19 pasajeros (F3-7 los lleva a su empresa).

---

## Fase 4 — Hoy, tarjeta de habitación, mantenimiento y calendario

Esta fase ordena las pantallas que recepción y mantenimiento usan todo el día: Hoy pasa a tener una sola lista "Para atender" por gravedad, contadores que filtran la grilla y una línea de pulso solo para el dueño; la tarjeta de habitación queda con una acción principal y un menú "⋯", y se cancela siempre con el mismo cuadro. Mantenimiento gana un modal que se usa bien en el celular, refresco automático y "Reportar desperfecto", que llega a la campana del admin, y el calendario se vuelve legible. Se reparte en cuatro carriles, 12 días en total: A (F4-2, F4-3 y F4-4, al final de la fila de RoomCard), E (F4-1a, F4-1b, F4-5 y F4-6, sobre `admin/page.tsx`), G (F4-7 y F4-8, con la 121, única migración de la fase) e I (F4-9).

> Las líneas citadas son de `a918c70`. Cuando la fase arranque, el carril A ya habrá movido RoomCard (F0-3 a F2-7a): ubicar por texto, no por número.

### F4-2 · Un solo diálogo para cancelar: motivos fijos, lo que se deja de cobrar a la vista y WhatsApp solo cuando corresponde

**Rama:** `claude/cancelar-dialogo-unico` · **Carril:** A · **Depende de:** F2-7a, F2-3 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Hoy hay cuatro formas de cancelar y el motivo se escribe a mano ("." o "mal cargado"), y ese texto le llega al pasajero por WhatsApp. Con un solo cuadro, el motivo sale de una lista, se ve si se le avisa al pasajero y se ve cuánta plata se deja de cobrar antes de confirmar.

**Archivos**
- Modify: `src/lib/cancel-reasons.ts` — `STAY_CANCEL_REASONS`, `resolveCancelReason`, `canCancelReservation`, `cancelActionLabel`.
- Modify: `src/lib/whatsapp-messages.ts` — `shouldNotifyCancellation({ phone, notifyGuest })`.
- Modify: `src/app/admin/actions.ts` — `handleCancelReservation(id, reason, options?: { notifyGuest?: boolean })`, con default `true`.
- Create: `src/app/admin/CancelReservationDialog.tsx` — el cuadro único.
- Modify: `src/app/admin/RoomCard.tsx` — fuera el estado y el modal propios de cancelar (107-113, 406-427, 948-986).
- Modify: `src/app/admin/calendario/CalendarClient.tsx` — fuera 162, 210-224 y el textarea en línea (821-846); `canCancelSelected` (292-294) usa `canCancelReservation`.
- Modify: `src/app/admin/solicitudes/SolicitudesClient.tsx` — el camino "cancel" (50-58, 153-200, 347-349) pasa al cuadro con `variant="solicitud"`.
- Modify: `src/app/admin/guests/GuestsClientTable.tsx` — fuera 27-45 y 210-270; `canCancel` (66) usa `canCancelReservation`.
- Modify: `src/lib/data.ts` — `has_phone` en el mapeo de `getDashboardData` (961-979).
- Modify: `src/app/admin/page.tsx` — `hasPhone` en `DashboardRoom` (una línea: rebase contra el carril E).

**Pasos**
1. Motivos de estadía: `no_se_presento`, `cargada_por_error`, `cambio_de_habitacion`, `cambio_de_fecha`, `pasajero_cancelo`, `otro`, con `label`, `notifyGuest` (true solo en `pasajero_cancelo`) y `hint` ("Usá Cambiar de habitación: no hace falta cancelar"; "Usá Editar reserva" en cargada por error y cambio de fecha). `resolveCancelReason('otro', texto)` pide 5 letras o más. `CANCEL_REASON_OPTIONS` y `translateCancelReason` quedan para Solicitudes (tienen portugués).
2. `canCancelReservation(status, role, opts?: { closedStays?: boolean })`: pending → staff; confirmed y checked_in → admin; checked_out → admin solo con `closedStays`, que pasa únicamente Huéspedes › Historial (como hoy; el calendario sigue sin ofrecerlo); cancelled → nadie. Sin respuesta a Q7, el admin no pierde nada y recepción no gana nada.
3. Con `notifyGuest: false`, `handleCancelReservation` saltea el webhook (386-406) y devuelve `whatsappSent: false`.
4. El cuadro: radios grandes, textarea solo en "Otro", la pista, y si es confirmed o checked_in con total mayor a lo pagado, "Se deja de cobrar $X: la reserva queda en lo ya pagado ($Y)" (la RPC de la mig 102 baja el total a lo pagado). Dice "Se le avisa al pasajero por WhatsApp", "No se le avisa al pasajero" o "No tiene teléfono cargado". Botones "Volver" y "Sí, cancelar" (rojo, apagado hasta que el motivo sirva). `role="dialog"`, `aria-modal="true"`, alto máximo con scroll. Si `canCancelReservation` da false, no se dibuja.
5. Variantes: `solicitud` para reservas pending (los 3 motivos de cliente, WhatsApp siempre, botón "Rechazar solicitud") y `estadia` para el resto. Tildes en todo lo tocado ("cancelación", "canceló").

**Aceptación**
- [ ] En la tarjeta, el calendario, Solicitudes y Huéspedes › Historial se cancela con el mismo cuadro.
- [ ] El motivo se elige de la lista; con "Otro" hay que escribir al menos 5 letras ("." no pasa).
- [ ] "Cambio de habitación" muestra la pista de usar Cambiar de habitación.
- [ ] Si la estadía debe plata, el cuadro dice cuánto se deja de cobrar antes de confirmar.
- [ ] Con "Cargada por error" o "Cambio de habitación" no sale ningún WhatsApp, y el cuadro lo dice.
- [ ] Rechazar una solicitud web avisa al cliente igual que hoy (en portugués si corresponde).
- [ ] Recepción solo ve "Rechazar solicitud" en reservas pendientes.

**Tests** (Vitest)
- `src/__tests__/cancel-reasons.test.ts` (Create): matriz de `canCancelReservation` (admin y receptionist × 5 estados, con y sin `closedStays`); `resolveCancelReason('otro', '.')` da null; `notifyGuest` es true solo en `pasajero_cancelo`.
- `src/__tests__/whatsapp-messages.test.ts` (Modify): `shouldNotifyCancellation` da false sin teléfono o con `notifyGuest: false`.
- `src/app/admin/CancelReservationDialog.test.tsx` (Create; `vi.mock('./actions')`; buscar por texto o aria-label, no con `getByRole` sobre toda la pantalla): "Sí, cancelar" apagado sin motivo; checked_in con total 50.000 y pagado 20.000 muestra "Se deja de cobrar $30.000,00"; confirmar llama a `handleCancelReservation(id, 'Cargada por error', { notifyGuest: false })`; la variante solicitud llama con `notifyGuest: true`; checked_out sin `closedStays` no renderiza.

**Verificación en PROD**
- Después del deploy (en `npm run dev` los client components de página no hidratan): ver el cuadro en `/admin`, `/admin/calendario`, `/admin/solicitudes` y `/admin/guests?view=historial`.
- Tras la primera cancelación real: `select reason, previous_status, cancelled_at from public.reservation_cancellations order by cancelled_at desc limit 5` (el motivo es una etiqueta fija).
- A la semana: `select count(*) from public.reservation_cancellations where cancelled_at > now() - interval '7 days' and length(btrim(reason)) < 5` → 0.

👤 **AGUSTÍN:** contestar Q7 (por defecto conservás la cancelación de estadías cerradas desde Historial); revisar y mergear; avisarle a recepción que un cambio de habitación no se hace cancelando.

**Riesgos.** Cambia la firma de una server action que usan 4 pantallas: el default `true` deja Solicitudes igual. Es el último del carril A que toca CalendarClient, SolicitudesClient y GuestsClientTable: los cierra antes de F4-9 y F5-14.

### F4-3 · Tarjeta de habitación: una acción principal por estado, pasajero primero y empresa en chip

**Rama:** `claude/tarjeta-accion-principal` · **Carril:** A · **Depende de:** F4-2 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Cada tarjeta muestra un solo botón fuerte con lo que toca hacer, sin "Hacer Check-In Automático" y sin el check-out que se pone gris justo cuando la salida está atrasada. En las estadías de empresa se lee primero quién duerme y después quién paga.

**Archivos**
- Create: `src/lib/room-card.ts` — `roomCardView(room, { isAdmin })`: píldora, acción principal y aviso por estado.
- Modify: `src/app/admin/RoomCard.tsx` — cabecera y píldora (441-489), bloque del huésped (492-517 y 610-624), check-out siempre primario (540-549), llegada y libre (595-683), limpieza y fuera de servicio (685-725), textos de 437 y 495.

**Pasos**
1. `roomCardView(room: DashboardRoom, opts: { isAdmin: boolean })` devuelve `{ pill: { label; tone }; primary: { kind; label; weight: 'solid' | 'outline'; tone: 'brand' | 'amber' } | null; notice?: string }`.
2. Píldoras: "Libre", "Llega hoy", "Falta check-in", "Ocupada", "Salida atrasada", "Con medio día" (reemplaza "Late Check-out"), "Limpieza", "Fuera de servicio".
3. Acción principal: libre → "Hacer check-in" (outline brand, para no llenar la grilla de botones sólidos); llegada de persona → "Registrar llegada de {nombre}" (sólido brand-700, truncado con `title` completo; reemplaza 649); empresa sin pasajero → "Hacer check-in y cargar pasajero"; llegada atrasada → la misma etiqueta en ámbar, sin tocar "No la asignes a otro pasajero" (636-640); ocupada → "Hacer check-out" sólido brand-700 siempre (se borra el gris de 543-545) y, si está atrasada, la línea "Debía salir {hora}"; limpieza → admin "Marcar lista", recepción el texto de siempre; fuera de servicio → admin "Marcar disponible" (outline).
4. Bloque del huésped: el pasajero primero y grande; si `billedToCompany`, chip con `Building2` y `reservationCompany?.display_name ?? 'Empresa'` (122-124). Con `passengerPending`: "Pasajero a definir" en cursiva, "Se carga al hacer el check-in" y el chip. Se conserva el chip de tarifa que puso F1-4.
5. Un solo verde: `green-*` y `emerald-*` (467-468, 513, 602-631, 646, 667) pasan a `brand-*`. Ámbar queda para lo atrasado, azul para ocupada y rojo para cancelar.
6. Textos: "Huesped" → "Huésped" (495); el toast de 437 pasa a "Habitación lista.". La fila de secundarios no se toca: la rearma F4-4.

**Aceptación**
- [ ] Cada tarjeta tiene un solo botón fuerte: "Registrar llegada de Ana Prueba", "Hacer check-out", "Marcar lista" o "Hacer check-in" (liviano, en una libre).
- [ ] Con la salida atrasada, "Hacer check-out" sigue siendo el botón fuerte y la tarjeta dice "Debía salir 10:00".
- [ ] En una estadía de empresa se lee primero el pasajero y la empresa va en un chip; sin pasajero cargado dice "Pasajero a definir".
- [ ] Libre y "Llega hoy" usan el mismo verde de marca.
- [ ] No aparecen más "Hacer Check-In Automático" ni "Late Check-out".

**Tests** (Vitest)
- `src/__tests__/room-card.test.ts` (Create): `roomCardView` para cada estado; con `isLate` el primary sigue `solid` y `brand`; empresa sin pasajero da "Hacer check-in y cargar pasajero" con notice; limpieza como recepción da primary null; nombre largo.
- `src/app/admin/RoomCard.test.tsx` (Modify; si el carril A todavía no lo creó, Create; mocks de `./actions`, `../components/PaymentModal`, `CheckoutFlow` y los modales; buscar por texto): llegada de persona muestra "Registrar llegada de Ana Prueba"; ocupada atrasada: "Hacer check-out" con `bg-brand-700` y "Debía salir"; empresa con pasajero muestra el chip "Empresa Demo SA"; nunca aparece "Automático".

**Verificación en PROD**
- Después del deploy, `/admin` como recepción: recorrer una tarjeta de cada estado.
- Llegada de empresa sin pasajero: `select ro.room_number, r.check_in_target from public.reservations r join public.rooms ro on ro.id = r.room_id where r.status = 'confirmed' and r.associated_client_id is not null and r.company_passenger_id is null order by r.check_in_target limit 3`.
- Salida atrasada: `select ro.room_number from public.reservations r join public.rooms ro on ro.id = r.room_id where r.status = 'checked_in' and coalesce(r.late_check_out_until, r.check_out_target) < now()`.

👤 **AGUSTÍN:** revisar y mergear; mostrarle a recepción los textos nuevos de los botones (sobre todo "Registrar llegada de …").

**Riesgos.** Si la empresa está inactiva, `getActiveAssociatedClients` no la trae y el chip dice "Empresa" a secas. Los nombres largos se truncan (con `title`). Va detrás de F4-2 en RoomCard.

### F4-4 · Tarjeta de habitación: fila de secundarios, menú "⋯" y un solo camino para el medio día

**Rama:** `claude/tarjeta-secundarios-menu` · **Carril:** A · **Depende de:** F4-3, F2-2 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Una tarjeta ocupada tiene hoy 6 o 7 botones del mismo peso, y "Cobrar Medio Día" hace lo mismo que Ampliar › Medio día. Menos botones es menos errores de mostrador.

**Archivos**
- Create: `src/app/admin/OverflowMenu.tsx` — menú "⋯" accesible.
- Modify: `src/app/admin/RoomCard.tsx` — fuera `onLateCheckout` (196-213), el botón "Cobrar Medio Dia" (520-528) y la grilla vieja de secundarios con el link de cancelar (551-591); fila nueva de secundarios; `OverflowMenu` en ocupada, llegada y libre; el modal Ampliar puede abrir con "Medio día" elegido.

**Pasos**
1. Borrar "Cobrar Medio Dia" y `onLateCheckout`: el único camino queda Ampliar › Medio día (`submitExtend` ya llama a `handleLateCheckOut`, y la mig 100 evita cobrar dos veces la misma tarde).
2. Si `room.canChargeLateCheckout`, "Ampliar" abre con `extendMode = 'half_day'`, y la tarjeta muestra debajo de "Debía salir": "Si se queda la tarde: Ampliar › Medio día ($X)" con `room.halfDayPrice`. Los dos botones de modo llevan `aria-pressed`. Se conservan el stepper de F0-6 y la vista previa de F2-2.
3. Fila de secundarios con el mismo peso (outline slate, ícono y texto): Ampliar · Extra · Cobrar. "Cobrar" es el que ya puso F2-3: se ubica acá, no se rehace.
4. `OverflowMenu` recibe `{ label: string; items: { key; label; icon?; tone?: 'danger'; onSelect(): void }[] }`: botón con `aria-label="Más acciones de Hab. {n}"`, `aria-haspopup="menu"` y `aria-expanded`; panel `role="menu"` con `role="menuitem"`; se cierra con Escape, click afuera o al elegir; el foco va al primer ítem; abre hacia arriba si no entra abajo.
5. Ítems: ocupada → "Cambiar de habitación" (staff), "Editar reserva" (admin), separador y "Cancelar reserva" (rojo, último, abre el cuadro de F4-2); llegada → "Editar reserva" (admin) y "Cancelar reserva" (hoy en 652-660); libre → "Poner fuera de servicio" (admin; hoy en 671-679). "Cancelar reserva" sale de `canCancelReservation` (F4-2), no de un `isAdmin` suelto. Sin ítems, el "⋯" no se dibuja.

**Aceptación**
- [ ] En una ocupada se ve "Hacer check-out" fuerte, una fila "Ampliar · Extra · Cobrar" y un "⋯".
- [ ] "Cobrar Medio Día" ya no existe; si pasó la hora de salida, "Ampliar" abre con "Medio día" elegido y la tarjeta muestra el precio.
- [ ] El "⋯" tiene "Cambiar de habitación"; el admin ve además "Editar reserva" y, al fondo y en rojo, "Cancelar reserva".
- [ ] El menú se cierra con Escape o tocando afuera, y en el celular no se sale de la pantalla.

**Tests** (Vitest)
- `src/app/admin/OverflowMenu.test.tsx` (Create): abre con click; Escape cierra; elegir llama a `onSelect` y cierra; el ítem `danger` va último; `aria-expanded` cambia.
- `src/app/admin/RoomCard.test.tsx` (Modify): no existe el texto "Cobrar Medio"; con `canChargeLateCheckout`, al tocar "Ampliar" el botón "Medio día" queda `aria-pressed="true"`; recepción no tiene "Editar reserva" ni "Cancelar reserva" en una ocupada; en el admin "Cancelar reserva" es el último ítem.

**Verificación en PROD**
- Después del deploy, una ocupada con la hora de salida pasada: `select ro.room_number from public.reservations r join public.rooms ro on ro.id = r.room_id where r.status = 'checked_in' and r.late_check_out_until is null and r.check_out_target < now()`.
- Tras el primer medio día cobrado desde Ampliar: `select reservation_id, count(*) from public.extra_charges where charge_type = 'half_day' group by 1 having count(*) > 1` → sin filas.

👤 **AGUSTÍN:** revisar y mergear; avisarle a recepción que el medio día ahora está en Ampliar.

**Riesgos.** Costumbre: recepción buscaba "Cobrar Medio Día" (va en el mensaje de capacitación). Un menú en las tarjetas del fondo de la grilla puede quedar cortado: por eso abre hacia arriba. Es el último PR funcional sobre RoomCard antes de F5-11b.

### F4-1a · Hoy: una sola lista "Para atender" con los avisos que ya existen

**Rama:** `claude/hoy-para-atender` · **Carril:** E · **Depende de:** P1, F1-3, F1-6 · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** Recepción ve tres carteles de distinto color apilados arriba de las habitaciones y no sabe qué atender primero. Con una sola lista por gravedad, lo que es plata queda arriba y en rojo, y el admin llega a sus avisos con un toque.

**Archivos**
- Create: `src/lib/attention.ts` — tipos, `buildAttentionItems`, `sortAttentionItems`, `formatLateCheckoutBadge`.
- Create: `src/app/admin/AttentionList.tsx` — la lista "Para atender (N)", plegable.
- Create: `src/app/admin/RegularizeOccupiedRoom.tsx` — "Cargar la estadía" + WalkInModal con fecha retroactiva, sacado del banner.
- Create: `src/app/admin/dashboard-types.ts` — `export type DashboardRoom` (hoy local en `page.tsx` 33-73 y copiado en `RoomCard.tsx` 37-80).
- Delete: `src/app/admin/OccupiedRoomAlertBanner.tsx` — tal como lo deja P1 (abiertos y cerrados).
- Modify: `src/app/admin/page.tsx` — los carteles (235-300) pasan a `<AttentionList>`; badge del encabezado (214-221).
- Modify: `src/lib/data.ts` — `getUnresolvedAdminAlerts()` con `cache()`; `getUnresolvedAdminAlertsCount` se mantiene y sale de ella.
- Modify: `src/app/admin/RoomCard.tsx` — `id="hab-{number}"` en el contenedor (442) y `room` tipado con `DashboardRoom`.

**Pasos**
1. `buildAttentionItems({ rooms, occupancyAlerts, pendingSolicitudes, adminAlerts?, nowIso, timezone })`, puro. CRÍTICA `ocupada_sin_estadia`: una fila por aviso con `resolved_at` null. ALTA `salida_atrasada` por habitación `isLate` ("Hab. 5 · debía salir 10:00"), `falta_check_in` por `arrivalIsOverdue` ("reservó para el 21/09") y `tarifa_para_autorizar` (solo admin). MEDIA `solicitudes_web` (a `/admin/solicitudes`) y `avisos_admin` (solo admin: el resto de los kinds, sin contar el de ocupada ni el de tarifa).
2. `getUnresolvedAdminAlerts = cache(...)` sobre `rpc_list_admin_alerts(true)`, `[]` si falla; `getUnresolvedAdminAlertsCount()` devuelve su largo. La campana del layout (F1-3) y Hoy hacen una sola llamada por request, y para recepción no se pide.
3. `AttentionList`: `<section aria-labelledby>` con filas de una línea (franja rose-500, amber-500 o sky-500, ícono, título, detalle y acción). Siempre las críticas y las altas, hasta 2 medias y el resto detrás de "Ver N más". Sin ítems, no se dibuja.
4. Acciones: las filas con habitación llevan a `#hab-5`; "tarifa para autorizar" y "avisos" usan `OpenAlertsButton` de F1-3 (evento `admin:abrir-avisos`), no `/admin/mantenimiento`. En la pieza usada sin estadía, el admin ve "Cargar la estadía" y recepción "Lo resuelve el administrador". `RegularizeOccupiedRoom` recibe lo mismo que hoy el banner (precios por habitación, empresas, zona horaria).
5. Los avisos de ocupada cerrados en las últimas 48 h (los trae P1) no cuentan en N: van plegados al final en gris, "Resueltos hace poco (N)", con el desenlace ("Se cargó la estadía" si `decision = 'regularizada'`; si no, "Se cerró sin cobrar" y la nota).
6. `page.tsx`: fuera los tres carteles; el badge usa `formatLateCheckoutBadge`. El título de 213 no se toca (es de F1-1b) y `OpenShiftAgeAlert` sigue en el layout.

**Aceptación**
- [ ] Arriba de las habitaciones hay un solo bloque "Para atender": primero lo rojo, después lo ámbar y al final lo azul.
- [ ] El admin carga la estadía de una pieza usada con "Cargar la estadía" (mismo modal y mensajes) y el aviso pasa a "Resueltos hace poco" como "Se cargó la estadía".
- [ ] Recepción ve la pieza usada sin estadía con "Lo resuelve el administrador", sin botón.
- [ ] El admin ve "N pedidos de tarifa para autorizar" y "N avisos para revisar"; tocarlos abre la campana, y la pieza sin estadía no se cuenta dos veces.
- [ ] El badge dice "1 check-out atrasado" o "2 check-outs atrasados".
- [ ] En el celular, sin avisos, la primera habitación se ve sin scrollear; si no hay nada para atender, el bloque no aparece.

**Tests** (Vitest)
- `src/__tests__/attention.test.ts` (Create): la ocupada abierta es `critica` y va primera; una con `resolved_at` no da fila; `avisos_admin` excluye el kind de ocupada y el de tarifa; sin `adminAlerts` (recepción) no hay ítems de admin; el orden es estable; `formatLateCheckoutBadge(1)` y `(2)`.
- `src/app/admin/AttentionList.test.tsx` (Create; mocks de `./actions`, `./WalkInModal` y `./OpenAlertsButton`; buscar por texto): 2 críticas + 1 alta + 4 medias muestran 5 filas y "Ver 2 más"; el click expande; admin ve "Cargar la estadía" y recepción "Lo resuelve el administrador"; lista vacía no renderiza.

**Verificación en PROD**
- Después del deploy, `/admin` como recepción y como admin, contra `select count(*) from public.admin_alerts where kind = 'room_occupied_without_active_reservation' and resolved_at is null`, `select count(*) from public.reservations where status = 'checked_in' and coalesce(late_check_out_until, check_out_target) < now()` y `select count(*) from public.reservations where status = 'pending'`.
- Tras una regularización real: `select id, decision, resolved_at from public.admin_alerts where kind = 'room_occupied_without_active_reservation' order by id desc limit 3` (`decision = 'regularizada'`, gracias a la 117 de P1).

👤 **AGUSTÍN:** confirmar que la 117 está aplicada y P1 mergeado antes de que arranque; revisar y mergear; mirar Hoy con la recepcionista de la mañana y preguntarle si entiende qué va primero.

**Riesgos.** Es la pantalla más usada y cambia de formato (mismos colores, mismo botón). Es la primera mitad del F4-1 original, que el crítico partió por tamaño. `admin/page.tsx` también lo tocan F1-1b, F1-3, F1-4 y F4-2 con cambios chicos: el que llega después rebasea. Si F1-4 entró antes, `DashboardRoom` ya trae `tariffRequest` y se muda tal cual.

### F4-1b · Hoy: "Facturas que no salieron" y "Sale hoy con saldo" en Para atender

**Rama:** `claude/hoy-facturas-y-saldos` · **Carril:** E · **Depende de:** F4-1a, F1-1a · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Una factura rechazada o trabada, o un pasajero que se va hoy debiendo, son plata que se pierde si nadie los ve a tiempo. Con esto aparecen en "Para atender", con el mismo número que muestra el menú.

**Archivos**
- Modify: `src/lib/attention.ts` — kinds `facturas_no_salieron` y `sale_hoy_con_saldo`.
- Modify: `src/app/admin/dashboard-types.ts` — `DashboardRoom` suma `effectiveCheckOutIso` y `debt`.
- Modify: `src/app/admin/page.tsx` — llena esos campos en el mapeo (123-158) y suma `listPendingInvoices().catch(() => [])` al `Promise.all` (80-90).
- Modify: `src/lib/data.ts` — `listPendingInvoices` envuelta en `cache()`, si F1-1a no lo hizo (el layout ya la pide).

**Pasos**
1. `facturas_no_salieron` (CRÍTICA): una fila "N facturas no salieron", contada con `facturasConError(rows, now)` de `billing.ts` (F1-1a): rechazadas, y pendientes o en proceso de más de 15 minutos. Lleva a `/admin/fiscal?view=pendientes` (Facturación › Con error). Recepción ve solo las de su turno: la RPC ya filtra desde la mig 80.
2. `effectiveCheckOutIso = late_check_out_until ?? check_out_target` y `debt = max(0, totalPrice − paidAmount)`, solo para la estadía activa.
3. `sale_hoy_con_saldo` (ALTA): `checked_in`, `hotelDateKey(effectiveCheckOutIso, tz)` hoy o antes y `debt > 0`: "Hab. 5 · sale hoy · debe $30.000,00" (`formatAmount`). Si la habitación ya tiene `salida_atrasada`, va en la MISMA fila: "Hab. 5 · debía salir 10:00 · debe $30.000,00".
4. Los que se van otro día no aparecen aunque deban: la lista completa sigue en Tablero › Cobros del día ("Deben los alojados", F1-9).

**Aceptación**
- [ ] Con una factura rechazada, o trabada más de 15 minutos, Hoy muestra "N facturas no salieron" en rojo, con el mismo número que la pestaña "Con error".
- [ ] Una factura que se está emitiendo hace 2 minutos no aparece.
- [ ] La recepcionista ve solo las facturas de su turno; el dueño ve todas.
- [ ] El que sale hoy (o ya debía salir) y debe plata aparece con el monto; una salida atrasada con saldo es UNA sola fila.
- [ ] Los alojados que se van otro día no aparecen.

**Tests** (Vitest)
- `src/__tests__/attention.test.ts` (Modify): una `pending` de hace 2 min no cuenta y una `rejected` sí; `sale_hoy_con_saldo` en hora del hotel (America/Argentina/Tucuman) con casos a las 23:30 y a las 00:30; salida atrasada con saldo da una sola fila; sin saldo, ninguna.
- `src/app/admin/AttentionList.test.tsx` (Modify): la fila de facturas lleva a `/admin/fiscal?view=pendientes`.

**Verificación en PROD**
- Después del deploy, comparar la fila y el número del menú con `select count(*) from public.invoices where status = 'rejected' or (status in ('pending','processing') and created_at < now() - interval '15 minutes')`.
- `select ro.room_number, r.total_price - r.paid_amount as debe from public.reservations r join public.rooms ro on ro.id = r.room_id where r.status = 'checked_in' and r.total_price > r.paid_amount and (coalesce(r.late_check_out_until, r.check_out_target) at time zone 'America/Argentina/Tucuman')::date <= (now() at time zone 'America/Argentina/Tucuman')::date`.

👤 **AGUSTÍN:** revisar y mergear; confirmar con recepción que "sale hoy con saldo" le sirve para cobrar antes de que el pasajero se vaya.

**Riesgos.** Suma `listPendingInvoices` a cada carga de Hoy: va con `cache()` y `.catch(() => [])` para que un error no deje sin tablero. Si `facturasConError` cambia, el menú y Hoy cambian juntos, que es lo que se busca.

### F4-5 · Hoy: contadores que filtran la grilla (Libres · Llegan hoy · Salen hoy · Ocupadas · Por limpiar)

**Rama:** `claude/hoy-filtros-grilla` · **Carril:** E · **Depende de:** F4-1b · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** "Total Habitaciones" no le sirve a nadie. Tocar "Salen hoy" y ver solo esas tarjetas le ahorra tiempo a la recepcionista a la mañana.

**Archivos**
- Create: `src/lib/today-rooms.ts` — `TodayFilter`, `matchesTodayFilter`, `countTodayFilters`.
- Create: `src/app/admin/RoomGrid.tsx` — fila de chips-filtro + grilla de `RoomCard`.
- Modify: `src/app/admin/page.tsx` — fuera las tres tarjetas y el h2 (301-324); `<RoomGrid>` y lectura de `?ver=`.

**Pasos**
1. `TodayFilter = 'todas' | 'libres' | 'llegan' | 'salen' | 'ocupadas' | 'limpieza'`. Libres = `available` sin llegada pendiente; llegan = `hasPendingArrival` (incluye atrasadas); salen = ocupada con `hotelDateKey(effectiveCheckOutIso)` hoy o antes (campo de F4-1b); ocupadas = `occupied`; limpieza = `cleaning`. Las `maintenance` solo cuentan en "todas".
2. `RoomGrid` (cliente): chips toggle con `aria-pressed` y el número ("Salen hoy 4"); en el celular, una sola línea con scroll horizontal. Tocar el chip activo vuelve a "Todas". Sin resultados, un mensaje según el filtro ("No hay habitaciones que salgan hoy").
3. `page.tsx` lee `searchParams.ver` y lo pasa como `initialFilter`: es un parámetro opcional de `/admin`, no una URL nueva. La fila "sale hoy con saldo" puede llevar a `/admin?ver=salen`.

**Aceptación**
- [ ] Arriba de la grilla hay una fila "Todas 14 · Libres 3 · Llegan hoy 2 · Salen hoy 4 · Ocupadas 8 · Por limpiar 1".
- [ ] Al tocar "Salen hoy" quedan solo esas tarjetas y el chip se ve marcado; al volver a tocarlo se ven todas.
- [ ] "Salen hoy" incluye las que ya debían haber salido.
- [ ] En el celular la fila de chips ocupa una sola línea (se desliza de costado).
- [ ] Ya no aparece "Total Habitaciones".

**Tests** (Vitest)
- `src/__tests__/today-rooms.test.ts` (Create): 14 habitaciones de prueba dan los contadores esperados; "salen" incluye la atrasada y excluye la de mañana; borde de medianoche en hora de Tucumán (23:30 y 00:30); `maintenance` solo en "todas".
- `src/app/admin/RoomGrid.test.tsx` (Create; mock de `./RoomCard` que dibuja el número; buscar por texto): "Salen hoy" deja solo esas; `aria-pressed` cambia; `initialFilter="salen"` arranca filtrado; filtro vacío muestra el mensaje.

**Verificación en PROD**
- Después del deploy, `/admin` contra `select status, count(*) from public.rooms where is_active group by status`.
- Salen hoy: `select count(*) from public.reservations where status = 'checked_in' and (coalesce(late_check_out_until, check_out_target) at time zone 'America/Argentina/Tucuman')::date <= (now() at time zone 'America/Argentina/Tucuman')::date`.
- Abrir `/admin?ver=salen` en el celular.

👤 **AGUSTÍN:** revisar y mergear; mirar en el celular que la fila de chips no ocupe más de una línea.

**Riesgos.** "Llegan hoy" usa `findPendingArrival` (incluye las llegadas de anoche): un SELECT por fecha puede dar distinto y no es un error. Toca `admin/page.tsx` entre F4-1b y F4-6.

### F4-6 · Hoy: línea de pulso para el dueño (Cobrado hoy · Ocupación 30 días · Falta facturar · Cuenta corriente)

**Rama:** `claude/hoy-pulso-admin` · **Carril:** E · **Depende de:** F4-5, F1-9 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** En una línea, el dueño ve cómo va el hotel y llega con un toque a la pantalla de cada número, sin tarjetas grandes que tapen las habitaciones en el celular.

**Archivos**
- Modify: `src/lib/analytics.ts` — extrae `occupancyRateForWindow` y lo usa dentro de `computeWindowKpis` (309-386).
- Modify: `src/lib/billing.ts` — `summarizeDayPayments(payments)` → `{ total, money, nonMoney }` (vale blanco y cuenta corriente van a `nonMoney`).
- Modify: `src/app/admin/finances/page.tsx` — el cálculo de 101-111 pasa a `summarizeDayPayments`.
- Modify: `src/lib/data.ts` — `getAdminPulse()`; `cache()` en `countBillingPending`; fuera `get_today_extra_income` y `todayIncome` de `getDashboardData` (157, 931, 997, 1007), que Hoy pide y no usa.
- Create: `src/app/admin/AdminPulse.tsx` — componente de servidor con los 4 links.
- Modify: `src/app/admin/page.tsx` — `<Suspense><AdminPulse /></Suspense>` solo si `isAdmin`, entre "Para atender" y los chips.

**Pasos**
1. `getAdminPulse(): Promise<{ cobradoHoy; ocupacion30d; faltaFacturar; ctaCteDeuda }>`, cada uno `number | null`: cada métrica falla por separado y se ve "—".
2. Cobrado hoy = `money` de los pagos del día en hora del hotel: lo mismo que "en dinero" de Cobros del día, sin los pagos a cuenta de empresas.
3. Ocupación 30 días = `occupancyRateForWindow` sobre [hoy−29, hoy], con el mismo filtro de reservas que `getManagementDashboardData`.
4. Falta facturar = `totalPendingBilling(countBillingPending(BILLING_PENDING_DAYS))`, el mismo número que el badge de Por facturar.
5. Cuenta corriente = suma de saldos positivos de `getCtaCteAccounts()`: solo cuenta corriente, no "reservas − cobrado" (decisión 1).
6. Links a `/admin/finances`, `/admin/analytics`, `/admin/fiscal/control` y `/admin/cuentas`, en una línea `text-sm` (dos en el celular), nunca tarjetas. Si F3-6 ya convirtió `/admin/cuentas` en redirect, el link queda igual.

**Aceptación**
- [ ] El dueño ve en Hoy "Cobrado hoy $X · Ocupación 30 días 62 % · Falta facturar 12 · Cuenta corriente $Y", y cada parte lleva a su pantalla.
- [ ] Cada número coincide con la pantalla a la que lleva.
- [ ] La recepcionista NO ve la línea, y el servidor ni la consulta para ella (arqueo a ciegas, PR #129).
- [ ] La grilla aparece aunque el pulso tarde; si un número falla, se ve "—".

**Tests** (Vitest)
- `src/__tests__/analytics.test.ts` (Modify): `occupancyRateForWindow` da lo mismo que `computeWindowKpis(...).occupancyRate.current` con los mismos datos.
- `src/__tests__/billing.test.ts` (Modify): `summarizeDayPayments` separa vale blanco y cuenta corriente.
- `src/app/admin/AdminPulse.test.tsx` (Create; `vi.mock('@/lib/data')`; se renderiza `await AdminPulse()`): 4 links con los href correctos, "—" si una métrica es null y montos en formato es-AR.

**Verificación en PROD**
- Después del deploy, `/admin` como admin contra `/admin/finances`, `/admin/analytics` (30 días), el badge de Por facturar y `/admin/cuentas`; como recepción, la línea no está.
- Cobrado hoy: `select coalesce(sum(amount),0) from public.payments where created_at >= ((now() at time zone 'America/Argentina/Tucuman')::date)::timestamp at time zone 'America/Argentina/Tucuman' and payment_method not in ('vale_blanco','cuenta_corriente')`.

👤 **AGUSTÍN:** revisar y mergear; confirmar que los 4 números te sirven.

**Riesgos.** Suma 4 o 5 consultas a Hoy para el admin: por eso va en `Suspense` y solo para admin. Si alguien cambia `computeWindowKpis` sin el helper, el pulso y el Tablero se separan: el test los ata. Toca `finances/page.tsx` después de F1-9 y antes de F5-1.

### F4-7 · Mantenimiento: el modal no queda tapado por el teclado, la pantalla se actualiza sola y "Ver como mantenimiento"

**Rama:** `claude/mantenimiento-usable` · **Carril:** G · **Depende de:** F1-6, F0-7, F1-9 · **Migración:** no · **Esfuerzo:** 0,75 días

**Por qué.** En el celular de la mucama, el teclado tapa "Confirmar" cuando escribe una nota, y la pantalla no muestra los check-outs nuevos hasta que la refresca a mano. El dueño hoy no tiene cómo ver lo que ve ella (decisión 5).

**Archivos**
- Modify: `src/app/maintenance/MaintenanceDashboard.tsx` — modal con alto máximo y pie fijo (378-379, 450-476), `aria-label` en cerrar (400), label asociada (439-447), `role="dialog"` y `aria-modal`, el hook de refresco y la línea "Actualizado a las…" (339-349).
- Modify: `src/app/maintenance/page.tsx` — pasa `loadedAt` (hora de la carga) al tablero.
- Modify: `src/app/maintenance/layout.tsx` — "Volver al panel" para el admin.
- Modify: `src/app/admin/mantenimiento/page.tsx` — "Ver como mantenimiento" en la cabecera que dejó F1-9.

**Pasos**
1. Overlay `items-end sm:items-center p-0 sm:p-4`; tarjeta `max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl`; botones en un pie `sticky bottom-0 bg-white`. El contenedor lleva `role="dialog"`, `aria-modal="true"` y `aria-labelledby`, porque F1-6 ya no toca modales.
2. `<label htmlFor="cleaning-notes">` + `id="cleaning-notes"` en el textarea; `aria-label="Cerrar"` en la X.
3. `useAutoRefresh({ intervalMs: 60000, paused: selected !== null || isPending })`, importado de `src/app/admin/useAutoRefresh.ts` (F1-6). No se crea un hook propio en `src/app/maintenance/`.
4. Debajo del título: "Actualizado a las 10:42 · Actualizar", con `loadedAt` en hora del hotel; "Actualizar" llama a `router.refresh()`. Cada refresco trae un `loadedAt` nuevo del servidor, así no hace falta un reloj en el cliente.
5. Links, solo en este PR: en `/admin/mantenimiento`, "Ver como mantenimiento" → `/maintenance`; en `maintenance/layout.tsx`, si `role === 'admin'`, "Volver al panel" → `/admin/mantenimiento`, junto a `LogoutButton`.

**Aceptación**
- [ ] En el celular, al tocar "Notas" con el teclado abierto, "Confirmar" sigue a la vista (o se llega scrolleando dentro del cuadro).
- [ ] Tocar "Notas (opcional)" pone el cursor en el campo.
- [ ] Si recepción hace un check-out, en un minuto la habitación aparece sola en mantenimiento; con un cuadro abierto la pantalla no se mueve.
- [ ] Arriba dice a qué hora se actualizó, con un botón "Actualizar".
- [ ] El dueño entra a "Ver como mantenimiento" desde Limpiezas y vuelve con "Volver al panel".

**Tests** (Vitest)
- `src/app/maintenance/MaintenanceDashboard.test.tsx` (Create; mocks de `./actions`, `next/navigation` y `@/app/admin/useAutoRefresh`; buscar por texto y label): `getByLabelText('Notas (opcional)')` encuentra el textarea; el cuadro abierto tiene `aria-modal="true"`, `max-h` y `overflow-y-auto`; el hook recibe `intervalMs: 60000` y `paused: true` con el cuadro abierto; "Actualizar" llama a `router.refresh`. El hook ya tiene sus tests en F1-6.

**Verificación en PROD**
- Después del deploy (en `npm run dev` los client components de página no hidratan).
- En el celular, con el usuario de mantenimiento: "Registrar limpieza" → tocar Notas → ver Confirmar.
- Con `/maintenance` abierto, hacer un check-out desde la PC y esperar un minuto.
- Como admin: `/admin/mantenimiento` → "Ver como mantenimiento" → "Volver al panel".

👤 **AGUSTÍN:** revisar y mergear; pedirle a la de mantenimiento que registre una limpieza con nota desde su celular.

**Riesgos.** El refresco cada 60 s es barato (una usuaria, 14 habitaciones), pero no debe correr con un cuadro abierto: lo cubren `paused` y el `aria-modal`. Va antes de F4-8 en `MaintenanceDashboard.tsx`.

### F4-8 · Mantenimiento: "Reportar desperfecto" que llega a la campana del admin (mig 121)

**Rama:** `claude/reportar-desperfecto` · **Carril:** G · **Depende de:** F4-7, F1-3, F4-1a · **Migración:** 121 (`121_reportar_desperfecto.sql`) · **Esfuerzo:** 1,5 días

**Por qué.** Los desperfectos (aire, canilla, TV) se avisan de palabra y se pierden: de 846 limpiezas, solo 9 tienen nota. Con el botón, el aviso le llega al dueño a la campana y a "Para atender" (decisión 5).

**Archivos**
- Create: `supabase_migrations/121_reportar_desperfecto.sql` — RPC, grants y `record_migration`.
- Modify: `src/lib/validations.ts` — `reportIssueSchema`.
- Modify: `src/lib/data.ts` — `reportMaintenanceIssue(roomId, description, urgent)`.
- Modify: `src/app/maintenance/actions.ts` — `reportMaintenanceIssueAction(input: unknown)`.
- Create: `src/app/maintenance/ReportIssueModal.tsx` — el cuadro de reporte.
- Modify: `src/app/maintenance/MaintenanceDashboard.tsx` — botón en la cabecera (341-349) y link "Reportar un problema" por tarjeta (`renderCard`, 159-319).
- Modify: `src/lib/admin-alerts.ts` y `src/app/admin/AdminAlertsList.tsx` (los crea F1-3) — rótulo "Desperfecto", chip "Urgente", quién lo reportó y botón "Ya lo vi" (`resolveAdminAlertAction`).
- Modify: `src/lib/attention.ts` — ítem `desperfecto`; `avisos_admin` deja de contar `maintenance_issue`.

**Pasos**
1. `reportIssueSchema = z.object({ roomId: z.number().int().positive().nullable(), description: z.string().trim().min(3).max(500), urgent: z.boolean() })`. La action valida, llama a la RPC, revalida con `revalidateMaintenanceViews()` y traduce el error con `parseActionError` ("No se pudo enviar el aviso.").
2. `ReportIssueModal`: habitación o "Otro lugar (pasillo, cocina, lavadero)", textarea "¿Qué pasa?" con label, checkbox "Es urgente: la habitación no se puede usar" y Confirmar en pie fijo (patrón de F4-7), con `aria-modal="true"` para que el refresco se pause. Toast: "Listo: el aviso le llegó al administrador." "Urgente" no saca la habitación de servicio: eso lo decide el dueño.
3. `desperfecto` en "Para atender" es ALTA si `payload.urgent` y MEDIA si no; la acción abre la campana (`OpenAlertsButton`).

**Base de datos.** Sin tablas, columnas ni RLS nuevas: `admin_alerts.kind` es texto libre (mig 41) y la lectura sigue siendo solo del admin. Crea `public.rpc_report_maintenance_issue(p_room_id integer, p_description text, p_urgent boolean DEFAULT false) RETURNS bigint`, `SECURITY DEFINER SET search_path = public`: exige `app_is_maintenance() OR app_is_staff()` (42501); `btrim(p_description)` de 3 a 500 letras (22023); si `p_room_id` no es null, la habitación existe (P0002); si ya hay un `maintenance_issue` sin resolver con la misma habitación y descripción de hace menos de 10 minutos, devuelve ese id. Si no, INSERT con `kind = 'maintenance_issue'`, `message` armado con `format()`, `related_room_id` y `payload = {description, urgent, reported_by: auth.uid(), reported_by_name}` (de `profiles.full_name`). `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated`. Cierra con el bloque `DO` de `record_migration('121_reportar_desperfecto.sql')`, como la 115 y la 116. En PROD va con `select public.exec_ddl($m121$ ... $m121$)`, sin BEGIN/COMMIT, sin `;` final y sin comillas en los comentarios, con OK de Agustín y ANTES del merge: sin ella, el botón falla con "function not found".

**Aceptación**
- [ ] La mucama toca "Reportar desperfecto", elige la habitación (u "Otro lugar"), escribe qué pasa y confirma; ve "Listo: el aviso le llegó al administrador".
- [ ] Dos toques seguidos en Confirmar no crean dos avisos.
- [ ] El dueño ve el desperfecto en la campana y en "Para atender" (arriba si es urgente), con quién lo reportó, y lo cierra con "Ya lo vi".
- [ ] La recepcionista no ve estos avisos.

**Tests** (Vitest)
- `src/__tests__/validations.test.ts` (Modify): `reportIssueSchema` rechaza menos de 3 y más de 500 letras y acepta `roomId: null`.
- `src/app/maintenance/ReportIssueModal.test.tsx` (Create; `vi.mock('./actions')` y sonner): Confirmar apagado hasta 3 letras; manda `{ roomId: 5, description: 'No anda el aire', urgent: false }` recortado; "Otro lugar" manda `roomId: null`; el error va a `toast.error`.
- `src/app/admin/AdminAlertsList.test.tsx` (Modify; Create si F1-3 no lo dejó): un `maintenance_issue` urgente muestra "Urgente" y "Ya lo vi".
- `src/__tests__/attention.test.ts` (Modify): urgente es `alta`, el resto `media`, y `avisos_admin` no lo cuenta.

**Verificación en PROD**
- Antes del merge: `select filename, applied_at from public.applied_migrations where filename = '121_reportar_desperfecto.sql'`; `select to_regprocedure('public.rpc_report_maintenance_issue(integer,text,boolean)') is not null`; `select has_function_privilege('anon', 'public.rpc_report_maintenance_issue(integer,text,boolean)', 'execute')` → false.
- Después del reporte de prueba: `select id, kind, related_room_id, payload->>'urgent' as urgente, created_at, resolved_at from public.admin_alerts where kind = 'maintenance_issue' order by id desc limit 5`; mirar la campana y Hoy como admin y como recepción.

👤 **AGUSTÍN:** dar el OK para aplicar la 121 con `exec_ddl` y verificar su fila en `applied_migrations` ANTES de mergear; mergear; pedirle a la de mantenimiento un desperfecto de prueba y cerrarlo con "Ya lo vi".

**Riesgos.** Mergear sin la 121 aplicada rompe el botón (ya pasó con las 108, 109 y 111): el orden es obligatorio. El número se confirma al aplicar, contra `applied_migrations` y `ls supabase_migrations`. `auth.uid()` dentro de SECURITY DEFINER es el que llama, así queda `reported_by`. Contra el abuso: tope de 500 letras y deduplicación de 10 minutos.

### F4-9 · Calendario: nombres que se leen, sin letra de 7 px, leyenda de 4 estados y animación que respeta "reducir movimiento"

**Rama:** `claude/calendario-legible` · **Carril:** I · **Depende de:** F2-3, F4-2 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Los nombres largos se cortan por el principio ("…ALEZ MARÍA"), el estado va en letra de 7 px y hay seis colores para memorizar. Recepción tiene que leer de un vistazo quién está y qué falta.

**Archivos**
- Modify: `src/app/admin/calendario/CalendarClient.tsx` — texto de ayuda (103), leyenda y paleta desde lib (106-144), estilos (341-383), letra chica (428, 460, 556, 563, 584, 749), tildes (418, 572, 651, 765).
- Modify: `src/lib/calendar.ts` — `CALENDAR_LEGEND` y `paletteForCategory`.

**Pasos**
1. Nombre (554-561): el `<p>` pasa a `w-full truncate text-center text-[11px] font-bold`. Hoy el contenedor es `flex items-center` y el `<p>` con `whitespace-nowrap` se desborda centrado, cortando el principio; con `w-full truncate` corta al final con "…".
2. Letra mínima de 12 px en todo el calendario, con 11 px solo en las barras: estado de la barra (563) de 7 a 11 px; fuera el "Salida" de 7 px (584), porque la diagonal ya marca la salida y el `aria-label` tiene el detalle; día de la semana (428), tipo de habitación (460) y 749 pasan a `text-xs`.
3. `CALENDAR_LEGEND` con 4 estados: "En estadía" verde, "Reservada" azul, "Sin confirmar" gris y "Falta check-in" rojo. `paletteForCategory('next')` usa el mismo azul que `future`; `finished` sigue gris claro y sin chip. La línea de estado de cada barra usa las mismas palabras. Si Q8 dice que recepción usa el amarillo, "Próxima" queda como quinto estado.
4. La animación flotante va dentro de `@media (prefers-reduced-motion: no-preference)`; se borran `.ribbon-gradient-anim` y `@keyframes ribbon-bg` (342-349), que no se usan.
5. Tildes: "Hacé clic en una fecha vacía para reservar…" (103), "Habitación" (418, 651), "En estadía" (572) y "Teléfono" (765). Las de 824 y 832 ya se fueron con F4-2.

**Aceptación**
- [ ] Un nombre largo se lee desde el principio y termina en "…" ("GONZÁLEZ MAR…").
- [ ] No queda texto de menos de 11 px en las barras ni de menos de 12 px en el resto del calendario.
- [ ] La leyenda tiene 4 colores y las barras dicen lo mismo que la leyenda.
- [ ] Con "reducir movimiento" activado en Windows o en el celular, las barras no flotan.
- [ ] Los textos llevan tilde ("Habitación", "Teléfono", "En estadía").

**Tests** (Vitest)
- `src/__tests__/calendar.test.ts` (Modify): `CALENDAR_LEGEND` tiene 4 etiquetas; `paletteForCategory('next')` es igual a `paletteForCategory('future')`; `overdue` es la roja.
- `src/app/admin/calendario/CalendarClient.test.tsx` (Create; mocks de `next/navigation`, `../actions` y los modales; buscar por texto): el `<p>` de un nombre largo tiene `truncate` y `w-full`; ningún elemento tiene `text-[7px]`, `text-[9px]` ni `text-[10px]`; la leyenda muestra 4 chips.

**Verificación en PROD**
- Después del deploy, `/admin/calendario` en un monitor de 1366 px y en el celular: nombres, leyenda y referencias plegadas.
- Con las animaciones apagadas en Windows (Accesibilidad › Efectos visuales), las barras quedan quietas.

👤 **AGUSTÍN:** antes de que arranque, preguntarle a la recepcionista de la mañana si usa el amarillo de "Próxima" (Q8); revisar y mergear.

**Riesgos.** Si recepción usa "Próxima", se vuelve a 5 estados. Dos líneas de 11 px entran justo en la barra de 26 px: revisar en Chrome y en el celular. Va después de F4-2, que ya cerró el detalle de la reserva en CalendarClient.

#### Fusionados o descartados

- **F4-10 · Recepción ve en Hoy la respuesta a sus pedidos de tarifa (opcional)** — descartado a favor de F1-4: hacían lo mismo con dos migraciones distintas, y F1-4 no cambia el esquema (chip en la tarjeta y aviso en el cobro). No se agrega fila en "Para atender". Estimado original: 1 día.

---

## Fase 5 — Sistema visual y textos

Esta fase cierra el plan con lo que se ve en todas las pantallas. La plata y las fechas salen de un solo formateador argentino y en la hora del hotel. Modales, botones, tablas y encabezados pasan a componentes compartidos (Escape, foco, celular). El texto gana contraste, letra mínima de 12 px y tildes, con una guía que evita que vuelvan los errores. Lo gana sobre todo recepción, que trabaja en el celular y con capacitación básica, y también el dueño, que deja de ver "$43,700.00" en Cobros del día. Todo va en el carril J y al final: F5-7 arranca ya porque solo crea archivos nuevos, cada PR espera a que el carril funcional cierre sus archivos, los barridos se parten por carpeta y F5-6 (la regla de ESLint) es el último PR del plan.

> Los números de línea son de main en a918c70 y se van a mover con F0 a F4, así que cada PR rehace su lista con grep sobre main al abrirse. Ningún PR de esta fase toca la base. Los tests buscan por texto o aria-label y no usan getByRole sobre toda la pantalla (PR #131).

### F5-7 · Componentes base en src/components/ui/: Button, StatusPill, EmptyState

**Rama:** `claude/componentes-ui-base` · **Carril:** J · **Depende de:** — · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Hoy cada botón, cada pastilla de estado y cada "No hay nada" se arma a mano con clases repetidas. Por eso el verde, el gris de deshabilitado y el foco cambian de una pantalla a otra. Estos tres componentes son la base de los PRs que siguen.

**Archivos**
- Create: `src/components/ui/Button.tsx`: variantes primary (brand-700, hover brand-800), secondary (borde slate-300), ghost y danger (red-600). Tamaños sm y md, con alto mínimo de 44 px en md. Con `loading` muestra `Loader2` y se deshabilita. Siempre lleva `focus-visible:ring-2`.
- Create: `src/components/ui/StatusPill.tsx`: recibe `kind` (habitación, pago, factura, remito) y `status`. Los colores de pago son los de `src/app/admin/EstadoPagoTag.tsx`, sin inventar otros.
- Create: `src/components/ui/EmptyState.tsx`: ícono, título, y descripción y acción opcionales.
- Create: `src/__tests__/ui-button.test.tsx`, `src/__tests__/ui-status-pill.test.tsx`, `src/__tests__/ui-empty-state.test.tsx`.

**Pasos**
1. Crear `src/components/ui/`, que hoy no existe. `src/app/components` es la web pública y no se mezcla con esto.
2. Escribir los tres componentes. Solo Button lleva `"use client"`, porque recibe onClick.
3. Escribir los tests.
4. No migrar ninguna pantalla todavía. Esto corrige el plan de fase, que tocaba UsersPanel (de F1-10 y F5-18a) y CloseShiftModal (de los carriles C y A). Los primeros usos reales llegan con F5-8a (Button dentro del Modal) y F5-18a (EmptyState).

**Aceptación**
- [ ] `npm run build` pasa y ninguna pantalla cambia, porque los archivos son nuevos y nadie los usa todavía.

**Tests** (Vitest)
- Button: `variant="danger"` aplica `bg-red-600`. Con `disabled` o `loading` no llama a onClick, y con `loading` muestra el ícono.
- StatusPill: cada par `kind` + `status` muestra su texto, y un status desconocido cae en un gris neutro sin romper.
- EmptyState: muestra el título y, si recibe `action`, el botón llama a su onClick.

**Verificación en PROD**
- No hay nada visible. Alcanza con que la app abra después del deploy.

👤 **AGUSTÍN:** mergear cuando quieras; no hay nada para probar.

**Riesgos.** Casi nulos. El único cuidado es no duplicar `EstadoPagoTag`: StatusPill copia sus colores, y EstadoPagoTag pasa a usar StatusPill recién cuando otro PR toque ese archivo.

### F5-15 · Guía de textos + recibo impreso con tildes + test anti-sin-tilde

**Rama:** `claude/guia-de-textos-recibo` · **Carril:** J · **Depende de:** F2-5b · **Migración:** no · **Esfuerzo:** 1,25 días

**Por qué.** El recibo que se le da al pasajero sale con "Huesped:", "Habitacion:" y "Total estadia:", y no hay ninguna guía escrita de cómo se redacta en el sistema. Con la guía y un test, las palabras sin tilde dejan de volver.

**Archivos**
- Create: `docs/guia-de-textos.md`. Fija estas reglas:
  - Voseo, y mayúscula solo al principio en botones y títulos.
  - "check-in" y "check-out" en minúscula.
  - Un glosario: habitación, huésped, estadía, remito, cta. cte., arqueo.
  - Letra mínima de 12 px, con 11 px solo en las barras del calendario.
  - La plata siempre con `formatAmount` y sus hermanos, las fechas siempre con `src/lib/time.ts`, y las confirmaciones con ConfirmDialog (F5-16), nunca con `confirm()`.
- Modify: `src/app/admin/recibo/[paymentId]/page.tsx`: las líneas 83, 100 y 115 pasan a "Huésped", "Habitación" y "Total estadía", y la 19 a "Tarjeta crédito". También se revisan las líneas que agregó el recibo agrupado de F2-5b.
- Modify: `src/app/admin/recibo-cc/[movementId]/page.tsx`: la línea 25 ("Tarjeta crédito") y las 56-57 ("Estadía - Remito", "Estadía sin facturar").
- Modify: `src/app/page.tsx` y `src/app/components/*`: los textos de la web pública que tutean o tratan de usted pasan a voseo.
- Create: `src/__tests__/textos-sin-tilde.test.ts` y `src/__tests__/textos-sin-tilde.baseline.json`.

**Pasos**
1. Escribir la guía: una página, con ejemplos de "así sí" y "así no".
2. Corregir los dos documentos que se imprimen.
3. Armar el test con el compilador de TypeScript (`ts.createSourceFile`) sobre `src/app/**/*.{ts,tsx}`, sin contar los tests.
   - Revisa solo el texto de JSX y las cadenas con al menos un espacio, que son frases. Saltea los argumentos de `console.*`.
   - Así no cuentan el valor `"estadia"` de un enum ni los nombres de variables: el crítico contó 97 apariciones de "estadia" en el código.
   - Busca estas palabras enteras, con o sin mayúscula: Huesped, Habitacion, Categoria, Telefono, credito, estadia, dia, accion.
4. Armar el baseline. Hoy el barrido encuentra unas 111 frases en 26 archivos; habitaciones, categorías y `admin/actions.ts` se llevan la mitad. Este PR no las corrige, porque esos archivos son de otros carriles: van al baseline como archivo → cantidad.
   - El test falla si aparece un archivo nuevo con frases sin tilde o si sube el número de alguno.
   - Quien limpia un archivo baja su número.
5. Imprimir un recibo de prueba (Q9).

**Aceptación**
- [ ] El recibo en papel dice "Huésped:", "Habitación:" y "Total estadía:", y las columnas no se corren.
- [ ] Si alguien escribe `<span>Habitacion:</span>` en una pantalla nueva, `npm test` falla y dice el archivo y la línea.

**Tests** (Vitest)
- `textos-sin-tilde.test.ts`, con fuentes armadas en memoria: "Habitacion:" dentro de JSX falla; `destino === "estadia"` no falla; `console.error("... estadia ...")` no falla.
- El recorrido real sobre `src/app` respeta el baseline.

**Verificación en PROD**
- Imprimir en la comandera del mostrador el recibo de un check-out real (o reimprimir uno) y un recibo de cobranza.

👤 **AGUSTÍN:** antes del merge, imprimir una prueba en la impresora del mostrador (Q9). Si las tildes salen como símbolos raros (pasa con el driver "Generic / Text Only", ver `docs/impresion-comandera.md`), avisá: el papel queda sin tildes y la pantalla las lleva.

**Riesgos.**
- La comandera puede no soportar tildes según el driver. En ese caso, esos dos documentos quedan sin tildes a propósito, se anota en la guía y el baseline los deja pasar.
- Hay un choque suave con otros carriles: sus archivos entran al baseline tal como están y no se tocan acá.

### F5-1 · Un solo formateador de plata: Finanzas deja "en-US" y se borran 4 copias locales

**Rama:** `claude/formato-plata-unico` · **Carril:** J · **Depende de:** F2-7b, F1-9, F4-6 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** En Cobros del día el dueño ve "$43,700.00", el formato de Estados Unidos, mientras el resto del sistema dice "$43.700,00". Además, Caja, el cierre de turno, la factura y Rendiciones tienen cada una su propia copia del formateador.

**Archivos**
- Modify: `src/lib/format.ts`: suma `formatAmountKpi(amount)`. Devuelve "$43.700" hasta 99.999, "$850 mil" hasta 999.999 y "$12,1 M" desde el millón (sin ",0": "$12 M"), con signo para los negativos. Lo usa F5-12.
- Modify: `src/app/admin/finances/page.tsx`:
  - Los 7 "en-US" (177, 182, 184, 201, 217, 260 y 295) pasan a `formatAmount`, sacando el "$" que está escrito en el JSX.
  - Los 2 `toLocaleString()` sin idioma (299 y 300) también. Hoy dependen del idioma del servidor.
  - La línea 59 (`toLocaleDateString('en-CA', …)`) pasa a `hotelDateKey(new Date(), hotelTimezone)`.
- Modify: `src/app/admin/caja/CajaClient.tsx`: borra `formatMoney` (24), usa `formatAmount` y saca el "$" del JSX.
- Modify: `src/app/admin/caja/CloseShiftModal.tsx`: lo mismo con `formatMoney` (80). No toca `ParsedAmountHint` ni la confirmación del arqueo que agregó el PR #130.
- Modify: `src/app/admin/InvoicePromptModal.tsx`: lo mismo con `formatMoney` (60).
- Modify: `src/app/admin/caja/rendiciones/page.tsx`: borra `formatMoney` (16) y queda `n === null ? "---" : formatAmount(n)`. El crítico encontró esta cuarta copia.
- Modify: `src/__tests__/format.test.ts`.

**Pasos**
1. Rehacer la lista con `grep -rn "en-US\|function formatMoney\|toLocaleString()" src/app` sobre main, porque F1-9 y F4-6 cambian `finances/page.tsx`.
2. Escribir `formatAmountKpi` con sus tests.
3. Reemplazar archivo por archivo, mirando el "$" de alrededor para que no quede "$$" ni falte el signo.
4. Dejar como están los `formatMoney(n, currency)` que usa el Tablero: vienen de lib, no son copias.

**Aceptación**
- [ ] En Tablero › Cobros del día todos los montos se leen "$43.700,00", incluidos el "Total" y el "Pagado" de la lista de deudas.
- [ ] Caja, el cierre de turno, el modal de factura y Rendiciones muestran los mismos números que antes, sin "$$".

**Tests** (Vitest)
- `format.test.ts`, casos de `formatAmountKpi`:
  - 1500 → "$1.500"
  - 850000 → "$850 mil"
  - 999999 → "$1 M"
  - 12100000 → "$12,1 M"
  - 12000000 → "$12 M"
  - -850000 → "-$850 mil"
- La página de Finanzas no se testea, porque es de servidor y lee Supabase; el guardarraíl es F5-6. `CloseShiftModal.test.tsx` tiene que quedar en verde sin tocarlo.

**Verificación en PROD**
- Abrir Cobros del día con un monto de 5 cifras o más y ver el punto de miles y la coma decimal.
- Comparar "Ingresos del día" con un SELECT de solo lectura: la suma de `payments.amount` del día del hotel.

👤 **AGUSTÍN:** mirar Cobros del día y la Caja después del deploy.

**Riesgos.** Que falte o sobre el "$" donde la copia local no lo ponía: CajaClient, CloseShiftModal e InvoicePromptModal devuelven el número sin "$". Hay que revisar cada uso, no reemplazar a ciegas.

### F5-2 · Fechas sin zona horaria: mover los formateos sueltos a lib/time.ts

**Rama:** `claude/fechas-zona-hotel` · **Carril:** J · **Depende de:** F3-3b, F4-2, F2-10 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Cinco pantallas arman la fecha con `toLocaleDateString` sin la zona del hotel, así que toman la de la compu o la del servidor. En una compu con otro huso horario, un pago de las 22:30 aparece al día siguiente.

**Archivos**
- Modify: `src/lib/time.ts`: suma `formatDateKey(key, estilo)`. Arma "25 jun" (`"corta"`) o "25/06/2026" (`"numerica"`) leyendo solo la fecha "aaaa-mm-dd" del texto, sin pasar por el `Date` del navegador. También lo usan F5-5 y F5-6.
- Modify: `src/app/admin/ClientSearch.tsx`: `shortDate` (16-19) pasa a `formatHotelShortDate`, que ya existe ("25 jun 26"). Solo esa función: los porcentajes de las líneas 143 y 177 los barre F5-6.
- Modify: `src/app/admin/GuestSelector.tsx`: `shortDate` (14-17) pasa a `formatHotelShortDate`.
- Modify: `src/app/admin/NewReservationModal.tsx`: `shortDate` (123-126) pasa a `formatDateKey(…, "corta")`. El resto del archivo lo barre F5-6.
- Modify: `src/app/admin/solicitudes/SolicitudesClient.tsx`: `formatDate` (101-107) pasa a `formatHotelShortDate`. Hoy muestra el año con 4 cifras y pasa a mostrar 2.
- Modify: `src/app/admin/clientes/ClienteFicha.tsx` (hoy `cuentas/FichaClienteModal.tsx:320` y `:761`; lo mueve F3-3b): los dos `toLocaleDateString` pasan a `formatHotelDate`, que da el mismo dd/mm/aaaa.
- Modify: `src/__tests__/time.test.ts`.

**Pasos**
1. Correr `grep -rn "toLocaleDateString\|toLocaleTimeString" src/app` sobre main.
2. Escribir el helper con sus tests y hacer los reemplazos. La zona sale de la configuración del hotel donde la pantalla ya la tiene; si no la tiene, se usa `DEFAULT_TZ`.
3. El único cambio visible es que `formatHotelShortDate` saca el punto del mes: "25 jun 26" en vez de "25 jun. 26".

**Aceptación**
- [ ] Un pago cargado a las 22:30 del 25/06 dice 25/06 en la ficha del cliente, también en una compu con la hora de otro país.
- [ ] En Reserva nueva, "Libres para 25 jun → 27 jun" muestra las mismas fechas que se tipearon.

**Tests** (Vitest)
- `time.test.ts`:
  - `formatDateKey("2026-06-25T23:30", "corta")` → "25 jun".
  - `formatDateKey("2026-06-25", "numerica")` → "25/06/2026".
  - `formatHotelShortDate("2026-06-26T02:30:00Z")` → "25 jun 26", cuando en UTC ya es 26.
  - Un caso de fin de año.

**Verificación en PROD**
- Abrir el buscador de clientes, una reserva nueva, Solicitudes y la ficha de un cliente con pagos: las fechas se leen como antes.

👤 **AGUSTÍN:** nada especial; mirar la ficha de un cliente después del deploy.

**Riesgos.** El formulario de reserva trabaja con un texto local "aaaa-mm-ddThh:mm", sin zona. Si se pasara por `Date` con la zona del hotel se podría correr de día, y por eso ese caso usa el helper que no convierte.

### F5-3 · Barrido de plata inline: Reservas y Habitaciones

**Rama:** `claude/barrido-plata-reservas` · **Carril:** J · **Depende de:** F5-1, F4-9, F2-2, F2-10 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Cada pantalla de reservas arma su "$" con toLocaleString a su manera: unas con decimales, otras sin, y Solicitudes directamente sin idioma. Todas pasan a los formateadores de lib.

**Archivos**
- Modify: `src/lib/format.ts`: suma dos helpers:
  - `formatPercent(value, maxDecimals = 2)`: devuelve "12,5", sin el "%", que ya está en cada JSX.
  - `formatPrice(amount)`: devuelve "$43.700" si el monto es entero y "$43.700,50" si no. Es para tarifas y precios de lista, que hoy se ven sin decimales.
- Modify: `src/app/admin/calendario/CalendarClient.tsx`: 804, 808 y 814 pasan a `formatAmount`.
- Modify: `src/app/admin/ChangeRoomModal.tsx`: `fmt` (108) y la 203 pasan a `formatPrice`.
- Modify: `src/app/admin/EditReservationModal.tsx`: 142, 153, 172, 273 y 307 pasan a `formatAmount`.
- Modify: `src/app/admin/ExtraChargesModal.tsx`: 68 y 163 pasan a `formatAmount`.
- Modify: `src/app/admin/WalkInModal.tsx`:
  - 397, 480 y 616 pasan a `formatPercent`.
  - 604 y 605 pasan a `formatPrice`.
  - 617 y 621 pasan a `formatAmount`.
- Modify: `src/app/admin/categorias/CategoriesClientTable.tsx`: 141 y 144 pasan a `formatPrice`.
- Modify: `src/app/admin/RoomCard.tsx`: 395 y 514 pasan a `formatAmount` (ver la nota).
- Modify: `src/app/admin/guests/GuestsClientTable.tsx`: la 90 ("Deuda") pasa a `formatAmount`.
- Modify: `src/app/admin/solicitudes/SolicitudesClient.tsx`: la 328 (`toLocaleString()` sin idioma) pasa a `formatPrice`.
- Modify: `src/__tests__/format.test.ts`.

**Pasos**
1. Rehacer la lista con grep sobre main, porque F2-2, F2-10, F4-2 y F4-9 cambian estos archivos.
2. Decidir cada uso con esta regla:
   - El monto de una cuenta va con `formatAmount` (2 decimales).
   - Una tarifa o un precio de lista va con `formatPrice`.
   - Un descuento va con `formatPercent`.
   - En todos los casos se saca el "$" del JSX si el helper ya lo pone.

> Nota: RoomCard lo cierra F4-4, y el mapa no pone F4-4 como dependencia de este PR. Si F4-4 todavía no está mergeado, RoomCard se saltea y lo barre F5-6.

**Aceptación**
- [ ] Calendario, cambio de habitación, editar reserva, cargos extra, walk-in, categorías e historial muestran los mismos montos que hoy, y las tarifas siguen sin ",00".
- [ ] En Solicitudes el total se lee "$43.700" y no "43,700".

**Tests** (Vitest)
- `formatPercent`: 12.5 → "12,5"; 10 → "10"; 33.333 → "33,33".
- `formatPrice`: 43700 → "$43.700"; 43700.5 → "$43.700,50"; 0 → "$0".

**Verificación en PROD**
- Abrir el calendario, cambiar de habitación, editar una reserva y abrir un walk-in con descuento: los montos y el % se ven como antes.

👤 **AGUSTÍN:** mirar un walk-in de un huésped con descuento.

**Riesgos.** Bajos. Si un precio que hoy se ve "43.700" pasara a `formatAmount`, ganaría un ",00": por eso tarifas y montos van separados.

### F5-4 · Barrido de plata inline: Clientes y Tablero

**Rama:** `claude/barrido-plata-clientes-tablero` · **Carril:** J · **Depende de:** F5-3, F3-6 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Clientes y el Tablero tienen el mismo formateo suelto: porcentajes de descuento y cantidades de noches. Después de F3, varias de las pantallas que nombraba el plan de fase ya no existen, así que la lista se arma sobre lo que quedó.

**Archivos**
- Modify: `src/lib/format.ts`: suma `formatNumber(n)`, que devuelve "1.500", sin decimales, para cantidades.
- Modify: `src/app/admin/analytics/page.tsx`: `num` (85) pasa a `formatNumber`.
- Modify: `src/app/admin/analytics/habitaciones/RoomBreakdownClient.tsx`: `num` (53) pasa a `formatNumber`.
- Modify: `src/app/admin/AssociatedClientSelector.tsx`: la 95 pasa a `formatPercent`.
- Modify: `src/app/admin/GuestSelector.tsx`: la 129 pasa a `formatPercent`.
- Modify: `src/app/admin/clientes/*`, que crean F3-3b y F3-5a (`ClienteFicha.tsx`, `ClientesTable.tsx`): lo que hayan traído de las pantallas viejas.
- Modify: `src/__tests__/format.test.ts`.

**Pasos**
1. Correr `grep -rn "toLocaleString\|Intl\.NumberFormat" src/app/admin/clientes src/app/admin/analytics src/app/admin/*Selector*.tsx` sobre main.
2. Ya no se tocan, porque F3 los borra o los convierte en redirect: `AssociatedClientLedgerModal`, `AssociatedClientsClientTable`, `GuestDirectoryTable`, `DiscountsManager` y `cuentas/page.tsx`. Si alguno sigue vivo en main, entra con el mismo criterio.
3. El `formatMoney(n, currency)` del Tablero queda, porque ya viene de lib.

**Aceptación**
- [ ] Tablero (General y Por habitación), la lista de Clientes y la ficha muestran los mismos números que antes.

**Tests** (Vitest)
- `formatNumber`: 1500 → "1.500"; 1234567 → "1.234.567"; 0 → "0".

**Verificación en PROD**
- Abrir Tablero › General, Tablero › Por habitación y Clientes › Con descuento, y comparar con una captura de antes del deploy.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos: son reemplazos de formato. El único riesgo es trabajar sobre una lista vieja, y por eso se arma con grep al abrir el PR.

### F5-5 · Barrido de plata inline: web pública de reservas (sin PaymentModal)

**Rama:** `claude/barrido-plata-web-publica` · **Carril:** J · **Depende de:** F5-3 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** La web donde reserva el pasajero arma a mano sus precios y sus fechas. Va en un PR aparte porque es la cara del hotel y conviene revisarla sola.

**Archivos**
- Modify: `src/app/components/BookingModal.tsx`: 262 y 266 pasan a `formatPrice`. Las fechas de 235 y 239 pasan a `formatDateKey(…, "numerica")` de F5-2. El mapa no nombra esas fechas, pero están en el mismo archivo.
- Modify: `src/app/components/RoomCard.tsx`: la 91 pasa a `formatPrice`.
- No se toca `src/app/components/PaymentModal.tsx`: no es de la web pública, es el cobro del check-out de recepción (lo importan RoomCard y GuestsClientTable), y su formato ya lo hizo F2-5a.
- `PublicSearchForm.tsx` y `src/app/page.tsx` quedan para F5-6.

**Pasos**
1. Hacer el grep sobre `src/app/components`, sin PaymentModal.
2. Reemplazar, cuidando que "Desde $43.700" no gane un ",00".

**Aceptación**
- [ ] En la web pública, los precios y las fechas de la reserva se ven igual que hoy.

**Tests** (Vitest)
- `src/app/components/BookingModal.test.tsx`, si el modal se puede montar con props simples: 2 noches de $43.700 muestran "$87.400".
- Si no se puede montar fácil, alcanza con los tests de `formatPrice` y `formatDateKey`.

**Verificación en PROD**
- Abrir la web pública, elegir fechas y una habitación, y llegar hasta el resumen: precios y fechas como antes.

👤 **AGUSTÍN:** recorrer la reserva pública de punta a punta después del deploy.

**Riesgos.** Bajos, pero lo ve el pasajero.

### F5-8a · Modal compartido (src/components/ui/Modal.tsx) + WalkInModal

**Rama:** `claude/modal-compartido-walkin` · **Carril:** J · **Depende de:** F5-7, F2-10 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Ningún modal de recepción se cierra con Escape, ni pone el cursor en el primer campo, ni se anuncia como diálogo: solo 4 de los 29 overlays tienen `role="dialog"`. Además, Hoy se actualiza solo (F1-6) y frena el refresco cuando encuentra `aria-modal="true"`. Sin ese atributo, que no se refresque depende de que el foco esté en un campo.

**Archivos**
- Create: `src/components/ui/Modal.tsx`:
  - Lleva `role="dialog"`, `aria-modal="true"` y `aria-labelledby` apuntando al título.
  - Escape y la X llaman al mismo `onClose`, y nada lo cierra mientras `busy`.
  - El foco arranca en el primer campo (o en `initialFocusRef`) y al cerrar vuelve al botón que lo abrió. Tab no se escapa del modal.
  - La X mide 44×44 y tiene `aria-label="Cerrar"`.
  - Conserva el armado de hoy: abajo en el celular, centrado en la PC, con `max-h-[92dvh]` / `sm:max-h-[88dvh]` y scroll interno.
  - `closeOnBackdrop` mantiene lo que hace hoy cada modal. `zIndex` es para los que se abren arriba de otro (`z-[60]`).
- Modify: `src/app/admin/WalkInModal.tsx`: el overlay de la línea 296 pasa a `<Modal>`. La lógica del formulario no se toca.
- Create: `src/__tests__/modal.test.tsx` y `src/app/admin/WalkInModal.test.tsx`.

**Pasos**
1. Escribir Modal y sus tests, sin dependencias nuevas. La trampa de foco se hace a mano y no con `<dialog>`, porque jsdom no lo soporta bien.
2. Migrar WalkInModal:
   - Envolver el contenido en `<Modal>`.
   - Sacar el overlay y la X propios.
   - Pasar `busy` mientras guarda.
3. Probar a mano en el celular que el teclado no tape el botón final.

**Aceptación**
- [ ] Recepción abre el walk-in y el cursor ya está en el primer campo.
- [ ] Escape cierra igual que la X, y mientras guarda no cierra.
- [ ] Con Tab no se pasa a la grilla de atrás.
- [ ] Con el walk-in abierto, Hoy no se refresca, porque F1-6 ve el `aria-modal`.

**Tests** (Vitest)
- `modal.test.tsx`:
  - Escape llama a onClose, y con `busy` no lo llama.
  - El foco inicial cae donde corresponde.
  - Tab desde el último elemento vuelve al primero.
  - La X tiene `aria-label="Cerrar"` y `aria-labelledby` apunta al título.
- `WalkInModal.test.tsx`: el título aparece dentro de un elemento con `aria-modal="true"`, y Escape llama a onClose.

**Verificación en PROD**
- En el celular de recepción, abrir un walk-in, recorrerlo con el teclado del teléfono y cerrarlo con la X.

👤 **AGUSTÍN:** pedirle a recepción que haga un walk-in real el día del deploy y que cuente si notó algún cambio.

**Riesgos.** Escape con el formulario a medio llenar lo pierde, igual que la X de hoy. Si a recepción le pasa, se agrega un "¿Descartar lo cargado?" en un PR aparte.

### F5-8b · Modal compartido: NewReservationModal

**Rama:** `claude/modal-nueva-reserva` · **Carril:** J · **Depende de:** F5-8a, F5-2 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Reserva nueva es el modal más largo de recepción, con más de 700 líneas. Con Escape, foco y scroll interno se usa igual en el celular y en la PC.

**Archivos**
- Modify: `src/app/admin/NewReservationModal.tsx`: el overlay de la línea 390 pasa a `<Modal>`, con `busy` mientras guarda.
- Create: `src/app/admin/NewReservationModal.test.tsx`.

**Pasos**
1. Rebasear sobre F5-2 (fechas) y F0-10 (primero las fechas, con aviso de habitación ocupada).
2. Migrar solo el envoltorio: los pasos del formulario quedan como están.
3. Confirmar que el aviso "la habitación dejó de estar libre" (F0-10) se sigue viendo dentro del scroll.

**Aceptación**
- [ ] El cursor arranca en las fechas, que después de F0-10 son el primer campo.
- [ ] Escape cierra, y mientras guarda no.
- [ ] El aviso de habitación ocupada se sigue viendo.

**Tests** (Vitest)
- El título está dentro de `aria-modal="true"`.
- Escape llama a onClose, y con `busy` no.

**Verificación en PROD**
- Abrir Reserva nueva en el celular y en la PC, recorrerla con Tab y cerrarla sin guardar.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos: se cambia solo el envoltorio.

### F5-8c · Modal compartido: EditReservationModal

**Rama:** `claude/modal-editar-reserva` · **Carril:** J · **Depende de:** F5-8a, F2-2 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Editar reserva lo usan recepción y el dueño para correr fechas. Tiene que comportarse igual que el resto de los modales.

**Archivos**
- Modify: `src/app/admin/EditReservationModal.tsx`: el overlay de la línea 161 pasa a `<Modal>`, con `busy` mientras guarda.
- Create: `src/app/admin/EditReservationModal.test.tsx`.

**Pasos**
1. Rebasear sobre F2-2 (vista previa del precio) y, si ya entró, sobre F2-13.
2. Migrar solo el envoltorio.

**Aceptación**
- [ ] La vista previa del precio de F2-2 se sigue viendo antes de guardar.
- [ ] Escape cierra, y mientras guarda no.

**Tests** (Vitest)
- El título está dentro de `aria-modal="true"`, y Escape llama a onClose.

**Verificación en PROD**
- Abrir Editar en una reserva futura, cambiar una fecha, mirar la vista previa y cerrar sin guardar.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-8d · Modal compartido: ChangeRoomModal

**Rama:** `claude/modal-cambiar-habitacion` · **Carril:** J · **Depende de:** F5-8a, F1-4 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** El cambio de habitación es donde recepción pide conservar la tarifa, y el pedido tiene que seguir saliendo igual después de pasar al Modal compartido.

**Archivos**
- Modify: `src/app/admin/ChangeRoomModal.tsx`: el overlay de la línea 137 pasa a `<Modal>`, con `busy` mientras guarda.
- Create: `src/app/admin/ChangeRoomModal.test.tsx`.

**Pasos**
1. Rebasear sobre F1-4.
2. Migrar solo el envoltorio.

**Aceptación**
- [ ] El pedido de "conservar la tarifa" se sigue enviando y se ve en la tarjeta, igual que con F1-4.
- [ ] Escape cierra, y mientras guarda no.

**Tests** (Vitest)
- El título está dentro de `aria-modal="true"`, y Escape llama a onClose.

**Verificación en PROD**
- Abrir Cambiar habitación en una estadía, recorrer la lista de habitaciones y cerrar sin guardar.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-8e · Modal compartido: ExtraChargesModal

**Rama:** `claude/modal-cargos-extra` · **Carril:** J · **Depende de:** F5-8a · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Cargar un extra (frigobar, lavandería) es rápido y frecuente. Con Escape y el cursor ya en el monto, sale en dos segundos.

**Archivos**
- Modify: `src/app/admin/ExtraChargesModal.tsx`: el overlay de la línea 75 pasa a `<Modal>`, con `busy` mientras guarda y el foco inicial en el monto.
- Create: `src/app/admin/ExtraChargesModal.test.tsx`.

**Pasos**
1. Migrar el envoltorio.
2. Verificar que el total nuevo (la 163, ya con `formatAmount` desde F5-3) se siga viendo sin scroll en el celular.

**Aceptación**
- [ ] Al abrir, el cursor está en el monto.
- [ ] Escape cierra, y mientras guarda no.

**Tests** (Vitest)
- El foco inicial está en el campo de monto, y Escape llama a onClose.

**Verificación en PROD**
- Abrir Cargos extra en una estadía y cerrar sin guardar.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-9a · Modal compartido: InvoicePromptModal (multi-paso, conserva el paso)

**Rama:** `claude/modal-factura` · **Carril:** J · **Depende de:** F5-8a, F2-7b, F0-9 · **Migración:** no · **Esfuerzo:** 0,75 días

**Por qué.** La pregunta de la factura aparece en cada check-out. Tiene varios pasos: tipo de comprobante, datos del B o del CUIT, confirmación y, desde F0-9, corregir el DNI. Al pasar al Modal compartido no se puede perder el paso ni el DNI tipeado.

**Archivos**
- Modify: `src/app/admin/InvoicePromptModal.tsx`: el overlay de la línea 264 pasa a `<Modal>`.
  - El título de cada paso va en `aria-labelledby`.
  - Escape y la X llaman a la misma función que en F0-4 pregunta antes de salir sin facturar.
- Create: `src/app/admin/InvoicePromptModal.test.tsx`.

**Pasos**
1. Rebasear sobre F2-7b: el modal ya vive dentro de CheckoutFlow.
2. Migrar el envoltorio sin tocar la máquina de pasos (`ConfirmBack`: tipo, formB, formCuit).
3. Poner `busy` mientras se emite, para que no cierre en medio de la llamada a ARCA.

**Aceptación**
- [ ] Escape hace lo mismo que la X de F0-4: pregunta, no cierra de golpe.
- [ ] "Volver" sigue llevando al paso anterior con los datos cargados.
- [ ] Mientras se emite, ni Escape ni la X cierran.

**Tests** (Vitest)
- En el paso de confirmación, Escape muestra la misma pregunta que la X.
- Con `busy`, Escape no hace nada.
- El DNI corregido (F0-9) sigue en el campo después de ir y volver de paso.

**Verificación en PROD**
- En el próximo check-out real con factura, emitir normalmente. En otro, cerrar con Escape y confirmar que pregunta.

👤 **AGUSTÍN:** mirar el primer check-out con factura del día del deploy.

**Riesgos.** Es el modal que emite facturas reales (PROD emite contra ARCA de verdad). Un error de estado no manda una factura de más, porque la emisión no cambia, pero sí puede dejar a recepción sin la pregunta. Por eso el test de Escape es obligatorio.

### F5-9b · Modal compartido: CloseShiftModal

**Rama:** `claude/modal-cierre-caja` · **Carril:** J · **Depende de:** F5-8a, F2-7b, F5-1 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** El cierre de turno ya tiene un `role="dialog"` y un Escape hechos a mano, repetidos en 4 overlays (357, 502, 712 y 773). Al pasarlo al Modal compartido, el comportamiento queda igual al del resto de los modales y se borra código repetido. Es el último PR que toca este archivo: el orden fue F2-8, F2-2, F2-7b y F5.

**Archivos**
- Modify: `src/app/admin/caja/CloseShiftModal.tsx`: los 4 overlays pasan a `<Modal>`. Los que se abren arriba del cierre, como la confirmación "Contaste $X ¿Confirmás?" del PR #130, llevan un `zIndex` mayor.
- Modify: `src/app/admin/caja/CloseShiftModal.test.tsx`: suma casos; los de hoy quedan en verde sin cambiarlos.

**Pasos**
1. Rebasear sobre F2-7b: el check-out ya se hace dentro del cierre.
2. Sacar el Escape y el `role` escritos a mano, y dejar que los ponga el Modal.
3. Poner `busy` mientras se cierra el turno.

**Aceptación**
- [ ] En la confirmación del arqueo, Escape cierra solo la confirmación y no todo el cierre.
- [ ] Mientras se cierra el turno, nada cierra el modal.
- [ ] El check-out dentro del cierre (F2-7b) sigue andando.

**Tests** (Vitest)
- Los de `CloseShiftModal.test.tsx` quedan en verde.
- Nuevo: con la confirmación abierta, Escape la cierra y el cierre de turno sigue abierto.

**Verificación en PROD**
- Cerrar un turno real con arqueo.

👤 **AGUSTÍN:** cerrar tu turno el día del deploy, o pedirle a recepción que lo haga y te cuente.

**Riesgos.** Hay modales anidados. Si el `zIndex` o el Escape quedan mal, se cierra el de abajo; el test de la confirmación cubre ese caso.

### F5-9c · Modal compartido: CompanyCheckInModal y EarlyCheckoutModal

**Rama:** `claude/modal-checkin-empresa-salida-anticipada` · **Carril:** J · **Depende de:** F5-8a, F2-10, F2-7a · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Son los dos modales cortos que quedan en el check-in de empresa y en la salida anticipada. `AssociatedClientLedgerModal` sale de la lista porque lo borra F3-3b.

**Archivos**
- Modify: `src/app/admin/CompanyCheckInModal.tsx`: el overlay de la línea 74 pasa a `<Modal>`.
- Modify: `src/app/admin/EarlyCheckoutModal.tsx`: el overlay de la línea 46 pasa a `<Modal zIndex>`, porque se abre arriba de otro (hoy usa `z-[60]`).
- Create: `src/app/admin/CompanyCheckInModal.test.tsx` y `src/app/admin/EarlyCheckoutModal.test.tsx`.

**Pasos**
1. Rebasear sobre F2-10 (tipo de documento en el check-in de empresa) y F2-7a (CheckoutFlow).
2. Migrar los dos envoltorios.

**Aceptación**
- [ ] El check-in de empresa carga el pasajero igual que antes, y Escape cierra.
- [ ] La salida anticipada se abre arriba del check-out, y Escape cierra solo ese modal.

**Tests** (Vitest)
- En cada modal, el título está dentro de `aria-modal="true"` y Escape llama a onClose.

**Verificación en PROD**
- Abrir el check-in de una reserva de empresa y el check-out anticipado de una estadía, y cerrarlos sin guardar.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

> Hay overlays que no tienen PR en el mapa: los 3 de RoomCard (800, 842 y 949), OpenShiftModal, GuestModal, AssociatedClientModal, RegisterPaymentModal (359 y 803), CategoryModal, CreateRoomModal, EditRoomModal, FiscalClient (690), SolicitudesClient (139) y MaintenanceDashboard (378). La guía de F5-15 pide que el PR funcional que toque cada uno lo pase a `<Modal>`. Mientras tanto, F1-6 igual frena el refresco de Hoy cuando el foco está en un campo.

### F5-16 · Confirmaciones propias en lugar de confirm() + etiquetas de medio de pago desde payment-methods.ts

**Rama:** `claude/confirmaciones-propias` · **Carril:** J · **Depende de:** F5-8a, F3-1, F3-6, F1-7 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Descartar una factura o borrar una habitación, una categoría o un cliente abre el cartel del navegador. Se ve distinto en cada teléfono, no respeta el voseo y un Enter por error confirma. Además, los nombres de los medios de pago están copiados en unos diez lugares.

**Archivos**
- Create: `src/components/ui/ConfirmDialog.tsx`: va sobre `<Modal>`. Tiene título, mensaje, texto del botón y tono `danger`. El foco arranca en "Cancelar", y `busy` queda activo mientras corre la acción.
- Modify: `src/app/admin/fiscal/FiscalClient.tsx`: el `confirm` de la línea 299 (descartar factura). Es el último PR en FiscalClient: el orden fue F0-9, F1-1b, F1-7 y F5-16.
- Modify: `src/app/admin/categorias/CategoriesClientTable.tsx`: el de la 39, con el texto nuevo "¿Seguro que querés eliminar la categoría …?".
- Modify: `src/app/admin/rooms/RoomsClientTable.tsx`: el de la 48.
- Modify: `src/app/admin/clientes/ClienteFicha.tsx`: los `confirm` de borrar persona y de archivar o reactivar empresa que F3-4 mudó a la ficha (hoy están en `GuestDirectoryTable.tsx:31` y `AssociatedClientsClientTable.tsx:36` y `:56`).
- Modify, para usar `src/lib/payment-methods.ts` (lo crea F3-1; este PR no lo crea):
  - `caja/CajaClient.tsx` (METHOD_META, 28)
  - `caja/CloseShiftModal.tsx` (METHOD_META en la 93 y la lista de la 352)
  - `caja/rendiciones/[id]/page.tsx` (24 y 298)
  - `finances/page.tsx` (el switch de la 31)
  - `analytics/DashboardCharts.tsx` (37)
  - `recibo/[paymentId]/page.tsx` (17)
  - `recibo-cc/[movementId]/page.tsx` (23)
  - `src/lib/csv.ts` (23)
- Create: `src/__tests__/confirm-dialog.test.tsx` y `src/__tests__/payment-methods.test.ts`.

**Pasos**
1. Correr `grep -rn "confirm(" src/app` y `grep -rn '"Mercado Pago"' src` sobre main.
2. Escribir ConfirmDialog con sus tests.
3. Pasar cada `confirm` a un estado "pendiente de confirmar": `confirm()` frenaba todo hasta la respuesta y el modal no, así que la acción corre en `onConfirm`.
4. Reemplazar las etiquetas por las de payment-methods.ts.

**Aceptación**
- [ ] Descartar una factura o borrar una habitación, una categoría o un cliente muestra el diálogo del sistema, y un Enter por error no borra porque el foco está en "Cancelar".
- [ ] Los nombres de los medios de pago son los mismos en Caja, Cobros del día, Tablero, los recibos y el CSV del turno.

**Tests** (Vitest)
- `confirm-dialog.test.tsx`: "Cancelar" y Escape no ejecutan la acción, "Confirmar" sí, y el foco inicial está en "Cancelar".
- En CategoriesClientTable, con la acción de borrar simulada: "Cancelar" no la llama.
- `payment-methods.test.ts`: cada valor de `PaymentMethod` (cash, credit_card, debit_card, bank_transfer, other, mercado_pago, vale_blanco, cuenta_corriente) tiene etiqueta.

**Verificación en PROD**
- Abrir el diálogo de borrar una categoría y cancelar.
- Mirar los medios de pago en Caja y en un recibo.

👤 **AGUSTÍN:** si el contador filtra el CSV del turno por el nombre del medio, avisale que puede cambiar, por ejemplo de "Tarjeta credito" a "Tarjeta crédito". Si preferís que el CSV no cambie, `csv.ts` queda afuera.

**Riesgos.**
- `confirm()` frenaba todo hasta la respuesta y el modal no: el código que venía después tiene que pasar a `onConfirm`, y hay que revisar llamada por llamada.
- El texto del CSV cambia (ver el paso de Agustín).

### F5-10a · DataTable compartido + PageHeader en Caja y Facturación

**Rama:** `claude/datatable-pageheader-caja-facturacion` · **Carril:** J · **Depende de:** F5-7, F2-7b, F1-7 · **Migración:** no · **Esfuerzo:** 0,75 días

**Por qué.** `PageHeader` ya existe en `src/app/admin/PageShell.tsx`, pero solo lo usan 4 de las 26 páginas del panel; el resto arma su propio `<h1>` y cada una se ve distinta. Remitos es la única pantalla con una tabla que en el celular pasa a tarjetas. Este PR convierte ese armado en un componente y empieza por Caja y Facturación.

**Archivos**
- Create: `src/components/ui/DataTable.tsx`: generaliza `src/app/admin/remitos/RemitosClient.tsx:273-318`, que muestra una tabla `hidden md:block overflow-x-auto` y una lista de tarjetas `md:hidden`. Recibe `columns`, `rows`, `getKey`, `renderCard` y `empty`; `empty` usa el EmptyState de F5-7.
- Modify, para pasar su título a `PageHeader`:
  - `src/app/admin/caja/CajaClient.tsx` (el `<h1>` de la 74)
  - `src/app/admin/caja/rendiciones/page.tsx`
  - `src/app/admin/caja/rendiciones/[id]/page.tsx`
  - `src/app/admin/fiscal/control/page.tsx`
  - `src/app/admin/fiscal/consolidada/page.tsx`
  - `src/app/admin/remitos/page.tsx`
- Modify: `src/app/admin/caja/rendiciones/page.tsx`: la tabla de turnos (68) pasa a `DataTable` y es el primer uso.
- Create: `src/__tests__/data-table.test.tsx`.

**Pasos**
1. Rehacer la lista con grep (`<h1` sin `PageHeader`) sobre `caja`, `fiscal` y `remitos`.
2. Si F1-1b ya pone el nombre de la sección en la barra de arriba, PageHeader lleva el título de la pantalla y no lo repite.
3. Quedan afuera: las páginas que se imprimen (`factura/`, `recibo/`, `recibo-cc/`, `comprobante-cc/`) y las tablas de ControlClient y FiscalClient, que ya se pueden correr de costado (`overflow-x-auto`) y no se tocan acá.

**Aceptación**
- [ ] En el celular, Rendiciones muestra una tarjeta por turno, sin columnas cortadas.
- [ ] Caja, Rendiciones, Control, Consolidada y Remitos tienen el mismo encabezado que Hoy.

**Tests** (Vitest)
- `data-table.test.tsx`:
  - Arma la tabla con `hidden md:block` y las tarjetas con `md:hidden`, con los mismos datos.
  - Sin filas, muestra el EmptyState.
  - Cada fila y cada tarjeta usa `getKey`.

**Verificación en PROD**
- Abrir Caja › Rendiciones en el celular (375 px) y en la PC.

👤 **AGUSTÍN:** nada especial; mirar Rendiciones en el celular.

**Riesgos.** Bajos: es maquetado. RemitosClient no se migra a DataTable, porque ya anda y sus tests (`RemitosClient.test.tsx`) no se tocan.

### F5-10b · PageHeader en Reservas (calendario, solicitudes, por llegar, historial)

**Rama:** `claude/pageheader-reservas` · **Carril:** J · **Depende de:** F5-10a, F4-9, F1-8 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Calendario y Solicitudes ya usan PageHeader; Por llegar e Historial no. Recepción, que desde F1-8 entra a Por llegar, ve la sección con el mismo encabezado en todas sus pestañas.

**Archivos**
- Modify: `src/app/admin/guests/page.tsx`: el `<h1>` pasa a `PageHeader` en las vistas Por llegar e Historial.
- Modify: `src/app/admin/calendario/page.tsx` y `src/app/admin/solicitudes/page.tsx`: solo si hace falta alinearlos con las pestañas de F1-1b.

**Pasos**
1. Hacer el grep de `<h1` en `calendario`, `solicitudes` y `guests`.
2. Respetar la vista de solo lectura de recepción (F1-8): en PageHeader no aparece ninguna acción que recepción no pueda usar.

**Aceptación**
- [ ] Las cuatro pestañas de Reservas tienen el mismo encabezado.
- [ ] Recepción ve Por llegar sin botones nuevos.

**Tests** (Vitest)
- No suma tests: es maquetado de servidor. Los tests que ya existen quedan en verde.

**Verificación en PROD**
- Entrar como recepción a Reservas › Por llegar y como admin a Reservas › Historial.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-10c · PageHeader en Clientes

**Rama:** `claude/pageheader-clientes` · **Carril:** J · **Depende de:** F5-10a, F3-8 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Después de F3, Clientes es una sola pantalla con filtros, y su encabezado tiene que ser igual al del resto de las secciones.

**Archivos**
- Modify: `src/app/admin/clientes/page.tsx` (lo crea F3-5a): el título pasa a `PageHeader`, con las acciones (nuevo cliente, CSV de "Con saldo") a la derecha.
- Modify: `src/app/admin/asociados/page.tsx`, `src/app/admin/descuentos/page.tsx` y `src/app/admin/cuentas/page.tsx`, solo si alguno sigue siendo una pantalla y no un redirect después de F3-6.

**Pasos**
1. Hacer el grep de `<h1` en `clientes`, `asociados`, `descuentos` y `cuentas`.
2. Migrar.

**Aceptación**
- [ ] Clientes tiene el mismo encabezado que Hoy y que Caja, con sus acciones a la derecha.

**Tests** (Vitest)
- No suma tests: es maquetado. Los tests de Clientes que dejó F3 quedan en verde.

**Verificación en PROD**
- Abrir Clientes en la PC y en el celular.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-10d · PageHeader en Tablero, Configuración y Limpiezas

**Rama:** `claude/pageheader-tablero-config` · **Carril:** J · **Depende de:** F5-10a, F1-10, F4-7, F4-6 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Tablero, Configuración y Limpiezas todavía arman su propio título. Con este PR, todas las pantallas del panel tienen el mismo encabezado.

**Archivos**
- Modify, para pasar su título a `PageHeader`:
  - `src/app/admin/analytics/page.tsx`
  - `src/app/admin/analytics/habitaciones/page.tsx`
  - `src/app/admin/finances/page.tsx`
  - `src/app/admin/settings/page.tsx`
  - `src/app/admin/rooms/page.tsx`
  - `src/app/admin/categorias/page.tsx`
  - `src/app/admin/mantenimiento/page.tsx` (la 155)

**Pasos**
1. Hacer el grep de `<h1` en esas carpetas.
2. En Limpiezas, el link "Ver como mantenimiento" de F4-7 pasa a las acciones de PageHeader.
3. En Configuración, respetar las pestañas de F1-10.

**Aceptación**
- [ ] Ninguna pantalla del panel conserva un `<h1>` propio, salvo las que se imprimen.
- [ ] "Ver como mantenimiento" sigue arriba a la derecha en Limpiezas.

**Tests** (Vitest)
- No suma tests: es maquetado. Los tests que ya existen quedan en verde.

**Verificación en PROD**
- Recorrer Tablero (sus cuatro pestañas) y Configuración (sus cuatro pestañas) en el celular.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-14 · Tablas en celular: lista de Clientes, historial y por llegar, y la fila que desborda en Solicitudes

**Rama:** `claude/tablas-celular` · **Carril:** J · **Depende de:** F5-10a, F3-6, F4-2 · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** En el celular, Por llegar e Historial cortan las columnas de la derecha: una tabla dentro de un `overflow-hidden`, sin forma de verlas. En Solicitudes, la fila de una solicitud procesada se sale de la pantalla. Recepción usa Por llegar todos los días desde el teléfono.

**Archivos**
- Modify: `src/app/admin/guests/UpcomingGuestsTable.tsx`: el contenedor de la 19 pasa a `DataTable`, con una tarjeta por llegada (nombre, habitación, fecha, saldo).
- Modify: `src/app/admin/guests/GuestsClientTable.tsx`: el contenedor de la 49 pasa a `DataTable`.
- Modify: `src/app/admin/clientes/ClientesTable.tsx` (lo crea F3-5a): pasa a `DataTable`, si F3 no lo dejó así.
- Modify: `src/app/admin/solicitudes/SolicitudesClient.tsx`: la fila de 379-386 (`flex items-center gap-4`) pasa a `flex flex-wrap gap-x-4 gap-y-1`, para que DNI, habitación y fechas bajen de línea.
- Ya no se tocan, porque F3-6 los borra: `GuestDirectoryTable.tsx` y `DiscountsManager.tsx`.
- Create: `src/app/admin/guests/UpcomingGuestsTable.test.tsx`.

**Pasos**
1. Correr `grep -rln "overflow-hidden" src/app/admin | xargs grep -l "<table"` sobre main.
2. Migrar cada tabla a DataTable, con una tarjeta pensada para el celular: primero lo que recepción mira.
3. Arreglar la fila de Solicitudes.

**Aceptación**
- [ ] En un celular de 375 px, recepción ve en Por llegar el nombre, la habitación, la fecha y el saldo de cada llegada, sin nada cortado.
- [ ] Historial y Clientes se leen en tarjetas en el celular.
- [ ] En Solicitudes, ninguna fila se sale de la pantalla.

**Tests** (Vitest)
- `UpcomingGuestsTable.test.tsx`: con dos llegadas, el nombre de cada una aparece en la tabla y en la lista de tarjetas (`md:hidden`), y la tabla ya no está dentro de un `overflow-hidden`.

**Verificación en PROD**
- En el celular, abrir Reservas › Por llegar, Reservas › Historial, Clientes y Solicitudes.

👤 **AGUSTÍN:** pedirle a recepción que mire Por llegar en su celular el día del deploy.

**Riesgos.** Bajos: es maquetado. Las acciones de cada fila, como cancelar (F4-2), tienen que estar también en la tarjeta.

### F5-11a · Contraste y foco: inputClass compartido + texto slate-500 en Caja y Facturación

**Rama:** `claude/contraste-foco-caja-facturacion` · **Carril:** J · **Depende de:** F5-7, F2-7b · **Migración:** no · **Esfuerzo:** 0,75 días

**Por qué.** Hay dos problemas de legibilidad. El texto secundario en `slate-400` sobre blanco se lee mal, sobre todo en un celular con luz fuerte. Y los campos usan `focus:ring` con cuatro colores distintos (brand y emerald) y sin `focus-visible`. Este PR crea la clase compartida y empieza por Caja y Facturación, que es donde se cuenta la plata.

**Archivos**
- Create: `src/lib/ui.ts`: exporta `inputClass`: borde slate-300, `focus-visible:ring-2 focus-visible:ring-brand-500`, `outline-none` y texto slate-800. También exporta `focusRing` para los botones.
- Modify: `src/app/admin/caja/*`, `src/app/admin/fiscal/*`, `src/app/admin/remitos/*`, `src/app/admin/InvoicePromptModal.tsx` y `src/app/admin/PageShell.tsx` (el subtítulo). Hoy suman unos 61 `text-slate-400` y 30 `focus:ring…`.
- Create: `src/__tests__/ui.test.ts`.

**Pasos**
1. Correr `grep -rnE "text-slate-400|focus:ring" src/app/admin/{caja,fiscal,remitos} src/app/admin/InvoicePromptModal.tsx src/app/admin/PageShell.tsx`.
2. `text-slate-400` pasa a `text-slate-500` solo cuando es texto. Quedan como están:
   - `placeholder:`, `border-`, `bg-` y `fill-`.
   - Los íconos decorativos.
3. En `<input>`, `<select>` y `<textarea>`, el `focus:ring…` pasa a `inputClass`. En los botones, `focus:` pasa a `focus-visible:`.

**Aceptación**
- [ ] Recorriendo el cierre de caja y la pantalla de facturación con Tab, cada campo muestra el mismo anillo verde.
- [ ] Las fechas, aclaraciones y contadores se leen más oscuros y se siguen distinguiendo del texto principal.

**Tests** (Vitest)
- `ui.test.ts`: `inputClass` contiene `focus-visible:ring-2` y no contiene `focus:ring` sin `-visible`.

**Verificación en PROD**
- En la PC, recorrer con Tab el cierre de turno y Facturación › Por facturar.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Hay mucho diff mecánico. Por eso va por carpeta, cuando los carriles funcionales ya cerraron estos archivos.

### F5-11b · Contraste y foco: Reservas, calendario y tarjeta de habitación

**Rama:** `claude/contraste-foco-reservas` · **Carril:** J · **Depende de:** F5-11a, F4-4, F4-9 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Es lo que más usa recepción: el calendario, las tarjetas de habitación y los modales de reserva. Hoy suman unos 60 `text-slate-400` y 39 `focus:ring…`.

**Archivos**
- Modify: `src/app/admin/calendario/*`, `src/app/admin/solicitudes/*` y `src/app/admin/guests/*`.
- Modify: `src/app/admin/RoomCard.tsx` y los modales de reserva (`WalkInModal`, `NewReservationModal`, `EditReservationModal`, `ChangeRoomModal`, `ExtraChargesModal`, `CompanyCheckInModal`, `EarlyCheckoutModal`).
- Modify: `DateTimePickerField.tsx`, `GuestRegistryFields.tsx` y `CompanyPassengerSelector.tsx`, todos en `src/app/admin/`.

**Pasos**
1. Hacer el grep con esa lista.
2. Aplicar el mismo criterio que F5-11a, usando `inputClass` de `src/lib/ui.ts`.

**Aceptación**
- [ ] En Reserva nueva y en el walk-in, cada campo muestra el anillo verde al llegar con Tab.
- [ ] El texto secundario de las tarjetas de habitación se lee sin forzar la vista.

**Tests** (Vitest)
- No suma tests (es de clases). Los tests de los modales de F5-8 quedan en verde.

**Verificación en PROD**
- Recorrer con Tab un walk-in y Reserva nueva, y mirar la grilla de Hoy en el celular.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-11c · Contraste y foco: Clientes

**Rama:** `claude/contraste-foco-clientes` · **Carril:** J · **Depende de:** F5-11a, F3-8 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Deja la ficha y la lista de Clientes con el mismo contraste y el mismo foco que el resto. Hoy suman unos 27 `text-slate-400` y 40 `focus:ring…`.

**Archivos**
- Modify: `src/app/admin/clientes/*` y lo que quede de `cuentas/`, `asociados/` y `descuentos/` después de F3-6.
- Modify: `src/app/admin/ClientSearch.tsx`, `src/app/admin/GuestSelector.tsx`, `src/app/admin/AssociatedClientSelector.tsx` y `src/app/admin/EstadoPagoTag.tsx`.

**Pasos**
1. Hacer el grep con esa lista sobre main.
2. Aplicar el criterio de F5-11a.

**Aceptación**
- [ ] En la ficha, los campos editables (F3-4) muestran el anillo verde con Tab.
- [ ] Los datos secundarios, como el CUIT, la última estadía o la condición de IVA, se leen bien.

**Tests** (Vitest)
- No suma tests. Los de Clientes (`CuentasClient.test.tsx`, `RegisterPaymentModal.test.tsx` y los de F3) quedan en verde.

**Verificación en PROD**
- Abrir una ficha de empresa y editar un dato con el teclado.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-11d · Contraste y foco: Mantenimiento, Tablero y Configuración

**Rama:** `claude/contraste-foco-mantenimiento-tablero-config` · **Carril:** J · **Depende de:** F5-11a, F4-8, F1-10 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Es el resto del panel. Mantenimiento se usa en el celular, y Configuración tiene la mayor cantidad de campos: hoy suman unos 58 `text-slate-400` y 110 `focus:ring…`.

**Archivos**
- Modify: `src/app/maintenance/*`, `src/app/admin/mantenimiento/*`, `src/app/admin/analytics/*` y `src/app/admin/finances/*`.
- Modify: `src/app/admin/settings/*`, `src/app/admin/rooms/*` y `src/app/admin/categorias/*`.
- Modify: el menú y la estructura del panel: `Sidebar.tsx`, `MobileNav.tsx`, `PaginationFooter.tsx`, `DateRangeFilter.tsx` y `loading.tsx`, en `src/app/admin/`.

**Pasos**
1. Hacer el grep con esa lista.
2. Aplicar el criterio de F5-11a.
3. La web pública (`src/app/components`, `src/app/page.tsx`) y `login` quedan fuera de F5-11, porque no son del panel.

**Aceptación**
- [ ] En Configuración y en el formulario "Reportar desperfecto" (F4-8), cada campo muestra el anillo verde con Tab.
- [ ] El texto secundario del Tablero se lee bien en el celular.

**Tests** (Vitest)
- No suma tests; los que ya existen quedan en verde.

**Verificación en PROD**
- Abrir la pantalla de mantenimiento en un celular y Configuración › Hotel y mensajes en la PC, con Tab.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos. Es la parte con más diff (110 focos), pero todo es de clases.

### F5-12 · KPIs sin degradé y sin desbordar: tarjetas blancas + @container

**Rama:** `claude/kpi-tarjetas-blancas` · **Carril:** J · **Depende de:** F5-1, F5-3, F4-6 · **Migración:** no · **Esfuerzo:** 1,5 días

**Por qué.** Hay dos problemas con las tarjetas grandes de Cobros del día y del Tablero. Tienen fondo de color o degradé con texto blanco encima, que se lee mal. Y su grilla depende del ancho de la pantalla, no del de la tarjeta, así que en el celular un monto largo se amontona con el ícono. Caja ya usa tarjetas blancas: se toma esa como modelo.

**Archivos**
- Create: `src/components/ui/KpiCard.tsx`: fondo blanco con una franja de color de 4 px arriba (`border-t-4`) y el ícono en ese color. Recibe `label`, `value`, `hint` y `tone`. El número lleva `tabular-nums whitespace-nowrap min-w-0`.
- Modify: `src/app/admin/finances/page.tsx`: la grilla de la 167 y las tarjetas de 168 (verde entero), 192 (degradé) y 207 (ámbar entero) pasan a `KpiCard`, con `@container` en el padre.
- Modify: `src/app/admin/caja/CajaClient.tsx`: la grilla de la 156 gana `@container` y el número gana `tabular-nums`. Las tarjetas ya son blancas.
- Modify: `src/app/admin/analytics/page.tsx`: las `heroCards` (94-99, con `gradient`) pasan a `KpiCard`, y la grilla de la 144 usa variantes `@md:`/`@lg:`. El ícono de la 128 queda sin degradé.
- Modify: `src/app/admin/analytics/habitaciones/page.tsx`: el ícono de la 40 queda sin degradé.
- Create: `src/__tests__/ui-kpi-card.test.tsx`.

**Pasos**
1. Hacer el grep de `bg-gradient` y de `grid-cols` en esas pantallas sobre main, porque F1-9 y F4-6 las cambian.
2. Escribir KpiCard. Tailwind 4 trae `@container` sin plugin.
3. En el Tablero, el número grande usa `formatAmountKpi` ("$12,1 M"), con el monto exacto en `title` y abajo en `text-xs`.
4. En Caja y en Cobros del día la plata no se abrevia, porque ahí se cuenta billete por billete.

**Aceptación**
- [ ] En un celular de 320 a 375 px, ningún número de las tarjetas se corta ni se pisa con el ícono.
- [ ] Las tarjetas son blancas con una franja de color, y la más importante (Ingresos del día) sigue destacando.
- [ ] En Caja y en Cobros del día los montos se ven completos, con centavos.

**Tests** (Vitest)
- `ui-kpi-card.test.tsx`: el nodo del número tiene `tabular-nums` y `whitespace-nowrap`, ninguna clase contiene `bg-gradient`, y `hint` se muestra si viene.

**Verificación en PROD**
- Abrir Tablero › General, Tablero › Cobros del día y Caja en un celular real, o emulado a 375 px.

👤 **AGUSTÍN:** mirar las capturas antes del merge. Es un cambio de estilo visible, de degradé a tarjeta blanca con franja. Si preferís otros colores para las franjas, se cambian en el mismo PR.

**Riesgos.** El riesgo es estético, no técnico: por eso las capturas van antes del merge.

### F5-18a · Usuarios: labels accesibles y fuera la opción "Cliente" del selector de rol

**Rama:** `claude/usuarios-labels-sin-cliente` · **Carril:** J · **Depende de:** F1-10 · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** En Configuración › Usuarios, los campos de nombre y rol de cada fila no tienen etiqueta, y un lector de pantalla los anuncia como "campo de texto" sin más. Además, el selector de rol ofrece "Cliente", que no es un rol de empleado: en PROD nadie lo tiene (4 admin, 6 recepción, 1 mantenimiento).

**Archivos**
- Modify: `src/app/admin/settings/UsersPanel.tsx`:
  - La 143 (nombre) y la 151 (rol) ganan `aria-label="Nombre de <email>"` y `aria-label="Rol de <email>"`, o un `<label className="sr-only">` con `htmlFor`.
  - Sale `<option value="client">` (159).
  - "No hay usuarios registrados." (113) pasa a `EmptyState`.
- Modify: `src/app/admin/settings/actions.ts`: `updateProfileAction` (105) deja de aceptar `"client"` y contesta "Rol inválido". El tipo `UserRole` no cambia.
- Create: `src/app/admin/settings/UsersPanel.test.tsx`.

**Pasos**
1. Rebasear sobre F1-10: UsersPanel ya vive en la pestaña Usuarios.
2. Antes del merge, correr un SELECT de solo lectura: `select role, count(*) from public.profiles group by role` no tiene que mostrar `client`.
3. El texto "desde el dashboard de Supabase" queda como está: invitar desde el panel es F5-18b, que está postergado (Q11).

**Aceptación**
- [ ] Un lector de pantalla dice "Nombre de …" y "Rol de …" al llegar a cada campo.
- [ ] El selector de rol ofrece Administrador, Recepción y Mantenimiento, sin Cliente.
- [ ] Cambiar el nombre o el rol de un empleado sigue andando.

**Tests** (Vitest)
- `UsersPanel.test.tsx`: `getByLabelText("Rol de …")` encuentra el select, y no existe ninguna `option` con value `client`.
- `updateProfileAction` con `"client"`, simulando `assertAdmin`: devuelve error y no llama a `rpc_admin_update_profile`.

**Verificación en PROD**
- Como admin, abrir Configuración › Usuarios, cambiar el nombre de un usuario de prueba y volverlo a dejar como estaba.

👤 **AGUSTÍN:** confirmar que nadie usa el rol Cliente (el SELECT del paso 2) y mergear.

**Riesgos.** Bajos. Si algún día aparece un perfil con rol `client`, su fila muestra el select sin opción elegida, pero editarlo no le cambia el rol hasta que se guarde.

### F5-13a · Letra mínima 12 px: Caja y Facturación

**Rama:** `claude/letra-12px-caja-facturacion` · **Carril:** J · **Depende de:** F5-11a · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** En el panel hay unos 100 textos de 7 a 11 px, casi ilegibles en el celular. La guía (F5-15) fija 12 px como mínimo, con 11 px solo en las barras del calendario. Se empieza por Caja y Facturación, que hoy tienen 26, de los cuales 10 están en `InvoicePromptModal`.

**Archivos**
- Modify: `src/app/admin/caja/*`, `src/app/admin/fiscal/*`, `src/app/admin/remitos/*` e `src/app/admin/InvoicePromptModal.tsx`: `text-[7px]` a `text-[11px]` pasan a `text-xs`.
- Create: `src/__tests__/letra-minima.test.ts`.

**Pasos**
1. Correr `grep -rnE "text-\[(7|8|9|10|11)px\]"` sobre esas carpetas.
2. Reemplazar. Si un badge queda apretado, se agranda el contenedor; no se achica la letra.
3. Crear el test con una lista de carpetas barridas. Este PR pone Caja y Facturación, y cada F5-13 que sigue suma las suyas.

**Aceptación**
- [ ] En Caja, el cierre de turno, Facturación, Remitos y la pregunta de factura no queda texto de menos de 12 px, y ningún badge se desarma.

**Tests** (Vitest)
- `letra-minima.test.ts`: en las carpetas de la lista no aparece `text-[7px]` a `text-[11px]`. Con una fuente armada en memoria, el test falla si aparece.

**Verificación en PROD**
- En el celular, mirar el cierre de turno, Remitos y la pregunta de factura de un check-out.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos. Las tablas densas, como Remitos, pueden crecer un poco en alto.

### F5-13b · Letra mínima 12 px: Reservas y calendario (11 px solo en las barras)

**Rama:** `claude/letra-12px-reservas` · **Carril:** J · **Depende de:** F5-11b · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Es lo que más lee recepción. Hoy hay 26 textos chicos, repartidos entre calendario, historial, la tarjeta de habitación y los modales de reserva.

**Archivos**
- Modify: `src/app/admin/calendario/*`, `src/app/admin/solicitudes/*` y `src/app/admin/guests/*`.
- Modify: `src/app/admin/RoomCard.tsx` y los modales de reserva.
- Modify: `DateTimePickerField.tsx` y `CompanyPassengerSelector.tsx`, en `src/app/admin/`.
- Modify: `src/__tests__/letra-minima.test.ts`: suma estas carpetas y deja 11 px permitido solo en las barras de `CalendarClient.tsx`.

**Pasos**
1. Hacer el grep sobre esas carpetas. F4-9 ya sacó los 7 y 9 px del calendario (hoy en 460, 563 y 584). Si alguno quedó, entra acá.
2. Reemplazar por `text-xs`, salvo el texto de las barras del calendario, que puede quedar en 11 px.

**Aceptación**
- [ ] En la tarjeta de habitación y en los modales de reserva no queda texto de menos de 12 px.
- [ ] Las barras del calendario se leen en 11 px sin cortar el nombre más de lo que ya lo corta F4-9.

**Tests** (Vitest)
- `letra-minima.test.ts` con las carpetas nuevas y la excepción del calendario.

**Verificación en PROD**
- Mirar Hoy y el calendario en el celular de recepción.

👤 **AGUSTÍN:** preguntarle a recepción si el calendario se lee mejor.

**Riesgos.** Bajos. Si la grilla de Hoy se hace más alta, el cambio es visible en el celular.

### F5-13c · Letra mínima 12 px: Clientes

**Rama:** `claude/letra-12px-clientes` · **Carril:** J · **Depende de:** F5-11c · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** La ficha y la lista de Clientes tienen hoy 23 textos chicos: etiquetas de solapas, estados de pago y CUIT.

**Archivos**
- Modify: `src/app/admin/clientes/*` y lo que quede de `cuentas/`, `asociados/` y `descuentos/`.
- Modify: `src/app/admin/ClientSearch.tsx` y `src/app/admin/EstadoPagoTag.tsx`.
- Modify: `src/__tests__/letra-minima.test.ts`: suma esas carpetas.

**Pasos**
1. Hacer el grep sobre main.
2. Reemplazar por `text-xs`.

**Aceptación**
- [ ] En la ficha de un cliente y en la lista no queda texto de menos de 12 px, y la pastilla de estado de pago entra en su columna.

**Tests** (Vitest)
- `letra-minima.test.ts` con las carpetas de Clientes.

**Verificación en PROD**
- Abrir la ficha de una empresa con varias estadías.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-13d · Letra mínima 12 px: Mantenimiento, Tablero y Configuración

**Rama:** `claude/letra-12px-mantenimiento-tablero-config` · **Carril:** J · **Depende de:** F5-11d, F5-18a · **Migración:** no · **Esfuerzo:** 0,5 días

**Por qué.** Cierra la letra mínima en todo el panel. Hoy hay 16 textos chicos, entre ellos el badge "ADMIN" de Usuarios y los números del menú.

**Archivos**
- Modify: `src/app/maintenance/*`, `src/app/admin/mantenimiento/*`, `src/app/admin/analytics/*` y `src/app/admin/finances/*`.
- Modify: `src/app/admin/settings/*` (incluido el badge de `UsersPanel.tsx`, hoy en la 136), `src/app/admin/rooms/*` y `src/app/admin/categorias/*`.
- Modify: el menú (`Sidebar.tsx`, `MobileNav.tsx` y la barra de arriba de F1-1b). Va acá porque no es de ninguna carpeta y el carril D ya lo cerró.
- Modify: `src/__tests__/letra-minima.test.ts`: la lista pasa a ser todo `src/app/admin` y `src/app/maintenance`, con la excepción del calendario.

**Pasos**
1. Hacer el grep sobre main.
2. Reemplazar por `text-xs`, cuidando que los números del menú y de la campana entren en su círculo.
3. La web pública (hoy 12 textos) queda fuera: no es del panel.

**Aceptación**
- [ ] En todo el panel no queda texto de menos de 12 px, salvo las barras del calendario.
- [ ] Los números del menú y de la campana se leen y no se salen de su círculo.

**Tests** (Vitest)
- `letra-minima.test.ts` sobre todo el panel.

**Verificación en PROD**
- Mirar el menú del celular, la pantalla de mantenimiento y Configuración › Usuarios.

👤 **AGUSTÍN:** nada especial.

**Riesgos.** Bajos.

### F5-6 · Regla de ESLint: prohibir formateo suelto de plata y fecha en src/app (último PR del plan)

**Rama:** `claude/eslint-formato-plata-fecha` · **Carril:** J · **Depende de:** F5-1, F5-2, F5-3, F5-4, F5-5, F5-12, F5-16, F5-13d · **Migración:** no · **Esfuerzo:** 1 día

**Por qué.** Sin un freno automático, la próxima pantalla va a volver a escribir `toLocaleString('en-US')` o una fecha sin la zona del hotel, como pasó en Finanzas. La regla va al final de todo el plan, cuando ya no quedan PRs que agreguen código de F0 a F4.

**Archivos**
- Modify: `eslint.config.mjs`: suma un bloque para `src/app/**/*.{ts,tsx}` que deja afuera `**/*.test.{ts,tsx}`. Usa `no-restricted-syntax` con un mensaje en castellano ("Usá formatAmount, formatPrice, formatPercent o formatNumber de @/lib/format, o los helpers de @/lib/time") y frena:
  - `CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]`
  - `NewExpression` y `CallExpression` de `Intl.NumberFormat` e `Intl.DateTimeFormat`
  - `Literal[value="en-US"]`
- Modify: el barrido de lo que queda, según el crítico:
  - `NewReservationModal.tsx` (424, 523, 670, 676, 677 y 683)
  - `ClientSearch.tsx` (143 y 177)
  - `src/app/components/PublicSearchForm.tsx` (47 y 96)
  - `src/app/page.tsx` (200, que pasa a `formatDateKey`)
  - `settings/FiscalSettingsPanel.tsx` (255, que pasa a `formatHotelDate`)
  - `calendario/page.tsx` (44, que pasa a `hotelDateKey`)
- Modify: `src/app/admin/calendario/CalendarClient.tsx:53-54`: los formateadores en UTC, que son así a propósito, se mudan a `src/lib/calendar.ts`. El crítico no los listaba, pero la regla los frena.
- Modify: `src/app/admin/RoomCard.tsx`, si F5-3 lo salteó, y cualquier otro uso que F0 a F4 hayan sumado.
- Create: `src/__tests__/eslint-formato.test.ts`.

**Pasos**
1. Agregar la regla como `error` y correr `npm run lint` en la rama.
2. Barrer todo lo que marque.
3. Si queda algo que no se puede limpiar en el día, la regla entra como `warn` y pasa a `error` en un PR de una línea.
4. Correr `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` antes de abrir el PR.

**Aceptación**
- [ ] `npm run lint` pasa limpio en main.
- [ ] Si alguien escribe `monto.toLocaleString("en-US")` en una pantalla, el CI falla con el mensaje en castellano que dice qué usar.

**Tests** (Vitest)
- `eslint-formato.test.ts`, con `// @vitest-environment node` y un timeout de 30 s:
  - `ESLint.lintText` de un archivo falso en `src/app/admin/` con `toLocaleString` da 1 error.
  - El mismo texto en `src/lib/` da 0.
- Si en CI tarda más de 10 s, se saca el test y alcanza con `npm run lint`.

**Verificación en PROD**
- La regla no cambia nada en PROD. Lo que se verifica es el barrido: después del deploy, abrir Reserva nueva, la web pública con fechas elegidas y Configuración › ARCA (vencimiento del certificado), y ver que los montos y las fechas siguen iguales.

👤 **AGUSTÍN:** para que la regla frene de verdad, el check "ci" tiene que ser obligatorio en la protección de main, y hoy todavía no lo es. Activarlo desde GitHub (Settings › Branches) es un paso tuyo.

**Riesgos.** Si F0 a F4 dejaron usos nuevos, el barrido crece. Para eso está la salida del `warn`.

#### Fusionados o descartados

- **F5-17 · Jerga visible a texto llano (barrido general).** Postergado: no tiene un alcance concreto, y extendía un test que iba a fallar el primer día. Vuelve cuando Agustín pase la lista de términos y pantallas (Q10). Mientras tanto, la guía de F5-15 frena las palabras nuevas. Estimado original: 1 día.
- **F5-18b · Usuarios: invitar desde el panel (clave service_role solo en el servidor).** Postergado: sería el primer cliente service_role del repo, que es público, y esa clave saltea toda la RLS. Además, el correo de Supabase tiene un cupo muy bajo. Vuelve solo con OK de Agustín (Q11). En ese caso: la clave va solo en Coolify (nunca `NEXT_PUBLIC`), con `import "server-only"`, revisión de seguridad y un SMTP propio configurado. Estimado: 1,5 días.
- **Partidos, no descartados:** F5-8 pasó a F5-8a–e y F5-9 a F5-9a–c (un modal por PR). F5-10, F5-11 y F5-13 se partieron por carpeta en a–d. F5-18 se partió en F5-18a y F5-18b. Todo el alcance de los originales quedó en esas partes, salvo `AssociatedClientLedgerModal`, que borra F3-3b.

---

## Cuestionario para Agustín

Contestá antes de arrancar el PR que cada una bloquea; lo demás puede avanzar.

Las más urgentes son Q1 y Q2, porque frenan PRs de la fase 0 que arrancan ya. Después vienen Q5 y Q6 (carril de Clientes) y Q3 (carril de check-out). Q4, Q10 y Q11 solo destraban PRs postergados, así que no hay apuro.

1. **Q1 · Cuentas corrientes que facturan en cada check-out.** Hay 3 empresas y 3 huéspedes con cuenta corriente que hoy están en "Factura por cada check-out", con 21 estadías fiadas y ninguna factura autorizada. ¿Pasan todas a "Consolidada" (una factura por período)? ¿O alguna quiere factura en cada salida a propósito?
   - **Bloquea:** F0-2
   - **Recomendación:** pasarlas todas a Consolidada, salvo las que me nombres. El cambio lo hacés vos desde la ficha (Editar → Facturación) después del deploy de F0-2. Esas 21 estadías pasan a salir en la consolidada.

2. **Q2 · Habitaciones y precios, solo el admin.** Hoy una recepcionista puede cambiar habitaciones y precios de categoría escribiendo /admin/rooms en el navegador. F0-7 lo cierra en pantalla. ¿Lo cerramos también en la base (mig 118, con tu OK para aplicarla)? ¿Y recepción usa esa pantalla para algo, por ejemplo para marcar una habitación fuera de servicio?
   - **Bloquea:** F0-8
   - **Recomendación:** sí a las dos capas. Si recepción marca habitaciones fuera de servicio desde ahí, avisame antes del merge de F0-7 y le dejamos ese botón en otro lugar.

3. **Q3 · Editar fechas y la tarifa.** Al editar las fechas de una reserva, el sistema recalcula toda la estadía al precio de HOY de la habitación y, si la reserva es de una persona, pierde el descuento del huésped. "Ampliar", en cambio, respeta la tarifa con la que se reservó. ¿Querés que editar fechas también conserve la tarifa y el descuento? En PROD hay 10 reservas de persona con descuento.
   - **Bloquea:** F2-2, F2-13
   - **Recomendación:** sí, conservar: es la regla de siempre (la tarifa se congela al crear). Va como PR aparte (F2-13, mig 122). Mientras tanto, F2-2 muestra en la vista previa lo que hace hoy el servidor, así no hay sorpresas al guardar.

4. **Q4 · Walk-in que paga al entrar.** ¿Es común que el pasajero de walk-in pague al entrar?
   - **Bloquea:** F2-12
   - **Recomendación:** si no es común, F2-12 queda afuera, porque suma un clic a cada walk-in. Si lo es, vuelve como paso opcional (medio día de trabajo).

5. **Q5 · Nombre del número "reservas menos cobrado".** El número "reservas menos cobrado" que sale de la ficha de empresa hoy es 100 % reservas futuras sin seña (6 reservas al 23/09): no es deuda ni facturación. La decisión 1 lo llamó "facturado contra cobrado". ¿Con qué nombre lo mostramos en el Tablero?
   - **Bloquea:** F3-9, F3-3a
   - **Recomendación:** llamarlo "Reservado sin cobrar", por empresa (las 5 más grandes y Particulares), en la tarjeta de Cobranzas. Si además querés un "facturado contra cobrado" de verdad (facturas emitidas menos pagos aplicados), es otro número y otro PR.

6. **Q6 · ¿La deuda de cuenta corriente es real?** Desde julio no se cargó ningún pago a cuenta corriente. La vista "Con saldo" va a mostrar 11 deudores con la deuda acumulada desde julio (el total lo ves hoy arriba de Cuenta Corriente). ¿Esa deuda es real, o las empresas te pagaron y no se cargó?
   - **Bloquea:** F3-5a
   - **Recomendación:** si pagaron, cargá esos cobros con el modal nuevo de F2-11 antes de que salga F3-5a. Si no pagaron, el número es real y se muestra tal cual.

7. **Q7 · Cancelar estadías ya cerradas.** Hoy, desde Huéspedes › Historial, podés cancelar una estadía ya cerrada (con el check-out hecho). En PROD no pasó nunca. ¿El diálogo nuevo de cancelación te saca ese poder también a vos? ¿Y lo bloqueamos además en la base?
   - **Bloquea:** F4-2
   - **Recomendación:** recepción no lo tiene ni lo gana. Vos lo conservás hasta que digas otra cosa, y por ahora no se bloquea en la base (hubo 0 casos). Si lo querés en la base, es una migración más: la 124.

8. **Q8 · El amarillo de "Próxima" en el calendario.** La leyenda nueva del calendario queda en 4 estados (En estadía verde, Reservada azul, Sin confirmar gris, Falta check-in rojo) y se pierde el amarillo de "Próxima", que marca la próxima llegada de cada habitación. ¿Recepción usa ese amarillo?
   - **Bloquea:** F4-9
   - **Recomendación:** preguntarle a la recepcionista de la mañana. Si no lo usa, quedan 4 estados; si lo usa, "Próxima" se queda como quinto estado.

9. **Q9 · Tildes en la comandera.** El recibo con tildes sale por la comandera. Si el driver es "Generic / Text Only", las tildes pueden salir como símbolos raros o correr las columnas (ver `docs/impresion-comandera.md`). ¿Podés imprimir una prueba en la impresora del mostrador antes del merge?
   - **Bloquea:** F5-15
   - **Recomendación:** sí: hacer una prueba real antes de mergear. Si las tildes se rompen, el papel queda sin tildes y la pantalla las lleva.

10. **Q10 · Jerga en pantalla.** Para limpiar la jerga que se ve en pantalla (pax, override, "Automático", ingesta, n8n…), ¿qué palabras o pantallas te molestan a vos o confunden a recepción?
    - **Bloquea:** F5-17
    - **Recomendación:** pasame la lista a medida que las veas en uso. Mientras tanto F5-17 queda postergado, y la guía de textos de F5-15 frena las palabras nuevas.

11. **Q11 · Invitar usuarios desde el panel.** Invitar usuarios desde el panel necesita la clave service_role de Supabase en el servidor (Coolify), que saltea toda la seguridad de la base, y un servidor de correo propio, porque el de Supabase tiene un cupo muy bajo. ¿Querés este botón, o seguís dando de alta usuarios desde el dashboard?
    - **Bloquea:** F5-18b
    - **Recomendación:** con 11 usuarios alcanza el dashboard: yo no lo haría todavía. Si lo querés, antes del deploy: clave solo en Coolify (nunca NEXT_PUBLIC), import "server-only", revisión de seguridad y SMTP propio.

Aparte del cuestionario, cada migración (117 a 121, y la 122 si Q3 dice "conservar") se aplica solo con tu OK explícito, que se pide en el PR que la usa y antes de mergearlo.

---

## Decisiones por defecto

Es lo que se hace salvo que digas otra cosa. Si alguna no te cierra, decilo antes de que arranque el PR que la nombra.

### Proceso y migraciones

- **Migraciones:** la 117 es P1, la 118 F0-8, la 119 F2-4, la 120 F1-4 y la 121 F4-8; la 122 y la 123 quedan reservadas. Cada número se confirma al aplicar contra `applied_migrations` y `ls supabase_migrations`. Se aplica con `exec_ddl` y tu OK antes del merge del PR que la usa, y después se verifica su fila en `applied_migrations`.
- **Planes:** no se escriben planes por fase aparte (el F1-1 original y F2 los traían dentro de PRs de código): todo vive en el plan maestro de P0 (`docs/plans/2026-09-23-reorden-ux-plan.md`, Create).
- **P1:** la 106 entra al repo tal como está en PROD. Regularizar una habitación ocupada lo hace solo el admin; recepción ve "Lo resuelve el administrador".

### Check-out, cobro y cancelación

- **F0-3:** Cta. Cte. viene marcada solo en reservas de empresa con cuenta corriente. En todo lo demás, incluidos los 5 particulares con cuenta, el medio arranca vacío y se elige.
- **F0-4:** si se cobró con tarjeta, transferencia o Mercado Pago, la recepcionista puede salir sin facturar después de confirmar, y la estadía queda en Por facturar para vos.
- **F0-5:** el remito reimpreso lleva la leyenda "REIMPRESIÓN".
- **F0-9:** recepción corrige el DNI de una estadía de su propio turno desde la pantalla de factura (la base lo permite desde la mig 73).
- **F1-4:** si hay un pedido de tarifa sin responder, el check-out avisa y deja cobrar (no se bloquea). La respuesta se ve como chip en la tarjeta; no hay fila en Para atender.
- **F2-4:** se usa la vía sin DROP (`rpc_staff_checkout_split`). En la v1, la cuenta corriente no se combina con otros medios en un mismo check-out.
- **F2-4 y F2-5a:** el CSV del turno muestra el medio principal (el de mayor monto), y se agrega "Débito" como botón aparte de "Tarjeta".
- **F2-7b:** en el traspaso forzado, el check-out se ofrece solo si la estadía no debe nada. Si tiene saldo, se amplía o se reporta, y se cobra con la caja propia.
- **F2-10:** con pasaporte no se emite Factura B por ahora; queda para una fase fiscal.
- **F4-2:** los motivos son fijos (No se presentó, Cargada por error, Cambio de habitación, Cambio de fecha, El pasajero canceló, Otro). El WhatsApp al pasajero sale solo con "El pasajero canceló" y en las solicitudes web. Mientras no contestes Q7, el admin conserva la cancelación de estadías cerradas.

### Menú, Hoy y avisos

- **F0-7:** arranca ya. Habitaciones, Categorías y Limpiezas pasan a ser solo del admin.
- **F1-1a:** el número de Remitos del menú cuenta lo mismo que muestra el panel al abrirlo.
- **F1-1b:** las pestañas de cada sección van en una barra de arriba de unos 48 px, con el buscador y la campana a la derecha.
- **F1-3:** el aviso de habitación ocupada en la campana tiene dos botones: "Regularizar en Hoy" y "Cerrar sin cargar" (con nota obligatoria).
- **F1-5 (F1-5a y F1-5b):** en el buscador, recepción ve "Debe" o "No debe", sin monto y sin botones; el admin ve el monto. El saldo es solo el de cuenta corriente (decisión 1).
- **F1-6 y F4-7:** Hoy se actualiza cada 30 s y la pantalla de mantenimiento cada 60 s. El refresco se pausa con un modal abierto, con el foco en un campo o con la pestaña oculta.
- **F1-7:** /admin/fiscal sin pestaña abre "Con error" también para el admin. El link viejo de "Sin facturar" lleva a Por facturar con "Últimos 10 días", y ese chip cuenta igual que el número rojo del menú (lo que falta facturar más lo que espera la consolidada).
- **F1-9:** Limpiezas muestra el mes en curso (contadores y tabla) con el botón "Todo el historial". En Cobros del día, "Saldos por cobrar" se parte en "Deben los alojados" y "Reservado sin seña".
- **F1-10:** /admin/rooms dice "N activas · M inactivas" en lugar de sumar la inactiva al total.
- **F4-1b:** en Para atender aparecen solo los que salen hoy (o ya debían salir) con saldo; la lista completa sigue en Cobros del día.
- **F4-6:** "Cobrado hoy" es lo mismo que "en dinero" de Cobros del día; no suma los pagos a cuenta de las empresas.

### Mantenimiento

- **F4-8:** el desperfecto lo reporta mantenimiento, y "Urgente" no saca la habitación de servicio sola: eso lo decidís vos.

### Clientes y cuenta corriente

- **F3-1:** el recibo de cobranza impreso dice "Aplicado a" en lugar de "Imputado a".
- **F3-5 (F3-5a y F3-5b):** la lista única vive en /admin/clientes; las cuatro pantallas viejas redirigen con el mismo filtro, solo para el admin.
- **F3-7:** los 19 pasajeros sin ficha aparecen como "Viaja por <empresa>" y abren la ficha de la empresa.
- **F3-8:** el domicilio que falta se completa con el botón "Usar como domicilio" (sin la mig 123). Nacionalidad y profesión quedan en la nota. A un huésped con CUIT de empresa se le ofrece "Crear empresa con estos datos", sin mover su historia.
- **Clientes:** las personas se siguen borrando del padrón como hoy; no se archivan.

### Sistema visual y textos

- **Letra mínima:** 12 px en todo el panel, con 11 px solo en las barras del calendario. F4-9 la aplica desde el principio y F5-15 la deja escrita en la guía.
- **F5:** los componentes nuevos van en `src/components/ui/`. La regla de ESLint también bloquea `toLocaleDateString` y `toLocaleTimeString`. `slate-400` pasa a `slate-500` solo en el texto. El rol "Cliente" sale del selector. Va un modal por PR, y los barridos se parten por carpeta con la lista real de grep sobre main.
- **F5-1:** `formatAmountKpi` usa la escala "$850 mil" y "$12,1 M".

Lo que queda fuera del plan por defecto está en la sección siguiente.

---

## Fuera de alcance / descartado

Salvo que digas otra cosa, estos PRs quedan fuera del plan. En el mapa, los postergados figuran como descartados: no suman a los 85,75 días del plan y, si vuelven, suman su estimado original. Los fusionados no se pierden: su trabajo ya está contado en el PR que los absorbe.

| PR | Título | Qué pasó | Motivo | Vuelve si… | Estimado original |
|---|---|---|---|---|---|
| F1-11 | /admin/timeline: redirect en next.config y fuera los revalidatePath | Descartado | Aporta poco: `src/app/admin/timeline/page.tsx` ya es un redirect. El borrado de los `revalidatePath("/admin/timeline")` (`src/app/admin/actions.ts` y `src/app/admin/finances/actions.ts`) pasa a F1-7, y el fallback del host de Supabase en `next.config.mjs` pasa a P2. | No vuelve: sus dos piezas útiles ya tienen dueño. | 0,25 días |
| F2-1 | Cobrar sin "Efectivo" preseleccionado | Fusionado en F0-3 y F2-11 | F0-3 y F2-1 cambiaban la misma línea de `src/app/components/PaymentModal.tsx` con reglas opuestas. La parte de PaymentModal va a F0-3 (arranca en null, salvo Cta. Cte. en empresa con cuenta); la de `src/app/admin/cuentas/RegisterPaymentModal.tsx` y `registerAccountPaymentAction` (`src/app/admin/cuentas/actions.ts`) va a F2-11. F2-3 pasa a depender de F0-3. | No vuelve. | 0,5 días |
| F2-6 | Corregir el DNI dentro del prompt de factura, antes de emitir | Fusionado en F0-9 | Los dos creaban la misma acción (`fixReservationDniAction`) y el mismo bloque en InvoicePromptModal. Sus tests (DNI de 9 dígitos, P0023 de otro turno) pasan a F0-9. | No vuelve. | 0,5 días |
| F2-12 | Walk-in: cobrar por adelantado, como paso opcional | Postergado | No está confirmado que se use, y suma un clic a cada walk-in. | Q4 dice que es común. Entonces va en el carril A, después de F2-3 y F2-10. | 0,5 días |
| F4-10 | Recepción ve en Hoy la respuesta a sus pedidos de tarifa (opcional) | Descartado a favor de F1-4 | Hacía lo mismo que F1-4 con otra migración (columna `created_by` en admin_alerts); F1-4 no cambia el esquema. No se agrega fila en Para atender. | No vuelve. | 1 día |
| F5-17 | Jerga visible a texto llano (barrido general) | Postergado | No tiene alcance concreto, y extendía un test que iba a fallar el primer día. | Pasás la lista de términos y pantallas (Q10). | 1 día |
| F5-18b | Usuarios: invitar desde el panel (clave service_role solo en el servidor) | Postergado | Sería el primer cliente service_role del repo, que saltea toda la RLS, y necesita un SMTP propio. | Das el OK (Q11). Entonces va con la clave en Coolify (nunca NEXT_PUBLIC), import "server-only", revisión de seguridad y SMTP propio configurado. | 1,5 días |

**Tampoco entra en este plan:**

- **Cambiar URLs.** Las secciones son pestañas sobre las rutas actuales; una ruta nueva solo si la vieja redirige con los mismos filtros.
- **Que recepción cancele estadías cerradas.** No lo gana. Bloquearlo en la base también para el admin sería la mig 124, y solo si Q7 lo pide.
- **Fusionar "Emitidas" con la solapa "Facturas" de la ficha.** Siguen separadas, y Control de facturación sigue siendo la pantalla dueña de "qué falta facturar".
- **Un "facturado contra cobrado" de verdad** (facturas emitidas menos pagos aplicados). Es otro número y otro PR (Q5).
- **Factura B con pasaporte.** Queda para una fase fiscal (F2-10).
- **Cuenta corriente combinada con otros medios en un mismo check-out.** No entra en la v1 (F2-4).
- **Las migraciones reservadas.** La 122 va solo si Q3 dice "conservar" (F2-13). La 123 va solo si preferís la vía en lote de F3-8.
- **Pasar las 6 fichas de "por check-out" a Consolidada.** No es código: lo hacés vos desde la ficha después del deploy de F0-2 (Q1).
- **Una fila de pedidos de tarifa en Para atender.** F1-4 lo resuelve con un chip en la tarjeta.
- **Archivar personas.** Se siguen borrando del padrón como hoy.

---

## Cómo medir que funcionó

Antes de cada fase, anotar el valor "Antes" en el PR que la abre. El valor "Después" se mide 30 a 60 días después del deploy del PR indicado. Todas las consultas son de solo lectura y se corren en el conector `supabase-sistema-hotel-prod`. En cada consulta, `<desde>` es la fecha del deploy del PR de esa fila (para el "Antes", la fecha desde la que se midió).

| # | Qué mide | Antes (23/09/2026) | Meta | PRs |
|---|---|---|---|---|
| 1 | Cierres de caja con diferencia | 21 de 275. Por causa: 5 tipeo, 3 medio de pago o dos medios, 4 precio o noches, 1 traspaso, 1 otra, 7 sin nota | 0 por tipeo y por medio; total menor al 3 % | #130 (ya mergeado), F0-3, F0-6, F2-2, F2-5a |
| 2 | Estadías fiadas que nunca van a la consolidada | 21 cargos, en 3 empresas y 3 huéspedes | 0, o solo las que Agustín decidió dejar así | F0-2 |
| 3 | Clicks del check-out fiado, y efectivo registrado por error en empresas con cuenta corriente | Arranca en Efectivo; los clicks los cuenta recepción antes de F0-3 | 2 clicks (abrir y "Cargar a la cuenta y cerrar"); 0 efectivo por error | F0-3 |
| 4 | Entradas del menú | Admin 17 · recepción 5 | Admin 7 secciones · recepción 4 | F1-1a |
| 5 | Cancelaciones con motivo inútil (menos de 5 letras) | 15 de 239 | 0 | F4-2 |
| 6 | Avisos de habitación ocupada cerrados con decisión | 19 cerrados, 0 con decisión | 100 % de los nuevos con `regularizada` o con nota | P1, F1-3, F4-1a |
| 7 | Cobros partidos y señas | 0 reservas con más de un pago | Aparecen; 0 cierres con nota "dos medios" | F2-3, F2-5a |
| 8 | Pagos a cuenta corriente registrados | 0 desde julio | Cada cobro real queda cargado; la deuda de "Con saldo" coincide con lo que Agustín sabe | F2-11, F3-2, F3-5a |
| 9 | Documentos que no sirven para facturar | 33 reservas de persona con 9 o 10 dígitos en 120 días | 0 desde el deploy | F2-10, F0-9 |
| 10 | Facturas trabadas por más de un día | 0 pendientes o rechazadas | Sigue en 0 | F0-9, F1-7, F4-1b |
| 11 | Cierre de mes de las consolidadas | Día del mes siguiente en que sale la última consolidada (medir el próximo cierre) | Antes que el mes anterior; Agustín cronometra el cierre del mes | F0-1, F0-2, F1-7, F3-5b |
| 12 | Estadías largas sospechosas (el "13 en vez de 3") | Revisar a mano | 0 por error de tipeo | F0-6 |
| 13 | Desperfectos reportados y tiempo hasta "Ya lo vi" | No existe | Se usan; se revisan en menos de un día | F4-8 |

**Consultas:**

```sql
-- 1. Cierres con diferencia (la causa se clasifica a mano leyendo notes)
select count(*) filter (where abs(coalesce(discrepancy,0)) > 0.009) as con_diferencia, count(*) as cierres
from public.cash_shifts where status = 'closed' and closed_at >= '<desde>';
select closed_at::date, expected_cash, actual_cash, discrepancy, notes from public.cash_shifts
where status = 'closed' and abs(coalesce(discrepancy,0)) > 0.009 and closed_at >= '<desde>' order by closed_at;

-- 2. Cargos fiados en fichas que facturan en cada check-out
select count(*) from public.cuenta_corriente_movimientos m
left join public.associated_clients ac on ac.id = m.associated_client_id
left join public.guests g on g.id = m.guest_id
where m.tipo = 'cargo' and coalesce(ac.facturacion_modo, g.facturacion_modo) = 'por_checkout'
  and coalesce(ac.cuenta_corriente_habilitada, g.cuenta_corriente_habilitada);

-- 3. Efectivo registrado en check-outs de empresas con cuenta corriente (revisar cada uno: alguno puede ser legítimo)
select count(*) from public.payments p
join public.reservations r on r.id = p.reservation_id
join public.associated_clients ac on ac.id = r.associated_client_id
where ac.cuenta_corriente_habilitada and p.payment_method = 'cash' and p.created_at >= '<desde>';

-- 5. Cancelaciones con motivo inútil
select count(*) filter (where length(btrim(coalesce(reason,''))) < 5), count(*)
from public.reservation_cancellations where cancelled_at >= '<desde>';

-- 6. Avisos de habitación ocupada cerrados, por decisión y con o sin nota
select decision, nullif(btrim(coalesce(resolved_notes,'')),'') is not null as con_nota, count(*)
from public.admin_alerts
where kind = 'room_occupied_without_active_reservation' and resolved_at >= '<desde>'
group by 1, 2 order by 1, 2;

-- 7. Reservas con más de un pago
select count(*) from (select reservation_id from public.payments
                      where created_at >= '<desde>' group by 1 having count(*) > 1) s;

-- 8. Pagos a cuenta corriente registrados
select date_trunc('month', created_at)::date as mes, count(*), sum(amount)
from public.cuenta_corriente_movimientos where tipo = 'pago' group by 1 order by 1;

-- 9. Documentos de 9 o 10 dígitos en reservas de persona
select count(*) from public.reservations
where created_at >= '<desde>' and associated_client_id is null
  and length(regexp_replace(coalesce(client_dni,''),'\D','','g')) in (9,10);

-- 10. Facturas trabadas por más de un día
select status, count(*) from public.invoices
where status in ('pending','processing','rejected') and created_at < now() - interval '1 day' group by 1;

-- 11. Día del mes en que salió la última consolidada (en hora del hotel)
select date_trunc('month', created_at at time zone 'America/Argentina/Tucuman')::date as mes_emision, count(*),
       max(extract(day from created_at at time zone 'America/Argentina/Tucuman')) as ultimo_dia
from public.invoices where kind = 'consolidada' and status = 'authorized' group by 1 order by 1;

-- 12. Estadías de más de 10 noches creadas desde el deploy (noches en hora del hotel, como app_hotel_nights)
select r.id,
       (r.check_out_target at time zone 'America/Argentina/Tucuman')::date
         - (r.check_in_target at time zone 'America/Argentina/Tucuman')::date as noches,
       r.total_price
from public.reservations r
where r.created_at >= '<desde>'
  and (r.check_out_target at time zone 'America/Argentina/Tucuman')::date
        - (r.check_in_target at time zone 'America/Argentina/Tucuman')::date > 10
order by noches desc;

-- 13. Desperfectos: cantidad y tiempo hasta revisarlos (el kind existe desde la mig 121)
select count(*), avg(resolved_at - created_at) filter (where resolved_at is not null)
from public.admin_alerts where kind = 'maintenance_issue' and created_at >= '<desde>';
```

**Sobre las consultas:**

- Las columnas se verificaron contra `supabase_migrations/`: `cash_shifts` (`expected_cash`, `actual_cash`, `discrepancy`, `notes`: mig 27), `cuenta_corriente_movimientos` (mig 64), `facturacion_modo` (mig 79), `payments.payment_method` (mig 09, CHECK de la mig 89), `reservation_cancellations.reason` y `cancelled_at` (mig 24), `admin_alerts.decision` (mig 69), `invoices.status` (migs 72 y 73) e `invoices.kind` (mig 79). `reservations` viene del esquema base, que no está en el repo; `client_dni`, `created_at`, `check_in_target`, `check_out_target` y `total_price` los usan el código y las migraciones 09, 101 y 102.
- La 1 suma `expected_cash` y `actual_cash` al detalle, para ver cuánto se esperaba y cuánto se contó.
- La 6 separa los avisos cerrados con nota, porque "Cerrar sin cargar" (F1-3) cierra con nota y sin `regularizada`.
- La 11 y la 12 pasan a hora del hotel. El `::date` directo usaba UTC, y una llegada después de las 21 h caía en el día siguiente y contaba una noche menos.
- La 13 devuelve 0 hasta que la mig 121 esté aplicada y F4-8 en PROD.
- La métrica 4 no lleva consulta: se cuenta en el menú.

**Mediciones manuales (con Agustín y recepción):**

- **Clicks del check-out fiado (métrica 3):** contar antes de F0-3 y después, en la PC del mostrador.
- **Tiempo del cierre de mes (métrica 11):** cronometrar el próximo cierre de consolidadas antes de F0-1 y F0-2, y el siguiente después.
- **Qué atender primero:** una semana después de F4-1a, preguntarle a la recepcionista de la mañana si entiende qué va primero en "Para atender" sin que nadie le explique.
