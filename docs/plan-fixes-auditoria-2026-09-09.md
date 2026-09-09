# Plan de fixes y mejoras post-auditoría (2026-09-09)

Origen: `docs/auditoria-codigo-2026-09-09.md`. Este documento convierte cada hallazgo en una fase ejecutable por una sesión independiente de Claude Code. Cada fase trae: alcance, modelo recomendado con el motivo, orden y dependencias, y un prompt autocontenido listo para pegar (la otra sesión no tiene el contexto de esta conversación).

## Cómo usarlo

1. Abrí una sesión nueva de Claude Code en el repo, con el modelo indicado en la fase.
2. Pegá primero el **preámbulo común** y a continuación el **prompt de la fase**.
3. La sesión termina con un PR contra `main`. Revisalo y mergealo vos: **al pushear a `main` Coolify deploya solo a producción**.
4. Si la fase trae migración SQL, aplicala vos en PROD en el orden que diga el PR (`scripts/recuperacion/apply-migration.mjs` con `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`, o el SQL editor del panel).

## Modelos: criterio costo-calidad

| Modelo | Usalo para | Por qué |
|---|---|---|
| **Haiku 4.5** | Cambios mecánicos y verificables por build o tests: bump de dependencias, YAML de CI, borrar código muerto. | Es el más barato y para tareas donde el compilador y los tests son el juez no hace falta más. Si se traba, escalá a Sonnet. |
| **Sonnet 5** | La mayoría de las fases: fixes acotados con algo de criterio, UI, fechas, tests unitarios sencillos, documentación. | Mejor relación costo-calidad para código de aplicación. Es el default. |
| **Opus 5** | Lógica de dinero o fiscal que cruza SQL y TypeScript, migraciones con impacto en datos de producción, tests con mocks complejos. | Un error en estas fases cuesta plata real o una factura duplicada; el sobrecosto del modelo es barato comparado con eso. |
| **Fable 5.1** | No hace falta para ejecutar ninguna fase. Opcional: revisar el PR de las fases 3 y 4 con `/code-review` antes de mergear. | Es el más caro; reservalo para revisar, no para tipear. |

## Resumen y orden

| # | Fase | Hallazgos | Modelo | Tamaño | Depende de |
|---|---|---|---|---|---|
| 1 | Dependencias y lint en verde | C-1, M-14, M-18, bajos | Sonnet 5 (Haiku 4.5 si solo hacés el bump) | S | — |
| 2 | Autorización en server actions | A-2, M-19, M-20, parte de M-12 | Sonnet 5 | S | — |
| 3 | Guardas de base (migración) | M-4, M-5, M-6, M-7b | Opus 5 | M | — (necesita lectura de PROD) |
| 4 | Criterio único de noches | A-1 | Opus 5 | M | Fase 1 mergeada (para no pelear con el lint) |
| 5 | Fechas en zona del hotel | M-1, M-2, M-3 | Sonnet 5 | M | — |
| 6 | Arreglos de UI | A-4, M-13, M-17, bajos de UI | Sonnet 5 | M | Fase 1 (misma zona de CloseShiftModal) |
| 7 | Tests del emisor ARCA | A-5, M-10 | Opus 5 | M | — |
| 8 | Robustez de la capa de datos | M-11, M-12, bajos de data | Sonnet 5 | S | Fase 2 |
| 9 | Bootstrap de base y documentación | A-3, bajos de docs | Sonnet 5 | S | — (necesita lectura de PROD) |
| 10 | CI y CSP | M-15, M-16 | Haiku 4.5 (CI) / decisión de Agustín (CSP) | S | Fase 1 (lockfile nuevo) |
| 11 | Fiscal: condición de venta, vencimiento y barrido | M-8, M-9 | Opus 5 | M | Decisión de Agustín sobre plazo de cuenta corriente |
| 12 | Bajos restantes | accesibilidad, `associated_clients`, `formatMoney` | Haiku 4.5 | S | — |

**Prioridad real.** Si solo hay tiempo para tres: fase 1 (CVE), fase 4 (cobra mal) y fase 2 (autorización). La fase 3 después.

## Línea de tiempo: qué va en paralelo y qué espera

Cada "ola" es un grupo de sesiones que pueden correr al mismo tiempo en worktrees separados (`EnterWorktree` o `git worktree add`) porque no tocan los mismos archivos. Una ola arranca cuando se mergearon las fases de la anterior que la bloquean. Tres sesiones a la vez es un máximo razonable para poder revisar y mergear con calma.

```
Ola 1   F1 deps+lint (Sonnet)     F7 tests emisor (Opus)     F9 bootstrap+docs (Sonnet)
            │                           │                          │
Ola 2   F4 noches (Opus, mig 95)  F2 autorización (Sonnet)   F10 CI (Haiku)
            │  ← aplicar mig 95         │                          │
Ola 3   F3 guardas (Opus, mig 96) F5 fechas (Sonnet)         F6 UI (Sonnet)
            │  ← aplicar mig 96         │                          │
Ola 4   F8 datos (Sonnet)         F12 bajos (Haiku)              │
            │                                                      │
Ola 5   F11 fiscal (Opus, mig 97) ← necesita: decisión de plazo + F3 + F7 mergeados
               ← aplicar mig 97 ANTES de mergear el código
```

**Camino crítico:** F1 → F4 → F3 → F11. Son las cuatro sesiones que van en serie sí o sí, por dos motivos: las migraciones se numeran en orden (dos sesiones en paralelo elegirían las dos el 95) y cada una necesita que la anterior esté mergeada para no pisar el lint o el lockfile. Todo lo demás cuelga en paralelo de ese tronco.

| Ola | Sesiones en paralelo | Arranca cuando | Qué hace Agustín al terminar la ola |
|---|---|---|---|
| 1 | F1, F7, F9 | Este PR mergeado | Mergear F1 apenas esté (desbloquea todo). F7 y F9 se mergean cuando terminen, sin apuro. Mirar logs de Coolify tras el deploy de Next 16.3.4. |
| 2 | F4, F2, F10 | F1 mergeado | Mergear F4 y aplicar la migración 95 en PROD (cualquier orden). Mergear F2. F10: activar la protección de `main` en GitHub. |
| 3 | F3, F5, F6 | F4 mergeado (F3 toma el número 96); F1 mergeado (F6) | Mergear F3 y aplicar la 96, después correr `test-anon-sql-arbitrario.mjs`. Mergear F5 y F6. |
| 4 | F8, F12 | F4 y F6 mergeados (F8); F5 y F6 mergeados (F12) | Mergear. |
| 5 | F11 | Decisión del plazo de cuenta corriente, F3 y F7 mergeados | Aplicar la 97 ANTES de mergear F11, después mergear. |

**Dependencias, una por una**

- F4, F6 y F10 esperan a F1: F4 y F6 porque el lint tiene que estar en verde antes de tocar `CloseShiftModal` y `pricing.ts`; F10 porque el CI usa el lockfile que regenera F1.
- F3 espera a F4 solo por el número de migración (95 y 96). Si F4 se demora, se puede invertir el orden: F3 toma el 95 y F4 el 96. Lo que no pueden es correr juntas.
- F8 espera a F4 (los dos tocan `pricing.ts` y su test) y a F6 (los dos tocan `format.ts`).
- F12 espera a F5 y F6 porque toca `CalendarClient` y `CloseShiftModal` después de ellas.
- F11 espera a F3 (número 97), a F7 (agrega un test al archivo que crea F7) y a la decisión del plazo.
- F2, F5, F7 y F9 no esperan a nadie: se pueden meter en cualquier hueco.

**Sesiones que necesitan el conector de Supabase de solo lectura:** F3, F4 (consulta de impacto en datos) y F9.

**Estimación de esfuerzo de agente por sesión:** S entre 30 y 60 minutos, M entre 1 y 3 horas. El cuello de botella real no es el agente sino la revisión, el merge y la aplicación de migraciones, que las hace una persona. Con una ola por día, el plan completo son cinco días de calendario; con dos olas por día, tres.

---

## Preámbulo común (pegar arriba de cada prompt)

```
Contexto: repo `sistema-hotel` (HotelSync). Next.js 16 App Router + React 19 con React Compiler + Tailwind 4 + Supabase (Postgres con RLS y RPC SECURITY DEFINER). Hotel de 12 habitaciones en Argentina, zona horaria America/Argentina/Tucuman, moneda ARS. UI en español para recepcionistas no técnicos; el dueño es Agustín y prefiere flujos simples y mensajes claros. No hay CI: los chequeos se corren a mano.

Reglas de trabajo:
- Trabajá en una rama nueva `claude/<tema>` creada desde `main` actualizado (`git fetch origin && git checkout -b claude/<tema> origin/main`). Commits con mensaje en español que explique el POR QUÉ, sin prefijos tipo feat/fix. Al terminar abrí un PR contra `main` con `gh pr create`, con resumen, cómo verificar y qué queda fuera. NO mergees: al mergear a `main`, Coolify deploya solo a producción.
- Antes de dar por terminado corré `npm run typecheck`, `npm run lint` y `npm test`; si tocaste dependencias o configuración también `npm run build`. Todo en verde. Si algo falla y no es tuyo, reportalo en el PR, no lo tapes ni lo deshabilites.
- Migraciones SQL: archivos en `supabase_migrations/NN_nombre.sql` con el siguiente número libre (verificá con `ls supabase_migrations`; hoy el último es 94). Comentario inicial con el POR QUÉ, `BEGIN;` / `COMMIT;`, idempotente donde se pueda, y este bloque justo antes del COMMIT:
    DO $$ BEGIN IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN PERFORM public.record_migration('NN_nombre.sql'); END IF; END $$;
  Leé `supabase_migrations/README.md` antes de escribir una. NO apliques migraciones a producción: dejá en el PR el orden de aplicación respecto al deploy del código.
- Convenciones de seguridad del repo: toda escritura a tablas de dinero va por RPC SECURITY DEFINER que valida rol adentro; toda función nueva o redefinida lleva `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` y `GRANT EXECUTE ... TO authenticated;` (nunca a anon, salvo `rpc_public_create_reservation`). Al redefinir una función existente, copiá la ÚLTIMA definición completa del repo (la migración más alta que la define) y cambiá solo lo necesario.
- Si tenés acceso al conector MCP `supabase-sistema-hotel-prod`, es SOLO lectura (SELECT). Usalo para verificar estado real, nunca intentes escribir por ahí.
- No toques nada fuera del alcance de tu fase. Si encontrás otro bug, anotalo en la descripción del PR.
- Referencia: `docs/auditoria-codigo-2026-09-09.md` tiene los hallazgos con archivo y línea. Las líneas pueden haberse movido: buscá por nombre de función, no confíes ciegamente en el número.
```

---

## Fase 1 — Dependencias y lint en verde

**Modelo:** Sonnet 5. Si preferís gastar menos, Haiku 4.5 solo para el bump de Next y `npm audit fix`, y Sonnet 5 para los tres errores de lint (piden criterio sobre efectos de React).
**Cubre:** C-1 (Next 16.2.10 con RCE y bypass de proxy), M-14 (lint rojo), M-18 (`@supabase/ssr` viejo), bajos (`isValidCuit` sin uso, `settings.local.json` trackeado).
**Riesgo:** bajo. Next 16.2 a 16.3 es minor. Después del deploy, entrar a `/admin`, imprimir un recibo y emitir una factura de prueba en homologación si está configurada.

### Prompt

```
Fase 1: dependencias y lint en verde.

1. Subí Next.js a 16.3.4 (pin exacto, como está hoy `"next": "16.2.10"`) y `eslint-config-next` a la misma versión. Corré `npm install` para regenerar `package-lock.json`. Después `npm audit --omit=dev`: el crítico de `next` y los altos de `postcss` y `sharp` tienen que desaparecer. Para `nanoid` y `baseline-browser-mapping` probá `npm audit fix` SIN `--force`; si no los resuelve, anotalo en el PR y seguí.
2. Subí `@supabase/ssr` a la última 0.12.x. Verificá que `src/lib/supabase/client.ts`, `server.ts` y `middleware.ts` compilen sin cambios de API (usan `createServerClient` con `cookies: { getAll, setAll }`). Si el bump exige cambios más allá de un ajuste de tipos, revertilo y dejalo documentado como pendiente en el PR: no quiero mezclar una migración de auth con un fix de seguridad.
3. Dejá `npm run lint` con 0 errores y 0 warnings sin desactivar la regla globalmente:
   - `src/app/admin/fiscal/consolidada/ConsolidadaClient.tsx`, efecto que llama `loadRows()` (regla `react-hooks/set-state-in-effect`): el problema es que `loadRows` hace `setLoading(true)` y resets sincrónicos antes del `await`. Preferí derivar el estado de carga en vez de setearlo (por ejemplo guardar `{ key, rows }` y calcular `loading = state?.key !== currentKey`), o mover los resets sincrónicos a un `key` en el componente padre para que el estado se reinicie al cambiar de cuenta.
   - Mismo archivo, efecto que copia `profile` a `razonSocial`, `cuit`, `condicionIva`, `domicilio` y `nota`: es estado derivado. Inicializá esos `useState` desde `profile` y reiniciá el formulario con un `key={selectedKey}` en el bloque del formulario, eliminando el efecto.
   - `src/app/admin/caja/CloseShiftModal.tsx`, efecto que llama `fetchBlockers()`: mirá qué setState sincrónico hay dentro de `fetchBlockers` antes del primer `await` y movelo después, o derivalo. No cambies el comportamiento del modal (eso lo hace otra fase).
   - `src/app/admin/RoomCard.tsx`: quitá el import de `isValidCuit` que no se usa.
   Si en algún caso puntual la única salida razonable es un `// eslint-disable-next-line react-hooks/set-state-in-effect`, dejalo con un comentario de una línea que explique por qué es legítimo.
4. Agregá `.claude/settings.local.json` a `.gitignore` y sacalo del índice con `git rm --cached` (no borres el archivo).
5. Verificación: `npm run typecheck`, `npm run lint`, `npm test` (hoy 257 tests), `npm run build`. En el build fijate que no aparezcan warnings nuevos de opciones deprecadas en `next.config.mjs`.
6. En el PR indicá: versiones antes y después, salida resumida de `npm audit`, y que el deploy es un minor de Next (Coolify lo toma al mergear; conviene mirar los logs del contenedor los primeros minutos).
```

---

## Fase 2 — Autorización en server actions

**Modelo:** Sonnet 5.
**Cubre:** A-2 (descuentos sin `assertAdmin` y con éxito falso), M-19 (mantenimiento y settings sin re-chequeo), M-20 (`admin/layout.tsx` no redirige sin usuario), y el mensaje crudo de RLS de M-12 en el camino del INSERT de huésped.
**Riesgo:** bajo. Solo agrega chequeos; los RPC de base ya validaban rol.

### Prompt

```
Fase 2: autorización explícita en server actions y detección de escrituras bloqueadas por RLS.

Contexto del bug: `updateGuestDiscountAction` y `updateCompanyDiscountAction` en `src/app/admin/actions.ts` no verifican rol (todas las demás acciones admin-only sí lo hacen con un `assertAdmin()` local, por ejemplo en `src/app/admin/guests/actions.ts`). Dependen de la RLS de `guests` y `associated_clients`, pero un UPDATE bloqueado por RLS no devuelve error: afecta 0 filas y la acción responde `{ success: true }` sin guardar nada.

1. Creá `src/lib/server-auth.ts` (server-only) con `assertAdmin()` que reproduzca el patrón de `src/app/admin/guests/actions.ts` (obtiene el usuario con `auth.getUser()`, lee `profiles.role`, lanza `new Error("No autorizado.")` si no es admin) y devuelva el cliente de Supabase. Agregá también `assertStaff()` (admin o receptionist) por si lo necesitás.
2. Usá `assertAdmin()` en:
   - `src/app/admin/actions.ts`: `updateGuestDiscountAction` y `updateCompanyDiscountAction`.
   - `src/app/admin/mantenimiento/actions.ts`: `authorizeOldTariffAction` y `rejectOldTariffAction`. Para `resolveAdminAlertAction`, mirá qué rol exige la RPC `rpc_resolve_admin_alert` (o como se llame) en `supabase_migrations` y usá el assert que corresponda.
   - `src/app/admin/settings/actions.ts`: `listManageableUsersAction` y `updateProfileAction` (este último puede ascender a admin). `updateHotelSettings` ya tiene un chequeo inline: reemplazalo por el helper solo si queda 1:1.
3. En `src/lib/data.ts`, `setGuestPersonalDiscount` (rama UPDATE) y `setCompanyDiscount`: encadená `.select("id")` al update y si `data` viene vacío lanzá `new Error("No se pudo guardar el descuento: no tenés permiso o el registro ya no existe.")`. Así nunca más un "guardado" sin guardar.
4. `src/lib/error-utils.ts`, `parseActionError`: cuando el código sea `42501` y el mensaje contenga "row-level security", devolvé "No tenés permiso para hacer esta operación." en lugar del texto crudo. NO enmascares los demás 42501: las RPC del sistema lanzan "Acceso denegado" en español con ese código y eso tiene que seguir viéndose.
5. `src/app/admin/layout.tsx`: si no hay usuario, `redirect("/login")`, igual que hace `src/app/maintenance/layout.tsx`. El middleware ya lo bloquea; esto es defensa en profundidad.
6. Opcional, solo si es reemplazo exacto: hacé que los `assertAdmin` locales de `guests`, `cuentas`, `asociados`, `categorias` y `rooms` importen el helper nuevo. Si alguno difiere en comportamiento, dejalo como está y anotalo.
7. Verificación: `npm run typecheck`, `npm run lint`, `npm test`. En el PR listá cada acción que ahora exige admin.
```

---

## Fase 3 — Guardas de base (migración 95)

**Modelo:** Opus 5. Toca constraints y grants de tablas de dinero en producción; un REVOKE de más rompe la facturación y un CHECK sobre datos sucios rompe la migración.
**Cubre:** M-4 (`payments.amount` sin CHECK), M-5 (FK de pagos en cascada), M-6 (tablas fiscales sin REVOKE), M-7b (descarte de factura `processing` con número).
**Requiere:** conector MCP `supabase-sistema-hotel-prod` (solo SELECT) para verificar estado real antes de escribir la migración.
**Riesgo:** medio. Mitigado por las verificaciones previas y porque la migración es una sola transacción.

### Prompt

```
Fase 3: migración de guardas de base. Una sola migración, `supabase_migrations/95_guardas_pagos_y_tablas_fiscales.sql` (verificá que 95 esté libre).

Antes de escribir nada, verificá en PROD con el conector de solo lectura y pegá los resultados en el PR:
  a. `select count(*) from public.payments where amount <= 0;` Si da más de 0, NO agregues el CHECK como VALID: agregalo `NOT VALID`, dejá el `VALIDATE CONSTRAINT` comentado y explicá en el PR qué filas son.
  b. `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.payments'::regclass;` para conocer el nombre real del FK a `reservations`.
  c. `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('invoices','arca_ta','fiscal_private','cuenta_corriente_movimientos','fiscal_settings') and grantee in ('anon','authenticated') order by 1,2,3;`
  d. `select tablename, policyname, cmd, roles from pg_policies where tablename in ('invoices','arca_ta','fiscal_private','cuenta_corriente_movimientos','fiscal_settings');`
  e. `select filename from public.applied_migrations where filename like '9%' order by 1;` para confirmar que 91 a 94 están aplicadas.
  f. En el código: `grep -rn 'from("\(invoices\|arca_ta\|fiscal_private\|cuenta_corriente_movimientos\|fiscal_settings\)")' src/` y confirmá que la única escritura directa es el `.update` de `fiscal_settings` en `updateFiscalSettings` (`src/lib/data.ts`). Todo lo demás va por RPC.

Contenido de la migración, en este orden:
  1. `ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);` (o `NOT VALID` según a). Es la única tabla de dinero sin guarda: `reservations.paid_amount`, `rooms.base_price` y `cuenta_corriente_movimientos.amount` ya la tienen.
  2. Reemplazá el FK `payments.reservation_id` para que sea `ON DELETE RESTRICT` (hoy es CASCADE desde `09_finance_module.sql`): `DROP CONSTRAINT <nombre real>` y `ADD CONSTRAINT payments_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE RESTRICT`. Motivo: un DELETE de reserva por service_role no puede llevarse los pagos.
  3. `REVOKE INSERT, UPDATE, DELETE ON public.invoices, public.arca_ta, public.fiscal_private, public.cuenta_corriente_movimientos FROM anon, authenticated;` y `REVOKE INSERT, DELETE ON public.fiscal_settings FROM anon, authenticated;`. En `fiscal_settings` el UPDATE se mantiene porque la policy "Admin update fiscal_settings" y `updateFiscalSettings` lo usan: dejalo escrito en el comentario como excepción intencional. Escribilo idempotente (REVOKE no falla si el grant no existe).
  4. Redefiní `public.rpc_discard_invoice(UUID)` copiando la definición completa de `79_facturacion_cuenta_corriente.sql` y agregando, después del chequeo de "processing fresco", este guard:
       IF v_i.status = 'processing' AND v_i.cbte_nro IS NOT NULL THEN
         RAISE EXCEPTION 'Esta factura tiene número asignado y ARCA puede haberla autorizado. Usá "Reintentar" para verificar contra ARCA antes de descartarla.' USING errcode = 'P0024';
       END IF;
     Motivo: hoy descarta y libera el número sin consultar FECompConsultar; si ARCA ya emitió el CAE, queda un comprobante real sin registro local. "Reintentar" (emitInvoice) ya reconcilia bien. Repetí el REVOKE/GRANT de la función.
  5. Bloque `record_migration('95_guardas_pagos_y_tablas_fiscales.sql')` y COMMIT.

Verificación: `npm test` (no debería cambiar nada), y en el PR incluí el checklist para después de aplicar en PROD: correr `node scripts/recuperacion/test-anon-sql-arbitrario.mjs`, registrar un pago normal desde la UI, abrir `/admin/fiscal` y `/admin/fiscal/consolidada` como admin, y guardar la configuración fiscal. Orden de aplicación: la migración es independiente del código y se puede aplicar antes o después del merge.
```

---

## Fase 4 — Criterio único de noches

**Modelo:** Opus 5. Es lógica de precio que cruza tres funciones SQL y la librería TypeScript, con impacto sobre reservas existentes.
**Cubre:** A-1.
**Riesgo:** medio. Cambia el precio solo cuando la hora de salida es mayor que la de entrada; el caso estándar (14:00 a 10:00) no se mueve.

### Prompt

```
Fase 4: un solo criterio para contar noches en todo el sistema.

El bug: hay tres fórmulas distintas para "cuántas noches tiene una reserva".
  - Al crear o reprecificar: `app_calculate_reservation_pricing` (`59_guest_spine_reservation.sql`) usa `GREATEST(1, ceil(extract(epoch from (p_check_out - p_check_in)) / 86400))`, y el preview de UI `calculateReservationNights` en `src/lib/pricing.ts` hace lo mismo con `Math.ceil`.
  - En la salida anticipada: `rpc_staff_early_checkout` (`71_shift_close_guard_bi_and_fixes.sql`) cuenta días calendario en la zona del hotel (`(ts AT TIME ZONE tz)::date` restados), igual que `countHotelNights` en `src/lib/time.ts` y `calculateEarlyCheckoutBreakdown` en `pricing.ts`.
  - Al extender: `rpc_extend_reservation` (`76_reservation_writes_via_rpc.sql`) divide el precio congelado por `round(epoch / 86400)`.
  Coinciden solo cuando la hora de salida es menor que la de entrada. Con entrada 09:00 y salida 10:00 dos días después (49 h), la creación congela 3 noches y la salida anticipada divide por 2: el huésped paga 1.5 noches por una. El picker de `NewReservationModal` permite cualquier hora (`DateTimePickerField`, input `type="time"`), así que pasa.

Decisión tomada: el criterio único es NOCHES CALENDARIO EN LA ZONA DEL HOTEL, mínimo 1. Es lo que ya usan la salida anticipada, el walk-in (`rpc_staff_assign_walk_in`: fecha + p_nights) y `countHotelNights`, y es lo que entiende cualquier hotelero.

Trabajo:
1. Migración nueva (siguiente número libre; leé el README de migraciones). Creá `public.app_hotel_nights(p_in timestamptz, p_out timestamptz) RETURNS int` (LANGUAGE sql o plpgsql, STABLE, SECURITY DEFINER, `SET search_path = public`) que lea `timezone` de `hotel_settings` con fallback 'America/Argentina/Tucuman' y devuelva `GREATEST(1, (p_out AT TIME ZONE tz)::date - (p_in AT TIME ZONE tz)::date)`. Con su REVOKE/GRANT.
   Después redefiní, copiando la última definición completa de cada una y cambiando solo la fórmula:
   - `app_calculate_reservation_pricing` (última en 59): `v_nights := public.app_hotel_nights(p_check_in, p_check_out);`. Mantené la validación `p_check_out <= p_check_in`.
   - `rpc_extend_reservation` (última en 76): `v_existing_nights := public.app_hotel_nights(v_r.check_in_target, v_r.check_out_target);`.
   - `rpc_staff_early_checkout` (última en 71, verificá que 89 no la redefina): reemplazá el cálculo inline por el helper para que no vuelvan a divergir. Si preferís no tocarla porque ya es correcta, dejá un comentario en la migración diciendo que es equivalente.
   Antes de redefinir cada función buscá con grep cuál es la migración más alta que la define, para no pisar cambios posteriores.
2. TypeScript, `src/lib/pricing.ts`: `calculateReservationNights(checkIn, checkOut, timezone?)` pasa a `Math.max(1, countHotelNights(checkIn, checkOut, timezone))`. `calculateReservationPriceBreakdown` acepta `timezone?` opcional y lo pasa. Los llamadores (`NewReservationModal`, `ChangeRoomModal`) no tienen la zona del hotel como prop; `countHotelNights` ya usa Tucumán por default, así que alcanza con no romper la firma. Si querés pasarla explícita, hacelo solo si el dato ya llega al componente.
3. Tests en `src/__tests__/pricing.test.ts`:
   - 14:00 a 10:00 del día siguiente = 1 noche; 14:00 a 10:00 dos días después = 2.
   - 09:00 a 10:00 dos días después = 2 noches (antes daba 3).
   - Mismo día (12:00 a 17:00) = 1.
   - Invariante: para varios pares (in, out), `calculateReservationPriceBreakdown(...).nights` es igual a `calculateEarlyCheckoutBreakdown({... departureIso: checkOutTargetIso}).originalNights`.
   - Cruce de medianoche UTC: entrada 2026-07-03T22:00:00-03:00, salida 2026-07-04T10:00:00-03:00 = 1 noche (en UTC son dos fechas distintas del lado de entrada).
4. Impacto en datos existentes: corré en PROD (solo lectura) y pegá el resultado en el PR:
     select r.id, r.status, r.check_in_target, r.check_out_target, r.base_total_price
     from public.reservations r, (select coalesce(timezone,'America/Argentina/Tucuman') tz from public.hotel_settings limit 1) s
     where r.status in ('confirmed','checked_in')
       and greatest(1, ceil(extract(epoch from (r.check_out_target - r.check_in_target))/86400))
        <> greatest(1, ((r.check_out_target at time zone s.tz)::date - (r.check_in_target at time zone s.tz)::date));
   Esas reservas quedaron congeladas con una noche de más. NO las corrijas por migración: listalas en el PR para que Agustín decida (pueden tener pagos hechos).
5. Verificación: `npm run typecheck`, `npm run lint`, `npm test`. En el PR explicá el criterio elegido en una frase y el orden de deploy: aplicar la migración primero y mergear después (o al revés, los dos órdenes son seguros; solo difiere el preview unos minutos).
```

---

## Fase 5 — Fechas en zona del hotel

**Modelo:** Sonnet 5.
**Cubre:** M-1 (validación pública rechaza "hoy" de noche), M-2 (WhatsApp y calendario sin zona), M-3 (historial con hora del servidor).
**Riesgo:** bajo. Todo son funciones puras con test.

### Prompt

```
Fase 5: toda comparación de "hoy" o de día calendario se hace en la zona del hotel, nunca con la del servidor o del navegador. `src/lib/time.ts` ya tiene `hotelDateKey(iso, tz?)` (clave YYYY-MM-DD en zona del hotel, default Tucumán) y `countHotelNights`; `src/lib/analytics.ts` tiene `hotelRangeToUtc`. Usalos, no inventes otros.

1. `src/lib/validations.ts`, `publicBookingSchema`: la regla "debe ser a futuro" compara contra `new Date().setHours(0,0,0,0)` del servidor (UTC en producción). Entre las 21:00 y las 24:00 hora Argentina rechaza reservas para hoy. Reemplazá por comparar `hotelDateKey(checkIn) >= hotelDateKey(new Date())` (comparación de strings YYYY-MM-DD funciona). Test en `validations.test.ts` con `vi.useFakeTimers()` y `vi.setSystemTime(new Date("2026-07-04T01:30:00Z"))` (22:30 del 3 de julio en el hotel): una reserva con checkIn del 3 de julio debe ser válida y una del 2 debe fallar.
2. `src/app/components/PublicSearchForm.tsx`: `today`, `todayIso` y `tomorrowIso` se calculan con `new Date()` y `toIsoDate` en la zona del runtime. Calculá `todayIso = hotelDateKey(new Date())` y el día siguiente sumando 1 día a la clave (mirá `addDaysToKey` en `src/app/admin/calendario/CalendarClient.tsx` y movela a `time.ts` si te sirve). Actualizá `PublicSearchForm.test.tsx` si hace falta.
3. `src/lib/message-templates.ts`, `formatDateForLang`: agregá `timeZone: "America/Argentina/Tucuman"` (importá la constante default de `time.ts`; si no está exportada, exportala) al `toLocaleDateString`. Test en `whatsapp-messages.test.ts`: con `check_in_target = "2026-07-04T01:00:00Z"` (22:00 del 3 en el hotel) el mensaje tiene que decir 03/07/2026, no 04/07/2026.
4. `src/lib/calendar.ts`, `getCalendarCellState`: reemplazá `startOfDay`/`isSameDay` de date-fns por comparación de claves `hotelDateKey(...)`. `CalendarClient` ya trabaja con claves y construye `day` como `new Date(Date.UTC(y, m-1, d, 12))`; si te resulta más limpio, cambiá la firma para recibir la clave del día en vez de un Date y ajustá el llamador. Test en `calendar.test.ts` con una reserva que entra a las 22:00 hora hotel.
5. `src/lib/data.ts`, `getReservationHistory`: `sinceIso` se calcula con `Date.now() - days * 24h`. Calculalo como el inicio del día (zona hotel) de hace `days` días usando `hotelRangeToUtc` o `hotelDateKey`.
6. Verificación extra: corré los tests de los archivos que tocaste con el proceso en UTC para confirmar que ya no dependen de la zona de la máquina. En PowerShell: `$env:TZ='UTC'; npx vitest run src/__tests__/validations.test.ts src/__tests__/whatsapp-messages.test.ts src/__tests__/calendar.test.ts`. No cambies la configuración global de vitest en esta fase.
7. `npm run typecheck`, `npm run lint`, `npm test`.
```

---

## Fase 6 — Arreglos de UI

**Modelo:** Sonnet 5.
**Cubre:** A-4 (cierre de caja arrastra turno anterior), M-17 (`useSearchParams` sin Suspense), login sin try/catch, `GuestModal`, `DiscountsManager`, parseo de montos.
**Riesgo:** bajo.

### Prompt

```
Fase 6: arreglos puntuales de UI. Verificá cada uno en el navegador con el dev server (`npm run dev`) antes de cerrar, además de typecheck/lint/test.

1. `src/app/admin/caja/CajaClient.tsx` monta `<CloseShiftModal>` sin `key`. `CloseShiftModal` guarda `closed` en `useState` y nunca lo reinicia, así que si se cierra el turno A y en la misma sesión se abre el turno B, al volver a "Cerrar Turno" aparece el resultado del turno A. Agregá `key={summary.shift.id}` al modal. Confirmá que el flujo de impresión del comprobante de rendición (efecto sobre `closed`) sigue disparándose una sola vez.
2. `src/app/page.tsx` renderiza `<PublicSearchForm />`, que usa `useSearchParams()`; no hay ningún `<Suspense>` en `src/app`. Envolvelo en `<Suspense fallback={...}>` con un placeholder del mismo alto para que no salte el layout.
3. `src/app/login/page.tsx`: `handleSubmit` hace `await login(formData)` sin try/catch. Si la promesa rechaza por red, el botón queda en "Verificando..." para siempre. Envolvé en try/catch con `toast.error("No se pudo iniciar sesión. Revisá la conexión e intentá de nuevo.")` y `setIsLoading(false)` en el catch. Ojo: `login` hace `redirect()` cuando sale bien y Next implementa el redirect lanzando una excepción especial; no la captures como error (verificá con `isRedirectError` de `next/dist/client/components/redirect-error` o dejando que el catch re-lance si `error.digest` empieza con "NEXT_REDIRECT").
4. `src/app/admin/guests/GuestModal.tsx`: al cambiar `guestId` se ve un frame con los datos del huésped anterior. Reiniciá el formulario y `loading` de forma sincrónica al cambiar de id (la solución más simple es un `key={guestId ?? "new"}` donde se monta el modal).
5. `src/app/admin/descuentos/DiscountsManager.tsx`: el handler de Enter llama `handleSave()` sin comprobar `saving`; el botón sí está deshabilitado. Agregá el guard.
6. Parseo de montos: `CloseShiftModal` (conteo de efectivo), `EditReservationModal` (override de precio) y `ExtraChargesModal` (cargo extra) hacen `parseFloat(valor.replace(",", "."))`, que con "1.500,00" devuelve 1.5. Creá `parseArMoney(input: string): number | null` en `src/lib/format.ts` (quita puntos de miles, cambia coma decimal por punto, devuelve null si no es número o es negativo) con tests en `format.test.ts` ("1.500,00" → 1500, "1500.50" → 1500.5, "12,5" → 12.5, "abc" → null) y usala en los tres lugares.
7. `npm run typecheck`, `npm run lint`, `npm test`, y una pasada manual: cerrar caja, login con contraseña mala, abrir dos huéspedes distintos seguidos.
```

---

## Fase 7 — Tests del emisor ARCA

**Modelo:** Opus 5. Hay que entender la máquina de estados de `emitter.ts` (recovery, single-flight, resultado desconocido) para escribir mocks que prueben algo real y no solo que el código corre.
**Cubre:** A-5 (sin tests), M-10 (doble login WSAA concurrente).
**Riesgo:** bajo para producción (solo tests y un lock en memoria).

### Prompt

```
Fase 7: red de tests para `src/lib/arca/emitter.ts`, la pieza que evita facturas duplicadas o perdidas y hoy no tiene ningún test.

Primero leé completo `src/lib/arca/emitter.ts` y `docs/facturacion-arca.md`. El emisor importa de `@/lib/data` (`beginInvoiceEmission`, `finalizeInvoice`, `getArcaTa`, `setArcaTa`, `getInvoiceById`, `getStaleProcessingInvoiceIds`), de `./wsfe` (`callWsfe` y los parsers), de `./wsaa` (`loginWsaa`) y de `./config` (certificado, clave interna, endpoints). Infra existente: vitest con jsdom, `server-only` está aliased a un mock en `vitest.config.ts`, tests en `src/__tests__/`.

1. Creá `src/__tests__/arca-emitter.test.ts` mockeando con `vi.mock` los módulos de datos, `./wsfe` (solo `callWsfe`; usá los parsers reales alimentándolos con XML de respuesta mínimo, hay ejemplos en `arca.test.ts`), `./wsaa` y `./config`. Escenarios mínimos, cada uno con aserciones sobre QUÉ se llamó y en qué orden:
   a. Camino feliz: TA vigente, FECompUltimoAutorizado devuelve N, `beginInvoiceEmission` recibe N+1, FECAESolicitar aprueba, `finalizeInvoice` recibe status `authorized` con CAE y vencimiento, y el outcome tiene mensaje para el usuario.
   b. Recovery con CAE: la factura llega `processing` con `cbte_nro` de un intento anterior; FECompConsultar la encuentra; se finaliza `authorized` SIN llamar FECAESolicitar.
   c. Recovery sin CAE: FECompConsultar no la encuentra; sigue el flujo normal y vuelve a pedir número.
   d. Resultado desconocido: `callWsfe` de FECAESolicitar lanza el error de red que el emisor clasifica como "outcome desconocido" (mirá `ArcaUnknownOutcomeError` o equivalente); la factura queda `processing`, no `pending`, y NO se reintenta en la misma llamada.
   e. Rechazo con observaciones: FECAESolicitar responde Resultado R con mensajes; se finaliza `rejected` con el texto de ARCA en `last_error`.
   f. Colisión de número: `beginInvoiceEmission` lanza un error con código 23505; el outcome tiene el mensaje accionable que ya traduce el emisor.
   g. Single-flight: `beginInvoiceEmission` indica que otro intento está en vuelo; no se llama FECAESolicitar.
   h. TA por vencer: `getArcaTa` devuelve un TA que vence en menos de 5 minutos; se llama `loginWsaa` y `setArcaTa` ANTES del primer `callWsfe`.
   i. Barrido: `getStaleProcessingInvoiceIds` devuelve dos ids; una se reconcilia y la otra lanza; la emisión principal termina bien igual.
2. `ensureTa` no tiene lock: dos `emitInvoice` concurrentes cerca del vencimiento pueden disparar dos `loginWsaa` y ARCA rechaza el segundo ("El CEE ya posee un TA valido"). Agregá un dedupe a nivel módulo (una promesa en vuelo por ambiente que los llamadores comparten y se limpia al resolver o rechazar) y un test que dispare dos `emitInvoice` en paralelo con TA vencido y verifique un solo `loginWsaa`.
3. No cambies la lógica del emisor más allá del punto 2. Si un test revela un bug real, no lo "arregles" en el test: documentalo en el PR con el escenario y dejá el test marcado `it.todo` o `it.fails` con el motivo.
4. `npm test` completo, `npm run typecheck`, `npm run lint`.
```

---

## Fase 8 — Robustez de la capa de datos

**Modelo:** Sonnet 5.
**Cubre:** M-11 (tablero gerencial ignora errores), bajos de `data.ts` y `pricing.ts`, código muerto.
**Riesgo:** bajo.

### Prompt

```
Fase 8: robustez de `src/lib/data.ts` y limpieza de código muerto.

1. `getManagementDashboardData`: de las 12 consultas del `Promise.all`, solo se chequea `error` en 6. Si `roomsRes` falla, `activeRooms` queda en 0 y ocupación, ADR y RevPAR dan `Infinity` o `NaN` sin aviso. Incluí TODAS las respuestas en el bucle `for (const res of [...]) if (res.error) throw res.error;`.
2. `getRoomsNeedingCleaning`: la consulta de últimas reservas no destructura ni chequea `error`. Hacelo consistente con el resto del archivo.
3. Código muerto, verificá con grep que no tenga llamadores antes de borrar: `checkRoomAvailability` en `data.ts`; `computeAmounts` en `src/lib/arca/amounts.ts` junto con su test en `arca.test.ts` (todo el cálculo real de neto e IVA vive en SQL; si algún día se necesita un preview en cliente, se escribe con un test que lo compare con `round()` de Postgres).
4. `src/lib/pricing.ts`: `calculateReservationPriceBreakdown`, `calculateWalkInPriceBreakdown` y `calculateHalfDayPriceBreakdown` no acotan `finalTotalPrice` a cero si el descuento supera 100. Agregá `Math.max(0, ...)` y un test.
5. `src/lib/billing.ts`, `sanitizeDetalleLine`: `.slice(0, max)` puede partir un emoji a la mitad. Cortá con `Array.from(text).slice(0, max).join("")` y agregá un test con un emoji en el límite.
6. `src/lib/format.ts`, `formatMoney`: si `currency` no es un código ISO válido cae a USD en silencio. Envolvé `Intl.NumberFormat` en try/catch y caé a ARS con un `console.warn` una sola vez por moneda inválida.
7. `npm run typecheck`, `npm run lint`, `npm test`.
```

---

## Fase 9 — Bootstrap de base y documentación

**Modelo:** Sonnet 5.
**Cubre:** A-3 (`exec_ddl` y `run_sql` no versionadas), bajos de documentación (`supabase_schema.sql` obsoleto, README raíz desactualizado).
**Requiere:** conector MCP `supabase-sistema-hotel-prod` (solo SELECT).
**Riesgo:** nulo para producción; solo archivos del repo.

### Prompt

```
Fase 9: que la base se pueda reconstruir desde el repo, y que la documentación diga la verdad.

1. `exec_ddl(text)` y `run_sql(text)` son las funciones con las que se aplican TODAS las migraciones (`scripts/recuperacion/apply-migration.mjs`), pero ningún archivo del repo las crea: solo aparecen en REVOKE/GRANT (migraciones 48, 84, 85). Tras un restore desde cero no se puede aplicar ni la 01. Con el conector de solo lectura corré:
     select p.proname, pg_get_functiondef(p.oid), r.rolname as owner, p.proacl
     from pg_proc p join pg_roles r on r.oid = p.proowner join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('exec_ddl','run_sql');
   Creá `supabase_migrations/00_bootstrap_exec_ddl.sql` con esas definiciones tal cual (SECURITY DEFINER, `SET search_path`), seguidas de `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` y `GRANT EXECUTE ... TO service_role;` (el estado que dejó la migración 84). Comentario inicial explicando que se corre PRIMERO y a mano (psql o SQL editor), porque es la función que después aplica todo lo demás, y que no se anota en `record_migration` porque esa función no existe todavía.
2. `supabase_migrations/README.md`: agregá una sección "Reconstruir desde cero" con el orden: 00 a mano, después 01 a NN vía `apply-migration.mjs`, después `scripts/recuperacion/test-anon-sql-arbitrario.mjs` para verificar permisos. Recordá la lección del repo: después de un restore o mudanza hay que auditar GRANTs, no solo datos.
3. `supabase_schema.sql` describe el MVP inicial (sin `payments`, `invoices`, `guests`...). Borralo. Si algo lo referencia (grep en README, docs, scripts), actualizá la referencia hacia `supabase_migrations/README.md` y la tabla `applied_migrations`.
4. `README.md` raíz: la sección de migraciones lista hasta la 13 y las variables de entorno omiten `ARCA_CERT_B64`, `ARCA_KEY_B64`, `ARCA_INTERNAL_KEY`, `N8N_WEBHOOK_URL` y `SUPABASE_SERVICE_ROLE_KEY` (esta última solo para `scripts/recuperacion`, nunca con prefijo NEXT_PUBLIC_). Sincronizá: env vars con una línea cada una (leé `src/lib/env.ts`, `src/lib/arca/config.ts`, `src/lib/webhook.ts`), scripts de `package.json`, cómo se deploya (Coolify al pushear a main), y reemplazá la sección de migraciones por un enlace al README de migraciones. No escribas secretos ni valores reales.
5. `npm run lint` y `npm test` (no deberían cambiar). PR con la salida de la consulta del punto 1 resumida (sin pegar ACLs completas si son ruidosas).
```

---

## Fase 10 — CI y CSP

**Modelo:** Haiku 4.5 para el workflow. Si el `next build` en CI se complica por variables de entorno, escalá a Sonnet 5. El CSP no es una tarea de código sino una decisión de Agustín (ver abajo).
**Cubre:** M-15 (sin CI), M-16 (CSP en modo reporte).
**Depende de:** fase 1 (lockfile regenerado).

### Prompt

```
Fase 10: CI mínimo en GitHub Actions.

1. Creá `.github/workflows/ci.yml` que corra en `pull_request` y en `push` a `main`: checkout, Node 22 con cache de npm, `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Para el build definí variables placeholder: `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co` y `NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder` (`src/lib/env.ts` lanza si faltan y `next.config.mjs` las lee). Si el build igual falla por prerender de alguna página que llama a Supabase, marcá esa página con `export const dynamic = "force-dynamic"` SOLO si ya era dinámica en la práctica (usa cookies o auth); si no, reportalo y dejá el build fuera del workflow con un TODO.
2. Job adicional `test-utc` con `TZ=UTC` corriendo solo `npm test`, con `continue-on-error: true`. Motivo: la máquina del dueño está en UTC-3 y los tests pueden estar pasando por eso; en UTC salen a la luz los bugs de zona horaria. Si falla, listá en el PR qué tests fallan: es información, no algo a tapar.
3. Verificá el YAML con `npx action-validator` o leyéndolo con cuidado; no tenés forma de correrlo local. Después de abrir el PR, esperá a que corra el workflow y pegá el enlace del run en la descripción; si falla, arreglalo en la misma rama.
4. En el PR dejá para Agustín el paso manual: en GitHub, Settings → Branches → proteger `main` exigiendo que pase el check "ci" antes de mergear.
```

### CSP: decisión de Agustín, no una sesión

`next.config.mjs` manda el CSP como `Content-Security-Policy-Report-Only` desde julio. Para pasarlo a enforcing hace falta validar en producción, con la consola del navegador abierta (F12, pestaña Console), que no aparezcan violaciones de CSP al: abrir el tablero, imprimir un recibo y una factura con QR, ver el Tablero Gerencial (recharts) y la página pública con fotos. Si en una semana de uso no hay violaciones, el cambio es una línea (renombrar la key a `Content-Security-Policy`) y la puede hacer Haiku 4.5 en una sesión de dos minutos. Si aparecen violaciones, pegarlas en la sesión para ajustar la política.

---

## Fase 11 — Fiscal: condición de venta, vencimiento y barrido

**Modelo:** Opus 5. Toca el envelope que se manda a ARCA y el impreso fiscal; un error acá es un comprobante formalmente incorrecto.
**Cubre:** M-8 (siempre "Contado" y `FchVtoPago = hoy`, también en consolidadas de cuenta corriente), M-9 (consolidada trabada sin nadie que la reconcilie).
**Bloqueado por una decisión de Agustín:** qué plazo de vencimiento lleva una factura consolidada de cuenta corriente (por ejemplo 30 días desde la emisión). Sin ese dato no arranques.

### Prompt

```
Fase 11: condición de venta y vencimiento correctos en facturas consolidadas, y barrido automático de facturas trabadas.

Dato de negocio (lo define Agustín, reemplazá el valor): plazo de vencimiento de una consolidada de cuenta corriente = __ días desde la fecha de emisión.

1. Condición de venta. `src/app/admin/factura/[invoiceId]/page.tsx` imprime "Cond. venta: Contado" para toda factura. Para `invoice.kind === 'consolidada'` tiene que decir "Cuenta corriente". Verificá si el mismo texto se muestra en algún otro lugar (grep "Contado").
2. Vencimiento de pago. `rpc_begin_invoice_emission` (última definición: buscá con grep, nace en `72_...sql`) fija `FchVtoPago = v_today` para todas. Hotel factura servicios (Concepto 2 o 3), así que WSFEv1 exige FchServDesde, FchServHasta y FchVtoPago; ARCA acepta FchVtoPago mayor o igual a CbteFch. Migración nueva que redefina la función copiando la última definición completa y, solo para `kind = 'consolidada'`, calcule `FchVtoPago = v_today + <plazo> días`. Si la columna donde se guarda ese dato no existe en `invoices`, agregala para que el impreso y el control fiscal puedan mostrarla. Leé `docs/facturacion-arca.md` y `docs/auditoria-facturacion-fiscal.md` antes de tocar el envelope, y no cambies ningún otro campo.
3. Barrido. `sweepStaleProcessing` en `src/lib/arca/emitter.ts` solo corre cuando se emite otra factura. Exportá una función `sweepStaleInvoices()` que arme TA y auth y llame al barrido, y disparala best-effort (sin bloquear el render y sin lanzar) desde la página `/admin/fiscal` cuando quien entra es admin. Así una consolidada trabada se reconcilia apenas alguien mira la pantalla, sin cron ni infraestructura nueva. Si preferís un endpoint `src/app/api/cron/arca-sweep/route.ts` protegido por un header secreto para llamarlo desde n8n, proponelo en el PR pero implementá primero la versión de la página.
4. Tests: agregá al archivo de tests del emisor (si la fase 7 ya corrió, `src/__tests__/arca-emitter.test.ts`) un caso para `sweepStaleInvoices`. Para el SQL, dejá en el PR la consulta de verificación post-aplicación: la próxima consolidada emitida tiene que mostrar el vencimiento nuevo en `/admin/fiscal/control`.
5. `npm run typecheck`, `npm run lint`, `npm test`. Orden de deploy: aplicar la migración ANTES de mergear el código (el impreso nuevo lee la columna nueva).
```

---

## Fase 12 — Bajos restantes

**Modelo:** Haiku 4.5.
**Cubre:** accesibilidad de modales, `associated_clients` con DELETE directo por RLS, locale inconsistente, warning de Turbopack.
**Riesgo:** nulo.

### Prompt

```
Fase 12: detalles de baja prioridad, cada uno chico y verificable.

1. Accesibilidad de modales: `src/app/components/BookingModal.tsx`, `src/app/admin/caja/CloseShiftModal.tsx` y el modal de reserva de `src/app/admin/calendario/CalendarClient.tsx` no tienen `role="dialog"`, `aria-modal="true"`, ni cierran con Escape. Agregá los atributos, un `aria-labelledby` apuntando al título y un listener de `keydown` para Escape que llame al `onClose` existente (solo si el modal no está en medio de un envío). Mirá cómo lo hacen otros modales del repo que ya lo tengan y copiá el patrón.
2. Barras de reserva del calendario (`CalendarClient.tsx`, los `<polygon onClick>`): agregá `role="button"`, `tabIndex={0}` y manejo de Enter/Espacio para que se puedan abrir con teclado.
3. `src/app/admin/guests/GuestsClientTable.tsx` usa locale `en-US` donde el resto usa `es-AR`. Unificá.
4. `next.config.mjs`: agregá `turbopack: { root: import.meta.dirname }` (o el equivalente que documente Next 16) para que el build no elija otro lockfile cuando el repo está en un worktree. Verificá con `npm run build` que el warning "multiple lockfiles" desaparece y que no aparece otro.
5. `associated_clients` permite DELETE directo por RLS (policy "Admin can delete associated clients", migración 63) mientras el resto del sistema borra por RPC. Es una inconsistencia, no un agujero: NO la cambies en esta fase; dejá una nota en `docs/auditoria-codigo-2026-09-09.md` bajo BAJO diciendo que queda pendiente y por qué (pasar a RPC implica tocar `src/app/admin/asociados/actions.ts` y una migración, mejor junto con la próxima migración de ese módulo).
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
```

---

## Después de cada fase

- Mergear el PR y mirar los logs de Coolify los primeros minutos.
- Si la fase trae migración, aplicarla en el orden que dice el PR y correr `node scripts/recuperacion/test-anon-sql-arbitrario.mjs`.
- Marcar la fase en este documento con la fecha y el número de PR, así el próximo que lo abra sabe qué quedó.

| Fase | Estado | PR | Fecha |
|---|---|---|---|
| 1 | pendiente | | |
| 2 | pendiente | | |
| 3 | pendiente | | |
| 4 | pendiente | | |
| 5 | pendiente | | |
| 6 | pendiente | | |
| 7 | pendiente | | |
| 8 | pendiente | | |
| 9 | pendiente | | |
| 10 | pendiente | | |
| 11 | bloqueada por decisión de plazo | | |
| 12 | pendiente | | |
