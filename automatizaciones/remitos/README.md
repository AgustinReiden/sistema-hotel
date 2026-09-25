# Remitos firmados — automatización

Toma los escaneos de los comprobantes de cuenta corriente, identifica cada remito por el QR
que imprime el sistema (`R-000158-DV`), lo archiva en Drive en
`Remitos/<Cliente>/<Unidad>/<AAAA-MM>/` y lo **registra en la base del sistema** (mig 116).
Aparte, evalúa la firma con Gemini. El estado de cada remito se ve en el panel
`/admin/remitos` del sistema, solo para el admin.

Desde la fase C (mig 124) también arma el **paquete**: el PDF con los remitos firmados de
una factura consolidada, que el admin pide desde el panel.

**n8n no tiene la llave maestra de la base.** Llama como `anon` a nueve funciones que exigen
la clave de la integración en el encabezado `x-remitos-clave`; en la base queda solo su
huella. La regla de la IA (umbral, intentos) vive en la base, no en n8n.

**En marcha desde el 2026-09-22.** Se controlan los remitos del `R-000161` en adelante
(`controlar_desde`) y cualquier remito anterior que se escanee.

Diseños: [general](../../docs/plans/2026-09-17-remitos-firmados-design.md),
[integración con el sistema](../../docs/plans/2026-09-22-remitos-integracion-design.md) y
[fase C](../../docs/plans/2026-09-23-remitos-fase-c-design.md) (vencidos, aviso en la consolidada, paquete).

## Piezas

| Carpeta | Qué es |
|---|---|
| `comun/codigo.mjs` | Formato del código `R-000123-96` (`T-` en las pruebas) y su dígito verificador (MOD 97, público). El sistema tiene una copia y un test que compara las dos. |
| `comun/ticket-compacto.mjs` | Diseño del comprobante compacto con QR: estilos, lado del QR y opciones del dibujo. El sistema tiene una copia y un test que compara las dos. |
| `generador/` | Genera comprobantes de prueba (`T-`) imprimibles (80 mm) con el diseño del sistema, para probar el worker. |
| `worker/` | Servicio HTTP: recibe el escaneo, separa los tickets (cartulina negra), devuelve cada uno con su código (`/procesar`). También une los PDF de un paquete (`/unir`). Sin estado, sin Google, sin base. |
| `n8n/logica.mjs` | Reglas de la ingesta (qué archivar, qué mandar a revisar, versiones, qué registrar en la base). Puras y testeadas. |
| `n8n/construir.mjs` | Arma los workflows de n8n incrustando `logica.mjs` en los nodos Code. |
| `herramientas/` | `analizar-escaneo.mjs` corre el worker sobre un escaneo real y guarda cada recorte (diagnóstico de pruebas con papel). `comparar-workflow.mjs` confirma que un workflow importado a mano en n8n quedó igual al build. |
| `test/` | `npm test` — 110 tests, incluida la separación de tickets en cualquier ángulo y la coherencia de los workflows. |

`salida/` queda fuera de git: ahí van los datos reales, los PDF generados, la clave de la
integración y los workflows armados (llevan ids, la URL de la base y datos de clientes).

## Cómo se escanea

**Varios tickets por hoja, sobre cartulina negra:**

1. Poner los tickets sueltos en el vidrio, **separados al menos 1 cm** entre sí y del borde.
   Pueden quedar torcidos o al revés: se enderezan solos. Lo que no puede pasar es que se
   toquen o se monten: se ven como una sola forma y van todos juntos a `_Revisar`.
2. **Taparlos con una cartulina negra** (A4 o más grande) y recién ahí cerrar la tapa.
3. Escanear. Varias hojas pueden ir en un mismo PDF.
4. Soltar el PDF en la carpeta `Remitos/_Entrada` de Drive.

El worker encuentra cada ticket por su forma (blanco sobre negro), lo recorta derecho y
después lee su código. Un ticket con el código ilegible **igual aparece** y va a
`_Revisar` con su imagen: no se puede perder en silencio.

Si alguien se olvida la cartulina, la hoja se procesa como antes: un remito por hoja. Si
esa hoja tenía varios, va entera a `_Revisar` como `varios_codigos`.

## Paso a paso

### 1. Hoja de muestras

```bash
npm install
npm run generar -- --muestras
```

Sale `salida/muestras.html`: el comprobante compacto, dos tickets por cada tamaño de QR
(`T-000911` y `912` con 14 mm, `913` y `914` con 16 mm, `915` y `916` con 18 mm; se cambian con
`--tamanos`). Imprimilos desde Chrome en la comandera con **Imprimir de a uno**, ponelos en el
vidrio **con la cartulina negra encima** y corré:

```bash
node herramientas/analizar-escaneo.mjs --pdf escaneo.pdf --salida salida/diag-muestras
```

Gana el tamaño más chico en el que las dos copias salen identificadas con `dpi 200` (primera
pasada del worker). Ese valor va en `QR_MM` de `comun/ticket-compacto.mjs` y en su copia del
sistema. La prueba del 2026-09-22 eligió **16 mm**: con 14 mm uno de los dos tickets no se
leyó; con 16 y 18 mm se leyeron todos. El ticket no lleva nombre ni dirección del hotel
(arranca en "COMPROBANTE CTA. CTE.") y mide unos 9 cm de largo.

### 2. Tickets de prueba `T-`

`salida/datos.local.json` tiene 20 movimientos reales (se sacaron con SELECT, solo lectura).

```bash
npm run generar -- --datos salida/datos.local.json
```

Sale `salida/comprobantes.html` para imprimir, con el QR del sistema (`--qr-mm` lo cambia).
**Sirven para probar el worker sin n8n**, con `herramientas/analizar-escaneo.mjs`. Los remitos
de verdad (`R-`) los imprime el sistema; un `T-` que pase por la ingesta va a `_Revisar` como
`codigo_inexistente`, porque no está en la base.

### 3. Worker

App aparte en Coolify (no en el contenedor del hotel ni en el de n8n), con `WORKER_TOKEN`
de un secreto largo cualquiera. Sin Docker: `HOST=0.0.0.0 WORKER_TOKEN=... npm run worker`.

Rutas: `POST /procesar` (el escaneo, para la Ingesta), `POST /unir` (`{ archivos: [{ nombre,
pdf_b64 }] }` → `{ paginas, pdf_b64 }`, para los paquetes; si un archivo no es PDF, 422 y no
devuelve nada) y `GET /salud`. Las dos primeras exigen `X-Worker-Token`. Un cambio en el
worker se publica **redesplegando la app en Coolify**.

### 4. Credenciales en n8n (las creás vos)

| Credencial | Tipo en n8n | Dato |
|---|---|---|
| Google | Google Drive OAuth2 API | Tu cuenta de Google. Con esta sola alcanza también para Sheets. |
| Gemini | Header Auth | Name `x-goog-api-key`, Value: tu API key de Gemini |
| Worker | Header Auth | Name `X-Worker-Token`, Value: el mismo `WORKER_TOKEN` del paso 3 |
| **Supabase - Remitos** | Header Auth | Name `x-remitos-clave`, Value: la clave de la integración (ver [la clave](#8-la-clave-de-la-integración)) |

### 5. Instalación

Corré una vez a mano el workflow **Remitos - Instalación**. Crea en Mi unidad:

```
Remitos/
  _Entrada/      ← acá se sueltan los escaneos
  _Revisar/      ← lo que no se pudo identificar
  _Procesados/   ← los escaneos originales ya procesados
  Remitos - Control   (planilla: Lotes, Errores, Estado)
```

La planilla es la bitácora técnica de n8n (turno, lotes, errores). Los remitos, sus escaneos
y sus firmas **no** están ahí: están en la base y se ven en `/admin/remitos`.

Si `Remitos` ya existe, no hace nada.

### 6. `n8n/config.local.json` (fuera de git)

| Clave | Qué es |
|---|---|
| `config_id`, `asegurar_carpeta_id`, `errores_id`, `ingesta_id`, `evaluar_firmas_id`, `paquetes_id`, … | Ids de los workflows en n8n. |
| `config.worker_url` | URL del worker. |
| `config.supabase_url` | URL del proyecto de Supabase de PROD. |
| `config.supabase_anon_key` | La anon key (la misma `NEXT_PUBLIC_SUPABASE_ANON_KEY` del sistema): no es secreta, viaja en el navegador. |
| `credenciales.{google,gemini,worker,supabase}` | `{ "id", "name" }` de cada credencial de n8n. |

`node n8n/construir.mjs` arma los workflows en `salida/n8n/` y avisa si falta algo.
`Remitos - Config` y `Errores` se actualizan por MCP; la Ingesta, *Evaluar firmas* y
*Paquetes* se reimportan a mano dentro del mismo workflow (abrir, Ctrl+A, Delete, *Import from File*,
Save) y se verifican con `herramientas/comparar-workflow.mjs`.

### 7. Configuración de cada workflow en n8n

En *Settings* de cada workflow: **Execution order: v1** y, en `Remitos - Ingesta`,
`Remitos - Evaluar firmas`, `Remitos - Vigilancia` y `Remitos - Paquetes`, **Error workflow:
Remitos - Errores**.

### 8. La clave de la integración

Se genera en la PC, nunca pasa por el chat ni por git. El script guarda la clave en
`salida/clave-remitos.local.txt` y muestra solo su huella:

```bash
node -e "
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const clave = randomBytes(32).toString('base64url');
fs.mkdirSync('salida', { recursive: true });
fs.writeFileSync('salida/clave-remitos.local.txt', clave + '\n');
console.log(createHash('sha256').update(clave).digest('hex'));
"
```

1. La huella va a la base (con el OK de Agustín), reemplazando `<HEX>`:
   `select public.exec_ddl($k$ INSERT INTO public.remitos_privado (id, clave_hash, updated_at) VALUES (1, decode('<HEX>', 'hex'), NOW()) ON CONFLICT (id) DO UPDATE SET clave_hash = EXCLUDED.clave_hash, updated_at = NOW() $k$)`
2. La clave va a la credencial **Supabase - Remitos** de n8n.

**Para rotarla** se repiten los dos pasos. Entre uno y otro, las llamadas a la base fallan
por "Acceso denegado": los escaneos quedan en `_Entrada` y se procesan cuando las dos puntas
vuelven a coincidir.

### 9. Qué hace cada workflow

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `Remitos - Ingesta` | Cada 5 min | Late en la base, toma el archivo más viejo de `_Entrada`, lo separa en tickets, le pregunta a la base qué remitos existen y de quién son, archiva cada uno en su carpeta y lo registra: lo archivado como escaneo del remito (queda "evaluando"), lo que va a revisar como pieza con su motivo. **No llama a Gemini**: una caída de Google nunca frena ni alarga el archivo. |
| `Remitos - Evaluar firmas` | Cada 5 min | Late en la base, le pide hasta 5 escaneos pendientes y los evalúa de a una, con una pausa, mandándole a Gemini el PDF archivado. Lo que dice Gemini vuelve a la base, que decide el estado: firmado o sin firma si la IA está segura (umbral 95 %, se cambia desde el panel), y "a revisar" si no. |
| `Remitos - Paquetes` | Cada minuto | Toma el pedido más viejo de la base, le pregunta a Drive por cada remito (que exista, no esté en la papelera ni se haya modificado), los baja, el worker los une y deja el PDF en `Remitos/<Cliente>/Paquetes/`. Si algo falla, el pedido queda en error con el motivo: nunca sale a medias. Sin pedidos, la corrida termina en la primera llamada a la base. |
| `Remitos - Vigilancia` | Cada hora | Anota una alerta en `Errores` si la ingesta no corre o si `_Entrada` no se vacía, y la manda por WhatsApp si `aviso_numero` tiene un número (hoy está vacío). |
| `Remitos - Config`, `Asegurar carpeta`, `Errores` | Los llaman los demás | Ajustes y carpetas por nombre; registro de ejecuciones caídas. |

**Activos:** la Ingesta, *Evaluar firmas*, *Paquetes* y Vigilancia. `Config`, `Asegurar carpeta` y
`Errores` quedan apagados: los llaman los demás y funcionan igual. `Instalación` queda
apagado y no hace falta volver a correrlo.

### 10. El panel

- **Filtra por la fecha del cargo**, no por la del escaneo. Un remito de julio escaneado
  hoy aparece en julio. Los anteriores a `controlar_desde` aparecen solo si tienen un escaneo.
- **Las piezas a revisar se ven siempre**, sin importar el mes elegido.
- **Re-escanear no cierra la pieza vieja.** El remito escaneado de nuevo se registra y se
  evalúa solo; la pieza se cierra con **Resuelta → "Ya se volvió a escanear bien"**. La nota
  solo es obligatoria para descartar ("No era un remito").
- **Vencidos (mig 124):** un remito de un cargo creado desde "Alertar desde" (24/09/2026)
  que a las 48 h del check-out no está firmado ni marcado "sin remito" aparece arriba, en
  *Vencidos*, sin importar el mes elegido. Las horas y la fecha se cambian en *Ajustes*.
- **Paquetes por factura (mig 124):** con un cliente elegido, lista sus consolidadas
  vigentes con "N de M firmados". *Armar paquete* deja el pedido en la base; en uno o dos
  minutos aparece *Descargar* (abre el PDF en Drive). Si se firma un remito después, el
  renglón lo avisa y ofrece *Volver a armar*: el nuevo sale con `_v2`, `_v3`… y el anterior
  queda en Drive.

### 11. Limpiar Drive y la planilla

- **La planilla `Remitos - Control` no se borra ni se renombra:** `Config` la busca por
  ese nombre y sin ella se cae todo. Lo mismo vale para `Remitos`, `_Entrada`, `_Revisar`
  y `_Procesados`.
- **La pestaña *Estado* no se toca.** Guarda la última corrida y el turno que impide dos
  ingestas a la vez, cada dato en un renglón fijo.
- **En *Lotes* y *Errores* se pueden borrar los renglones**, dejando el primero (los
  títulos). Sin *Lotes*, un PDF ya procesado se vuelve a procesar, pero la base reconoce
  cada pieza por su huella y no la registra dos veces.
- **Los archivos que la base conoce no se borran:** los escaneos de cada remito y las
  piezas de `_Revisar`. Son los que abre "Ver" en el panel; si se borran, el botón queda
  apuntando a nada. Los originales de `_Procesados` no los usa el panel, pero son el
  respaldo del escaneo completo. Lo que se archivó antes de la mig 116 (pruebas `T-`,
  pruebas viejas en carpetas de clientes) sí se puede borrar.

### 12. Una cuenta aparte para quien escanea

Quien escanea no necesita ver el resto del Drive: alcanza con compartirle **solo
`Remitos/_Entrada`**, como **Editor** (con Lector o Comentador no puede subir), y destildar
"Los editores pueden cambiar los permisos y compartir". La carpeta le aparece en
"Compartidos conmigo".

Probado el 2026-09-23: un PDF subido desde otra cuenta se procesa igual, y la Ingesta
mueve el original a `_Procesados` sin problema. Hay que tener en cuenta dos cosas:

- **El original sigue siendo de la cuenta que lo subió.** Si esa cuenta se borra, los
  originales de `_Procesados` desaparecen. Los tickets archivados los crea n8n con la
  cuenta dueña, así que el panel no pierde nada.
- **Un editor puede renombrar `_Entrada`.** Si lo hace, la Ingesta deja de encontrarla y
  se frena, sin perder nada. El panel avisa en rojo a la hora sin latido.

## Qué pasa cuando algo falla

| Falla | Qué hace |
|---|---|
| Código ilegible, DV que no cierra, código ajeno | El ticket va a `_Revisar` con el motivo en el nombre, y aparece en el panel como pieza a revisar. Nunca se imputa "al más parecido". |
| Dos tickets pegados sobre la cartulina | Se ven como una sola forma: van a `_Revisar` como `forma_no_reconocida`, con los números que se alcanzan a leer en el nombre del archivo (`..._forma_no_reconocida_R-000007_R-000013.pdf`) y en el panel. Nunca se imputan ni se pueden asignar a mano: se re-escanean separados. |
| Cartulina escaneada sin tickets | La hoja va a `_Revisar` como `sin_tickets`. |
| Sin cartulina y varios tickets en la hoja | La hoja entera va a `_Revisar` como `varios_codigos`. |
| Número que no existe como cargo, o un `T-` de prueba | `_Revisar`, motivo `codigo_inexistente`. |
| Re-escaneo de un remito ya archivado | Se guarda como `R-000123_v2.pdf` y el remito vuelve a "evaluando": la imagen nueva puede contradecir a la vieja. No pisa nada. |
| La misma pieza llega dos veces | La base la reconoce por huella: no se sube ni se registra de nuevo. Un archivo entero repetido lo aparta `Lotes` como `duplicado`. |
| El flujo se cae a mitad de lote | El original queda en `_Entrada` y se reintenta; lo ya registrado se saltea por huella. Si se cayó entre subir a Drive y registrar, puede quedar un archivo huérfano en Drive, pero el registro no se duplica. |
| La base no contesta, o la clave no coincide | La corrida se cae al latir, antes de tocar ningún archivo, y queda en `Errores`. El escaneo sigue en `_Entrada` y se reintenta cada 5 minutos. El panel avisa en rojo si la ingesta no late hace más de una hora. |
| Archivo que no es PDF/imagen, o documento de Google | Se aparta a `_Revisar` y se anota en `Errores`. No se reintenta. |
| Worker caído | Se anota en `Errores`; el archivo queda en `_Entrada` y se reintenta cada 5 minutos. |
| Gemini falla o está saturado | La ingesta no se entera. `Remitos - Evaluar firmas` prueba el modelo principal y, si falla, el de respaldo. Si fallan los dos por cuota (429), saturación (503) o red, el intento queda anotado como `error` (nunca "no firmado") con el mensaje real de Google, la corrida se corta y se sigue 5 minutos después. Con 5 intentos fallidos, el remito pasa a "a revisar". El panel avisa si hay remitos esperando la evaluación hace más de 2 horas. |
| Se reinstala (carpetas y planilla nuevas) | Nada que tocar: `Remitos - Config` busca carpetas y planilla por nombre en cada corrida. Si falta algo o está repetido, la corrida falla con un mensaje claro. |
| Dos corridas a la vez | Un turno en `Estado` lo impide; si una corrida muere, el turno vence a los 30 min. |
| Paquete: un remito borrado, en la papelera o modificado en Drive después de archivarse | El pedido queda en error con el remito y el motivo ("R-000170: el archivo de Drive no está"); no se baja ni se sube nada. Se corrige el archivo (o se re-escanea) y se vuelve a pedir. |
| Paquete: el worker no une (caído, o un archivo que no es PDF) | El pedido queda en error con lo que dijo el worker; se vuelve a pedir. |
| Paquete: la corrida se cae a mitad (Drive se cae al bajar o al subir) | Queda en `Errores` y el pedido sigue "armando"; a los 30 minutos el panel deja volver a pedirlo. Puede quedar un PDF huérfano en `Paquetes/`, que se puede borrar. |

## Límites conocidos

- **Varios por hoja requiere cartulina negra.** Sin ella, un remito por hoja.
- **Tickets separados al menos 1 cm.** Si se tocan, se ven como una sola forma y van a revisión.
- **La confianza de la firma la declara el modelo**, no está calibrada. Por eso decide sola
  solo por encima del umbral (95 %); lo demás lo mira una persona, y cualquier estado se
  puede corregir desde el panel, con registro de quién y cuándo.
- **La prueba sin papel** (HTML → PDF → worker) no reemplaza la prueba con la comandera y el
  escáner reales.
