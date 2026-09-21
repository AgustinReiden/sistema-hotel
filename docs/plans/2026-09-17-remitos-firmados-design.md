# Remitos firmados de cuenta corriente — diseño

Fecha: 2026-09-17
Estado: propuesta, pendiente de aprobación

## 1. El problema

Cuando un cliente de cuenta corriente consume, el sistema imprime un comprobante
(`/admin/comprobante-cc/[movementId]`) que el empleado de la empresa firma en el
momento. Ese papel es el respaldo del consumo.

Al fin del período, el hotel emite una factura consolidada a la empresa. La empresa
pide, junto con la factura, **los remitos firmados que corroboran cada consumo**.

Hoy eso lo resuelven dos personas:

1. Una escanea los papeles y los guarda en el servidor.
2. Otra baja la planilla de consumos, busca a ojo el escaneo de cada uno, verifica
   que tenga firma, los agrupa y los manda.

El sistema no sabe nada de esto. No sabe qué remitos se escanearon, cuáles están
firmados, ni cuáles faltan.

### Qué trabajo es realmente

Mirar si hay firma es la parte chica. A ~200 remitos por mes (~10 por día hábil),
son unos dos minutos diarios. El trabajo pesado es otro:

- **Cotejar**: encontrar el escaneo que corresponde a cada consumo.
- **Detectar faltantes**: saber qué remitos nunca llegaron, cuando ya es tarde para
  reclamarlos.
- **Armar el paquete**: juntar y ordenar los escaneos para mandarlos.

Ese es el trabajo que elimina este diseño. La detección automática de firma queda
explícitamente **fuera de esta versión** (ver §9).

## 2. Objetivo

Que el estado de cada remito —escaneado, firmado, faltante— viva en la base de
datos, colgado del consumo, y que el sistema lo mantenga solo.

Éxito se ve así:

- El que escanea suelta papeles en una carpeta y no clasifica nada.
- El que controla abre una pantalla, ve qué falta y tilda lo que corresponda.
- Al facturar, el sistema avisa qué remitos faltan antes de emitir.
- El paquete para el cliente se arma solo.

## 3. La pieza que hace todo posible: el número en el papel

Hoy el comprobante imprime como número los primeros 8 caracteres del UUID del
movimiento (`raw.id.slice(0, 8)`). Sirve para identificar a mano, pero no para
dictar, tipear ni buscar.

El diseño agrega **dos cosas al papel impreso**:

1. **Un número corto y secuencial** (`R-000123`), legible, grande, tipeable.
2. **Un código escaneable** con ese mismo número más un verificador
   (`R-000123-A7F3`), donde el verificador se deriva de una clave que solo conoce el
   servidor.

El verificador no es seguridad, es **anti-error**: garantiza que un código mal leído
o un número mal tipeado se rechace en vez de imputarse al comprobante equivocado.

Con eso, identificar a qué consumo pertenece un escaneo es **determinístico**: no
hay IA, no hay heurística, no hay ambigüedad. Es la decisión de diseño de la que
cuelga todo lo demás.

### Riesgo principal, y cómo se prueba primero

La comandera imprime a 203 dpi en papel térmico de 80mm. Un QR chico sale borroso y
después el escáner no lo lee.

**Antes de construir nada**, se hace una prueba de humo: imprimir remitos de prueba
con el código en dos tamaños y dos formatos (QR y código de barras lineal tipo
Code128), escanearlos con el escáner real, y verificar que se lean. Si el QR no
sobrevive, se usa el código lineal; si ninguno sobrevive, se cae a tipeo manual del
número —el resto del diseño no cambia, solo se vuelve más lento el paso 3.

El número en texto grande es el seguro permanente: si el código no se lee por papel
arrugado o escaneo torcido, alguien lo tipea en tres segundos.

La librería `qrcode` ya es dependencia del proyecto y ya se usa para imprimir el QR
de ARCA desde un server component (`src/lib/arca/qr.ts`). No hay costo ni pieza
nueva.

## 4. Modelo de datos

### 4.1 Numeración del remito

`cuenta_corriente_movimientos` suma `remito_nro bigint`, asignado por secuencia al
insertar un movimiento de tipo `cargo`. Los `pago` no llevan remito y quedan en NULL.

Es inmutable: una vez asignado no cambia nunca, porque ya está impreso en un papel
que anda dando vueltas.

### 4.2 Estado de firma

En el mismo movimiento:

- `firma_estado`: `sin_escanear` (default) | `firmado` | `sin_firma` | `sin_remito`
- `firma_confirmada_por` / `firma_confirmada_at`: quién lo marcó y cuándo
- `firma_nota`: texto libre, obligatorio para `sin_remito`

`sin_remito` es la válvula de escape: el papel se perdió y no va a aparecer. Sin ese
estado, un remito perdido queda como faltante para siempre y la pantalla nunca queda
limpia, que es como una alerta deja de mirarse.

El estado siempre lo confirma una persona. En esta versión no hay nada automático
escribiendo ahí.

### 4.3 Escaneos

Tabla `remito_escaneos`:

- `id`, `cc_movimiento_id`
- `ruta`: ruta canónica en el almacenamiento, escrita por el sistema
- `hash_sha256`: del contenido del archivo
- `version`: 1, 2, 3… (un remito puede re-escanearse)
- `subido_por`, `created_at`
- índice único parcial: una sola versión vigente por movimiento

La base guarda **el puntero, no el binario**. El archivo vive en Drive (o en el
servidor propio), que es almacenamiento barato. Esto mantiene a Supabase en su plan
gratuito: unos pocos cientos de bytes por remito en vez de 100 KB.

El hash es lo que hace que Drive sea aceptable como archivo definitivo: si alguien
mueve, reemplaza o corrompe un archivo, el hash deja de coincidir y el sistema lo
puede detectar en vez de entregar un respaldo equivocado.

### 4.4 Páginas no identificadas

Tabla `remito_paginas_sin_identificar`:

- `id`, `ruta`, `hash_sha256`, `lote_origen`
- `motivo`: `codigo_ilegible` | `codigo_inexistente` | `no_es_remito`
- `resuelto_at`, `resuelto_por`, `resuelto_como` (movimiento al que se imputó)

Sin esta tabla, la primera página torcida frena la cadena entera. Con ella, lo que no
se pudo resolver automáticamente queda visible y accionable, y el resto del lote
sigue.

## 5. El flujo

### Paso 1 — Impresión

El comprobante de cta. cte. imprime el número corto en grande y el código escaneable.
Nada más cambia en el papel.

### Paso 2 — Buzón de entrada

Una sola carpeta, `_Entrada`. El que escanea suelta el archivo con el nombre que le
haya puesto el escáner. **No elige carpeta, no elige nombre, no abre el sistema.**

Cada decisión que se le pide a una persona es una decisión que puede salir mal.

### Paso 3 — Ingesta

Un proceso toma cada archivo nuevo de `_Entrada` y:

1. Lo parte en páginas (los escaneos llegan en lotes de decenas de páginas).
2. Lee el código de cada página, probando las cuatro rotaciones.
3. Verifica el dígito verificador y busca el movimiento.
4. Archiva la página en su ruta canónica: `Clientes/<cliente>/<período>/R-000123.pdf`.
5. Escribe la fila en `remito_escaneos` con la ruta y el hash.
6. Mueve el lote original a `_Procesados`.

El movimiento pasa de `sin_escanear` a "escaneado, pendiente de revisión de firma".

### Paso 4 — Conciliación

Una pantalla por cliente y período. Lista todos los consumos del período con su
estado al lado, y arriba el semáforo: *"47 consumos — 44 firmados, 2 sin revisar,
1 sin escanear"*.

El que controla abre la imagen, mira, y tilda. A diez por día son dos minutos.

Aparte, la bandeja de no identificados: la imagen a la vista y un campo para tipear
el número. Al tipearlo, la página se archiva sola.

### Paso 5 — Facturación

Al emitir la consolidada, el sistema cruza las estadías que entran en la factura
contra el estado de firma de sus remitos. El vínculo ya existe en el esquema:
`invoice_reservations.cc_movimiento_id` apunta al movimiento de cuenta corriente de
cada línea.

Si falta algo, avisa con nombre y apellido: *"faltan los remitos R-000012, R-000030 y
R-000041"*.

**No bloquea.** El admin puede emitir igual, dejando constancia de quién autorizó y
por qué. Un hotel tiene que poder facturar; lo que no puede es facturar sin enterarse.

Y arma el paquete: un PDF con los remitos del período en el mismo orden que la
factura.

### Beneficio de arrastre

Como el sistema sabe hoy que un remito de hace tres días no se escaneó, el reclamo
deja de ser retroactivo. Se pide cuando el papel todavía existe y el empleado se
acuerda, no un mes después. Buena parte de los faltantes desaparece solo por esto.

## 6. Qué pasa cuando cada paso falla

Esta es la sección que decide si el sistema sirve. Lo peor que puede pasar no es que
un paso falle: es que falle **en silencio**.

### 6.1 Impresión

| Falla | Qué hace el sistema |
|---|---|
| El código sale ilegible en la comandera | El número en texto grande permite tipearlo. Se detecta en la prueba de humo (§3), antes de construir. |
| Se reimprime un comprobante | Sale el mismo número. La numeración es del movimiento, no de la impresión. |
| El movimiento se anula después de impreso | El remito queda huérfano: sale de la conciliación y el papel, si aparece, cae en no identificados con motivo claro. |

### 6.2 Buzón

| Falla | Qué hace el sistema |
|---|---|
| Suben un archivo que no es PDF ni imagen | Va a `_Revisar` y queda listado. No frena el resto del lote. |
| Suben el mismo lote dos veces | El hash ya existe: se descarta con aviso. No duplica nada. |
| Escanean rotado o al revés | El lector prueba las cuatro rotaciones antes de rendirse. |
| Drive no responde o se cortó el permiso | Reintentos con espera creciente. **Después de N fallas, la pantalla de conciliación muestra un cartel visible: "la ingesta no corre desde hace X horas".** Esta es la falla más peligrosa, porque desde afuera se ve idéntica a "no hubo escaneos": todo parece normal y los faltantes se acumulan invisibles. |
| `_Entrada` tiene archivos hace rato | Mismo cartel. Una carpeta que no se vacía es la señal más barata que existe. |

### 6.3 Ingesta

| Falla | Qué hace el sistema |
|---|---|
| El código no se lee | La página va a `_Revisar` y a no identificados con motivo `codigo_ilegible`. Aparece en la bandeja con la imagen para tipear el número. |
| El código se lee pero el verificador no da | Se **rechaza**, motivo `codigo_inexistente`. Nunca se imputa "al más parecido". |
| El código apunta a un movimiento que no existe | Igual que arriba. |
| La página no es un remito | Motivo `no_es_remito`, descarte manual desde la bandeja. |
| Ese remito ya tenía escaneo | Se guarda como versión nueva y la anterior queda archivada. **El estado de firma vuelve a "pendiente de revisión"**: la imagen nueva puede contradecir a la vieja, y arrastrar una confirmación hecha sobre otra imagen es exactamente cómo se cuela un respaldo equivocado. |
| El proceso muere a mitad de lote | Reprocesar es idempotente: cada página se identifica por su hash, las ya archivadas se saltean. |
| El archivo archivado se movió o cambió | El hash deja de coincidir. Se detecta al armar el paquete y se reporta como remito faltante, no como remito presente. |
| El almacenamiento se llena | La ingesta falla ruidosamente y el lote queda en `_Entrada` sin marcar como procesado. Nada se pierde. |

### 6.4 Conciliación

| Falla | Qué hace el sistema |
|---|---|
| Alguien marca "firmado" por error | Queda registrado quién y cuándo. Se puede revertir; la corrección también queda registrada. |
| El papel se perdió | Estado `sin_remito` con nota obligatoria. Sale de faltantes sin mentir sobre lo que pasó. |
| El consumo se anula o sale nota de crédito | Sale de la lista: ya no hay nada que respaldar. |
| Nadie revisa durante semanas | El semáforo del período lo muestra, y el gate de facturación lo vuelve a mostrar antes de emitir. |

### 6.5 Facturación

| Falla | Qué hace el sistema |
|---|---|
| Faltan remitos | Aviso explícito con la lista. Se puede seguir dejando constancia de quién autorizó. |
| Un archivo del paquete no está | El paquete **no se genera a medias**. Se informa qué falta y no se entrega nada hasta resolverlo. Un paquete incompleto que parece completo es peor que ningún paquete. |
| Aparece un remito después de armado el paquete | El paquete se regenera entero. No se edita ni se parcha. |
| La factura se anula con nota de crédito | Los remitos vuelven a quedar disponibles para la consolidada que la reemplace. |

### 6.6 Regla general de degradación

Si la ingesta, Drive o el lector de códigos dejan de funcionar, **el resto del sistema
sigue igual**. No se bloquea un check-out, un cobro ni una facturación por un problema
de escaneo. Lo peor que pasa es que se vuelve al trabajo manual de hoy, con la
pantalla avisando por qué.

## 7. Dónde corre la ingesta

En el propio sistema (Next.js + Supabase), disparada por un cron. No se agrega n8n en
esta versión.

Razón: con el código en el papel, la ingesta es un proceso simple —partir, leer,
archivar, escribir—. n8n suma una pieza para mantener, un juego de credenciales más y
un lugar más donde debuggear, a cambio de poder cambiar el flujo sin deploy. Ese
canje conviene cuando entre la IA (§9), no antes.

## 8. Convivencia con lo que ya existe

Los remitos ya emitidos no tienen código. Conviven sin migración: quedan en
`sin_escanear` y se resuelven tipeando el número desde la bandeja de no identificados,
igual que cualquier página con código ilegible. La numeración corta arranca en el
primer movimiento nuevo.

## 9. Fuera de alcance (v2)

**Detección automática de firma.** Se enchufa en el paso 4 —pre-marca el estado, el
humano revisa solo los dudosos— sin tocar nada del resto del diseño. Costo estimado a
200 remitos/mes: menos de un dólar mensual con cualquier modelo de visión actual, o
gratis dentro del nivel gratuito de Gemini. Modelo recomendado para evaluar primero:
Gemini 3 Flash.

Va después, no por costo, sino porque:

- Ahorra dos minutos diarios; el resto del diseño ahorra un puesto.
- Para confiarle algo hay que medirla primero contra remitos reales, y esos remitos
  recién van a existir cuando este flujo esté andando.
- Un falso positivo —"dice firmado, no lo estaba"— manda una factura con respaldo
  falso, y eso se paga con el consumo rebotado. La IA nunca decide qué comprobante es,
  solo si hay firma, y el humano confirma.

**También fuera:** reclamo automático por mail de remitos faltantes, y firma digital
en pantalla (que eliminaría el papel, pero es otro proyecto y otra discusión con los
clientes).

## 10. Orden de construcción

1. **Prueba de humo del código impreso.** Comandera + escáner reales. Si esto falla,
   el diseño cambia antes de escribirse una línea.
2. Numeración y código en el comprobante impreso.
3. Modelo de datos y pantalla de conciliación, con carga manual del escaneo.
   *Acá ya se puede usar el sistema*: alguien sube el archivo a mano y tilda.
4. Ingesta automática desde el buzón, con la bandeja de no identificados.
5. Gate de facturación y armado del paquete.

Cada paso deja algo usable. El 3 ya reemplaza la planilla manual.
