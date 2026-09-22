# Remitos firmados: integración con el sistema

Fecha: 2026-09-22
Estado: aprobado por Agustín (brainstorming del 2026-09-22)
Antecedentes: [`2026-09-17-remitos-firmados-design.md`](2026-09-17-remitos-firmados-design.md)
(diseño general) y [`automatizaciones/remitos/README.md`](../../automatizaciones/remitos/README.md)
(etapa 1, aislada del sistema).

## 1. De dónde partimos

La etapa 1 ya funciona con papel real. Toma los escaneos de `_Entrada`, separa los
tickets (cartulina negra), lee el QR, archiva cada uno en
`Remitos/<Cliente>/Hotel/<AAAA-MM>/` y evalúa la firma con Gemini. Usa una Google Sheet
en lugar de la base.

- **Prueba grande (2026-09-22):** 14 tickets en 5 hojas. Resultado: 11 de 11 separados
  quedaron archivados con su número, 0 imputados mal, y 3 tickets que se tocaban fueron
  juntos a `_Revisar`.
- **Gemini:** respondió 503 y 429 a todos los tickets. Por eso la firma se evalúa aparte,
  en *Remitos - Evaluar firmas* (PR #123).
- **Numeración:** ya existe desde la migración 106. `cuenta_corriente_movimientos.remito_numero`
  (INTEGER) se asigna por trigger a cada cargo, tiene índice único y en PROD numera los 157
  cargos (del 1 al 157). El comprobante ya imprime `Nro: 000157`. Falta el código
  escaneable.

## 2. Decisiones

| Tema | Decisión |
|---|---|
| Alcance | Solo los remitos impresos con QR, desde el primero que salga con el sistema nuevo. Lo anterior sigue por fuera del sistema. |
| Regla de la IA | Si la IA está al menos 95% segura, decide sola, tanto "firmado" como "sin firma". Si no, el remito va a *a revisar* y lo decide una persona. El umbral es un ajuste. Cualquier estado se puede corregir, y cada cambio queda registrado. |
| Quién usa el panel | Solo el admin, igual que *Control de facturación*. |
| Piezas a revisar | Se resuelven re-escaneando o tipeando el número impreso. Antes de vincular, el sistema muestra cliente, fecha y monto. |
| Conexión n8n ↔ base | Funciones acotadas con una clave propia de la integración. En la base queda solo la huella de la clave. n8n no tiene la llave maestra. |
| Papel | Comprobante compacto: el ticket con QR tiene que salir más corto que el de hoy sin QR. |

## 3. B1: el comprobante compacto con QR

Solo cambia `/admin/comprobante-cc/[movementId]`, el ticket que sale al cerrar a cuenta
corriente o al reimprimir desde la ficha.

```
           El Refugio
   RN16 km 491, Taco Pozo, Chaco
       COMPROBANTE CTA. CTE.          <- chico, donde el de prueba decía "COMPROBANTE DE PRUEBA"
 --------------------------------
 [QR]   R-000158                      <- QR al costado del número
 [QR]   17/09/2026 07:54
 --------------------------------
 Cliente:     EMPRESA A - AREA 1
 DNI/CUIT:           30000000000
 Habitación:                   1
 Estadía:  16/09/2026 -> 17/09/2026
 --------------------------------
 CARGADO A CUENTA        $ 50.000     <- una sola línea
 --------------------------------
 Firma: ______________________        <- el espacio para firmar no se achica
 Aclaración: _________________
```

**Sale del ticket:**
- el título grande "COMPROBANTE CTA. CTE.", que pasa a ser la línea chica de arriba;
- "CARGO A CUENTA CORRIENTE";
- el texto legal "El cliente reconoce adeudar…";
- "Conserve este comprobante".

**Cambios de tamaño:**
- Letra más chica en general.
- Los títulos entran en una sola línea.
- El número `R-000158` va más chico, al lado del QR.

**El código**
- **Formato:** `R-000158-DV`. Es `remito_numero` con prefijo `R` y dígito verificador
  MOD 97, público, con el mismo algoritmo que `automatizaciones/remitos/comun/codigo.mjs`.
- **Dónde vive:** `src/lib/remito-codigo.ts`, con un test que lo compara contra el de la
  automatización para que nunca se separen.
- **Cómo se arma el QR:** en el servidor, con la librería `qrcode` (la misma del QR de
  ARCA), corrección de errores M, en PNG y dibujado sin suavizar (`image-rendering:
  pixelated`).
- **Reimpresiones:** salen con el mismo código.
- **Cargos viejos:** si se reimprimen, salen con QR. Si alguien los escanea, se registran.

**Tamaños: se deciden con una prueba real antes de programar el ticket.**
1. El generador de la automatización arma una hoja de muestras con el diseño compacto
   en tres variantes: QR de 14, 16 y 18 mm.
2. Se imprimen en la comandera y se escanean con la cartulina.
3. Nos quedamos con la variante más chica que se lea completa en la primera pasada del
   worker (200 dpi). La relectura a 300 dpi no cuenta, así queda margen.

Los tickets de prueba `T-` pasan a usar el mismo diseño.

**De paso:** la página hoy imprime cualquier movimiento como "CARGO", incluso un pago. Se
limita a `tipo = 'cargo'`.

Las instrucciones que se le dan a Gemini se ajustan al ticket nuevo: el título ahora es
chico y sigue habiendo dos renglones, Firma y Aclaración.

## 4. B2: datos, estados y reglas

### 4.1 Estados de un remito

| Estado | Qué significa | Quién lo pone |
|---|---|---|
| `sin_escanear` | Todavía no llegó el escaneo (no hay fila en `remito_control`) | Nadie: es el punto de partida |
| `evaluando` | Llegó el escaneo y la IA todavía no lo miró | La ingesta |
| `firmado` | Tiene firma | La IA (confianza ≥ umbral) o una persona |
| `sin_firma` | Volvió sin firmar: hay que reclamarlo | La IA (confianza ≥ umbral) o una persona |
| `a_revisar` | La IA duda (confianza < umbral) o agotó sus intentos | La IA |
| `sin_remito` | El papel se perdió; lleva nota obligatoria | Una persona |

### 4.2 Reglas

1. **Un escaneo nuevo pone el remito en `evaluando`.** Si es un re-escaneo, vale aunque el
   remito ya estuviera confirmado: la imagen nueva puede contradecir a la vieja.
2. **Cuándo decide la IA:** cuando evalúa el escaneo vigente y todavía no decidió una
   persona sobre ese escaneo.
   - Firmado o sin firma con confianza ≥ umbral: queda así.
   - Confianza menor: `a_revisar`.
   - Error con los intentos agotados: `a_revisar`.
3. **La IA nunca pisa lo que decidió una persona** sobre el mismo escaneo.
4. **Una persona puede poner cualquier estado.** `sin_remito` exige nota.
5. **Cada cambio de estado se registra** en `remito_eventos`: antes, después, quién,
   cuándo, sobre qué escaneo y con qué nota.
6. **Período:** es el mes del cargo en la zona del hotel. Para un cargo de check-out, es
   el mes del check-out.
7. **Alcance:** entran los cargos con `remito_numero >= controlar_desde` y cualquier cargo
   que tenga al menos un escaneo (un remito viejo reimpreso con QR).
8. **Asignar una pieza a mano** solo se permite si la pieza tiene un único ticket
   (`codigo_ilegible`, `dv_invalido`, `codigo_ajeno`, `codigo_inexistente`, `sin_tickets`).
   Si tiene varios (`forma_no_reconocida`, `varios_codigos`), solo se resuelve
   re-escaneando: una imagen con varios tickets nunca queda como respaldo de uno.

### 4.3 Tablas nuevas (migración 115)

No se modifica ninguna tabla que ya existe.

| Tabla | Para qué | Campos principales |
|---|---|---|
| `remito_escaneos` | Cada escaneo archivado de un remito, con lo que dijo la IA | Remito (`cc_movimiento_id`), `version`, `origen` (`qr` \| `tipeado`), archivo de Drive (id y enlace), `hash_sha256` único, lote y ubicación. La firma de la IA va aparte: `firma_ia` (`si` \| `no` \| `error` \| NULL = pendiente), confianza, observación, modelo, intentos y fecha. |
| `remito_control` | Estado actual de cada remito con actividad | `estado`, `escaneo_id` vigente, `decidido_por` (`sistema` \| `ia` \| `persona`), `usuario_id`, `nota`, `updated_at` |
| `remito_eventos` | Registro de cambios; solo se agrega | — |
| `remito_piezas_revisar` | Lo que fue a `_Revisar` | Archivo, `hash_sha256` único, motivo, `numeros_leidos` y la resolución: `asignada` \| `reescaneada` \| `descartada`, con quién, cuándo, nota y remito |
| `remitos_ajustes` | Una sola fila de ajustes | `umbral_confianza` (0,95), `max_intentos_firma` (5), `controlar_desde` y los dos latidos: `ultima_ingesta_at`, `ultima_evaluacion_at` |
| `remitos_privado` | La huella de la clave de n8n | RLS sin policies y sin grants, igual que `fiscal_private` |

**Acceso:**
- Todas nacen cerradas (mig. 110) y solo se leen y escriben por funciones `SECURITY
  DEFINER` con `search_path` fijo.
- `controlar_desde` se fija con el primer `remito_numero` creado después del despliegue
  de B1.
- La migración termina con `record_migration()`.

## 5. B2: n8n con la base

### 5.1 Las funciones para n8n

Se llaman como `anon` por PostgREST. Cada una exige el encabezado `x-remitos-clave`; la
función calcula su huella SHA-256 y la compara contra `remitos_privado`. Si no coincide,
responden "acceso denegado" y no hacen nada. Todas se pueden repetir sin duplicar nada,
porque los registros se identifican por huella.

| Función | Qué hace |
|---|---|
| `rpc_remitos_planificar(numeros, hashes)` | Para cada número leído: si existe como cargo, el nombre de la cuenta (para la carpeta), el período y cuántas versiones tiene. Además, cuáles de las huellas ya están registradas, para no subir dos veces el mismo archivo. |
| `rpc_remitos_registrar_escaneo(datos)` | Alta del escaneo con la versión siguiente. El remito pasa a `evaluando`. |
| `rpc_remitos_registrar_pieza(datos)` | Alta de una pieza a revisar. |
| `rpc_remitos_firmas_pendientes(limite)` | Escaneos vigentes sin firma, o en error con intentos libres. Primero los que menos intentos tienen. |
| `rpc_remitos_guardar_firma(escaneo, firma, confianza, observacion, modelo)` | Guarda lo que dijo la IA y aplica las reglas de §4.2. |
| `rpc_remitos_latido(que)` | Registra que corrió la `ingesta` o la `evaluacion`. |

**La clave**
- Tiene 32 bytes aleatorios. Se genera en la PC de Agustín con un script, así nunca pasa
  por el chat ni por git.
- En la base va solo su huella, cargada con `exec_ddl`.
- En n8n va en una credencial *Header Auth*.
- La clave pública de Supabase (`anon`) también la usa n8n. Esa no es secreta: ya viaja
  en el navegador.

### 5.2 Qué cambia en los workflows

- **Ingesta:**
  - Para saber cliente y período usa `planificar` en lugar de la pestaña *Comprobantes*.
  - Para anotar usa `registrar_escaneo` y `registrar_pieza` en lugar de *Resultados*.
  - Al empezar llama a `latido`.
  - Drive no cambia: `Remitos/<Cliente>/Hotel/<AAAA-MM>/R-000158.pdf`, y los re-escaneos
    como `R-000158_v2.pdf`.
- ***Evaluar firmas*:** usa `firmas_pendientes`, `guardar_firma` y `latido`. Lo demás
  queda igual: de a una, con respaldo, y corta si Google se satura.
- **La planilla** queda solo con *Lotes*, *Errores* y *Estado*, como bitácora técnica de
  n8n (turno y duplicados por lote).
- **Un código `T-` de prueba** que se escanee después de esto va a `_Revisar` como
  `codigo_inexistente`.

## 6. B2: el panel `/admin/remitos` (solo admin)

**Menú y estado general**
- **En el menú de admin:** "Remitos firmados", con un numerito que suma los remitos
  `a_revisar` y las piezas sin resolver.
- **Filtros:** cliente y mes. Arranca en el mes actual con todos los clientes.
- **Semáforo:** "47 remitos: 44 firmados · 1 sin firma · 1 a revisar · 1 sin escanear".
- **Aviso rojo** si la ingesta no late hace más de 1 h, o si hay escaneos en `evaluando`
  hace más de 2 h. Es la falla que desde afuera se ve igual que "no hubo escaneos".

**Remitos**
- **Un renglón por remito:** `R-000158`, fecha, habitación y pasajero, monto, estado con su
  color, lo que dijo la IA (por ejemplo "firmado 98%") y **Ver escaneo**, que abre en Drive
  la última versión.
- **Sin escanear:** muestran hace cuántos días salió el remito, para reclamarlo a tiempo.
- **Acciones**, con confirmación: Firmado · Sin firma · Sin remito (pide nota) · Volver a
  revisar. Cada estado muestra quién lo puso y cuándo.

**Piezas a revisar**
- **Qué muestra:** motivo en castellano ("tickets pegados", "QR ilegible"), números
  leídos y **Ver imagen**.
- **Asignar a un remito** (solo si la pieza tiene un único ticket): se tipea `R-000158`,
  el sistema muestra cliente, fecha y monto, y se confirma. El escaneo queda como
  `tipeado` y la IA lo evalúa como a cualquiera.
- **Resuelta:** ya se re-escaneó o no era un remito. Pide nota.

**Otros**
- **Ajustes:** umbral y "controlar desde", editables por el admin.
- **Celular:** la tabla pasa a tarjetas.

**Queda para la fase C:** el aviso de faltantes al emitir la consolidada y el paquete PDF
para la empresa.

## 7. Qué pasa cuando algo falla

Nada de esto frena un check-out, un cobro ni una factura. Si la integración falla, el
panel lo dice y el resto sigue como hoy.

| Falla | Qué hace el sistema |
|---|---|
| n8n no llega a la base (clave mal, Supabase caído) | El escaneo queda en `_Entrada` y se reintenta. Se anota en *Errores*. El panel avisa por el latido. |
| Número que no existe como cargo | Va a revisar como `codigo_inexistente`. Nunca se imputa al más parecido. |
| La misma pieza llega dos veces | La huella lo detecta: no se sube ni se registra de nuevo. |
| Se cae n8n entre subir el archivo y registrarlo | Al reintentar, `planificar` no conoce la huella y vuelve a subir el archivo. Puede quedar un archivo huérfano en Drive, pero el registro no se duplica. |
| Gemini caído | Los remitos quedan en `evaluando`. El panel avisa a las 2 h. |
| Alguien marca mal | Se corrige y el cambio queda en `remito_eventos`. |
| Pieza con varios tickets | No se puede asignar a mano: se re-escanea. |

## 8. Pruebas

- **Código:** `remito-codigo.ts` contra `comun/codigo.mjs` para los números 0 a 5000 y los
  bordes.
- **Funciones de la base:** antes de aplicarlas se ejecutan contra PROD dentro de un
  `exec_ddl` que termina en `RAISE EXCEPTION`, así siempre se deshace y el mensaje trae los
  resultados. Se prueban los escenarios de §4.2 y §7. Después de aplicarlas se verifica la
  huella del cuerpo de cada función contra el archivo.
- **Panel:** tests de pantalla (Testing Library), como los de *Cuentas* y *Control*.
- **n8n:** tests de lógica y estructura en `automatizaciones/remitos`.
- **CI:** lint, typecheck, tests y build.
- **Prueba real al final:** 3 o 4 remitos reales impresos con QR, escaneados, tienen que
  aparecer en el panel con su estado.

## 9. Orden de trabajo

Cada paso deja algo andando.

1. **PR #123 mergeado:** la automatización con *Evaluar firmas*.
2. **Prueba de impresión del diseño compacto:** hoja de muestras con QR de 14, 16 y 18 mm,
   para elegir tamaños.
3. **B1:** comprobante compacto con QR. Es un PR sin migración. Desde el despliegue, los
   remitos nuevos salen con QR.
4. **Migración 115 en PROD,** con el OK de Agustín antes de aplicarla. `controlar_desde`
   queda en el primer remito posterior a B1.
5. **B2:** el panel, la clave (huella en la base, credencial en n8n) y los workflows nuevos
   (se reimportan la Ingesta y *Evaluar firmas*).
6. **Prueba real** y activación de Ingesta, *Evaluar firmas* y *Vigilancia*.
