# Facturación electrónica ARCA

La app emite por WSFEv1, con cliente propio contra ARCA (`src/lib/arca/`) y estado
en `fiscal_settings` / `invoices`:

| Comprobante | Cuándo | Migración |
|---|---|---|
| **Factura B** a consumidor final (DNI) | Check-out, prompt SÍ/NO | 72 |
| **Factura A** a RI / Monotributo (CUIT) | Check-out, camino "con CUIT" | 74 |
| **Factura B a Exento** (CUIT) | Check-out, camino "con CUIT" | 75 |
| **Factura consolidada** (N estadías de cuenta corriente) | `/admin/fiscal/consolidada`, admin | 79 |
| **Nota de crédito** A/B (anula un comprobante) | `/admin/fiscal`, playero en turno o admin | 80 |

Los datos del receptor salen de la ficha del cliente —empresa o huésped— y se
precargan solos (mig 74/75 para empresas, 81 para personas).

## Arquitectura en una línea

Check-out → prompt SÍ/NO → `rpc_create_invoice_draft` (valida turno/DNI/exclusiones)
→ `emitInvoice` (WSAA + WSFEv1) → CAE → impresión térmica con QR en
`/admin/factura/[id]`. Si ARCA no responde, la factura queda **pendiente** en
`/admin/fiscal` y se reintenta — el check-out nunca se traba.

## Variables de entorno (server-only; Coolify y `.env.local`)

| Variable | Qué es |
|---|---|
| `ARCA_CERT_B64` | Certificado X.509 (PEM) **en base64** |
| `ARCA_KEY_B64` | Clave privada (PEM) **en base64** |
| `ARCA_INTERNAL_KEY` | Clave interna del server (≥32 chars aleatorios). Autoriza a ESTE server a finalizar facturas y manejar el ticket WSAA. Al guardar la config fiscal desde Ajustes, su hash se sincroniza solo en la DB. |

Para pasar un PEM a base64: `base64 -w0 archivo.pem` (Linux) o
`[Convert]::ToBase64String([IO.File]::ReadAllBytes("archivo.pem"))` (PowerShell).

**La misma `ARCA_INTERNAL_KEY` tiene que estar en cada ambiente que use la misma
DB** (si dev y prod comparten la DB de PROD, deben compartir la clave, porque en
la DB vive un solo hash).

## Trámite 1 — Certificado de HOMOLOGACIÓN (sandbox, gratis, ~10 min)

El sandbox de ARCA (`wswhomo.afip.gov.ar`) emite CAEs de prueba sin valor fiscal.

1. Generar clave privada y CSR (en cualquier máquina segura):
   ```bash
   openssl genrsa -out arca-homo.key 2048
   openssl req -new -key arca-homo.key -subj "/C=AR/O=Hotel El Refugio/CN=hotelsync-homo/serialNumber=CUIT 30XXXXXXXXX" -out arca-homo.csr
   ```
   (reemplazar el CUIT real, sin guiones)
2. En el portal de ARCA con clave fiscal (nivel 3): **Administrador de Relaciones
   de Clave Fiscal** → adherir el servicio **"WSASS – Autoservicio de Acceso a
   APIs de Homologación"**.
3. Entrar a WSASS → **Nuevo certificado** → pegar el contenido del `arca-homo.csr`
   → descargar el certificado (`.crt`/`.pem`).
4. En WSASS → **Autorizar servicio** → autorizar el DN del certificado al servicio
   **`wsfe`** (el propio CUIT como representado).
5. Cargar en el server: `ARCA_CERT_B64` (el .crt en base64) y `ARCA_KEY_B64`
   (el arca-homo.key en base64).
6. En la app: Ajustes → Facturación electrónica → completar CUIT/razón social/
   punto de venta (en homologación cualquier PV entre 1 y 99998 sirve, ej. `1`),
   ambiente **Homologación**, habilitar y **Guardar**.
7. Botón **"Probar conexión ARCA"**: los 4 checks en verde = listo para facturar
   de prueba.

## Trámite 2 — PRODUCCIÓN (cuando el sandbox esté validado y Pablo dé el OK)

1. **Administración de Certificados Digitales** (portal ARCA): nuevo alias con un
   CSR *distinto* (generar `arca-prod.key`/`.csr` como arriba).
2. **Administrador de Relaciones**: delegar el servicio "Facturación Electrónica"
   (wsfe) al certificado nuevo.
3. **Administración de Puntos de Venta y Domicilios**: alta del punto de venta
   nuevo, modalidad **"Factura Electrónica / Web Services (RECE)"**, exclusivo
   para la app.
4. Confirmar con el contador: alícuota del hospedaje (21%), leyendas de IIBB, y
   quién emite notas de crédito (v1: no las emite la app).
5. Cambiar en Coolify `ARCA_CERT_B64`/`ARCA_KEY_B64` por los de producción,
   y en Ajustes: ambiente **Producción** + punto de venta real + Guardar +
   Probar conexión. Emitir la primera factura real supervisada.

## Reglas de negocio v1

- Solo **Factura B** (cód. 06) a consumidor final con **DNI** (7-8 dígitos).
  DNI inválido → se bloquea con mensaje; se corrige el DNI en la reserva y se
  reintenta (el sistema re-lee el DNI al reintentar).
- **Excluido siempre**: el `vale_blanco` (consumo interno) no se factura nunca.
  Las reservas de empresa se facturan A o B desde la mig 74/75, y los cierres a
  cuenta corriente desde la mig 79 (ver más abajo) — ya no están excluidos.
- El playero factura solo check-outs de **su turno abierto**; después, solo admin.
  Desde la mig 80, además: si en el prompt eligió **NO**, queda registrado y ya no
  puede cambiarlo (ver "Ventana de facturación" más abajo).
- Se factura el `total_price` final (descuentos/extras/media estadía incluidos),
  IVA 21% incluido (neto = total/1.21). Concepto 2 (Servicios) con el período
  de la estadía.
- El impreso cumple RG 1415 (datos formales), **RG 4892** (QR) y **RG 5614 /
  Ley 27.743** (bloque "Régimen de Transparencia Fiscal al Consumidor" con IVA
  Contenido). En homologación lleva la banda "COMPROBANTE DE PRUEBA".

## Cuenta corriente: modo por cliente, consolidada y control (mig 79)

Antes de la mig 79, **ninguna venta a cuenta corriente se facturaba nunca**: el
check-out no ofrecía factura y el RPC la rechazaba con "se factura al saldar la
cuenta", pero ese flujo no existía. Todo el volumen de empresas con convenio
quedaba sin comprobante fiscal y sin que ningún reporte lo mostrara.

**Modo de facturación por cliente** (`facturacion_modo` en `associated_clients` y
`guests`, editable en la ficha):

| Modo | Qué pasa al cerrar | Quién factura |
|---|---|---|
| `por_checkout` | Se ofrece factura, incluso si va a cuenta corriente | El playero, en su turno |
| `consolidada` | No se ofrece factura; la estadía queda pendiente | El admin, juntando N estadías |
| `no_factura` | No se ofrece nunca (`P0027` si se intenta) | Nadie |

El backfill dejó en `consolidada` a todos los clientes con cuenta corriente
habilitada, que es exactamente el comportamiento previo.

**Factura consolidada** (`/admin/fiscal/consolidada`, sólo admin): N estadías de un
cliente → un comprobante. Detalles que importan:

- Se factura el **cargo a cuenta corriente**, no `reservations.total_price`: si
  hubo un cobro parcial en caja, facturar el total duplicaría lo ya cobrado. Las
  filas con pago mixto se marcan con ⚠ en el selector.
- `FchServDesde/Hasta` va del primer check-in al último check-out; `CbteFch` es
  **siempre la fecha de emisión** (ARCA no permite otra cosa).
- El neto se calcula **sobre el total consolidado**, nunca sumando netos por
  estadía: el redondeo por fila rompe `invoices_amounts_add_up` (hay tests).
- El detalle de estadías va **sólo al impreso**. WSFEv1 no recibe renglones, sólo
  totales, así que para ARCA una consolidada es un total más grande.
- **El detalle es editable antes de emitir (mig 89).** El admin puede reescribir el
  texto de cada línea y agregar una nota al pie (típico: la orden de compra de la
  empresa). Los **importes no se editan**: salen del cargo de cuenta corriente, así
  que el detalle impreso nunca puede contradecir el total que lleva CAE. El texto se
  **congela** en `invoice_reservations.descripcion` / `invoices.detalle_nota` al crear
  el draft — incluso cuando no se editó, para que el comprobante se reimprima igual
  dentro de tres años aunque cambie el formato del código. Después del CAE no hay
  forma de cambiarlo: ninguna función escribe esas columnas fuera del draft y las
  tablas no tienen policy de escritura. Corregir un detalle emitido es nota de crédito.
- La lista muestra **todas** las estadías de la cuenta, no sólo las pendientes: las ya
  cubiertas salen con su comprobante y el checkbox deshabilitado
  (`rpc_list_cc_account_stays`, que reemplazó a `rpc_list_cc_charges_to_invoice`).
- Una empresa sin `condicion_iva` cargada **no se puede consolidar** (`P0022`): se
  completa en el formulario y queda guardado en la ficha.
- Un huésped particular se factura **B con DNI** de su ficha, salvo que tenga datos
  fiscales cargados (`condicion_iva`, `cuit`, `razon_social`, `domicilio_fiscal`), que
  sí existen desde la **migración 81**; con ellos se factura como corresponda.
- Si sale rechazada, las estadías siguen bloqueadas hasta que se **descarte** la
  factura; descartarla las libera. Si sale **autorizada con error**, corregirla
  exige nota de crédito, que la app todavía no emite.

**Listado de control** (`/admin/fiscal/control`, sólo admin): todas las estadías
cerradas de un rango, sin el límite de 10 días, con el estado fiscal de cada una:

| Estado | Significado |
|---|---|
| `facturado` / `facturado_consolidado` | Tiene CAE |
| `en_proceso` | Hay una factura sin CAE todavía |
| `pendiente_consolidada` | Cargo a cta cte de un cliente en modo consolidada |
| `no_corresponde` | Vale blanco, o ficha en `no_factura` |
| `falta` | **Hay que facturarla** |

**Invariante**: ningún reporte de ventas lee `invoices`. La emisión consolidada
escribe sólo en `invoices` e `invoice_reservations`; no toca `payments`,
`reservations`, `cash_shifts` ni `cuenta_corriente_movimientos`, y su
`cash_shift_id` es NULL por constraint (`invoices_kind_shape`), así que no se
puede imputar a ningún turno ni por error. El Tablero, el arqueo, Finanzas del día
y el CSV fiscal por turno dan igual antes y después de emitirla.

## Datos de facturación en la ficha del cliente (mig 81)

El punto 3 del gerente: *"los datos de la factura deberían venir ya de los que
cargaste en la ficha del cliente"*. Para **empresas** ya funcionaba desde la mig
74/75. Para **personas** no había nada: un monotributista que se aloja seguido tenía
que dictar CUIT, razón social, condición IVA y domicilio en cada check-out.

`guests` ahora tiene una sección de facturación: `condicion_iva`, `cuit`,
`razon_social`, `domicilio_fiscal`.

- **`cuit` es OTRO campo que `document_id`.** `document_id` es el DNI, que va en la
  Factura B (doc_tipo 96); el CUIT va en la A (doc_tipo 80). Meterlos en la misma
  columna haría que una Factura A saliera con el DNI en el campo del CUIT.
- **`domicilio_fiscal` es OTRO campo que `address`.** `address` es el domicilio
  particular del registro de huéspedes; el fiscal puede ser el del comercio y es el
  que exige RG 1415 en el impreso.
- **Prioridad de los datos al facturar:** lo que se tipeó en el modal → ficha de la
  empresa → ficha del huésped. Lo que se completa a mano **queda guardado** en la
  ficha que corresponda, igual que ya hacía para empresas.
- **El prefill se resuelve en el server**, en `resolveBillingContextByReservation`
  (`src/lib/data.ts`), que ya leía ambas tablas por reserva para el flag de cuenta
  corriente y el modo de facturación. No hay RPC ni round-trip nuevo.
- **Efecto en la consolidada:** un huésped con cuenta corriente y condición IVA
  cargada ahora se factura **A** (o B a exento) en vez de B con DNI siempre. Sin
  condición cargada, sigue saliendo B con DNI — el default no cambió.
- El DNI de la Factura B del check-out **sigue saliendo de `reservations.client_dni`**,
  no de la ficha. Es lo que permite "corregir DNI y reintentar"
  (`rpc_fix_reservation_dni_for_invoice`) sin tocar el padrón.

## Nota de crédito: anular y volver a facturar (mig 80)

Antes de la mig 80, una factura con CAE emitida con datos equivocados **no tenía
arreglo desde el sistema**: `rpc_discard_invoice` sólo aplica a `pending`/`rejected`.
Ahora se anula con nota de crédito, que es lo que AFIP exige para eso.

| Original | Nota de crédito |
|---|---|
| Factura A (cód. 01) | NC A (cód. 03) |
| Factura B (cód. 06) | NC B (cód. 08) |

- **Permisos** (regla del gerente): el playero anula mientras **su turno siga
  abierto**; cerrado el turno, sólo el administrador. Las consolidadas, sólo admin.
- La NC **referencia obligatoriamente** el comprobante que cancela: bloque
  `<CbtesAsoc>` del WSFEv1, que va **entre `CondicionIVAReceptorId` e `Iva`** (el
  schema es una secuencia; hay un test que fija ese orden).
- Al obtener CAE, el trigger marca `invoices.anulada_at` en el original y
  **desvincula sus estadías**, que vuelven a ser facturables. Eso es lo que permite
  "volver a facturar": sin ese paso, la factura anulada seguiría ocupando
  `invoices_reservation_uq` y el reuso devolvería `already_authorized`.
- **La NC no borra nada.** AFIP conserva las dos y el número de la factura queda
  consumido. Después de corregir quedan **3 papeles**: factura mala + NC + factura
  buena. Avisarle al playero antes de que aparezca con tres tickets.
- La NC lleva **su propia fecha de emisión**: si anula hoy una factura de ayer,
  quedan con fechas distintas. Es inevitable y AFIP lo contempla.
- Es **sólo fiscal**: no devuelve plata, no toca la caja ni ningún reporte.
- Una NC no se anula con otra NC, y no se puede emitir una segunda NC del mismo
  comprobante (índice `invoices_nota_credito_uq`).
- Si la NC sale rechazada, se descarta y se vuelve a generar. Descartar una NC
  **no** deshace nada, porque el original sólo se marca anulado cuando la NC obtiene CAE.

## Ventana de facturación: el SÍ/NO es en el momento (mig 80)

`reservations.invoice_decision` registra la decisión del prompt post check-out.

- **NO** → queda grabado (`rpc_decline_invoice`) y el playero **ya no puede
  facturarla**: `rpc_create_invoice_draft` responde `P0030`. Sólo el administrador
  puede emitirla después. El modal pide confirmación antes, porque es irreversible
  para él.
- **SÍ** → lo graba `rpc_create_invoice_draft` al crear el borrador.
- **Reintentar una emisión que ya se decidió y falló SIGUE PERMITIDO.** El reintento
  va por `rpc_begin_invoice_emission`, no por el draft, así que no lo toca el gate.
  Es deliberado: sin esa distinción, una caída de ARCA en el momento del check-out
  dejaría esa venta sin factura para siempre.
- **Límite conocido:** cerrar el modal con la X no cuenta como NO — no registra
  decisión, y la estadía sigue facturable dentro del turno (comportamiento previo).
  Se eligió así para que un clic accidental en la X no bloquee una factura legítima.
  Si se quiere endurecer, la X tendría que grabar `'no'` igual que el botón.

## Facturación obligatoria por medio bancario (mig 83)

Lo que se cobra con **tarjeta, transferencia o Mercado Pago** deja rastro bancario:
no facturarlo es una inconsistencia que después hay que explicar. En esos casos el
prompt **no muestra el SÍ/NO** — va directo a elegir el tipo.

**Lo obligatorio es el "no", nunca el "sí".** Si ARCA se cae, la estadía queda
pendiente y salta en el aviso de cierre de turno y en el control. Lo que **no** se
puede es *decidir* no facturarla: `rpc_decline_invoice` rechaza con **P0032**. Ese
es el enforcement real — sin él la regla sería cosmética, porque bastaría un
`fetch` a mano para saltar la pantalla.

**El medio de pago se resuelve en la base, no en la pantalla.** Hay tres caminos de
check-out **sin método de pago**: si el huésped pagó antes (seña o pago adelantado),
el saldo llega en cero, el modal de cobro nunca se abre y el check-out no inserta
nada en `payments`. Por eso se miran **todos** los pagos de la reserva
(`app_reservation_has_bank_payment`), no sólo el del check-out. Mismo criterio que
`get_shift_checkout_export` (mig 71). El set vive en un solo lugar
(`app_is_bank_payment_method`) y se espeja en [src/lib/billing.ts](src/lib/billing.ts).

> **Corrige un bug previo:** una estadía prepagada con `vale_blanco` mostraba igual
> el prompt y, al apretar SÍ, el servidor la rechazaba con un error. Ahora
> `shouldPromptInvoice` mira los pagos previos y no la ofrece.

**Emisión con datos precargados.** Si la ficha del cliente ya tiene los **cuatro**
datos (CUIT válido, condición IVA, razón social y domicilio), no se pregunta el
tipo: se muestra qué se va a emitir y se confirma con un clic, con un **"Cambiar"**
al lado. El "Cambiar" existe porque el pasajero de una empresa puede querer la
factura a nombre propio, y una vez emitida sólo se arregla con nota de crédito. Un
huésped que sólo tiene DNI **no** entra por acá: va al paso de tipo, que es lo
correcto.

**En el camino con CUIT, el CUIT va primero.** Al completar 11 dígitos que pasan el
dígito verificador, `rpc_lookup_receptor_by_cuit` busca en la ficha de la empresa,
en la del huésped y en la última factura emitida a ese CUIT, y completa el resto
indicando de dónde salió. Nunca pisa lo que ya se escribió a mano.

En el listado de control, las estadías con pago bancario llevan el chip
**"Bancaria"**, para distinguir las pendientes innegociables del resto.

## Facturado por fuera del sistema y contadores (mig 82)

Cuando el contador emite el comprobante **desde el portal de ARCA o desde otro
sistema**, esa estadía está facturada pero HotelSync no lo sabe y la muestra para
siempre como "FALTA FACTURAR". El admin la marca desde **Control de facturación →
"Ya facturado"**, con el comprobante, la fecha y una nota opcional. Queda asentado
quién lo marcó, y **"Deshacer" la revierte** (no borra: desvincula, así queda el
rastro). Estado en el listado: `facturado_externo`.

**Dónde vive la marca — y por qué.** No es una fila de `invoices`: esa tabla
significa *comprobantes que emitió esta app contra ARCA*, y meterle filas sin CAE
rompería `invoices_authorized_complete`. Tampoco es una columna de `reservations`,
porque entonces la regla *"una estadía tiene a lo sumo una cobertura viva"* quedaría
partida en dos lugares. Va en `invoice_reservations` con `invoice_id` NULL, así el
**mismo índice único** `(reservation_id) WHERE unlinked_at IS NULL` impide marcar
como externa una estadía ya facturada **y** facturar una ya marcada — una sola regla,
en la base, y los 5 RPC que consultan esa tabla la respetan sin cambios.

**Contadores.** El listado de control sólo sirve si alguien lo mira:

- **Al cerrar el turno**, si al playero le quedan check-outs sin facturar, sale un
  aviso en rojo. Es **aviso, no bloqueo**: no facturar puede ser una decisión
  legítima, y trabar el cierre de caja por esto sería peor que el problema. El texto
  aclara que después del cierre sólo puede el administrador.
- **En el sidebar del admin**, un badge con la cantidad de estadías en estado
  `falta` de los últimos 60 días (`rpc_count_billing_pending`).

## Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| "El CEE ya posee un TA valido" | Se pidió un ticket WSAA teniendo uno vigente que no quedó guardado (p.ej. se borró la fila de `arca_ta`). Esperar a que venza (máx. 12 h) y reintentar. Prevención: el sistema persiste el TA antes de usarlo. |
| Error 10242 | Falta la condición de IVA del receptor (RG 5616). La app la manda siempre; si aparece, revisar que el server esté actualizado. |
| "Acceso denegado" en reintento | El hash de `ARCA_INTERNAL_KEY` no está sincronizado: guardar la config fiscal desde Ajustes (admin) lo re-sincroniza. |
| Factura "En verificación" que no avanza | Hubo timeout post-envío. El botón Reintentar consulta `FECompConsultar` y recupera el CAE si ARCA lo emitió (no duplica). |
| Certificado vencido | El health check muestra el vencimiento (~2 años). Generar CSR nuevo y repetir el trámite del certificado. |
| `P0026` "ya está incluida en una factura consolidada" | La estadía ya se facturó por otro lado. Recargar la lista; si hay que rehacerla, descartar la factura que la contiene. |
| `P0027` "cliente con factura consolidada" / "no se factura" | El modo de la ficha no permite facturar acá. Cambiarlo en la ficha del cliente, o facturar desde Control de facturación. |
| `P0022` "Cargá la condición frente al IVA de la empresa" | La ficha del asociado no tiene `condicion_iva`. Completarla en el formulario de la consolidada (queda guardada). |
| Estadías que no aparecen en la consolidada | Sólo se listan cargos de cuenta corriente sin comprobante vivo. Si la estadía cerró por caja, se factura desde Control de facturación. |
| `P0030` "en el check-out se eligió no facturar" | El playero apretó NO. Sólo el administrador puede emitirla ahora. |
| `P0031` "ya fue anulada con una nota de crédito" | Ya tiene NC. Si hace falta rehacerla, emitir la factura correcta (la estadía volvió a estar facturable). |
| "Solo se anula con nota de credito una factura ya emitida (con CAE)" | La factura no tiene CAE: el camino correcto es **descartarla**, no la NC. |
| "Solo podes anular facturas de tu turno abierto" | El turno en que se emitió ya cerró. La anula el administrador. |
| "El CUIT del huesped no es valido. Cargalo en la seccion de facturacion de su ficha" | El huésped tiene condición IVA cargada pero no CUIT. Completar `cuit` en la ficha (es distinto del DNI). |
| El modal del check-out no precarga nada | La reserva no está asociada a una ficha (`guest_id`/`associated_client_id` nulos), o la ficha no tiene datos de facturación cargados. |
| "Esta estadia ya tiene un comprobante asociado en el sistema" al marcar como externa | Ya hay factura viva o marca previa. Si la factura se anuló, primero emitir la NC; si hay otra marca, deshacerla. |
| El badge del sidebar no baja | Cuenta estado `falta` de los últimos 60 días. Lo de cuenta corriente cuenta aparte (`pendiente_consolidada`) y no entra en el badge. |
| `P0032` "se cobró por tarjeta, transferencia o Mercado Pago" | Se intentó marcar "no facturar" una estadía con pago bancario. Si ya se facturó en ARCA, usar "Ya facturado" en Control; si no, emitirla. |
| No aparece el SÍ/NO en el check-out | Es lo esperado si algún pago de la reserva fue bancario (incluida una seña previa). Se puede cerrar con la X: queda pendiente, no se pierde. |
| El CUIT no autocompleta | Sólo busca con 11 dígitos que pasen el dígito verificador, y no pisa campos ya escritos a mano. |

## Checklist de pruebas en el sandbox (Fase 6 del plan)

1. Walk-in $121 → check-out → SÍ → CAE + ticket con QR escaneable + bloque RG 5614.
2. Reserva con descuento → neto/IVA correctos (verificar en ARCA con FECompConsultar).
3. Media estadía / extras → total facturado = total final.
4. DNI inválido → rechazo claro → corregir → reintentar → autorizada.
5. Bloquear `wswhomo.afip.gov.ar` en hosts → check-out no se traba → pendiente → reintentar OK.
6. Doble click en SÍ → un solo comprobante (correlatividad OK).
7. Cerrar la caja → el playero ya no puede facturar ese check-out; el admin sí.
8. "Probar conexión ARCA" todo en verde.
