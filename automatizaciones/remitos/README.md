# Remitos firmados — ingesta (etapa 1)

Automatización aislada del sistema del hotel: toma los escaneos de los comprobantes de
cuenta corriente, identifica cada remito por su código, lo archiva en Drive en
`Remitos/<Cliente>/<Unidad>/<AAAA-MM>/` y anota si está firmado y con qué confianza.

**No toca el sistema del hotel.** No importa nada de `src/`, no escribe en la base.
Diseño: [`docs/plans/2026-09-17-remitos-firmados-design.md`](../../docs/plans/2026-09-17-remitos-firmados-design.md).

## Piezas

| Carpeta | Qué es |
|---|---|
| `comun/codigo.mjs` | Formato del código `T-000123-96` y su dígito verificador (MOD 97, público). |
| `comun/ticket-compacto.mjs` | Diseño del comprobante compacto con QR: estilos, lado del QR y opciones del dibujo. El sistema tiene una copia y un test que compara las dos. |
| `generador/` | Genera comprobantes de prueba imprimibles (80 mm) con el diseño compacto del sistema, a partir de movimientos reales. |
| `worker/` | Servicio HTTP: recibe el escaneo, separa los tickets (cartulina negra), devuelve cada uno con su código. Sin estado, sin Google. |
| `n8n/logica.mjs` | Reglas de negocio (qué archivar, qué mandar a revisar, versiones, firma). Puras y testeadas. |
| `n8n/construir.mjs` | Arma los workflows de n8n incrustando `logica.mjs` en los nodos Code. |
| `herramientas/` | `analizar-escaneo.mjs` corre el worker sobre un escaneo real y guarda cada recorte (diagnóstico de pruebas con papel). `comparar-workflow.mjs` confirma que un workflow importado a mano en n8n quedó igual al build. |
| `test/` | `npm test` — 101 tests, incluida la separación de tickets en cualquier ángulo y la coherencia de los workflows. |

`salida/` queda fuera de git: ahí van los datos reales, los PDF generados y los workflows
armados (llevan ids y datos de clientes).

## Cómo se escanea

**Varios tickets por hoja, sobre cartulina negra:**

1. Poner los tickets sueltos en el vidrio, **separados al menos 1 cm** entre sí y del borde.
   Pueden quedar torcidos o al revés: se enderezan solos. Lo que no puede pasar es que se
   toquen o se monten: se ven como una sola forma y van todos juntos a `_Revisar`.
2. **Taparlos con una cartulina negra** (A4 o más grande) y recién ahí cerrar la tapa.
3. Escanear. Varias hojas pueden ir en un mismo PDF.

El worker encuentra cada ticket por su forma (blanco sobre negro), lo recorta derecho y
después lee su código. Un ticket con el código ilegible **igual aparece** y va a
`_Revisar` con su imagen: no se puede perder en silencio.

Si alguien se olvida la cartulina, la hoja se procesa como antes: un remito por hoja. Si
esa hoja tenía varios, va entera a `_Revisar` como `varios_codigos`.

## Paso a paso

### 1. Hoja de muestras (antes que nada)

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
leyó; con 16 y 18 mm se leyeron todos. El ticket impreso mide unos 10 cm de largo.

### 2. Lote de prueba

`salida/datos.local.json` tiene 20 movimientos reales (se sacaron con SELECT, solo lectura).

```bash
npm run generar -- --datos salida/datos.local.json
```

Sale con el QR del sistema; `--qr-mm` lo cambia.

- `salida/comprobantes.html` → imprimir en la comandera.
- `salida/comprobantes.csv` → es la pestaña `Comprobantes` de la planilla (la instalación ya
  la carga sola si el CSV existe cuando se arman los workflows).

### 3. Worker en el servidor de n8n

Al lado de n8n, en la misma red de Docker y **sin publicar el puerto**:

```yaml
  remitos-worker:
    build: ./remitos          # esta carpeta
    restart: unless-stopped
    environment:
      - WORKER_TOKEN=${REMITOS_WORKER_TOKEN}   # un secreto largo cualquiera
    # sin "ports:": solo lo ve n8n, como http://remitos-worker:8787
```

Sin Docker: `HOST=0.0.0.0 WORKER_TOKEN=... npm run worker`.

### 4. Credenciales en n8n (las creás vos)

| Credencial | Tipo en n8n | Dato |
|---|---|---|
| Google | Google Drive OAuth2 API | Tu cuenta de Google. Con esta sola alcanza también para Sheets. |
| Gemini | Header Auth | Name `x-goog-api-key`, Value: tu API key de Gemini |
| Worker | Header Auth | Name `X-Worker-Token`, Value: el mismo `WORKER_TOKEN` del paso 3 |

### 5. Instalación

Corré una vez a mano el workflow **Remitos - Instalación**. Crea en Mi unidad:

```
Remitos/
  _Entrada/      ← acá se sueltan los escaneos
  _Revisar/      ← lo que no se pudo identificar
  _Procesados/   ← los escaneos originales ya procesados
  Remitos - Control   (planilla: Comprobantes, Resultados, Lotes, Errores, Estado)
```

Si `Remitos` ya existe, no hace nada. El resultado trae los ids: con eso se completan
`n8n/config.local.json`, se reconstruyen los workflows y se suben.

### 6. Configuración de cada workflow en n8n

En *Settings* de cada workflow: **Execution order: v1** y, en `Remitos - Ingesta`,
`Remitos - Evaluar firmas` y `Remitos - Vigilancia`, **Error workflow: Remitos - Errores**.

### 7. Qué hace cada workflow

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `Remitos - Ingesta` | Cada 5 min | Toma el archivo más viejo de `_Entrada`, lo separa en tickets, archiva cada uno y anota la fila en `Resultados` con la firma `pendiente`. **No llama a Gemini**: una caída de Google nunca frena ni alarga el archivo. |
| `Remitos - Evaluar firmas` | Cada 5 min | Toma hasta 5 firmas `pendiente` (o `error` con intentos libres) y las evalúa de a una, con una pausa, mandándole a Gemini el PDF archivado. |
| `Remitos - Vigilancia` | Cada hora | Avisa si la ingesta no corre o si `_Entrada` no se vacía. |
| `Remitos - Config`, `Asegurar carpeta`, `Errores` | Los llaman los demás | Ajustes y carpetas por nombre; registro de ejecuciones caídas. |

## Qué pasa cuando algo falla

| Falla | Qué hace |
|---|---|
| Código ilegible, DV que no cierra, código ajeno | El ticket va a `_Revisar` con el motivo en el nombre y en `Resultados`. Nunca se imputa "al más parecido". |
| Dos tickets pegados sobre la cartulina | Se ven como una sola forma: van a `_Revisar` como `forma_no_reconocida`, con los números que se alcanzan a leer en el nombre del archivo (`..._forma_no_reconocida_T-000007_T-000013.pdf`) para saber cuáles re-escanear. Nunca se imputan. |
| Cartulina escaneada sin tickets | La hoja va a `_Revisar` como `sin_tickets`. |
| Sin cartulina y varios tickets en la hoja | La hoja entera va a `_Revisar` como `varios_codigos`. |
| Código válido que no está en `Comprobantes` | `_Revisar`, motivo `codigo_inexistente`. |
| Re-escaneo de un remito ya archivado | Se guarda como `T-000123_v2.pdf`, marcado `reescaneo`. No pisa nada. |
| El mismo archivo subido dos veces | `Lotes` lo reconoce por hash: se aparta como `duplicado`. |
| El flujo se cae a mitad de lote | El original queda en `_Entrada` y se reintenta; lo ya guardado se saltea por hash. |
| Archivo que no es PDF/imagen, o documento de Google | Se aparta a `_Revisar` y se anota en `Errores`. No se reintenta. |
| Worker caído | Se anota en `Errores`; el archivo queda en `_Entrada` y se reintenta cada 5 minutos. |
| Gemini falla o está saturado | La ingesta no se entera: archiva igual y la firma queda `pendiente`. `Remitos - Evaluar firmas` prueba el modelo principal y, si falla, el de respaldo. Si fallan los dos por cuota (429), saturación (503) o red, la firma queda `error` (nunca "no firmado"), la corrida se corta y se sigue 5 minutos después. Cada firma tiene hasta 5 intentos; en la observación queda el código y el mensaje real de Google. |
| Se reinstala (carpetas y planilla nuevas) | Nada que tocar: `Remitos - Config` busca carpetas y planilla por nombre en cada corrida. Si falta algo o está repetido, la corrida falla con un mensaje claro. |
| Dos corridas a la vez | Un turno en `Estado` lo impide; si una corrida muere, el turno vence a los 30 min. |
| La ingesta deja de correr o `_Entrada` no se vacía | `Remitos - Vigilancia` avisa por WhatsApp (webhook del hotel), como máximo cada 6 h. |

## Límites conocidos

- **Varios por hoja requiere cartulina negra.** Sin ella, un remito por hoja.
- **Tickets separados al menos 1 cm.** Si se tocan, se ven como una sola forma y van a revisión.
- **La confianza de la firma la declara el modelo**, no está calibrada. Para eso es la prueba:
  comparar `Resultados.firma` contra `Comprobantes.verdad_firmado`.
- **La prueba sin papel** (HTML → PDF → worker) lee 20 de 20, pero no reemplaza la prueba con
  la comandera y el escáner reales.
