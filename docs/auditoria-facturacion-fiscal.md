# Auditoría adversarial del circuito de facturación fiscal

**Fecha:** 2026-09-08 · **Base auditada:** PROD (`xoqxbtlpppsyzccljjxp`, Brasil)
**Alcance:** emisión fiscal de punta a punta, admin y recepcionista, con foco en cuenta corriente.
**Postura:** asumir que el sistema está mal hasta probar lo contrario, y probarlo **ejecutando**.

---

## Veredicto

**El sistema NO estaba en condiciones de facturar cuenta corriente. Ahora lo está a nivel
código, pero sigue bloqueado por datos.**

Dos cosas distintas:

1. **Un bug que hacía imposible emitir una consolidada** (C-01). No era una hipótesis: el RPC
   fallaba en la primera llamada. Estaba ahí desde la migración 79 (2026-07-31) y se arrastró
   por la 80 y la 81. **Corregido** en la migración 93 y verificado ejecutándolo.
2. **El 87% de la cuenta corriente no se puede facturar por datos fiscales faltantes o mal
   cargados** (C-02). Eso no lo arregla el código: son decisiones de negocio y datos que hay
   que cargar.

El núcleo de seguridad e integridad **resistió todo lo que le tiré**: no encontré forma de
facturar dos veces la misma estadía, de romper la numeración, de descuadrar los importes, de
leer el certificado ni de escribir en las tablas fiscales desde la app.

---

## Qué se probó, y cómo

| Prueba | Método | Resultado |
|---|---|---|
| Camino de escritura completo de la consolidada | Ejecutado de verdad contra PROD, dentro de una transacción que **siempre aborta** (`exec_ddl` es atómico; lo verifiqué antes con un probe que escribió y se revirtió) | Encontró C-01 |
| Consolidación de las 70 estadías reales de JUFEC PERFUMERIA | Dry run abortado | Cuadra al centavo |
| Rechazos del detalle editable | Dry run abortado, 5 ataques | Los 5 rechazados |
| Invariante de doble facturación y numeración | Definiciones de índices únicos parciales | Estructuralmente imposible |
| Permisos de escritura desde la app | Matriz completa de policies RLS por tabla y comando | Sin policies de escritura |
| Congelamiento del detalle tras el CAE | Búsqueda de toda función que escriba esas columnas | Sólo el draft las escribe |
| Guardas de rol | `prosrc` de las 20 RPC fiscales + ejecución como anónimo | Todas con guarda, `SECURITY DEFINER`, `search_path` fijo |
| Fidelidad repo ↔ PROD | md5 del cuerpo de cada función normalizado | Lógica idéntica |

**Lo que NO pude probar** (está en "Límites" al final): una sesión real de recepcionista
contra PostgREST, y la emisión real contra ARCA homologación.

---

## Hallazgos

### 🔴 C-01 — La factura consolidada nunca pudo emitirse. `min(uuid)` no existe.

**Qué pasaba.** El `INSERT` que arma el detalle hacía `MIN(m.id)` sobre `cc_movimiento_id`,
que es un UUID. Postgres no tiene un agregado `min(uuid)`, así que el RPC moría con
`function min(uuid) does not exist` en **cualquier** llamada, con cualquier cliente y
cualquier selección. No había forma de emitir una consolidada.

**Cómo se reproduce.** Llamar `rpc_create_consolidated_invoice_draft` con cualquier
selección válida. Falla siempre, en el último paso, después de haber creado la fila en
`invoices` (que rollbackea).

**Por qué no se había visto.** `fiscal_settings.enabled = false`, así que el RPC cortaba
antes con `P0025` y nadie llegó nunca a ejecutar el camino entero. Las verificaciones
anteriores contaron funciones y firmas, que es exactamente lo que este bug no rompe: plpgsql
no valida el cuerpo al crear la función.

**Estado: CORREGIDO** en `93_detalle_editable_consolidada.sql` (`(array_agg(m.id ORDER BY
m.id))[1]`, mismo "elegí uno, siempre el mismo") y verificado emitiendo un draft real de 70
estadías por $3.960.000, con neto/IVA cuadrando, que después se revirtió.

**Lección de método:** contar funciones y comparar firmas no alcanza. Hay que ejecutar.

---

### 🔴 C-02 — El 87% de la cuenta corriente no se puede facturar por datos.

De **$9.330.000 en 135 cargos**, hoy sólo **$1.240.000 (13%)** pasarían la validación fiscal.
Los otros **$8.090.000** rebotan con `P0022`. No es un bug: es el sistema negándose a emitir
un comprobante con datos inválidos, que es lo correcto. Pero hay que cargarlos.

| Cliente | Estadías | Monto | Problema |
|---|---:|---:|---|
| JUFEC SA - PERFUMERIA | 70 | $3.960.000 | Sin condición IVA |
| JUFEC - DROGUERIA | 34 | $1.870.000 | Sin condición IVA. Su CUIT inválido **ya se corrigió** (mig 94) |
| MUNIC TACO POZO | 9 | $1.710.000 | Cargado como huésped con un **CUIT en el campo del DNI** |
| H CLINICAL ARGENTINA S.A | 8 | $360.000 | Sin condición IVA |
| COMISARIA TACO POZO | 1 | $70.000 | Exento, pero **CUIT inválido** (`30999175707`) |
| COMPAÑÍA LA LEGUA SA | 1 | $70.000 | **CUIT de 12 dígitos** (`30-7070916787-8`) |
| EL HORNERO SA - Nico Rivas | 1 | $50.000 | CUIT en el campo del DNI, sin condición IVA |
| *GANANOR PUJOL SA, LUCAS COATTO, LEON MARCELO TOMAS, FRANCO FAVA* | 11 | $1.240.000 | **Facturables hoy** |

Dos cosas que valen la pena mirar:

- El CUIT de **JUFEC DROGUERIA** no era un typo: era la única forma de cargar la segunda
  área, porque `document_id` tenía un índice **único** y las dos áreas comparten CUIT. El
  modelo estaba mal, no el dato — ver C-03. Corregido en la migración 94.
- **Qué condición IVA le corresponde a cada uno lo decidís vos o el contador.** No lo adivino:
  emitir la letra equivocada sólo se arregla con nota de crédito.

---

### 🔴 C-03 — El CUIT era clave única de cliente, y eso obligaba a inventar números.

**Qué pasaba.** `associated_clients.document_id` tenía un índice **único** y se usaba a la
vez como identificador del cliente y como CUIT del receptor. JUFEC opera como dos áreas
(Droguería y Perfumería) que fiscalmente son la misma empresa: el hotel las necesita como dos
cuentas corrientes, pero la segunda no entraba. Se la cargó con el CUIT de la primera
cambiándole el último dígito, y ese número no pasa el módulo 11 → esa cuenta ($1.870.000 en
34 estadías) no se podía facturar.

**El supuesto equivocado:** el CUIT identifica a un **contribuyente**, no a un cliente. Un
contribuyente puede ser dos cuentas del hotel y recibir dos facturas; eso es normal y legal.
Forzar unicidad sobre el CUIT empuja a inventar datos fiscales, que es exactamente lo que
pasó. Y `document_id` no valida nada más que "6 caracteres", así que también entraron un CUIT
de 13 dígitos y otro con el verificador mal.

**Estado: CORREGIDO** en la migración 94. El índice pasa a no-único (se conserva para buscar
por CUIT), el aviso de duplicado se mueve al alta como confirmación visible ("ya existe X con
este CUIT, ¿es otra área de la misma empresa?"), y el alta ahora valida de verdad: DNI de 7-8
dígitos o CUIT de 11 con verificador. Las dos JUFEC quedaron con el CUIT real.

**De paso, un defecto que iba a salir en la primera factura:** `associated_clients` no tenía
**razón social**. El receptor salía de `display_name`, que es el nombre operativo con el que
recepción llama al cliente — la Factura A de la droguería habría salido a nombre de "JUFEC -
DROGUERIA" en vez del nombre legal, y RG 1415 pide la razón social. Ahora es un campo propio
que cae a `display_name` cuando está vacío, así que para los clientes donde son lo mismo no
cambia nada. **Hay que cargarla en las dos JUFEC antes de facturar.**

---

### 🟠 A-01 — La factura de cuenta corriente dice "Contado". Y a ARCA le dice lo mismo.

El impreso tiene `Cond. venta: Contado` fijo en el código
(`src/app/admin/factura/[invoiceId]/page.tsx:169`), y `rpc_begin_invoice_emission` manda
`FchVtoPago` = fecha de emisión, con el comentario *"contado: vence el mismo día"*.

Eso era cierto cuando el único camino era el check-out. Ya no: una consolidada junta un mes
de estadías fiadas. La venta es **a crédito**, y RG 1415 exige declarar la condición de venta.
Es un defecto formal, y es lo primero que va a ver el contador en la primera factura.

**Qué debería pasar:** la condición de venta debería derivarse del `kind` (consolidada →
"Cuenta corriente") y `fch_vto_pago` debería reflejar el plazo real, no el día de emisión.

**Costo:** bajo. Una columna o un `CASE` en el RPC, y una línea en el impreso.

---

### 🟠 A-02 — El código que evita facturar dos veces no tiene un solo test.

`src/lib/arca/emitter.ts` (438 líneas) es lo que sostiene el recovery por `FECompConsultar`,
el single-flight, el claim del número y el barrido de facturas trabadas. Ningún test lo
importa: los 240 tests cubren `amounts`, `wsaa`, `wsfe`, `billing` y validaciones — todo
lógica pura. Verificado con `grep`: cero referencias a `arca/emitter` en `src/__tests__/`.

No es que esté mal escrito — lo leí y el diseño es sólido. Es que es el componente cuyo fallo
cuesta más caro (una factura duplicada se arregla con nota de crédito y explicaciones) y es el
único sin red.

**Costo:** medio. Requiere mockear `callWsfe` y los RPC; hay 6 escenarios que valen
(recovery con CAE existente, recovery sin comprobante, timeout post-envío, rechazo 10016 con
reintento, colisión 23505, single-flight).

---

### 🟠 A-03 — Una consolidada trabada puede quedar semanas sin que nadie la vea.

Dos cosas se combinan:

1. `sweepStaleProcessing` (`emitter.ts:245`) sólo corre **cuando alguien emite otra factura**.
   No hay cron ni API routes en el proyecto: no hay por dónde entrar a barrer.
2. `rpc_list_pending_invoices` filtra `app_is_admin() OR i.cash_shift_id =
   app_current_open_shift()`. Una consolidada tiene `cash_shift_id NULL`, y `NULL = uuid` es
   NULL, no true → **el recepcionista nunca la ve**.

Como una consolidada se emite una vez por mes, si ARCA da timeout justo ahí, la factura queda
`processing` reteniendo un número hasta que un admin entre a `/admin/fiscal` y la reintente.
El comportamiento del recepcionista es correcto por diseño (las consolidadas son admin-only);
lo que falta es que alguien las mire.

**Costo:** bajo si se resuelve avisando (badge en el sidebar cuando hay una `processing` de
más de N minutos); medio si se quiere un barrido de verdad.

---

### 🟡 Medios

| # | Hallazgo | Detalle |
|---|---|---|
| M-01 | **Grants de escritura que sobraron** | `invoices`, `fiscal_settings`, `cuenta_corriente_movimientos` y `arca_ta` todavía tienen `INSERT/UPDATE/DELETE` concedidos a `authenticated` a nivel tabla. Hoy **no es explotable** porque RLS está activo y no hay policies de escritura, pero la migración 77 sí los revocó en `invoice_reservations`, `payments` y `reservations`. Quedaron a mitad de camino: una policy permisiva agregada por error abriría un camino de escritura directo sobre las tablas fiscales. |
| M-02 | **Nunca se registró un pago a cuenta corriente** | 135 cargos, **0 pagos**. El "saldo" que muestra `/admin/cuentas` es el total histórico acumulado, no la deuda real. O no se está usando el registro de pagos, o hay $9.330.000 realmente impagos. Conviene definir cuál de las dos. |
| M-03 | **`updateFiscalSettings` escribe directo a la tabla** | `src/lib/data.ts:3236` es el único punto del dominio fiscal que no pasa por un RPC `SECURITY DEFINER`. Su única defensa es la policy `Admin update fiscal_settings`, que verifiqué y está bien puesta. Es una asimetría, no un agujero. |
| M-04 | **Leyenda Ley 27.618 sin confirmar** | El impreso todavía dice *"Texto a confirmar por el contador antes de producción"*. Bloquea cualquier Factura A a un monotributista. |
| M-05 | **Clientes de cuenta corriente en modo `por_checkout`** | MUNIC TACO POZO ($1.710.000), GANANOR PUJOL SA ($860.000) y cinco más acumulan cargos con el modo por defecto. Se pueden consolidar igual (la pantalla no filtra por modo), pero en el check-out el sistema les ofreció factura individual. Hay que definir el modo de cada uno. |
| M-06 | **`docs/facturacion-arca.md` tiene secciones vencidas** | La sección de la migración 79 sigue diciendo que `guests` no tiene campos fiscales y que la app no emite notas de crédito. Las migraciones 80 y 81 cambiaron ambas cosas. |

### 🔵 Bajos

- **B-01** — `getCtaCteAccounts()` (`data.ts:369`) trae toda `cuenta_corriente_movimientos` sin
  filtro y suma en Node. Con 135 filas no se nota; queda anotado.
- **B-02** — La nota de crédito de una consolidada imprimía "HOSPEDAJE" en vez del detalle de
  estadías. **Corregido** en esta tanda: las estadías cuelgan del comprobante original, que la
  NC desvincula al obtener CAE, así que hay que leerlas incluyendo los vínculos desactivados.
- **B-03** — El cuerpo de `rpc_create_consolidated_invoice_draft` quedó en PROD sin los
  comentarios explicativos del repo. Verifiqué por md5 que **la lógica es idéntica**; sólo
  difieren los comentarios. Cosmético, pero el repo es la referencia.

---

## Lo que resistió

En una auditoría los resultados negativos valen tanto como los hallazgos:

- **Doble facturación: imposible.** `invoice_reservations_active_uq` es un índice único
  parcial sobre `reservation_id WHERE unlinked_at IS NULL`. Cubre los cuatro caminos con el
  mismo candado: consolidada, factura de check-out, marca de "facturado por fuera" y la
  carrera entre dos admins. El draft además lockea con `FOR UPDATE` ordenado por id.
- **Numeración: imposible duplicar.** `invoices_number_uq` sobre
  `(environment, pto_vta, cbte_tipo, cbte_nro)` para `processing`/`authorized`.
- **Importes: cuadran.** Consolidé las 70 estadías reales de JUFEC PERFUMERIA:
  `$3.960.000 = $3.272.727,27 + $687.272,73`, y la suma de las 70 líneas del detalle da
  exactamente el total. El redondeo va sobre el total, nunca por fila.
- **Secretos: inalcanzables.** `fiscal_private` y `arca_ta` tienen RLS activo y **cero
  policies** → invisibles para `anon` y para `authenticated`. El certificado no está en la base.
- **Escritura desde la app: bloqueada.** Ninguna de las 8 tablas del circuito tiene policy de
  `INSERT`/`UPDATE`/`DELETE`. Todo pasa por RPC `SECURITY DEFINER`.
- **Guardas de rol: completas.** Las 20 RPC fiscales son `SECURITY DEFINER` con `search_path`
  fijo y guarda de rol. Las cuatro que tocan credenciales o finalizan comprobantes
  (`begin_invoice_emission`, `finalize_invoice`, `get_arca_ta`, `set_arca_ta`) exigen además
  la clave interna del servidor.
- **`anon` no llega a nada.** La única función ejecutable sin sesión es
  `rpc_public_create_reservation`, que es la de la web pública.
- **El detalle editable no puede mentir.** Los importes no viajan en el detalle: salen del
  cargo de cuenta corriente. Y una vez emitida, **ninguna función escribe** `descripcion` ni
  `detalle_nota` (lo verifiqué contra el código de las 100+ funciones de la base), y las
  tablas no tienen policy de UPDATE. El comprobante entregado y el reimpreso dicen lo mismo.
- **Los 5 ataques al detalle nuevo rebotaron:** descripción apuntando a una estadía de otro
  cliente (`22023`), estadía repetida (`22023`), detalle que no es un array (`22023`), reserva
  de otro cliente en la selección (`P0029`), CUIT inválido (`P0022`). Y 400 caracteres con
  saltos de línea entran recortados y limpios a 80, sin romper el CHECK ni el ticket.

---

## Antes de prender la facturación

1. **Cargar la condición IVA** de JUFEC PERFUMERIA, JUFEC DROGUERIA y H CLINICAL. Se hace
   desde el formulario de `/admin/fiscal/consolidada` y queda guardado en la ficha.
2. **Corregir los CUIT inválidos** que quedan: COMISARIA TACO POZO (`30999175707`) y
   COMPAÑÍA LA LEGUA (`30-7070916787-8`, 13 dígitos). El de JUFEC DROGUERIA ya se arregló.
   No los deduje yo: adivinar un CUIT en un comprobante fiscal no es una opción.
3. **Cargar la razón social** de las dos JUFEC (el nombre legal, que es el mismo para las
   dos áreas).
4. **Arreglar MUNIC TACO POZO y EL HORNERO**: tienen un CUIT metido en el campo del DNI. El
   CUIT va en su propio campo (`cuit`), y hay que elegirles condición IVA.
5. **Definir el modo de facturación** de los clientes de cuenta corriente que quedaron en
   `por_checkout`.
6. **Confirmar con el contador** el texto de la leyenda de la Ley 27.618.
7. **Decidir qué hacer con el atraso**: 199 estadías de caja + 135 de cuenta corriente sin
   comprobante. Al prender la facturación, el badge del sidebar y `/admin/fiscal/control` lo
   van a mostrar todo junto. Es el objetivo, pero conviene saberlo antes.
8. **Probar en homologación** antes de la primera factura real. Requiere poner
   `fiscal_settings.environment = 'homologacion'` temporalmente — no lo toqué porque es
   configuración de producción y es tu decisión.

---

## Límites de esta auditoría

Digo lo que no probé, para que no se lea como más de lo que es:

- **No probé una sesión real de recepcionista contra PostgREST.** El intento de impersonar a
  un usuario concreto y de ejecutar escrituras de prueba fue bloqueado por el control de
  permisos de la herramienta. Lo que sí verifiqué: que cada RPC admin-only tiene la guarda
  `app_is_admin()` en su cuerpo, que `app_is_admin()` devuelve false sin sesión de admin
  (ejecutado), y que la matriz de policies RLS no habilita escritura a nadie. La cadena es
  sólida, pero conviene confirmarlo una vez desde la app con un usuario recepcionista.
- **No emití contra ARCA.** Todo se probó contra la base. La emisión real depende del WSAA, del
  certificado y de la red, y exige cambiar la configuración de producción.
- **Los dry runs corrieron sobre PROD** dentro de transacciones que abortan. Verifiqué antes
  que `exec_ddl` es atómico, y después que no quedó nada escrito: 1 factura (la de julio en
  homologación), 0 consolidadas, facturación deshabilitada.
- **Observación sin explicación:** entre el principio y el final de la sesión, el conteo de
  cargos de cuenta corriente pasó de 133 a 135 (+$100.000) sin que ninguna fila tenga fecha de
  creación de hoy, y sin duplicados por reserva. Las dos filas son indistinguibles de
  actividad legítima (creadas por recepcionistas reales, con fecha coincidente con su
  check-out). No pude determinar la causa; los números de este informe son los del cierre.
