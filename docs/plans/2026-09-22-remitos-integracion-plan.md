# Remitos firmados: integración con el sistema — plan de implementación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o superpowers:subagent-driven-development) para implementar este plan tarea por tarea.

**Goal:** que el comprobante de cuenta corriente salga compacto y con QR (`R-000158`), y que el estado de firma de cada remito viva en la base y se vea en un panel del admin, alimentado por la automatización de n8n.

**Architecture:** B1 cambia solo la página de impresión `/admin/comprobante-cc/[movementId]` (diseño compacto + QR con dígito MOD 97). B2 agrega la migración 116: tablas cerradas + funciones `SECURITY DEFINER`; seis para n8n, que exigen la clave `x-remitos-clave`, y ocho para el panel, que exigen `app_is_admin()`. Además suma el panel `/admin/remitos` y cambia los workflows de n8n para que lean y escriban en la base en lugar de la planilla.

**Tech Stack:** Next.js 16 (App Router, server components, server actions), Supabase/PostgREST, PL/pgSQL, Vitest + Testing Library, `qrcode`, n8n (workflows armados por `automatizaciones/remitos/n8n/construir.mjs`), `node:test` para la automatización.

**Diseño aprobado:** [`2026-09-22-remitos-integracion-design.md`](2026-09-22-remitos-integracion-design.md).

---

## Reglas de este repo (leer antes de empezar)

- **Worktree:** `C:\Users\jorge\Desktop\sistema-hotel\.claude\worktrees\pagos-imputados-retenciones-57d6d5`. Rama por fase desde `origin/main`, PR y **nunca mergear** (mergea Agustín; al mergear, Coolify despliega a producción el hotel y, por watch paths, el worker).
- **Repo público:** nada de nombres de clientes, CUIT, IDs de Drive, claves ni la URL del proyecto de Supabase en archivos versionados. En tests, nombres ficticios.
- **Windows + CRLF:** el checkout tiene CRLF. Editar con la herramienta de edición, no con `sed` sobre código.
- **Comandos del sistema (raíz):** `npm ci` (si falta `node_modules`), `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- **Comandos de la automatización:** `cd automatizaciones/remitos && npm ci && npm test`.
- **Base de PROD:** el conector MCP `supabase-sistema-hotel-prod` es para leer. El DDL va con `select public.exec_ddl($m116$ ... $m116$)`, **sin** `BEGIN;/COMMIT;`, **sin** `;` final en la llamada y **sin comillas en los comentarios SQL** (el conector se traba). Aplicar a PROD **solo con el OK explícito de Agustín**.
- **n8n:** el MCP `update_workflow` funciona en *Config*, *Errores* y *Asegurar carpeta*. La Ingesta y *Evaluar firmas* los reimporta Agustín dentro del mismo workflow: abrir, Ctrl+A, Delete, *Import from File*, Save.
- 👤 **AGUSTÍN** marca los pasos que hace él.

---

## Fase 0 — Prerrequisitos

### Task 0.1: PR #123 verificado y mergeado

1. 👤 **AGUSTÍN:** importar `salida/n8n/ingesta.json` en *Remitos - Ingesta* y `salida/n8n/evaluar-firmas.json` en *Remitos - Reintentar firmas*; renombrar este último a **Remitos - Evaluar firmas**; correrlo a mano 3 veces.
2. Verificar la importación: `mcp__n8n__get_workflow` de la Ingesta y de *Evaluar firmas* (ids en `automatizaciones/remitos/n8n/config.local.json`: `ingesta_id` y `evaluar_firmas_id`; la salida va a un archivo) y comparar contra el build con `node herramientas/comparar-workflow.mjs <archivo bajado> salida/n8n/ingesta.json` (y lo mismo con `evaluar-firmas.json`). Esperado: `0 diferencia(s)`. La herramienta ya ignora los valores por defecto que n8n borra.
3. Pedir a Agustín la pestaña *Resultados* (captura o .xlsx) y confirmar que cada una de las 11 firmas corresponde a su ticket:
   - T-000012, 08, 09, 10, 11 y 20: firmados.
   - T-000014 y 15: en blanco.
   - T-000018: solo aclaración, tiene que salir `no`.
   - T-000016, la rayita, y T-000017, la tenue: dudosas.
4. 👤 **AGUSTÍN:** mergear PR #123.
5. `git fetch origin` y confirmar que `origin/main` contiene `claude/remitos-evaluar-firmas`.

---

## Fase 1 — Prueba de impresión del ticket compacto (automatización)

Rama: `claude/remitos-b1-comprobante-qr` desde `origin/main`.

### Task 1.1: diseño compacto compartido

**Files:**
- Create: `automatizaciones/remitos/comun/ticket-compacto.mjs`

**Step 1: crear el módulo** (sin dependencias: lo importa también un test del sistema)

```js
// Diseño del comprobante de cuenta corriente con QR (2026-09-22).
//
// Lo usan el generador de tickets de prueba y, copiado, el sistema
// (src/app/admin/comprobante-cc/ticket-compacto.ts). Un test del sistema compara
// las dos copias: si cambia una sin la otra, falla.
//
// Sin dependencias a proposito: el test del sistema lo importa desde otra raiz.

/** Lado del QR impreso, en mm. Sale de la prueba de impresion en la comandera. */
export const QR_MM = 16;

/**
 * Estilos completos del ticket compacto, bajo la clase `compacto`. En el sistema
 * van DESPUES de los estilos termicos comunes, asi estos mandan.
 */
export const CSS_TICKET_COMPACTO = `
.compacto { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; background: white; color: #000; width: 72mm; max-width: 72mm; margin: 0 auto; padding: 0 3mm; box-sizing: border-box; line-height: 1.25; }
.compacto h1 { font-size: 12pt; font-weight: 900; margin: 0 0 1px; padding-top: 1mm; text-align: center; line-height: 1.15; }
.compacto .addr { font-size: 8pt; font-weight: 600; text-align: center; margin: 0 0 2px; }
.compacto .tipo { font-size: 7.5pt; font-weight: 800; text-align: center; letter-spacing: 1px; margin: 0 0 2px; }
.compacto hr { border: none; border-top: 1px solid #000; margin: 3px 0; }
.compacto .ident { display: flex; align-items: center; gap: 3mm; margin: 3px 0; }
.compacto .ident .qr { display: block; flex: 0 0 auto; image-rendering: pixelated; image-rendering: crisp-edges; }
.compacto .ident .nro { font-family: "Courier New", monospace; font-size: 13pt; font-weight: 900; letter-spacing: 0.5px; margin: 0; }
.compacto .ident .fecha { font-size: 8.5pt; font-weight: 700; margin: 2px 0 0; }
.compacto .row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-size: 9pt; margin: 1.5px 0; }
.compacto .row > span:first-child { flex: 0 0 auto; white-space: nowrap; font-weight: 700; }
.compacto .row > span:last-child { flex: 1 1 auto; min-width: 0; text-align: right; font-weight: 600; overflow-wrap: break-word; }
.compacto .total { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 10.5pt; font-weight: 900; margin: 4px 0 2px; border-top: 1px solid #000; padding-top: 3px; }
.compacto .total > span:last-child { white-space: nowrap; }
.compacto .firma, .compacto .aclaracion { display: flex; align-items: flex-end; gap: 2mm; font-size: 8.5pt; font-weight: 700; }
.compacto .firma { height: 13mm; }
.compacto .aclaracion { height: 8mm; }
.compacto .linea { flex: 1 1 auto; border-bottom: 1px solid #000; margin-bottom: 1mm; }
.compacto .thermal-feed { height: 2mm; }
`.trim();
```

**Step 2: commit**

```bash
git add automatizaciones/remitos/comun/ticket-compacto.mjs
git commit -m "Remitos: diseño del comprobante compacto con QR, compartido"
```

### Task 1.2: el generador arma el ticket compacto

**Files:**
- Modify: `automatizaciones/remitos/generador/ticket.mjs` (reemplazar el ticket viejo por el compacto)
- Modify: `automatizaciones/remitos/generador/cli.mjs` (`--muestras` con tamaños, `--qr-mm`)
- Test: `automatizaciones/remitos/test/ticket.test.mjs`

**Step 1: test que falla**

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { htmlTicket } from "../generador/ticket.mjs";
import { QR_MM } from "../comun/ticket-compacto.mjs";

const HOTEL = { nombre: "Hotel de Prueba", direccion: "Ruta 1 km 1", zona: "America/Argentina/Tucuman" };
const C = {
  numero_visible: "T-000158", codigo: "T-000158-00", cliente: "EMPRESA DE PRUEBA SA", documento: "20000000001",
  habitacion: "7", check_in: "2026-09-16T15:00:00Z", check_out: "2026-09-17T11:00:00Z",
  created_at: "2026-09-17T11:00:00Z", monto: 50000,
};

test("ticket compacto: QR al costado del numero, sin titulos ni textos de mas", async () => {
  const h = await htmlTicket(C, HOTEL);
  assert.match(h, /class="thermal-page compacto"/);
  assert.match(h, /COMPROBANTE CTA\. CTE\./);
  assert.match(h, new RegExp(`width:${QR_MM}mm;height:${QR_MM}mm`));
  assert.match(h, /class="nro">T-000158</);
  assert.match(h, /class="firma"/);
  assert.match(h, /class="aclaracion"/);
  assert.doesNotMatch(h, /CARGO A CUENTA CORRIENTE/);
  assert.doesNotMatch(h, /reconoce adeudar/);
  assert.doesNotMatch(h, /Conserve este comprobante/);
});

test("ticket compacto: el tamaño del QR y la leyenda de muestra se pueden cambiar", async () => {
  const h = await htmlTicket(C, HOTEL, { qrMm: 14, leyenda: "MUESTRA 14 mm" });
  assert.match(h, /width:14mm;height:14mm/);
  assert.match(h, /COMPROBANTE CTA\. CTE\. · MUESTRA 14 mm/);
});
```

**Step 2:** `cd automatizaciones/remitos && node --test test/ticket.test.mjs` → FALLA (el ticket viejo tiene "CARGO A CUENTA CORRIENTE").

**Step 3: implementación.** En `generador/ticket.mjs`:
- Borrar `FORMATOS`, `imagenCodigo`, `bloqueIdentificacion` y `htmlMuestra`.
- Reemplazar `htmlTicket` por la versión de abajo.
- En `documento()`, reemplazar las reglas de ticket viejas (`.thermal-page {...}`, `h1`, `.addr`, `.prueba`, `h2`, `.sub`, `hr`, `.row*`, `.total*`, `.note`, `.footer*`, `.ident`, `.codigo`, `.nro-grande`) por `${CSS_TICKET_COMPACTO}`.
- Conservar: `@page`, `@media print`, `body`, `.barra*`, `.thermal-page + .thermal-page { break-before: page; page-break-before: always; }` y `@media screen { .thermal-page { margin: 8mm auto; box-shadow: 0 0 4px #999; } }`.
- `scriptImpresion` queda igual.

```js
import bwipjs from "bwip-js/node";

import { CSS_TICKET_COMPACTO, QR_MM } from "../comun/ticket-compacto.mjs";

async function imagenQr(texto, lado) {
  // Escala alta y render "pixelated": Chrome la baja a la resolucion de la
  // comandera sin suavizar bordes, que es lo que arruina un codigo en termico.
  const png = await bwipjs.toBuffer({ bcid: "qrcode", text: texto, scale: 8, eclevel: "M", paddingwidth: 4, paddingheight: 4 });
  return `<img class="qr" alt="${esc(texto)}" style="width:${lado}mm;height:${lado}mm" src="data:image/png;base64,${png.toString("base64")}">`;
}

/**
 * Un comprobante con el diseño compacto del sistema. `c` es una fila del manifiesto.
 * `leyenda` se agrega a la linea chica de arriba (ej. "MUESTRA 14 mm").
 */
export async function htmlTicket(c, hotel, { qrMm = QR_MM, leyenda = "" } = {}) {
  return `
  <section class="thermal-page compacto">
    <h1>${esc(hotel.nombre)}</h1>
    ${hotel.direccion ? `<p class="addr">${esc(hotel.direccion)}</p>` : ""}
    <p class="tipo">COMPROBANTE CTA. CTE.${leyenda ? ` · ${esc(leyenda)}` : ""}</p>
    <hr />
    <div class="ident">
      ${await imagenQr(c.codigo, qrMm)}
      <div>
        <p class="nro">${esc(c.numero_visible)}</p>
        <p class="fecha">${esc(fechaHora(c.created_at, hotel.zona))}</p>
      </div>
    </div>
    <hr />
    <p class="row"><span>Cliente:</span><span>${esc(c.cliente)}</span></p>
    ${c.documento ? `<p class="row"><span>DNI/CUIT:</span><span>${esc(c.documento)}</span></p>` : ""}
    ${c.habitacion ? `<p class="row"><span>Habitación:</span><span>${esc(c.habitacion)}</span></p>` : ""}
    ${c.check_in ? `<p class="row"><span>Estadía:</span><span>${esc(fecha(c.check_in, hotel.zona))} → ${esc(fecha(c.check_out, hotel.zona))}</span></p>` : ""}
    <p class="total"><span>CARGADO A CUENTA</span><span class="money">${esc(pesos(c.monto))}</span></p>
    <div class="firma"><span>Firma:</span><span class="linea"></span></div>
    <div class="aclaracion"><span>Aclaración:</span><span class="linea"></span></div>
    <div class="thermal-feed"></div>
  </section>`;
}
```

En `generador/cli.mjs`:
- Reemplazar la rama `--muestras` por:

```js
if (args.includes("--muestras")) {
  // Numeros 900+ reservados para muestras: no chocan con el lote (que arranca en 1).
  const tamanos = opcion("--tamanos", "14,16,18").split(",").map((s) => Number(s.trim())).filter((n) => n >= 8 && n <= 30);
  const secciones = [];
  let n = 911;
  for (const lado of tamanos) {
    for (let copia = 0; copia < 2; copia++, n++) {
      const c = {
        codigo: formatearCodigo(PREFIJO_PRUEBA, n), numero_visible: numeroVisible(PREFIJO_PRUEBA, n),
        cliente: "EMPRESA DE PRUEBA SA", documento: "20000000001", habitacion: "7",
        check_in: "2026-09-16T15:00:00Z", check_out: "2026-09-17T11:00:00Z",
        created_at: new Date().toISOString(), monto: 50000,
      };
      secciones.push(await htmlTicket(c, HOTEL_POR_DEFECTO, { qrMm: lado, leyenda: `MUESTRA ${lado} mm` }));
      console.log(`  ${c.numero_visible}  ->  QR ${lado} mm`);
    }
  }
  const destino = join(SALIDA, "muestras.html");
  await writeFile(destino, documento("Muestras del ticket compacto", secciones));
  console.log(`\nMuestras en ${destino}. Imprimir de a uno en la comandera, escanear con la cartulina.`);
  process.exit(0);
}
```

- Reemplazar la opción `--formato` por `--qr-mm` (default `QR_MM`). Hay que importar `QR_MM` desde `../comun/ticket-compacto.mjs`, sacar `FORMATOS` del import y llamar `htmlTicket(c, hotel, { qrMm })`. El CSV de *Comprobantes* se sigue escribiendo hasta la Fase 5.
- En la ayuda de la cabecera: `--muestras [--tamanos 14,16,18]` y `--datos ... [--qr-mm 16] [--solo 7-20]`.

**Step 4:** `cd automatizaciones/remitos && npm test`. Esperado: todo en verde, con los 2 tests nuevos incluidos.

**Step 5: commit**

```bash
git add automatizaciones/remitos/generador automatizaciones/remitos/test/ticket.test.mjs
git commit -m "Remitos: los tickets de prueba usan el diseño compacto; muestras de 14, 16 y 18 mm"
```

### Task 1.3: hoja de muestras y prueba real

1. `cd automatizaciones/remitos && npm run generar -- --muestras`. Sale `salida/muestras.html` con 6 tickets:
   - T-000911 y 912: QR de 14 mm.
   - T-000913 y 914: QR de 16 mm.
   - T-000915 y 916: QR de 18 mm.
2. Abrir el HTML en el panel del navegador y sacar una captura para mandarle a Agustín, junto con la ruta del archivo.
3. 👤 **AGUSTÍN:** imprimir con **Imprimir de a uno**, escanear los 6 juntos con la cartulina, sin que se toquen y algunos torcidos, y pasar la ruta del PDF.
4. Correr `cd automatizaciones/remitos && node herramientas/analizar-escaneo.mjs --pdf <ruta> --salida salida/diag-muestras`. Imprime por pieza la ubicación, el número, la resolución a la que se leyó (`dpi 200` = primera pasada) y las medidas. Mirar los recortes que deja en la carpeta.
5. **Criterio:** gana el lado más chico en el que las **dos** copias salen `identificado` con `dpi_lectura: 200`. Si ninguno cumple, se usa 18 y se avisa. Anotar además el largo de los tickets (medidas en mm): tiene que ser menor a ~140 mm.
6. Fijar `QR_MM` en `comun/ticket-compacto.mjs` con el valor ganador, correr `npm test` y commitear:

```bash
git commit -am "Remitos: QR de <N> mm, elegido con la prueba de impresion"
```

---

## Fase 2 — B1: el comprobante compacto con QR en el sistema

Misma rama `claude/remitos-b1-comprobante-qr`. Correr `npm ci` en la raíz si falta `node_modules`.

### Task 2.1: `remito-codigo.ts` (el dígito verificador, igual al de la automatización)

**Files:**
- Create: `src/lib/remito-codigo.ts`
- Test: `src/__tests__/remito-codigo.test.ts`

**Step 1: test que falla**

```ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { calcularDV, codigoRemito, interpretarCodigo, numeroVisible } from "@/lib/remito-codigo";

type CodigoAutomatizacion = {
  calcularDV(prefijo: string, numero: number): string;
  formatearCodigo(prefijo: string, numero: number): string;
  interpretarCodigo(texto: string): { ok: boolean; motivo?: string; numero?: number; prefijo?: string };
};

async function automatizacion(): Promise<CodigoAutomatizacion> {
  const ruta = path.resolve(process.cwd(), "automatizaciones/remitos/comun/codigo.mjs");
  return (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as CodigoAutomatizacion;
}

describe("codigo del remito", () => {
  it("numero visible y codigo completo", () => {
    expect(numeroVisible(158)).toBe("R-000158");
    expect(codigoRemito(158)).toMatch(/^R-000158-\d{2}$/);
  });

  it("da exactamente el mismo DV que la automatizacion (R y T, del 0 al 5000 y los bordes)", async () => {
    const a = await automatizacion();
    for (const prefijo of ["R", "T"]) {
      for (let n = 0; n <= 5000; n++) expect(calcularDV(prefijo, n)).toBe(a.calcularDV(prefijo, n));
    }
    for (const n of [999998, 999999]) expect(codigoRemito(n)).toBe(a.formatearCodigo("R", n));
  });

  it("lee lo mismo que la automatizacion y rechaza lo mismo", async () => {
    const a = await automatizacion();
    const bueno = codigoRemito(158);
    const dvMalo = bueno.slice(0, -2) + (bueno.endsWith("00") ? "01" : "00");
    for (const t of [bueno, dvMalo, "R-158-00", "X", ""]) {
      expect(interpretarCodigo(t).ok).toBe(a.interpretarCodigo(t).ok);
    }
    expect(interpretarCodigo(bueno)).toEqual({ ok: true, prefijo: "R", numero: 158, visible: "R-000158" });
    expect(interpretarCodigo(dvMalo)).toEqual({ ok: false, motivo: "dv_invalido" });
  });

  it("R y T con el mismo numero no comparten codigo", () => {
    expect(codigoRemito(158, "R")).not.toBe(codigoRemito(158, "T").replace(/^T/, "R"));
  });
});
```

**Step 2:** `npx vitest run src/__tests__/remito-codigo.test.ts` → FALLA (no existe el módulo).

**Step 3: implementación**

```ts
// Código escaneable del remito de cuenta corriente: "R-000158-47".
//
// Mismo formato y mismo dígito verificador (MOD 97-10, ISO 7064, público) que la
// automatización de remitos (automatizaciones/remitos/comun/codigo.mjs); un test
// compara los dos. El DV no es seguridad: hace que un código mal leído o mal
// tipeado se rechace en vez de imputarse a otro remito.

export const PREFIJO_REMITO = "R";

const PATRON = /^([A-Z]{1,3})-(\d{6})-(\d{2})$/;

function prefijoANumeros(prefijo: string): string {
  let s = "";
  for (const ch of prefijo) s += String(ch.charCodeAt(0) - 55); // A=10 … Z=35
  return s;
}

function mod97(digitos: string): number {
  let resto = 0;
  for (const d of digitos) resto = (resto * 10 + Number(d)) % 97;
  return resto;
}

function base(prefijo: string, numero: number): string {
  return prefijoANumeros(prefijo) + String(numero).padStart(6, "0");
}

export function calcularDV(prefijo: string, numero: number): string {
  if (!/^[A-Z]{1,3}$/.test(prefijo)) throw new Error(`Prefijo inválido: ${prefijo}`);
  if (!Number.isInteger(numero) || numero < 0 || numero > 999999) {
    throw new Error(`Número fuera de rango: ${numero}`);
  }
  return String(98 - mod97(base(prefijo, numero) + "00")).padStart(2, "0");
}

/** "R-000158": lo que se imprime grande y lo que se tipea. */
export function numeroVisible(numero: number, prefijo = PREFIJO_REMITO): string {
  return `${prefijo}-${String(numero).padStart(6, "0")}`;
}

/** "R-000158-47": lo que va en el QR. */
export function codigoRemito(numero: number, prefijo = PREFIJO_REMITO): string {
  return `${numeroVisible(numero, prefijo)}-${calcularDV(prefijo, numero)}`;
}

export type LecturaCodigo =
  | { ok: true; prefijo: string; numero: number; visible: string }
  | { ok: false; motivo: "formato" | "dv_invalido" };

/** Nunca "corrige": un DV que no cierra es un rechazo. */
export function interpretarCodigo(texto: string): LecturaCodigo {
  const m = PATRON.exec(String(texto ?? "").trim());
  if (!m) return { ok: false, motivo: "formato" };
  const [, prefijo, nroTxt, dv] = m;
  const numero = Number(nroTxt);
  if (mod97(base(prefijo, numero) + dv) !== 1) return { ok: false, motivo: "dv_invalido" };
  return { ok: true, prefijo, numero, visible: numeroVisible(numero, prefijo) };
}
```

**Step 4:** `npx vitest run src/__tests__/remito-codigo.test.ts` → PASA.

**Step 5:** commit `git commit -m "Remitos: codigo R- del remito con el mismo DV que la automatizacion"` (con los 2 archivos agregados).

### Task 2.2: QR del remito y copia del diseño compacto

**Files:**
- Create: `src/lib/remito-qr.ts`
- Create: `src/app/admin/comprobante-cc/ticket-compacto.ts`
- Test: `src/__tests__/ticket-compacto.test.ts`

**Step 1: test que falla**

```ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { CSS_TICKET_COMPACTO, REMITO_QR_MM } from "@/app/admin/comprobante-cc/ticket-compacto";
import { remitoQrDataUrl } from "@/lib/remito-qr";

describe("ticket compacto del remito", () => {
  it("es el mismo diseño que los tickets de prueba de la automatizacion", async () => {
    const ruta = path.resolve(process.cwd(), "automatizaciones/remitos/comun/ticket-compacto.mjs");
    const a = (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as { CSS_TICKET_COMPACTO: string; QR_MM: number };
    expect(CSS_TICKET_COMPACTO).toBe(a.CSS_TICKET_COMPACTO);
    expect(REMITO_QR_MM).toBe(a.QR_MM);
  });

  it("el QR sale como PNG y siempre igual para el mismo codigo", async () => {
    const a = await remitoQrDataUrl("R-000158-47");
    expect(a.startsWith("data:image/png;base64,")).toBe(true);
    expect(await remitoQrDataUrl("R-000158-47")).toBe(a);
  });
});
```

**Step 2:** `npx vitest run src/__tests__/ticket-compacto.test.ts` → FALLA.

**Step 3: implementación**

`src/lib/remito-qr.ts`:

```ts
import "server-only";

/**
 * PNG data-URL del QR de un remito ("R-000158-47"). Escala entera (8 px por
 * módulo) y corrección M: el mismo criterio que los tickets de prueba que se
 * probaron en la comandera. El <img> se dibuja con image-rendering: pixelated.
 */
export async function remitoQrDataUrl(codigo: string): Promise<string> {
  const { toDataURL } = await import("qrcode");
  return toDataURL(codigo, { errorCorrectionLevel: "M", margin: 1, scale: 8 });
}
```

`src/app/admin/comprobante-cc/ticket-compacto.ts`: copiar **textual** `QR_MM` (como `REMITO_QR_MM`) y `CSS_TICKET_COMPACTO` de `automatizaciones/remitos/comun/ticket-compacto.mjs`, con este encabezado:

```ts
// Copia textual de automatizaciones/remitos/comun/ticket-compacto.mjs: el ticket del
// sistema y los de prueba de la automatización tienen que ser el mismo papel. El test
// src/__tests__/ticket-compacto.test.ts compara las dos copias.
export const REMITO_QR_MM = 16; // el valor que haya quedado en la Task 1.3
export const CSS_TICKET_COMPACTO = `...`.trim();
```

**Step 4:** `npx vitest run src/__tests__/ticket-compacto.test.ts` → PASA.

**Step 5: verificación de lectura real del QR.** El sistema no tiene lector de QR. Se usa el zxing de la automatización desde la raíz del repo, con un comando descartable:

```bash
node -e "
const { toBuffer } = require('qrcode');
toBuffer('R-000158-47', { errorCorrectionLevel: 'M', margin: 1, scale: 8 }).then(async (png) => {
  const { readBarcodes } = await import('file:///C:/Users/jorge/Desktop/sistema-hotel/.claude/worktrees/pagos-imputados-retenciones-57d6d5/automatizaciones/remitos/node_modules/zxing-wasm/dist/es/reader/index.js');
  console.log((await readBarcodes(png, { formats: ['QRCode'] })).map((r) => r.text));
});"
```

Esperado: `[ 'R-000158-47' ]`. Si la ruta de `zxing-wasm` difiere, ubicarla con `ls automatizaciones/remitos/node_modules/zxing-wasm/dist`.

**Step 6:** commit `git commit -m "Remitos: QR del remito y diseño compacto compartido con la automatizacion"`.

### Task 2.3: la página del comprobante compacto

**Files:**
- Modify: `src/app/admin/comprobante-cc/[movementId]/page.tsx`

**Step 1: implementación.**
- **Imports:** agregar `codigoRemito, numeroVisible` de `@/lib/remito-codigo`, `remitoQrDataUrl` de `@/lib/remito-qr` y `CSS_TICKET_COMPACTO, REMITO_QR_MM` de `../ticket-compacto`.
- **Sin tocar:** `remitoNumeroCached`, `generateMetadata` y la consulta.
- **Después de `if (error || !data) notFound();`**, y ya con `raw` tipado:

```tsx
  // Solo los cargos llevan remito. Un pago que llegara por esta URL se imprimía
  // como "CARGO A CUENTA CORRIENTE" con un número que no es de ningún remito.
  if (raw.tipo !== "cargo") notFound();
```

y, antes del `return`:

```tsx
  const codigo = raw.remito_numero !== null ? codigoRemito(raw.remito_numero) : null;
  const visible = raw.remito_numero !== null ? numeroVisible(raw.remito_numero) : raw.id.slice(0, 8);
  const qr = codigo ? await remitoQrDataUrl(codigo) : null;
```

- **El `return` entero se reemplaza por:**

```tsx
  return (
    <div className="thermal">
      <div className="compacto">
        <h1>{hotelSettings?.name || "Hotel El Refugio"}</h1>
        {hotelSettings?.address ? <p className="addr">{hotelSettings.address}</p> : null}
        <p className="tipo">COMPROBANTE CTA. CTE.</p>
        <hr />
        {/* QR al costado del número, no arriba: el bloque ocupa lo que mide el QR
            y el ticket sale más corto que el de antes sin QR (pedido de Agustín). */}
        <div className="ident">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="qr"
              src={qr}
              alt={codigo ?? ""}
              style={{ width: `${REMITO_QR_MM}mm`, height: `${REMITO_QR_MM}mm` }}
            />
          ) : null}
          <div>
            <p className="nro">{visible}</p>
            <p className="fecha">{formatHotelDateTime(raw.created_at, tz)}</p>
          </div>
        </div>
        <hr />
        <p className="row">
          <span>Cliente:</span>
          <span>{clientName}</span>
        </p>
        {clientDoc && (
          <p className="row">
            <span>DNI/CUIT:</span>
            <span>{clientDoc}</span>
          </p>
        )}
        {room && (
          <p className="row">
            <span>Habitación:</span>
            <span>{room.room_number}</span>
          </p>
        )}
        {reservation && (
          <p className="row">
            <span>Estadía:</span>
            <span>
              {formatHotelDate(reservation.check_in_target, tz)} → {formatHotelDate(reservation.check_out_target, tz)}
            </span>
          </p>
        )}
        <p className="total">
          <span>CARGADO A CUENTA</span>
          <span className="money">{formatAmount(amount)}</span>
        </p>
        <div className="firma">
          <span>Firma:</span>
          <span className="linea" />
        </div>
        <div className="aclaracion">
          <span>Aclaración:</span>
          <span className="linea" />
        </div>
      </div>
      <div className="thermal-feed" aria-hidden="true" />
      {autoPrint && <ReceiptAutoPrint closeOnDone />}
      <ThermalStyles />
      {/* Después de ThermalStyles a propósito: el diseño compacto manda sobre los
          tamaños comunes de los papeles térmicos. */}
      <style>{`.thermal-feed { height: 2mm; }\n${CSS_TICKET_COMPACTO}`}</style>
    </div>
  );
```

- `formatShiftCode` queda en uso solo en `generateMetadata`.

**Step 2:** `npm run typecheck && npm run lint && npm test`. Todo en verde.

**Step 3:** `npm run build` → OK.

**Step 4:** commit `git commit -m "Remitos: comprobante de cuenta corriente compacto con QR R-"`.

### Task 2.4: PR de B1

1. `git push -u origin claude/remitos-b1-comprobante-qr` y `gh pr create`. El PR explica:
   - el papel antes y después (largo medido en la prueba, tamaño de QR elegido);
   - el test de sincronía con la automatización;
   - que los códigos `R-` escaneados antes de B2 van a `_Revisar` como `codigo_inexistente` (la planilla solo conoce `T-`), así que la ingesta queda inactiva hasta B2.
2. Terminar la descripción con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
3. 👤 **AGUSTÍN:** mergear.
4. Anotar la **hora UTC del despliegue** de Coolify. Si no se sabe, usar la hora del merge + 10 minutos. Se usa en la migración 116.
5. 👤 **AGUSTÍN:** reimprimir desde la ficha de *Cuentas* un cargo cualquiera, escanearlo con la cartulina y pasar el PDF.
6. Correr `node herramientas/analizar-escaneo.mjs --pdf <ruta>` (desde `automatizaciones/remitos`). Tiene que salir `R-00xxxx` identificado con `dpi 200`.

---

## Fase 3 — Migración 116 (tablas y funciones)

Rama: `claude/remitos-b2-panel` desde `origin/main` (después del merge de B1).

### Task 3.1: número libre

1. `git fetch origin && git ls-tree --name-only origin/main supabase_migrations/ | sort -V | tail -3`
2. Por el MCP: `select filename from public.applied_migrations where (regexp_match(filename, '^(\d+)_'))[1]::int >= 115 order by filename`
3. Si 116 está libre en los dos, usar `116_remitos_firmados.sql`. Si no, el siguiente libre, y cambiar el número en todo este plan.

### Task 3.2: escribir la migración

**Files:**
- Create: `supabase_migrations/116_remitos_firmados.sql`

Contenido completo. **Los comentarios no llevan comillas**, porque se aplica por `exec_ddl`.

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 116: remitos firmados de cuenta corriente, adentro del sistema.
--
-- POR QUÉ. Cuando el hotel emite la consolidada, la empresa pide los remitos
-- firmados que respaldan cada consumo. Hoy dos personas escanean y cotejan a
-- mano. La automatizacion (automatizaciones/remitos, en n8n) ya separa los
-- escaneos, lee el QR de cada remito, lo archiva en Drive y le pregunta a Gemini
-- si esta firmado, pero anotaba todo en una planilla. Con esto el estado de cada
-- remito vive en la base, colgado de su cargo.
--
-- Diseño: docs/plans/2026-09-22-remitos-integracion-design.md.
--
-- QUIEN ESCRIBE. n8n no tiene sesion ni la llave maestra: llama como anon a seis
-- funciones que exigen la clave de la integracion en el encabezado
-- x-remitos-clave. En la base queda solo su huella (remitos_privado), igual que
-- la clave interna de ARCA en fiscal_private. El panel usa funciones que exigen
-- app_is_admin(). Las tablas nacen cerradas y solo las tocan estas funciones.
--
-- LA REGLA DE LA IA VIVE ACA y no en n8n: n8n informa lo que dijo Gemini y la
-- base decide con el umbral de remitos_ajustes (0,95 por defecto). La IA nunca
-- pisa lo que decidio una persona sobre el mismo escaneo.
--
-- ALCANCE. Se controlan los remitos impresos con QR: desde controlar_desde (el
-- primer cargo creado despues del despliegue del comprobante con QR) y cualquier
-- remito que tenga al menos un escaneo.
--
-- ANTES DE APLICAR: reemplazar __DESPLIEGUE_B1__ por la hora UTC del despliegue
-- del comprobante con QR. Si se olvida, la migracion falla: no es una fecha.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Ajustes, una sola fila ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remitos_ajustes (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  umbral_confianza NUMERIC(3,2) NOT NULL DEFAULT 0.95
    CHECK (umbral_confianza BETWEEN 0.50 AND 1.00),
  max_intentos_firma INT NOT NULL DEFAULT 5 CHECK (max_intentos_firma BETWEEN 1 AND 20),
  controlar_desde INT NOT NULL CHECK (controlar_desde >= 1),
  ultima_ingesta_at TIMESTAMPTZ,
  ultima_evaluacion_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

INSERT INTO public.remitos_ajustes (id, controlar_desde)
SELECT 1, COALESCE(
  (SELECT MIN(m.remito_numero) FROM public.cuenta_corriente_movimientos m
    WHERE m.tipo = 'cargo' AND m.created_at >= TIMESTAMPTZ '__DESPLIEGUE_B1__'),
  (SELECT COALESCE(MAX(m.remito_numero), 0) + 1 FROM public.cuenta_corriente_movimientos m))
ON CONFLICT (id) DO NOTHING;

-- 2) Huella de la clave de la integracion --------------------------------------------
CREATE TABLE IF NOT EXISTS public.remitos_privado (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  clave_hash BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Escaneos archivados ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_escaneos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cc_movimiento_id UUID NOT NULL REFERENCES public.cuenta_corriente_movimientos(id),
  version INT NOT NULL CHECK (version >= 1),
  origen TEXT NOT NULL CHECK (origen IN ('qr', 'tipeado')),
  drive_file_id TEXT NOT NULL CHECK (btrim(drive_file_id) <> ''),
  drive_link TEXT,
  hash_sha256 TEXT NOT NULL CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  lote_archivo TEXT,
  lote_hash TEXT,
  ubicacion TEXT,
  firma_ia TEXT CHECK (firma_ia IN ('si', 'no', 'error')),
  firma_ia_confianza NUMERIC(3,2) CHECK (firma_ia_confianza BETWEEN 0 AND 1),
  firma_ia_observacion TEXT,
  firma_ia_modelo TEXT,
  firma_ia_intentos INT NOT NULL DEFAULT 0 CHECK (firma_ia_intentos >= 0),
  firma_ia_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  CONSTRAINT remito_escaneos_version_uq UNIQUE (cc_movimiento_id, version),
  CONSTRAINT remito_escaneos_hash_uq UNIQUE (hash_sha256)
);

-- 4) Estado actual de cada remito con actividad ------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_control (
  cc_movimiento_id UUID PRIMARY KEY REFERENCES public.cuenta_corriente_movimientos(id),
  estado TEXT NOT NULL CHECK (estado IN ('evaluando', 'a_revisar', 'firmado', 'sin_firma', 'sin_remito')),
  escaneo_id UUID REFERENCES public.remito_escaneos(id),
  decidido_por TEXT NOT NULL CHECK (decidido_por IN ('sistema', 'ia', 'persona')),
  usuario_id UUID REFERENCES auth.users(id),
  nota TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT remito_control_sin_remito_con_nota
    CHECK (estado <> 'sin_remito' OR length(btrim(COALESCE(nota, ''))) > 0),
  CONSTRAINT remito_control_persona_con_usuario
    CHECK (decidido_por <> 'persona' OR usuario_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS remito_control_estado_idx ON public.remito_control (estado);

-- 5) Registro de cambios, solo se agrega -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_eventos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cc_movimiento_id UUID NOT NULL REFERENCES public.cuenta_corriente_movimientos(id),
  estado_anterior TEXT,
  estado_nuevo TEXT NOT NULL,
  decidido_por TEXT NOT NULL,
  usuario_id UUID REFERENCES auth.users(id),
  escaneo_id UUID REFERENCES public.remito_escaneos(id),
  nota TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS remito_eventos_mov_idx ON public.remito_eventos (cc_movimiento_id, created_at);

-- 6) Piezas que fueron a _Revisar ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_piezas_revisar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash_sha256 TEXT NOT NULL UNIQUE CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  drive_file_id TEXT NOT NULL CHECK (btrim(drive_file_id) <> ''),
  drive_link TEXT,
  lote_archivo TEXT,
  lote_hash TEXT,
  ubicacion TEXT,
  motivo TEXT NOT NULL CHECK (motivo ~ '^[a-z_]{3,40}$'),
  numeros_leidos TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_at TIMESTAMPTZ,
  resuelta_por UUID REFERENCES auth.users(id),
  resuelta_como TEXT CHECK (resuelta_como IN ('asignada', 'reescaneada', 'descartada')),
  resuelta_nota TEXT,
  cc_movimiento_id UUID REFERENCES public.cuenta_corriente_movimientos(id),
  CONSTRAINT remito_piezas_resuelta_coherente CHECK ((resuelta_at IS NULL) = (resuelta_como IS NULL)),
  CONSTRAINT remito_piezas_asignada_con_remito CHECK (resuelta_como <> 'asignada' OR cc_movimiento_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS remito_piezas_abiertas_idx
  ON public.remito_piezas_revisar (created_at) WHERE resuelta_at IS NULL;

-- 7) Todo cerrado: solo las funciones de abajo tocan estas tablas -----------------------------------
ALTER TABLE public.remitos_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remitos_privado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_escaneos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_piezas_revisar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.remitos_ajustes, public.remitos_privado, public.remito_escaneos,
  public.remito_control, public.remito_eventos, public.remito_piezas_revisar
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.remito_eventos_id_seq FROM PUBLIC, anon, authenticated;

-- 8) Ayudantes internos, sin GRANT -------------------------------------------------------------------

-- La clave llega en el encabezado x-remitos-clave: PostgREST deja los encabezados
-- en request.headers. En n8n vive en una credencial, que no se puede meter en el
-- cuerpo de un pedido.
CREATE OR REPLACE FUNCTION public.app_remitos_clave_ok()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clave TEXT;
BEGIN
  BEGIN
    v_clave := NULLIF(current_setting('request.headers', true), '')::json ->> 'x-remitos-clave';
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;
  IF v_clave IS NULL OR length(v_clave) < 32 THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.remitos_privado p
     WHERE p.id = 1 AND p.clave_hash = extensions.digest(v_clave, 'sha256')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.app_remitos_clave_ok() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_remitos_tz()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT NULLIF(btrim(h.timezone), '') FROM public.hotel_settings h LIMIT 1),
                  'America/Argentina/Tucuman');
$$;
REVOKE ALL ON FUNCTION public.app_remitos_tz() FROM PUBLIC;

-- Unico lugar que escribe remito_control. Siempre deja el rastro en remito_eventos.
CREATE OR REPLACE FUNCTION public.app_remitos_cambiar_estado(
  p_mov UUID, p_estado TEXT, p_decidido_por TEXT, p_usuario UUID, p_escaneo UUID, p_nota TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anterior TEXT;
  v_nota TEXT := NULLIF(btrim(COALESCE(p_nota, '')), '');
  v_escaneo UUID;
BEGIN
  SELECT c.estado, c.escaneo_id INTO v_anterior, v_escaneo
    FROM public.remito_control c WHERE c.cc_movimiento_id = p_mov FOR UPDATE;
  v_escaneo := COALESCE(p_escaneo, v_escaneo);

  INSERT INTO public.remito_control AS c
    (cc_movimiento_id, estado, escaneo_id, decidido_por, usuario_id, nota, updated_at)
  VALUES (p_mov, p_estado, v_escaneo, p_decidido_por, p_usuario, v_nota, NOW())
  ON CONFLICT (cc_movimiento_id) DO UPDATE
     SET estado = EXCLUDED.estado,
         escaneo_id = EXCLUDED.escaneo_id,
         decidido_por = EXCLUDED.decidido_por,
         usuario_id = EXCLUDED.usuario_id,
         nota = EXCLUDED.nota,
         updated_at = NOW();

  INSERT INTO public.remito_eventos
    (cc_movimiento_id, estado_anterior, estado_nuevo, decidido_por, usuario_id, escaneo_id, nota)
  VALUES (p_mov, v_anterior, p_estado, p_decidido_por, p_usuario, v_escaneo, v_nota);
END;
$$;
REVOKE ALL ON FUNCTION public.app_remitos_cambiar_estado(UUID, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC;

-- 9) Funciones para n8n: exigen la clave de la integracion -----------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_remitos_planificar(p_numeros INT[], p_hashes TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT := public.app_remitos_tz();
  v_remitos JSONB;
  v_hashes JSONB;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero', n.numero,
           'existe', m.id IS NOT NULL,
           'cliente', COALESCE(ac.display_name, g.full_name),
           'periodo', to_char(m.created_at AT TIME ZONE v_tz, 'YYYY-MM'),
           'versiones', COALESCE((SELECT MAX(e.version) FROM public.remito_escaneos e
                                   WHERE e.cc_movimiento_id = m.id), 0)
         ) ORDER BY n.numero), '[]'::jsonb)
    INTO v_remitos
    FROM (SELECT DISTINCT unnest(COALESCE(p_numeros, '{}'::int[])) AS numero) n
    LEFT JOIN public.cuenta_corriente_movimientos m ON m.remito_numero = n.numero AND m.tipo = 'cargo'
    LEFT JOIN public.associated_clients ac ON ac.id = m.associated_client_id
    LEFT JOIN public.guests g ON g.id = m.guest_id;

  SELECT COALESCE(jsonb_agg(DISTINCT h.hash), '[]'::jsonb)
    INTO v_hashes
    FROM unnest(COALESCE(p_hashes, '{}'::text[])) AS h(hash)
   WHERE EXISTS (SELECT 1 FROM public.remito_escaneos e WHERE e.hash_sha256 = h.hash)
      OR EXISTS (SELECT 1 FROM public.remito_piezas_revisar p WHERE p.hash_sha256 = h.hash);

  RETURN jsonb_build_object('remitos', v_remitos, 'hashes_registrados', v_hashes);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_registrar_escaneo(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT := lower(btrim(COALESCE(p ->> 'hash_sha256', '')));
  v_numero INT := (p ->> 'numero')::int;
  v_existente public.remito_escaneos%ROWTYPE;
  v_mov UUID;
  v_version INT;
  v_id UUID;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  -- Idempotente: la misma pieza (misma huella) nunca se registra dos veces.
  SELECT * INTO v_existente FROM public.remito_escaneos WHERE hash_sha256 = v_hash;
  IF FOUND THEN
    RETURN jsonb_build_object('escaneo_id', v_existente.id, 'version', v_existente.version, 'ya_existia', TRUE);
  END IF;

  SELECT m.id INTO v_mov FROM public.cuenta_corriente_movimientos m
   WHERE m.remito_numero = v_numero AND m.tipo = 'cargo';
  IF v_mov IS NULL THEN
    RAISE EXCEPTION 'El remito % no existe', v_numero USING errcode = 'P0060';
  END IF;

  SELECT COALESCE(MAX(e.version), 0) + 1 INTO v_version
    FROM public.remito_escaneos e WHERE e.cc_movimiento_id = v_mov;

  INSERT INTO public.remito_escaneos
    (cc_movimiento_id, version, origen, drive_file_id, drive_link, hash_sha256, lote_archivo, lote_hash, ubicacion)
  VALUES (v_mov, v_version, 'qr', p ->> 'drive_file_id', p ->> 'drive_link', v_hash,
          p ->> 'lote_archivo', p ->> 'lote_hash', p ->> 'ubicacion')
  RETURNING id INTO v_id;

  -- Escaneo nuevo: vuelve a evaluando aunque ya estuviera confirmado, porque la
  -- imagen nueva puede contradecir a la vieja.
  PERFORM public.app_remitos_cambiar_estado(v_mov, 'evaluando', 'sistema', NULL, v_id, NULL);

  RETURN jsonb_build_object('escaneo_id', v_id, 'version', v_version, 'ya_existia', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_registrar_pieza(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT := lower(btrim(COALESCE(p ->> 'hash_sha256', '')));
  v_id UUID;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  INSERT INTO public.remito_piezas_revisar
    (hash_sha256, drive_file_id, drive_link, lote_archivo, lote_hash, ubicacion, motivo, numeros_leidos)
  VALUES (v_hash, p ->> 'drive_file_id', p ->> 'drive_link', p ->> 'lote_archivo', p ->> 'lote_hash',
          p ->> 'ubicacion', p ->> 'motivo',
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(p -> 'numeros_leidos', '[]'::jsonb))))
  ON CONFLICT (hash_sha256) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.remito_piezas_revisar r WHERE r.hash_sha256 = v_hash;
    RETURN jsonb_build_object('pieza_id', v_id, 'ya_existia', TRUE);
  END IF;
  RETURN jsonb_build_object('pieza_id', v_id, 'ya_existia', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_firmas_pendientes(p_limite INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
  v_lista JSONB;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT a.max_intentos_firma INTO v_max FROM public.remitos_ajustes a WHERE a.id = 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'escaneo_id', t.id, 'drive_file_id', t.drive_file_id,
           'numero', t.remito_numero, 'intentos', t.firma_ia_intentos)
         ORDER BY t.firma_ia_intentos, t.created_at), '[]'::jsonb)
    INTO v_lista
    FROM (
      SELECT e.id, e.drive_file_id, m.remito_numero, e.firma_ia_intentos, e.created_at
        FROM public.remito_control c
        JOIN public.remito_escaneos e ON e.id = c.escaneo_id
        JOIN public.cuenta_corriente_movimientos m ON m.id = e.cc_movimiento_id
       WHERE c.estado = 'evaluando'
         AND (e.firma_ia IS NULL OR e.firma_ia = 'error')
         AND e.firma_ia_intentos < COALESCE(v_max, 5)
       ORDER BY e.firma_ia_intentos, e.created_at
       LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 5), 50))
    ) t;
  RETURN v_lista;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_guardar_firma(
  p_escaneo_id UUID, p_firma TEXT, p_confianza NUMERIC, p_observacion TEXT, p_modelo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.remito_escaneos%ROWTYPE;
  v_c public.remito_control%ROWTYPE;
  v_umbral NUMERIC;
  v_max INT;
  v_estado TEXT;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_firma IS NULL OR p_firma NOT IN ('si', 'no', 'error') THEN
    RAISE EXCEPTION 'Firma invalida: %', p_firma USING errcode = '22023';
  END IF;
  SELECT a.umbral_confianza, a.max_intentos_firma INTO v_umbral, v_max
    FROM public.remitos_ajustes a WHERE a.id = 1;

  UPDATE public.remito_escaneos
     SET firma_ia = p_firma,
         firma_ia_confianza = CASE WHEN p_firma = 'error' THEN NULL
                                   ELSE LEAST(1, GREATEST(0, COALESCE(p_confianza, 0))) END,
         firma_ia_observacion = left(p_observacion, 300),
         firma_ia_modelo = left(p_modelo, 80),
         firma_ia_intentos = firma_ia_intentos + 1,
         firma_ia_at = NOW()
   WHERE id = p_escaneo_id
   RETURNING * INTO v_e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escaneo inexistente' USING errcode = 'P0061';
  END IF;

  SELECT * INTO v_c FROM public.remito_control WHERE cc_movimiento_id = v_e.cc_movimiento_id FOR UPDATE;
  -- La IA solo decide sobre el escaneo vigente, mientras el remito esta evaluando
  -- y ninguna persona decidio sobre ese escaneo.
  IF NOT FOUND OR v_c.escaneo_id IS DISTINCT FROM v_e.id OR v_c.estado <> 'evaluando'
     OR v_c.decidido_por = 'persona' THEN
    RETURN jsonb_build_object('estado', COALESCE(v_c.estado, 'sin_escanear'), 'cambio', FALSE);
  END IF;

  IF p_firma IN ('si', 'no') AND v_e.firma_ia_confianza >= COALESCE(v_umbral, 0.95) THEN
    v_estado := CASE p_firma WHEN 'si' THEN 'firmado' ELSE 'sin_firma' END;
  ELSIF p_firma IN ('si', 'no') THEN
    v_estado := 'a_revisar';
  ELSIF v_e.firma_ia_intentos >= COALESCE(v_max, 5) THEN
    v_estado := 'a_revisar';
  ELSE
    RETURN jsonb_build_object('estado', 'evaluando', 'cambio', FALSE);
  END IF;

  PERFORM public.app_remitos_cambiar_estado(v_e.cc_movimiento_id, v_estado, 'ia', NULL, v_e.id, NULL);
  RETURN jsonb_build_object('estado', v_estado, 'cambio', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_latido(p_que TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_que = 'ingesta' THEN
    UPDATE public.remitos_ajustes SET ultima_ingesta_at = NOW() WHERE id = 1;
  ELSIF p_que = 'evaluacion' THEN
    UPDATE public.remitos_ajustes SET ultima_evaluacion_at = NOW() WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'Latido desconocido: %', p_que USING errcode = '22023';
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- 10) Funciones del panel: solo admin --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_remitos_listar(p_client_kind TEXT, p_client_id UUID, p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT := public.app_remitos_tz();
  v_desde INT;
  v_filas JSONB;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo invalido' USING errcode = '22023';
  END IF;
  SELECT a.controlar_desde INTO v_desde FROM public.remitos_ajustes a WHERE a.id = 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'movimiento_id', m.id,
           'remito_numero', m.remito_numero,
           'created_at', m.created_at,
           'amount', m.amount,
           'client_kind', CASE WHEN m.associated_client_id IS NOT NULL THEN 'company' ELSE 'guest' END,
           'client_id', COALESCE(m.associated_client_id, m.guest_id),
           'cliente', COALESCE(ac.display_name, g.full_name),
           'room_number', rm.room_number,
           'pasajero', r.client_name,
           'estado', COALESCE(c.estado, 'sin_escanear'),
           'decidido_por', c.decidido_por,
           'decidido_por_nombre', COALESCE(NULLIF(btrim(pr.full_name), ''), u.email::text),
           'estado_at', c.updated_at,
           'nota', c.nota,
           'escaneo_version', e.version,
           'escaneo_link', e.drive_link,
           'escaneo_origen', e.origen,
           'firma_ia', e.firma_ia,
           'firma_ia_confianza', e.firma_ia_confianza,
           'firma_ia_observacion', e.firma_ia_observacion
         ) ORDER BY m.remito_numero), '[]'::jsonb)
    INTO v_filas
    FROM public.cuenta_corriente_movimientos m
    LEFT JOIN public.associated_clients ac ON ac.id = m.associated_client_id
    LEFT JOIN public.guests g ON g.id = m.guest_id
    LEFT JOIN public.reservations r ON r.id = m.reservation_id
    LEFT JOIN public.rooms rm ON rm.id = r.room_id
    LEFT JOIN public.remito_control c ON c.cc_movimiento_id = m.id
    LEFT JOIN public.remito_escaneos e ON e.id = c.escaneo_id
    LEFT JOIN public.profiles pr ON pr.id = c.usuario_id
    LEFT JOIN auth.users u ON u.id = c.usuario_id
   WHERE m.tipo = 'cargo'
     AND (m.remito_numero >= COALESCE(v_desde, 2147483647) OR c.cc_movimiento_id IS NOT NULL)
     AND (m.created_at AT TIME ZONE v_tz)::date BETWEEN p_desde AND p_hasta
     AND (p_client_kind IS NULL
          OR (p_client_kind = 'company' AND m.associated_client_id = p_client_id)
          OR (p_client_kind = 'guest' AND m.guest_id = p_client_id));
  RETURN v_filas;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_salud()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT jsonb_build_object(
           'ultima_ingesta_at', a.ultima_ingesta_at,
           'ultima_evaluacion_at', a.ultima_evaluacion_at,
           'evaluando_viejos', (SELECT count(*) FROM public.remito_control c
                                  JOIN public.remito_escaneos e ON e.id = c.escaneo_id
                                 WHERE c.estado = 'evaluando' AND e.created_at < NOW() - INTERVAL '2 hours'),
           'a_revisar', (SELECT count(*) FROM public.remito_control c WHERE c.estado = 'a_revisar'),
           'piezas_abiertas', (SELECT count(*) FROM public.remito_piezas_revisar p WHERE p.resuelta_at IS NULL),
           'umbral_confianza', a.umbral_confianza,
           'controlar_desde', a.controlar_desde,
           'max_intentos_firma', a.max_intentos_firma)
    INTO v
    FROM public.remitos_ajustes a WHERE a.id = 1;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_marcar(p_movimiento_id UUID, p_estado TEXT, p_nota TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('firmado', 'sin_firma', 'sin_remito', 'a_revisar') THEN
    RAISE EXCEPTION 'Estado invalido: %', p_estado USING errcode = '22023';
  END IF;
  IF p_estado = 'sin_remito' AND length(btrim(COALESCE(p_nota, ''))) = 0 THEN
    RAISE EXCEPTION 'Para marcar sin remito hace falta una nota que diga que paso con el papel.' USING errcode = 'P0062';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cuenta_corriente_movimientos m
                  WHERE m.id = p_movimiento_id AND m.tipo = 'cargo') THEN
    RAISE EXCEPTION 'El remito no existe' USING errcode = 'P0060';
  END IF;
  IF p_estado <> 'sin_remito' AND NOT EXISTS (
       SELECT 1 FROM public.remito_control c
        WHERE c.cc_movimiento_id = p_movimiento_id AND c.escaneo_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Este remito todavia no tiene escaneo: primero hay que escanearlo.' USING errcode = 'P0063';
  END IF;

  PERFORM public.app_remitos_cambiar_estado(p_movimiento_id, p_estado, 'persona', auth.uid(), NULL, p_nota);
  RETURN jsonb_build_object('ok', TRUE, 'estado', p_estado);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_piezas(p_incluir_resueltas BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id, 'created_at', t.created_at, 'motivo', t.motivo,
           'numeros_leidos', to_jsonb(t.numeros_leidos), 'drive_link', t.drive_link,
           'lote_archivo', t.lote_archivo, 'ubicacion', t.ubicacion,
           'resuelta_at', t.resuelta_at, 'resuelta_como', t.resuelta_como,
           'resuelta_nota', t.resuelta_nota, 'remito_numero', t.remito_numero)
         ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v
    FROM (
      SELECT p.*, m.remito_numero
        FROM public.remito_piezas_revisar p
        LEFT JOIN public.cuenta_corriente_movimientos m ON m.id = p.cc_movimiento_id
       WHERE COALESCE(p_incluir_resueltas, FALSE) OR p.resuelta_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT 200
    ) t;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_buscar(p_numero INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT jsonb_build_object(
           'existe', TRUE,
           'movimiento_id', m.id,
           'remito_numero', m.remito_numero,
           'cliente', COALESCE(ac.display_name, g.full_name),
           'created_at', m.created_at,
           'amount', m.amount,
           'room_number', rm.room_number,
           'pasajero', r.client_name,
           'estado', COALESCE(c.estado, 'sin_escanear'),
           'escaneos', (SELECT count(*) FROM public.remito_escaneos e WHERE e.cc_movimiento_id = m.id))
    INTO v
    FROM public.cuenta_corriente_movimientos m
    LEFT JOIN public.associated_clients ac ON ac.id = m.associated_client_id
    LEFT JOIN public.guests g ON g.id = m.guest_id
    LEFT JOIN public.reservations r ON r.id = m.reservation_id
    LEFT JOIN public.rooms rm ON rm.id = r.room_id
    LEFT JOIN public.remito_control c ON c.cc_movimiento_id = m.id
   WHERE m.remito_numero = p_numero AND m.tipo = 'cargo';
  RETURN COALESCE(v, jsonb_build_object('existe', FALSE));
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_asignar_pieza(p_pieza_id UUID, p_numero INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p public.remito_piezas_revisar%ROWTYPE;
  v_mov UUID;
  v_version INT;
  v_id UUID;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT * INTO v_p FROM public.remito_piezas_revisar WHERE id = p_pieza_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pieza no existe' USING errcode = 'P0064';
  END IF;
  IF v_p.resuelta_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta pieza ya se resolvio' USING errcode = 'P0065';
  END IF;
  -- Una imagen con varios tickets nunca queda como respaldo de uno solo.
  IF v_p.motivo IN ('forma_no_reconocida', 'varios_codigos') THEN
    RAISE EXCEPTION 'Esta imagen tiene varios tickets: hay que volver a escanearlos separados.' USING errcode = 'P0066';
  END IF;
  SELECT m.id INTO v_mov FROM public.cuenta_corriente_movimientos m
   WHERE m.remito_numero = p_numero AND m.tipo = 'cargo';
  IF v_mov IS NULL THEN
    RAISE EXCEPTION 'El remito R-% no existe', lpad(p_numero::text, 6, '0') USING errcode = 'P0060';
  END IF;
  IF EXISTS (SELECT 1 FROM public.remito_escaneos e WHERE e.hash_sha256 = v_p.hash_sha256) THEN
    RAISE EXCEPTION 'Esta imagen ya esta vinculada a un remito' USING errcode = 'P0067';
  END IF;

  SELECT COALESCE(MAX(e.version), 0) + 1 INTO v_version
    FROM public.remito_escaneos e WHERE e.cc_movimiento_id = v_mov;
  INSERT INTO public.remito_escaneos
    (cc_movimiento_id, version, origen, drive_file_id, drive_link, hash_sha256, lote_archivo, lote_hash, ubicacion, created_by)
  VALUES (v_mov, v_version, 'tipeado', v_p.drive_file_id, v_p.drive_link, v_p.hash_sha256,
          v_p.lote_archivo, v_p.lote_hash, v_p.ubicacion, auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.remito_piezas_revisar
     SET resuelta_at = NOW(), resuelta_por = auth.uid(), resuelta_como = 'asignada', cc_movimiento_id = v_mov
   WHERE id = p_pieza_id;

  -- Queda evaluando: la IA mira la firma como en cualquier escaneo.
  PERFORM public.app_remitos_cambiar_estado(v_mov, 'evaluando', 'sistema', auth.uid(), v_id, 'Escaneo asignado a mano');
  RETURN jsonb_build_object('ok', TRUE, 'escaneo_id', v_id, 'version', v_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_resolver_pieza(p_pieza_id UUID, p_como TEXT, p_nota TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_como IS NULL OR p_como NOT IN ('reescaneada', 'descartada') THEN
    RAISE EXCEPTION 'Resolucion invalida: %', p_como USING errcode = '22023';
  END IF;
  IF p_como = 'descartada' AND length(btrim(COALESCE(p_nota, ''))) = 0 THEN
    RAISE EXCEPTION 'Para descartar una pieza hace falta una nota.' USING errcode = 'P0062';
  END IF;
  UPDATE public.remito_piezas_revisar
     SET resuelta_at = NOW(), resuelta_por = auth.uid(), resuelta_como = p_como,
         resuelta_nota = NULLIF(btrim(COALESCE(p_nota, '')), '')
   WHERE id = p_pieza_id AND resuelta_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pieza no existe o ya se resolvio' USING errcode = 'P0065';
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_guardar_ajustes(p_umbral NUMERIC, p_controlar_desde INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_umbral IS NULL OR p_umbral < 0.50 OR p_umbral > 1.00 THEN
    RAISE EXCEPTION 'El umbral tiene que estar entre 50 y 100' USING errcode = '22023';
  END IF;
  IF p_controlar_desde IS NULL OR p_controlar_desde < 1 THEN
    RAISE EXCEPTION 'El numero desde el que se controla tiene que ser 1 o mas' USING errcode = '22023';
  END IF;
  UPDATE public.remitos_ajustes
     SET umbral_confianza = p_umbral, controlar_desde = p_controlar_desde,
         updated_at = NOW(), updated_by = auth.uid()
   WHERE id = 1;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- 11) Permisos -------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_remitos_planificar(INT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_registrar_escaneo(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_registrar_pieza(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_firmas_pendientes(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_guardar_firma(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_latido(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_planificar(INT[], TEXT[]) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_registrar_escaneo(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_registrar_pieza(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_firmas_pendientes(INT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_guardar_firma(UUID, TEXT, NUMERIC, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_latido(TEXT) TO anon;

REVOKE ALL ON FUNCTION public.rpc_remitos_listar(TEXT, UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_salud() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_marcar(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_piezas(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_buscar(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_asignar_pieza(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_resolver_pieza(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_remitos_guardar_ajustes(NUMERIC, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_listar(TEXT, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_salud() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_marcar(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_piezas(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_buscar(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_asignar_pieza(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_resolver_pieza(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_guardar_ajustes(NUMERIC, INT) TO authenticated;

-- Registro
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('116_remitos_firmados.sql');
  END IF;
END
$do$;

COMMIT;
```

Commit: `git commit -m "Remitos: migracion 116, estado de firma de cada remito en la base"` (sin aplicar todavía).

### Task 3.3: prueba en seco contra PROD (se deshace sola)

La idea es mandar la migración entera (con `__DESPLIEGUE_B1__` reemplazado por la hora real) seguida de un bloque que ejercita los escenarios y termina en `RAISE EXCEPTION`. `exec_ddl` es atómico: se deshace todo y el mensaje de error trae los resultados. Esto **no requiere OK**, porque no queda nada escrito. Igual conviene avisarle a Agustín antes.

1. Armar el payload con un script temporal, fuera del repo. El script lee el archivo, saca `BEGIN;` y `COMMIT;`, reemplaza el marcador, pasa CRLF a LF y agrega el bloque de prueba:

```sql
DO $prueba$
DECLARE
  v_admin UUID := (SELECT p.id FROM public.profiles p WHERE p.role = 'admin' ORDER BY p.created_at LIMIT 1);
  v_mov UUID;
  v_num INT;
  v_r JSONB := '{}'::jsonb;
  v_x JSONB;
  v_e1 UUID;
  v_e2 UUID;
  v_p UUID;
  v_err TEXT;
BEGIN
  INSERT INTO public.remitos_privado (id, clave_hash)
  VALUES (1, extensions.digest('clave-de-prueba-0123456789-0123456789', 'sha256'))
  ON CONFLICT (id) DO UPDATE SET clave_hash = EXCLUDED.clave_hash;
  PERFORM set_config('request.headers', json_build_object('x-remitos-clave', 'clave-de-prueba-0123456789-0123456789')::text, true);
  SELECT m.id, m.remito_numero INTO v_mov, v_num FROM public.cuenta_corriente_movimientos m
   WHERE m.tipo = 'cargo' ORDER BY m.remito_numero DESC LIMIT 1;

  v_r := v_r || jsonb_build_object('01_planificar', public.rpc_remitos_planificar(ARRAY[v_num, 999999], ARRAY[repeat('a', 64)]));
  v_x := public.rpc_remitos_registrar_escaneo(jsonb_build_object('numero', v_num, 'drive_file_id', 'f1', 'drive_link', 'l1', 'hash_sha256', repeat('b', 64), 'ubicacion', '1.1'));
  v_e1 := (v_x ->> 'escaneo_id')::uuid;
  v_r := v_r || jsonb_build_object('02_registrar', v_x, '02_estado', (SELECT c.estado FROM public.remito_control c WHERE c.cc_movimiento_id = v_mov));
  v_r := v_r || jsonb_build_object('03_repetido', public.rpc_remitos_registrar_escaneo(jsonb_build_object('numero', v_num, 'drive_file_id', 'f1', 'hash_sha256', repeat('b', 64))));
  v_r := v_r || jsonb_build_object('04_pendientes', public.rpc_remitos_firmas_pendientes(5));
  v_r := v_r || jsonb_build_object('05_ia_098', public.rpc_remitos_guardar_firma(v_e1, 'si', 0.98, 'rubrica', 'modelo'));
  v_x := public.rpc_remitos_registrar_escaneo(jsonb_build_object('numero', v_num, 'drive_file_id', 'f2', 'hash_sha256', repeat('c', 64)));
  v_e2 := (v_x ->> 'escaneo_id')::uuid;
  v_r := v_r || jsonb_build_object('06_reescaneo', v_x, '06_estado', (SELECT c.estado FROM public.remito_control c WHERE c.cc_movimiento_id = v_mov));
  v_r := v_r || jsonb_build_object('07_ia_080', public.rpc_remitos_guardar_firma(v_e2, 'no', 0.80, 'dudosa', 'modelo'));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_r := v_r || jsonb_build_object('08_persona', public.rpc_remitos_marcar(v_mov, 'firmado', 'visto a mano'));
  v_r := v_r || jsonb_build_object('09_ia_tarde', public.rpc_remitos_guardar_firma(v_e2, 'no', 0.99, 'tarde', 'modelo'),
                                   '09_estado', (SELECT c.estado || '/' || c.decidido_por FROM public.remito_control c WHERE c.cc_movimiento_id = v_mov));
  BEGIN PERFORM public.rpc_remitos_marcar(v_mov, 'sin_remito', '  '); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('10_sin_nota', v_err);
  v_x := public.rpc_remitos_registrar_pieza(jsonb_build_object('hash_sha256', repeat('d', 64), 'drive_file_id', 'f3', 'motivo', 'forma_no_reconocida', 'numeros_leidos', jsonb_build_array('R-000001', 'R-000002')));
  BEGIN PERFORM public.rpc_remitos_asignar_pieza((v_x ->> 'pieza_id')::uuid, v_num); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('11_asignar_pegados', v_err);
  v_x := public.rpc_remitos_registrar_pieza(jsonb_build_object('hash_sha256', repeat('e', 64), 'drive_file_id', 'f4', 'motivo', 'codigo_ilegible'));
  v_p := (v_x ->> 'pieza_id')::uuid;
  v_r := v_r || jsonb_build_object('12_asignar', public.rpc_remitos_asignar_pieza(v_p, v_num),
                                   '12_estado', (SELECT c.estado || '/' || c.decidido_por FROM public.remito_control c WHERE c.cc_movimiento_id = v_mov));
  v_r := v_r || jsonb_build_object('13_listar', jsonb_path_query_array(
                   public.rpc_remitos_listar(NULL, NULL, CURRENT_DATE - 400, CURRENT_DATE + 1),
                   '$[*] ? (@.movimiento_id == $m)', jsonb_build_object('m', v_mov)));
  v_r := v_r || jsonb_build_object('14_salud', public.rpc_remitos_salud());
  v_r := v_r || jsonb_build_object('15_eventos', (SELECT count(*) FROM public.remito_eventos ev WHERE ev.cc_movimiento_id = v_mov));
  PERFORM set_config('request.headers', json_build_object('x-remitos-clave', 'otra-clave-0123456789-0123456789-xx')::text, true);
  BEGIN PERFORM public.rpc_remitos_latido('ingesta'); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('16_clave_mala', v_err);
  RAISE EXCEPTION 'PRUEBA %', v_r::text;
END
$prueba$;
```

2. Llamar a `select public.exec_ddl($m116$ <payload> $m116$)` por el MCP. La respuesta es un error `PRUEBA {...}`. **Esperado:**

| Paso | Resultado esperado |
|---|---|
| `01` | `v_num` con `existe: true`, el cliente y `versiones: 0`; 999999 con `existe: false`; `hashes_registrados: []` |
| `02` | `version: 1`, `ya_existia: false`, estado `evaluando` |
| `03` | `ya_existia: true` |
| `04` | Un pendiente con `intentos: 0` |
| `05` | `estado: firmado`, `cambio: true` |
| `06` | `version: 2`, estado `evaluando` |
| `07` | `estado: a_revisar` |
| `08` | `ok` |
| `09` | `cambio: false` y estado `firmado/persona` |
| `10` | `P0062` |
| `11` | `P0066` |
| `12` | `version: 3` y estado `evaluando/sistema` |
| `13` | Una fila con `estado: evaluando`, `escaneo_version: 3` y `escaneo_origen: tipeado` |
| `14` | `a_revisar: 0` y `piezas_abiertas: 1` (la de tickets pegados sigue abierta) |
| `15` | 6 eventos |
| `16` | `42501` |

3. Si algo no da, corregir el SQL, commitear (`--amend` no: commit nuevo) y repetir hasta que dé todo.
4. Confirmar que no quedó nada: `select to_regclass('public.remito_control')` tiene que dar `null`.

### Task 3.4: aplicar a PROD (con OK)

1. 👤 **AGUSTÍN:** OK explícito para aplicar la migración 116.
2. Commitear el archivo con la hora real en lugar de `__DESPLIEGUE_B1__`.
3. Aplicar en 3 llamadas a `exec_ddl`, sin `BEGIN/COMMIT` y con CRLF pasado a LF:
   - (a) secciones 1 a 7;
   - (b) sección 8 y funciones para n8n (sección 9);
   - (c) sección 10, permisos y registro.
4. Verificar:
   - `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname like 'rpc_remitos_%' or proname like 'app_remitos_%' order by 1`: 14 `rpc_` y 3 `app_`, con las firmas del archivo.
   - `select has_function_privilege('anon', 'public.rpc_remitos_latido(text)', 'execute'), has_function_privilege('anon', 'public.rpc_remitos_listar(text,uuid,date,date)', 'execute')` → `true, false`.
   - `select relname, relacl from pg_class where relname like 'remito%'`: sin `anon` ni `authenticated`.
   - `select * from public.remitos_ajustes`: una fila, `controlar_desde` igual al primer remito posterior al despliegue de B1.
   - md5 del cuerpo de cada función contra el archivo: `select proname, md5(prosrc) from pg_proc where ...`, y el mismo cálculo sobre el texto entre `$$` del archivo, en LF.
   - `select filename from public.applied_migrations where filename = '116_remitos_firmados.sql'`.

---

## Fase 4 — El panel `/admin/remitos` (B2, sistema)

Misma rama `claude/remitos-b2-panel`.

### Task 4.1: tipos

**Files:** Modify: `src/lib/types.ts`. Agregar al final:

```ts
/** Estado del remito firmado de un cargo de cuenta corriente (mig 116). */
export type RemitoEstado = "sin_escanear" | "evaluando" | "a_revisar" | "firmado" | "sin_firma" | "sin_remito";
/** Lo que una persona puede decidir desde el panel. */
export type RemitoEstadoPersona = "firmado" | "sin_firma" | "sin_remito" | "a_revisar";
export type RemitoDecididoPor = "sistema" | "ia" | "persona";
export type RemitoFirmaIa = "si" | "no" | "error";

export type RemitoPanelRow = {
  movimiento_id: string;
  remito_numero: number;
  created_at: string;
  amount: number;
  client_kind: CtaCteClientKind;
  client_id: string;
  cliente: string;
  room_number: string | null;
  pasajero: string | null;
  estado: RemitoEstado;
  decidido_por: RemitoDecididoPor | null;
  decidido_por_nombre: string | null;
  estado_at: string | null;
  nota: string | null;
  escaneo_version: number | null;
  escaneo_link: string | null;
  escaneo_origen: "qr" | "tipeado" | null;
  firma_ia: RemitoFirmaIa | null;
  firma_ia_confianza: number | null;
  firma_ia_observacion: string | null;
};

export type RemitoPieza = {
  id: string;
  created_at: string;
  motivo: string;
  numeros_leidos: string[];
  drive_link: string | null;
  lote_archivo: string | null;
  ubicacion: string | null;
  resuelta_at: string | null;
  resuelta_como: "asignada" | "reescaneada" | "descartada" | null;
  resuelta_nota: string | null;
  remito_numero: number | null;
};

export type RemitosSalud = {
  ultima_ingesta_at: string | null;
  ultima_evaluacion_at: string | null;
  evaluando_viejos: number;
  a_revisar: number;
  piezas_abiertas: number;
  umbral_confianza: number;
  controlar_desde: number;
  max_intentos_firma: number;
};

export type RemitoLookup =
  | { existe: false }
  | {
      existe: true;
      movimiento_id: string;
      remito_numero: number;
      cliente: string;
      created_at: string;
      amount: number;
      room_number: string | null;
      pasajero: string | null;
      estado: RemitoEstado;
      escaneos: number;
    };
```

`npm run typecheck` → OK. Commit con la Task 4.2.

### Task 4.2: ayudantes puros del panel (TDD)

**Files:**
- Create: `src/lib/remitos.ts`
- Test: `src/__tests__/remitos.test.ts`

**Step 1: test que falla**

```ts
import { describe, expect, it } from "vitest";

import {
  accionesRemito,
  avisosSalud,
  haceDias,
  iaTexto,
  motivoPiezaLabel,
  parseNumeroRemito,
  piezaAsignable,
  rangoDeMes,
  resumirRemitos,
  textoSemaforo,
} from "@/lib/remitos";
import { codigoRemito } from "@/lib/remito-codigo";
import type { RemitoEstado, RemitoPanelRow, RemitosSalud } from "@/lib/types";

const fila = (estado: RemitoEstado, extra: Partial<RemitoPanelRow> = {}): RemitoPanelRow => ({
  movimiento_id: `m-${estado}`, remito_numero: 158, created_at: "2026-09-20T12:00:00Z", amount: 50000,
  client_kind: "company", client_id: "c1", cliente: "Empresa de prueba", room_number: "7", pasajero: "Pasajero",
  estado, decidido_por: null, decidido_por_nombre: null, estado_at: null, nota: null,
  escaneo_version: null, escaneo_link: null, escaneo_origen: null,
  firma_ia: null, firma_ia_confianza: null, firma_ia_observacion: null, ...extra,
});

const SALUD: RemitosSalud = {
  ultima_ingesta_at: null, ultima_evaluacion_at: null, evaluando_viejos: 0, a_revisar: 0,
  piezas_abiertas: 0, umbral_confianza: 0.95, controlar_desde: 158, max_intentos_firma: 5,
};
const AHORA = Date.parse("2026-09-22T15:00:00Z");

describe("remitos: ayudantes del panel", () => {
  it("el numero se tipea como venga, pero un DV que no cierra se rechaza", () => {
    expect(parseNumeroRemito("158")).toBe(158);
    expect(parseNumeroRemito(" r-000158 ")).toBe(158);
    expect(parseNumeroRemito("R158")).toBe(158);
    expect(parseNumeroRemito(codigoRemito(158))).toBe(158);
    const malo = codigoRemito(158).slice(0, -2) + (codigoRemito(158).endsWith("00") ? "01" : "00");
    expect(parseNumeroRemito(malo)).toBeNull();
    expect(parseNumeroRemito("0")).toBeNull();
    expect(parseNumeroRemito("1234567")).toBeNull();
    expect(parseNumeroRemito("abc")).toBeNull();
  });

  it("semaforo: cuenta por estado y no nombra los ceros", () => {
    const r = resumirRemitos([fila("firmado"), fila("firmado"), fila("sin_firma"), fila("sin_escanear")]);
    expect(textoSemaforo(r)).toBe("4 remitos: 2 firmados · 1 sin firma · 1 sin escanear");
    expect(textoSemaforo(resumirRemitos([]))).toBe("No hay remitos en este período.");
    expect(textoSemaforo(resumirRemitos([fila("firmado")]))).toBe("1 remito: 1 firmado");
  });

  it("avisos: la ingesta parada es rojo; nunca corrio es informativo", () => {
    expect(avisosSalud(SALUD, AHORA)).toEqual([
      { tono: "info", texto: "La ingesta de remitos todavía no registró ninguna corrida." },
    ]);
    const parada = avisosSalud({ ...SALUD, ultima_ingesta_at: "2026-09-22T12:00:00Z" }, AHORA);
    expect(parada[0].tono).toBe("alert");
    expect(parada[0].texto).toMatch(/no corre desde hace 3 h/);
    expect(avisosSalud({ ...SALUD, ultima_ingesta_at: "2026-09-22T14:50:00Z" }, AHORA)).toEqual([]);
    const lenta = avisosSalud({ ...SALUD, ultima_ingesta_at: "2026-09-22T14:50:00Z", evaluando_viejos: 2 }, AHORA);
    expect(lenta).toHaveLength(1);
    expect(lenta[0].texto).toMatch(/2 remitos esperan/);
  });

  it("acciones: sin escaneo solo se puede decir que se perdio; nunca se ofrece el estado actual", () => {
    expect(accionesRemito("sin_escanear").map((a) => a.estado)).toEqual(["sin_remito"]);
    expect(accionesRemito("firmado").map((a) => a.estado)).toEqual(["sin_firma", "sin_remito", "a_revisar"]);
  });

  it("piezas: con varios tickets no se asignan a mano", () => {
    expect(piezaAsignable("codigo_ilegible")).toBe(true);
    expect(piezaAsignable("forma_no_reconocida")).toBe(false);
    expect(piezaAsignable("varios_codigos")).toBe(false);
    expect(motivoPiezaLabel("forma_no_reconocida")).toBe("Tickets pegados o forma rara");
    expect(motivoPiezaLabel("algo_nuevo")).toBe("algo nuevo");
  });

  it("IA, dias y rango del mes", () => {
    expect(iaTexto(fila("firmado", { firma_ia: "si", firma_ia_confianza: 0.98 }))).toBe("firmado 98%");
    expect(iaTexto(fila("sin_firma", { firma_ia: "no", firma_ia_confianza: 0.97 }))).toBe("sin firma 97%");
    expect(iaTexto(fila("evaluando"))).toBe("esperando");
    expect(iaTexto(fila("sin_escanear"))).toBeNull();
    expect(haceDias("2026-09-20T12:00:00Z", AHORA)).toBe("hace 2 días");
    expect(haceDias("2026-09-22T10:00:00Z", AHORA)).toBe("hoy");
    expect(rangoDeMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoDeMes("2026-12")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});
```

**Step 2:** `npx vitest run src/__tests__/remitos.test.ts` → FALLA.

**Step 3: implementación** (`src/lib/remitos.ts`)

```ts
// Reglas de pantalla del panel de remitos firmados (/admin/remitos). Puras y
// testeadas: la decisión de fondo (qué estado queda) la toma la base (mig 116).

import { interpretarCodigo, numeroVisible } from "./remito-codigo";
import type { RemitoEstado, RemitoEstadoPersona, RemitoPanelRow, RemitosSalud } from "./types";

export const REMITO_ESTADO_LABEL: Record<RemitoEstado, string> = {
  sin_escanear: "Sin escanear",
  evaluando: "Evaluando",
  a_revisar: "A revisar",
  firmado: "Firmado",
  sin_firma: "Sin firma",
  sin_remito: "Sin remito",
};

export const REMITO_ESTADO_TONO: Record<RemitoEstado, string> = {
  sin_escanear: "bg-slate-100 text-slate-600 border-slate-200",
  evaluando: "bg-sky-50 text-sky-700 border-sky-200",
  a_revisar: "bg-amber-50 text-amber-800 border-amber-200",
  firmado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sin_firma: "bg-rose-50 text-rose-700 border-rose-200",
  sin_remito: "bg-slate-200 text-slate-700 border-slate-300",
};

export function numeroRemitoVisible(numero: number): string {
  return numeroVisible(numero);
}

const ACCIONES: { estado: RemitoEstadoPersona; label: string }[] = [
  { estado: "firmado", label: "Firmado" },
  { estado: "sin_firma", label: "Sin firma" },
  { estado: "sin_remito", label: "Sin remito" },
  { estado: "a_revisar", label: "Volver a revisar" },
];

/** Lo que se puede decidir sobre un remito. Sin escaneo, solo que el papel se perdió. */
export function accionesRemito(estado: RemitoEstado): { estado: RemitoEstadoPersona; label: string }[] {
  if (estado === "sin_escanear") return ACCIONES.filter((a) => a.estado === "sin_remito");
  return ACCIONES.filter((a) => a.estado !== estado);
}

const MOTIVO_PIEZA_LABEL: Record<string, string> = {
  forma_no_reconocida: "Tickets pegados o forma rara",
  varios_codigos: "Varios tickets en la hoja, sin cartulina",
  codigo_ilegible: "QR ilegible",
  dv_invalido: "QR mal leído",
  codigo_ajeno: "Código que no es de un remito",
  codigo_inexistente: "Número que no existe en el sistema",
  sin_tickets: "Hoja sin tickets",
};

export function motivoPiezaLabel(motivo: string): string {
  return MOTIVO_PIEZA_LABEL[motivo] ?? motivo.replace(/_/g, " ");
}

const MOTIVOS_VARIOS_TICKETS = new Set(["forma_no_reconocida", "varios_codigos"]);

/** Una imagen con varios tickets nunca queda como respaldo de uno: se re-escanea. */
export function piezaAsignable(motivo: string): boolean {
  return !MOTIVOS_VARIOS_TICKETS.has(motivo);
}

/**
 * "158", "000158", "R-158", "R-000158" o el código completo del QR. Con el código
 * completo, el DV tiene que cerrar: si no, es un número mal copiado y se rechaza.
 */
export function parseNumeroRemito(texto: string): number | null {
  const t = String(texto ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const completo = /^R-?(\d{1,6})-(\d{2})$/.exec(t);
  if (completo) {
    const lectura = interpretarCodigo(`R-${completo[1].padStart(6, "0")}-${completo[2]}`);
    return lectura.ok ? lectura.numero : null;
  }
  const simple = /^(?:R-?)?(\d{1,6})$/.exec(t);
  if (!simple) return null;
  const n = Number(simple[1]);
  return n >= 1 ? n : null;
}

export type ResumenRemitos = { total: number; porEstado: Record<RemitoEstado, number> };

export function resumirRemitos(rows: RemitoPanelRow[]): ResumenRemitos {
  const porEstado: Record<RemitoEstado, number> = {
    sin_escanear: 0, evaluando: 0, a_revisar: 0, firmado: 0, sin_firma: 0, sin_remito: 0,
  };
  for (const r of rows) porEstado[r.estado] += 1;
  return { total: rows.length, porEstado };
}

const PARTES: { estado: RemitoEstado; uno: string; varios: string }[] = [
  { estado: "firmado", uno: "firmado", varios: "firmados" },
  { estado: "sin_firma", uno: "sin firma", varios: "sin firma" },
  { estado: "a_revisar", uno: "a revisar", varios: "a revisar" },
  { estado: "evaluando", uno: "evaluando", varios: "evaluando" },
  { estado: "sin_escanear", uno: "sin escanear", varios: "sin escanear" },
  { estado: "sin_remito", uno: "sin remito", varios: "sin remito" },
];

export function textoSemaforo(r: ResumenRemitos): string {
  if (r.total === 0) return "No hay remitos en este período.";
  const partes = PARTES.filter((p) => r.porEstado[p.estado] > 0).map(
    (p) => `${r.porEstado[p.estado]} ${r.porEstado[p.estado] === 1 ? p.uno : p.varios}`
  );
  return `${r.total} ${r.total === 1 ? "remito" : "remitos"}: ${partes.join(" · ")}`;
}

export type AvisoSalud = { tono: "alert" | "info"; texto: string };

/** Lo que desde afuera se ve igual que "no hubo escaneos". */
export function avisosSalud(s: RemitosSalud, ahoraMs: number): AvisoSalud[] {
  const avisos: AvisoSalud[] = [];
  if (!s.ultima_ingesta_at) {
    avisos.push({ tono: "info", texto: "La ingesta de remitos todavía no registró ninguna corrida." });
  } else {
    const horas = Math.floor((ahoraMs - Date.parse(s.ultima_ingesta_at)) / 3_600_000);
    if (horas >= 1) {
      avisos.push({
        tono: "alert",
        texto: `La ingesta de remitos no corre desde hace ${horas} h: los escaneos nuevos no se están procesando. Revisá "Remitos - Ingesta" en n8n.`,
      });
    }
  }
  if (s.evaluando_viejos > 0) {
    avisos.push({
      tono: "alert",
      texto: `${s.evaluando_viejos} ${s.evaluando_viejos === 1 ? "remito espera" : "remitos esperan"} la evaluación de la firma hace más de 2 horas. Revisá "Remitos - Evaluar firmas" en n8n.`,
    });
  }
  return avisos;
}

export function iaTexto(r: RemitoPanelRow): string | null {
  const pct = r.firma_ia_confianza === null ? "" : ` ${Math.round(r.firma_ia_confianza * 100)}%`;
  if (r.firma_ia === "si") return `firmado${pct}`;
  if (r.firma_ia === "no") return `sin firma${pct}`;
  if (r.firma_ia === "error") return "no pudo leerlo";
  return r.estado === "evaluando" ? "esperando" : null;
}

export function haceDias(iso: string, ahoraMs: number): string {
  const dias = Math.floor((ahoraMs - Date.parse(iso)) / 86_400_000);
  if (dias <= 0) return "hoy";
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** "2026-09" → primer y último día del mes. */
export function rangoDeMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}
```

**Step 4:** `npx vitest run src/__tests__/remitos.test.ts` → PASA.

**Step 5:** commit (`types.ts` + `remitos.ts` + test): `git commit -m "Remitos: tipos y reglas de pantalla del panel"`.

### Task 4.3: capa de datos

**Files:** Modify: `src/lib/data.ts`. Agregar los imports de tipos (`RemitoEstadoPersona, RemitoLookup, RemitoPanelRow, RemitoPieza, RemitosSalud`) y al final:

```ts
// ─── Remitos firmados (mig 116) ─────────────────────────────────────────────

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}
function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function toRemitoRow(r: Record<string, unknown>): RemitoPanelRow {
  return {
    movimiento_id: String(r.movimiento_id),
    remito_numero: Number(r.remito_numero),
    created_at: String(r.created_at),
    amount: Number(r.amount) || 0,
    client_kind: r.client_kind === "guest" ? "guest" : "company",
    client_id: String(r.client_id),
    cliente: String(r.cliente ?? "—"),
    room_number: strOrNull(r.room_number),
    pasajero: strOrNull(r.pasajero),
    estado: r.estado as RemitoPanelRow["estado"],
    decidido_por: (r.decidido_por as RemitoPanelRow["decidido_por"]) ?? null,
    decidido_por_nombre: strOrNull(r.decidido_por_nombre),
    estado_at: strOrNull(r.estado_at),
    nota: strOrNull(r.nota),
    escaneo_version: numOrNull(r.escaneo_version),
    escaneo_link: strOrNull(r.escaneo_link),
    escaneo_origen: (r.escaneo_origen as RemitoPanelRow["escaneo_origen"]) ?? null,
    firma_ia: (r.firma_ia as RemitoPanelRow["firma_ia"]) ?? null,
    firma_ia_confianza: numOrNull(r.firma_ia_confianza),
    firma_ia_observacion: strOrNull(r.firma_ia_observacion),
  };
}

/** Remitos del período (y del cliente, si se elige) con su estado de firma. */
export async function listRemitos(
  desde: string,
  hasta: string,
  clientKind?: CtaCteClientKind,
  clientId?: string
): Promise<RemitoPanelRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_remitos_listar", {
    p_client_kind: clientKind ?? null,
    p_client_id: clientId ?? null,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(toRemitoRow);
}

/** Latidos de n8n, contadores del badge y ajustes. */
export async function getRemitosSalud(): Promise<RemitosSalud> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_remitos_salud");
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ultima_ingesta_at: strOrNull(r.ultima_ingesta_at),
    ultima_evaluacion_at: strOrNull(r.ultima_evaluacion_at),
    evaluando_viejos: Number(r.evaluando_viejos) || 0,
    a_revisar: Number(r.a_revisar) || 0,
    piezas_abiertas: Number(r.piezas_abiertas) || 0,
    umbral_confianza: Number(r.umbral_confianza) || 0.95,
    controlar_desde: Number(r.controlar_desde) || 1,
    max_intentos_firma: Number(r.max_intentos_firma) || 5,
  };
}

export async function markRemito(movimientoId: string, estado: RemitoEstadoPersona, nota?: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_remitos_marcar", {
    p_movimiento_id: movimientoId,
    p_estado: estado,
    p_nota: nota ?? null,
  });
  if (error) throw error;
}

export async function listRemitoPiezas(incluirResueltas = false): Promise<RemitoPieza[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_remitos_piezas", { p_incluir_resueltas: incluirResueltas });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id),
    created_at: String(p.created_at),
    motivo: String(p.motivo),
    numeros_leidos: Array.isArray(p.numeros_leidos) ? p.numeros_leidos.map(String) : [],
    drive_link: strOrNull(p.drive_link),
    lote_archivo: strOrNull(p.lote_archivo),
    ubicacion: strOrNull(p.ubicacion),
    resuelta_at: strOrNull(p.resuelta_at),
    resuelta_como: (p.resuelta_como as RemitoPieza["resuelta_como"]) ?? null,
    resuelta_nota: strOrNull(p.resuelta_nota),
    remito_numero: numOrNull(p.remito_numero),
  }));
}

export async function lookupRemito(numero: number): Promise<RemitoLookup> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_remitos_buscar", { p_numero: numero });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  if (!r.existe) return { existe: false };
  return {
    existe: true,
    movimiento_id: String(r.movimiento_id),
    remito_numero: Number(r.remito_numero),
    cliente: String(r.cliente ?? "—"),
    created_at: String(r.created_at),
    amount: Number(r.amount) || 0,
    room_number: strOrNull(r.room_number),
    pasajero: strOrNull(r.pasajero),
    estado: r.estado as RemitoPanelRow["estado"],
    escaneos: Number(r.escaneos) || 0,
  };
}

export async function assignRemitoPieza(piezaId: string, numero: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_remitos_asignar_pieza", { p_pieza_id: piezaId, p_numero: numero });
  if (error) throw error;
}

export async function resolveRemitoPieza(
  piezaId: string,
  como: "reescaneada" | "descartada",
  nota?: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_remitos_resolver_pieza", {
    p_pieza_id: piezaId,
    p_como: como,
    p_nota: nota ?? null,
  });
  if (error) throw error;
}

export async function saveRemitosAjustes(umbral: number, controlarDesde: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_remitos_guardar_ajustes", {
    p_umbral: umbral,
    p_controlar_desde: controlarDesde,
  });
  if (error) throw error;
}
```

`npm run typecheck` → OK. Commit: `git commit -m "Remitos: capa de datos del panel"`.

### Task 4.4: server actions

**Files:** Create: `src/app/admin/remitos/actions.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";

import {
  assignRemitoPieza,
  lookupRemito,
  markRemito,
  resolveRemitoPieza,
  saveRemitosAjustes,
} from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult, RemitoEstadoPersona, RemitoLookup } from "@/lib/types";

const ESTADOS: ReadonlySet<RemitoEstadoPersona> = new Set(["firmado", "sin_firma", "sin_remito", "a_revisar"]);

function revalidar() {
  revalidatePath("/admin/remitos");
  // El numerito del menú lo calcula el layout.
  revalidatePath("/admin", "layout");
}

function numeroValido(numero: number): boolean {
  return Number.isInteger(numero) && numero >= 1 && numero <= 999999;
}

export async function markRemitoAction(
  movimientoId: string,
  estado: RemitoEstadoPersona,
  nota: string
): Promise<ActionResult> {
  if (!ESTADOS.has(estado)) return { success: false, error: "Estado inválido." };
  try {
    await markRemito(movimientoId, estado, nota.trim().slice(0, 300) || undefined);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo cambiar el estado del remito.") };
  }
}

export async function lookupRemitoAction(numero: number): Promise<ActionResult<RemitoLookup>> {
  if (!numeroValido(numero)) return { success: false, error: "Número de remito inválido." };
  try {
    return { success: true, data: await lookupRemito(numero) };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo buscar el remito.") };
  }
}

export async function assignRemitoPiezaAction(piezaId: string, numero: number): Promise<ActionResult> {
  if (!numeroValido(numero)) return { success: false, error: "Número de remito inválido." };
  try {
    await assignRemitoPieza(piezaId, numero);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo vincular el escaneo.") };
  }
}

export async function resolveRemitoPiezaAction(
  piezaId: string,
  como: "reescaneada" | "descartada",
  nota: string
): Promise<ActionResult> {
  if (como !== "reescaneada" && como !== "descartada") return { success: false, error: "Opción inválida." };
  try {
    await resolveRemitoPieza(piezaId, como, nota.trim().slice(0, 300) || undefined);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo resolver la pieza.") };
  }
}

export async function saveRemitosAjustesAction(umbralPct: number, controlarDesde: number): Promise<ActionResult> {
  if (!Number.isFinite(umbralPct) || umbralPct < 50 || umbralPct > 100) {
    return { success: false, error: "El umbral tiene que estar entre 50 y 100." };
  }
  if (!numeroValido(controlarDesde)) return { success: false, error: "Número de remito inválido." };
  try {
    await saveRemitosAjustes(Math.round(umbralPct) / 100, controlarDesde);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudieron guardar los ajustes.") };
  }
}
```

`npm run typecheck` → OK. Commit.

### Task 4.5: pantalla (cliente) con tests

**Files:**
- Create: `src/app/admin/remitos/RemitosClient.tsx`
- Test: `src/app/admin/remitos/RemitosClient.test.tsx`

**Step 1: test que falla**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RemitosClient from "./RemitosClient";
import type { RemitoEstado, RemitoPanelRow, RemitoPieza, RemitosSalud } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const markRemitoAction = vi.fn();
const lookupRemitoAction = vi.fn();
const assignRemitoPiezaAction = vi.fn();
const resolveRemitoPiezaAction = vi.fn();
const saveRemitosAjustesAction = vi.fn();
vi.mock("./actions", () => ({
  markRemitoAction: (...a: unknown[]) => markRemitoAction(...a),
  lookupRemitoAction: (...a: unknown[]) => lookupRemitoAction(...a),
  assignRemitoPiezaAction: (...a: unknown[]) => assignRemitoPiezaAction(...a),
  resolveRemitoPiezaAction: (...a: unknown[]) => resolveRemitoPiezaAction(...a),
  saveRemitosAjustesAction: (...a: unknown[]) => saveRemitosAjustesAction(...a),
}));

const AHORA = Date.parse("2026-09-22T15:00:00Z");
let n = 150;
const fila = (estado: RemitoEstado, extra: Partial<RemitoPanelRow> = {}): RemitoPanelRow => ({
  movimiento_id: `m${++n}`, remito_numero: n, created_at: "2026-09-20T12:00:00Z", amount: 50000,
  client_kind: "company", client_id: "c1", cliente: "Empresa de prueba", room_number: "7", pasajero: "Pasajero",
  estado, decidido_por: null, decidido_por_nombre: null, estado_at: null, nota: null,
  escaneo_version: estado === "sin_escanear" ? null : 1, escaneo_link: estado === "sin_escanear" ? null : "https://example.test/x",
  escaneo_origen: estado === "sin_escanear" ? null : "qr", firma_ia: null, firma_ia_confianza: null,
  firma_ia_observacion: null, ...extra,
});
const SALUD: RemitosSalud = {
  ultima_ingesta_at: "2026-09-22T14:55:00Z", ultima_evaluacion_at: "2026-09-22T14:55:00Z",
  evaluando_viejos: 0, a_revisar: 0, piezas_abiertas: 0, umbral_confianza: 0.95, controlar_desde: 151,
  max_intentos_firma: 5,
};
const pieza = (motivo: string, extra: Partial<RemitoPieza> = {}): RemitoPieza => ({
  id: `p-${motivo}`, created_at: "2026-09-22T12:00:00Z", motivo, numeros_leidos: [],
  drive_link: "https://example.test/p", lote_archivo: "escaneo.pdf", ubicacion: "1.1",
  resuelta_at: null, resuelta_como: null, resuelta_nota: null, remito_numero: null, ...extra,
});

function renderPanel(props: Partial<Parameters<typeof RemitosClient>[0]> = {}) {
  return render(
    <RemitosClient rows={[]} piezas={[]} salud={SALUD} accounts={[]} cliente="" mes="2026-09" nowMs={AHORA} errores={[]} {...props} />
  );
}

describe("RemitosClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    n = 150;
  });

  it("muestra el semaforo del periodo", () => {
    renderPanel({ rows: [fila("firmado"), fila("sin_firma"), fila("a_revisar"), fila("sin_escanear")] });
    expect(screen.getByTestId("semaforo")).toHaveTextContent(
      "4 remitos: 1 firmado · 1 sin firma · 1 a revisar · 1 sin escanear"
    );
  });

  it("avisa en rojo si la ingesta no corre hace mas de una hora", () => {
    renderPanel({ salud: { ...SALUD, ultima_ingesta_at: "2026-09-22T12:00:00Z" } });
    expect(screen.getByRole("alert")).toHaveTextContent("no corre desde hace 3 h");
  });

  it("sin remito exige nota antes de confirmar", async () => {
    markRemitoAction.mockResolvedValue({ success: true });
    renderPanel({ rows: [fila("sin_escanear")] });
    fireEvent.click(screen.getAllByRole("button", { name: "Sin remito" })[0]);
    const confirmar = screen.getByRole("button", { name: "Confirmar" });
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: "se perdio en la habitacion" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(markRemitoAction).toHaveBeenCalledWith("m151", "sin_remito", "se perdio en la habitacion"));
    expect(refresh).toHaveBeenCalled();
  });

  it("asignar a mano muestra el remito antes de vincular", async () => {
    lookupRemitoAction.mockResolvedValue({
      success: true,
      data: { existe: true, movimiento_id: "m9", remito_numero: 158, cliente: "Empresa de prueba",
        created_at: "2026-09-20T12:00:00Z", amount: 70000, room_number: "3", pasajero: "X", estado: "sin_escanear", escaneos: 0 },
    });
    assignRemitoPiezaAction.mockResolvedValue({ success: true });
    renderPanel({ piezas: [pieza("codigo_ilegible")] });
    fireEvent.click(screen.getByRole("button", { name: "Asignar a un remito" }));
    const vincular = screen.getByRole("button", { name: "Vincular" });
    expect(vincular).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Número del remito"), { target: { value: "158" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByTestId("remito-encontrado")).toHaveTextContent("R-000158 · Empresa de prueba");
    fireEvent.click(vincular);
    await waitFor(() => expect(assignRemitoPiezaAction).toHaveBeenCalledWith("p-codigo_ilegible", 158));
  });

  it("una pieza con tickets pegados no se puede asignar y muestra que tiene adentro", () => {
    renderPanel({ piezas: [pieza("forma_no_reconocida", { numeros_leidos: ["R-000001", "R-000002"] })] });
    expect(screen.queryByRole("button", { name: "Asignar a un remito" })).toBeNull();
    expect(screen.getByText(/Adentro se leyó: R-000001, R-000002/)).toBeInTheDocument();
  });
});
```

**Step 2:** `npx vitest run src/app/admin/remitos/RemitosClient.test.tsx` → FALLA.

**Step 3: implementación** (`src/app/admin/remitos/RemitosClient.tsx`)

```tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Info, Loader2, Settings2, X } from "lucide-react";
import { toast } from "sonner";

import ClientFilter from "../fiscal/control/ClientFilter";
import { formatAmount } from "@/lib/format";
import { formatHotelDate, formatHotelDateTime } from "@/lib/time";
import {
  REMITO_ESTADO_LABEL,
  REMITO_ESTADO_TONO,
  accionesRemito,
  avisosSalud,
  haceDias,
  iaTexto,
  motivoPiezaLabel,
  numeroRemitoVisible,
  parseNumeroRemito,
  piezaAsignable,
  resumirRemitos,
  textoSemaforo,
} from "@/lib/remitos";
import type {
  CtaCteAccount,
  RemitoEstadoPersona,
  RemitoLookup,
  RemitoPanelRow,
  RemitoPieza,
  RemitosSalud,
} from "@/lib/types";
import {
  assignRemitoPiezaAction,
  lookupRemitoAction,
  markRemitoAction,
  resolveRemitoPiezaAction,
  saveRemitosAjustesAction,
} from "./actions";

type Props = {
  rows: RemitoPanelRow[];
  piezas: RemitoPieza[];
  salud: RemitosSalud;
  accounts: CtaCteAccount[];
  /** "company:<uuid>" | "guest:<uuid>" | "" (todos). */
  cliente: string;
  /** "AAAA-MM". */
  mes: string;
  nowMs: number;
  /** Qué no se pudo cargar (la pantalla lo dice en vez de mostrar una lista vacía). */
  errores: string[];
};

const inputClass =
  "px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500";
const botonSecundario =
  "flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors";
const botonPrimario =
  "flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2";
const botonChico = "text-xs px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 whitespace-nowrap";

function Modal({ titulo, onClose, children, pie }: { titulo: string; onClose: () => void; children: ReactNode; pie: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800">{titulo}</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="p-5 border-t border-slate-100 flex gap-3">{pie}</div>
      </div>
    </div>
  );
}

function EstadoChip({ row }: { row: RemitoPanelRow }) {
  const quien =
    row.decidido_por === "ia" ? "la IA" : row.decidido_por === "persona" ? row.decidido_por_nombre ?? "una persona" : null;
  const titulo = quien && row.estado_at ? `Lo puso ${quien} el ${formatHotelDateTime(row.estado_at)}` : undefined;
  return (
    <span title={titulo} className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${REMITO_ESTADO_TONO[row.estado]}`}>
      {REMITO_ESTADO_LABEL[row.estado]}
      {row.decidido_por === "ia" ? " · IA" : ""}
    </span>
  );
}

function EnlaceEscaneo({ row }: { row: RemitoPanelRow }) {
  if (!row.escaneo_link) return <span className="text-slate-400">—</span>;
  return (
    <a href={row.escaneo_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
      Ver{row.escaneo_version && row.escaneo_version > 1 ? ` (v${row.escaneo_version})` : ""}
      <ExternalLink size={13} />
    </a>
  );
}

export default function RemitosClient({ rows, piezas, salud, accounts, cliente, mes, nowMs, errores }: Props) {
  const router = useRouter();
  const [clienteSel, setClienteSel] = useState(cliente);
  const [mesSel, setMesSel] = useState(mes);
  const [busy, setBusy] = useState(false);

  const [marca, setMarca] = useState<{ row: RemitoPanelRow; estado: RemitoEstadoPersona } | null>(null);
  const [nota, setNota] = useState("");

  const [asignando, setAsignando] = useState<RemitoPieza | null>(null);
  const [numeroTexto, setNumeroTexto] = useState("");
  const [encontrado, setEncontrado] = useState<RemitoLookup | null>(null);

  const [resolviendo, setResolviendo] = useState<RemitoPieza | null>(null);
  const [como, setComo] = useState<"reescaneada" | "descartada">("reescaneada");
  const [notaPieza, setNotaPieza] = useState("");

  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [umbralPct, setUmbralPct] = useState(String(Math.round(salud.umbral_confianza * 100)));
  const [desdeTexto, setDesdeTexto] = useState(String(salud.controlar_desde));

  const resumen = useMemo(() => resumirRemitos(rows), [rows]);
  const avisos = useMemo(() => avisosSalud(salud, nowMs), [salud, nowMs]);
  const mostrarCliente = cliente === "";

  function aplicarFiltros() {
    const q = new URLSearchParams();
    if (clienteSel) q.set("cliente", clienteSel);
    if (mesSel) q.set("mes", mesSel);
    const qs = q.toString();
    router.push(`/admin/remitos${qs ? `?${qs}` : ""}`);
  }

  async function confirmarMarca() {
    if (!marca) return;
    setBusy(true);
    const r = await markRemitoAction(marca.row.movimiento_id, marca.estado, nota);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success(`${numeroRemitoVisible(marca.row.remito_numero)}: ${REMITO_ESTADO_LABEL[marca.estado]}`);
    setMarca(null);
    router.refresh();
  }

  async function buscarNumero() {
    const numero = parseNumeroRemito(numeroTexto);
    if (numero === null) {
      toast.error("Escribí el número como está impreso, por ejemplo R-000158.");
      return;
    }
    setBusy(true);
    const r = await lookupRemitoAction(numero);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    setEncontrado(r.data ?? { existe: false });
  }

  async function confirmarAsignacion() {
    if (!asignando || !encontrado?.existe) return;
    setBusy(true);
    const r = await assignRemitoPiezaAction(asignando.id, encontrado.remito_numero);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success(`Escaneo vinculado a ${numeroRemitoVisible(encontrado.remito_numero)}. La IA va a mirar la firma.`);
    setAsignando(null);
    router.refresh();
  }

  async function confirmarResolucion() {
    if (!resolviendo) return;
    setBusy(true);
    const r = await resolveRemitoPiezaAction(resolviendo.id, como, notaPieza);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success("Pieza resuelta.");
    setResolviendo(null);
    router.refresh();
  }

  async function guardarAjustes() {
    setBusy(true);
    const r = await saveRemitosAjustesAction(Number(umbralPct), Number(desdeTexto));
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success("Ajustes guardados.");
    setAjustesAbiertos(false);
    router.refresh();
  }

  const accionesDe = (r: RemitoPanelRow) =>
    accionesRemito(r.estado).map((a) => (
      <button
        key={a.estado}
        type="button"
        onClick={() => {
          setMarca({ row: r, estado: a.estado });
          setNota("");
        }}
        className={botonChico}
      >
        {a.label}
      </button>
    ));

  return (
    <div className="space-y-4">
      {errores.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border p-3 text-sm bg-rose-50 border-rose-200 text-rose-800">
          <AlertTriangle size={18} className="shrink-0" />
          <span>No se pudo cargar: {errores.join(", ")}. Probá de nuevo; si sigue, avisá.</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-3 md:p-4 flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="remitos-cliente">
            Cliente
          </label>
          <ClientFilter accounts={accounts} value={clienteSel} onChange={setClienteSel} inputId="remitos-cliente" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="remitos-mes">
            Mes
          </label>
          <input id="remitos-mes" type="month" value={mesSel} onChange={(e) => setMesSel(e.target.value)} className={inputClass} />
        </div>
        <button type="button" onClick={aplicarFiltros} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg">
          Ver
        </button>
        <button
          type="button"
          onClick={() => setAjustesAbiertos(true)}
          className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800 flex items-center gap-1.5"
          title="Umbral de la IA y desde qué remito se controla"
        >
          <Settings2 size={16} /> Ajustes
        </button>
      </div>

      {avisos.map((a) => (
        <div
          key={a.texto}
          role={a.tono === "alert" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            a.tono === "alert" ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-slate-50 border-slate-200 text-slate-600"
          }`}
        >
          {a.tono === "alert" ? <AlertTriangle size={18} className="shrink-0" /> : <Info size={18} className="shrink-0" />}
          <span>{a.texto}</span>
        </div>
      ))}

      <p className="text-sm font-semibold text-slate-700" data-testid="semaforo">
        {textoSemaforo(resumen)}
      </p>

      {rows.length > 0 && (
        <>
          <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Remito</th>
                  <th className="text-left px-3 py-2">Fecha</th>
                  {mostrarCliente && <th className="text-left px-3 py-2">Cliente</th>}
                  <th className="text-left px-3 py-2">Hab. / pasajero</th>
                  <th className="text-right px-3 py-2">Monto</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-left px-3 py-2">IA</th>
                  <th className="text-left px-3 py-2">Escaneo</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.movimiento_id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-mono font-semibold">{numeroRemitoVisible(r.remito_numero)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatHotelDate(r.created_at)}
                      {r.estado === "sin_escanear" && <span className="block text-xs text-slate-400">{haceDias(r.created_at, nowMs)}</span>}
                    </td>
                    {mostrarCliente && <td className="px-3 py-2">{r.cliente}</td>}
                    <td className="px-3 py-2">{[r.room_number ? `Hab. ${r.room_number}` : null, r.pasajero].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatAmount(r.amount)}</td>
                    <td className="px-3 py-2">
                      <EstadoChip row={r} />
                      {r.nota && <span className="block text-xs text-slate-500 mt-1">{r.nota}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600" title={r.firma_ia_observacion ?? undefined}>
                      {iaTexto(r) ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <EnlaceEscaneo row={r} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 justify-end">{accionesDe(r)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-2">
            {rows.map((r) => (
              <li key={r.movimiento_id} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{numeroRemitoVisible(r.remito_numero)}</span>
                  <EstadoChip row={r} />
                </div>
                <p className="text-sm text-slate-600">
                  {formatHotelDate(r.created_at)} · {formatAmount(r.amount)}
                  {mostrarCliente ? ` · ${r.cliente}` : ""}
                </p>
                <p className="text-xs text-slate-500">
                  {iaTexto(r) ?? (r.estado === "sin_escanear" ? haceDias(r.created_at, nowMs) : "")}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <EnlaceEscaneo row={r} />
                  {accionesDe(r)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <section className="bg-white border border-slate-200 rounded-xl">
        <h2 className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-700">
          Piezas a revisar ({piezas.length})
        </h2>
        {piezas.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">No hay nada para revisar.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {piezas.map((p) => (
              <li key={p.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{motivoPiezaLabel(p.motivo)}</p>
                  <p className="text-xs text-slate-500">
                    {formatHotelDateTime(p.created_at)}
                    {p.lote_archivo ? ` · ${p.lote_archivo}` : ""}
                    {p.ubicacion ? ` · pieza ${p.ubicacion}` : ""}
                  </p>
                  {p.numeros_leidos.length > 0 && (
                    <p className="text-xs text-slate-600 mt-0.5">Adentro se leyó: {p.numeros_leidos.join(", ")}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.drive_link && (
                    <a href={p.drive_link} target="_blank" rel="noopener noreferrer" className={`${botonChico} inline-flex items-center gap-1`}>
                      Ver imagen <ExternalLink size={12} />
                    </a>
                  )}
                  {piezaAsignable(p.motivo) && (
                    <button
                      type="button"
                      className={botonChico}
                      onClick={() => {
                        setAsignando(p);
                        setNumeroTexto("");
                        setEncontrado(null);
                      }}
                    >
                      Asignar a un remito
                    </button>
                  )}
                  <button
                    type="button"
                    className={botonChico}
                    onClick={() => {
                      setResolviendo(p);
                      setComo("reescaneada");
                      setNotaPieza("");
                    }}
                  >
                    Resuelta
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {marca && (
        <Modal
          titulo={`${numeroRemitoVisible(marca.row.remito_numero)}: ${REMITO_ESTADO_LABEL[marca.estado]}`}
          onClose={() => setMarca(null)}
          pie={
            <>
              <button type="button" onClick={() => setMarca(null)} className={botonSecundario}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarMarca()}
                disabled={busy || (marca.estado === "sin_remito" && !nota.trim())}
                className={botonPrimario}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Confirmar
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            {marca.row.cliente} · {formatHotelDate(marca.row.created_at)} · {formatAmount(marca.row.amount)}
          </p>
          <div>
            <label htmlFor="remito-nota" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Nota {marca.estado === "sin_remito" ? <span className="text-rose-600">*</span> : "(opcional)"}
            </label>
            <input
              id="remito-nota"
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={300}
              placeholder={marca.estado === "sin_remito" ? "Qué pasó con el papel" : ""}
              className={`${inputClass} w-full`}
              autoFocus
            />
          </div>
        </Modal>
      )}

      {asignando && (
        <Modal
          titulo="Asignar a un remito"
          onClose={() => setAsignando(null)}
          pie={
            <>
              <button type="button" onClick={() => setAsignando(null)} className={botonSecundario}>
                Cancelar
              </button>
              <button type="button" onClick={() => void confirmarAsignacion()} disabled={busy || !encontrado?.existe} className={botonPrimario}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Vincular
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Tipeá el número impreso en el ticket, al lado del QR.</p>
          <div className="flex gap-2">
            <input
              aria-label="Número del remito"
              value={numeroTexto}
              onChange={(e) => {
                setNumeroTexto(e.target.value);
                setEncontrado(null);
              }}
              placeholder="R-000158"
              className={`${inputClass} flex-1 font-mono`}
              autoFocus
            />
            <button
              type="button"
              onClick={() => void buscarNumero()}
              disabled={busy || !numeroTexto.trim()}
              className="px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Buscar
            </button>
          </div>
          {encontrado && !encontrado.existe && <p className="text-sm text-rose-700">Ese número no existe. Revisá el ticket.</p>}
          {encontrado?.existe && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-slate-700" data-testid="remito-encontrado">
              <p className="font-semibold">
                {numeroRemitoVisible(encontrado.remito_numero)} · {encontrado.cliente}
              </p>
              <p>
                {formatHotelDate(encontrado.created_at)} · {formatAmount(encontrado.amount)}
                {encontrado.room_number ? ` · Hab. ${encontrado.room_number}` : ""}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Estado actual: {REMITO_ESTADO_LABEL[encontrado.estado]}
                {encontrado.escaneos > 0 ? ` · ya tiene ${encontrado.escaneos} escaneo(s): este va a quedar como versión nueva` : ""}
              </p>
            </div>
          )}
        </Modal>
      )}

      {resolviendo && (
        <Modal
          titulo="Marcar la pieza como resuelta"
          onClose={() => setResolviendo(null)}
          pie={
            <>
              <button type="button" onClick={() => setResolviendo(null)} className={botonSecundario}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarResolucion()}
                disabled={busy || (como === "descartada" && !notaPieza.trim())}
                className={botonPrimario}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Confirmar
              </button>
            </>
          }
        >
          <fieldset className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="como" checked={como === "reescaneada"} onChange={() => setComo("reescaneada")} />
              Ya se volvió a escanear bien
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="como" checked={como === "descartada"} onChange={() => setComo("descartada")} />
              No era un remito (se descarta)
            </label>
          </fieldset>
          <div>
            <label htmlFor="pieza-nota" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Nota {como === "descartada" ? <span className="text-rose-600">*</span> : "(opcional)"}
            </label>
            <input
              id="pieza-nota"
              type="text"
              value={notaPieza}
              onChange={(e) => setNotaPieza(e.target.value)}
              maxLength={300}
              className={`${inputClass} w-full`}
            />
          </div>
        </Modal>
      )}

      {ajustesAbiertos && (
        <Modal
          titulo="Ajustes de remitos"
          onClose={() => setAjustesAbiertos(false)}
          pie={
            <>
              <button type="button" onClick={() => setAjustesAbiertos(false)} className={botonSecundario}>
                Cancelar
              </button>
              <button type="button" onClick={() => void guardarAjustes()} disabled={busy} className={botonPrimario}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Guardar
              </button>
            </>
          }
        >
          <div>
            <label htmlFor="ajuste-umbral" className="block text-sm font-semibold text-slate-700 mb-1.5">
              La IA decide sola desde este % de seguridad
            </label>
            <input
              id="ajuste-umbral"
              type="number"
              min={50}
              max={100}
              value={umbralPct}
              onChange={(e) => setUmbralPct(e.target.value)}
              className={`${inputClass} w-28`}
            />
            <p className="text-xs text-slate-500 mt-1">Con 100, una persona confirma todo.</p>
          </div>
          <div>
            <label htmlFor="ajuste-desde" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Controlar desde el remito número
            </label>
            <input
              id="ajuste-desde"
              type="number"
              min={1}
              value={desdeTexto}
              onChange={(e) => setDesdeTexto(e.target.value)}
              className={`${inputClass} w-32`}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
```

**Step 4:** `npx vitest run src/app/admin/remitos/RemitosClient.test.tsx` → PASA. Si el test de "Sin remito" encuentra más de un botón con ese nombre (tabla + tarjetas), el `getAllByRole(...)[0]` ya lo contempla.

**Step 5:** commit `git commit -m "Remitos: pantalla del panel de remitos firmados"`.

### Task 4.6: página, menú y ruta solo admin

**Files:**
- Create: `src/app/admin/remitos/page.tsx`
- Modify: `src/app/admin/nav-links.ts`, `src/app/admin/layout.tsx`, `src/app/admin/Sidebar.tsx`, `src/app/admin/MobileNav.tsx`, `src/lib/supabase/middleware.ts`
- Test: `src/__tests__/nav-links.test.ts`

**Step 1: test que falla** (`src/__tests__/nav-links.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { getNavSections } from "@/app/admin/nav-links";

describe("menu: remitos firmados", () => {
  it("el admin lo ve con el numerito de pendientes; recepcion no lo ve", () => {
    const admin = getNavSections("admin", { remitosPendientes: 3 }).flatMap((s) => s.items);
    const remitos = admin.find((i) => i.href === "/admin/remitos");
    expect(remitos?.label).toBe("Remitos firmados");
    expect(remitos?.badge?.text).toBe("3");
    const recepcion = getNavSections("receptionist", { remitosPendientes: 3 }).flatMap((s) => s.items);
    expect(recepcion.find((i) => i.href === "/admin/remitos")).toBeUndefined();
  });

  it("sin pendientes no hay numerito", () => {
    const admin = getNavSections("admin", {}).flatMap((s) => s.items);
    expect(admin.find((i) => i.href === "/admin/remitos")?.badge).toBeUndefined();
  });
});
```

**Step 2:** `npx vitest run src/__tests__/nav-links.test.ts` → FALLA.

**Step 3: implementación**

- **Ícono:** confirmar que existe con `node -e "console.log(typeof require('lucide-react').Signature)"`. Si da `undefined`, usar `FileCheck`.
- **`nav-links.ts`:**
  - `NavState` suma `remitosPendientes?: number`.
  - `getAdminItems({ unbilledCount = 0, remitosPendientes = 0 })` agrega, justo después de "Control de facturación":

```ts
    {
      href: "/admin/remitos",
      label: "Remitos firmados",
      icon: Signature,
      highlighted: remitosPendientes > 0,
      badge:
        remitosPendientes > 0
          ? {
              text: String(remitosPendientes),
              tone: "warn",
              title: `${remitosPendientes} remitos o piezas para revisar`,
            }
          : undefined,
    },
```

- **`layout.tsx`:** junto a `unbilledCount`, y con `getRemitosSalud` importado de `@/lib/data`:

```ts
    // Remitos a revisar + piezas sin resolver (mig 116). Si la migración todavía no
    // está aplicada, la RPC no existe y el menú sigue igual: 0.
    const remitosPendientes =
        role === "admin"
            ? await getRemitosSalud()
                  .then((s) => s.a_revisar + s.piezas_abiertas)
                  .catch(() => 0)
            : 0;
```

  Pasar `remitosPendientes={remitosPendientes}` a `<MobileTopBar>` y a `<Sidebar>`.
- **`Sidebar.tsx` y `MobileNav.tsx`:** aceptar la prop `remitosPendientes` y pasarla a `getNavSections(role, { hasOpenShift, unbilledCount, remitosPendientes })`.
- **`middleware.ts`:** sumar `pathname.startsWith("/admin/remitos")` a `isAdminOnlyFiscalPath`, o crear `isAdminOnlyRemitosPath` e incluirlo en el `if (... && role !== "admin")`.
- **`src/app/admin/remitos/page.tsx`:**

```tsx
import { redirect } from "next/navigation";
import { Signature } from "lucide-react";

import { getCtaCteAccounts, getCurrentUserRole, getRemitosSalud, listRemitoPiezas, listRemitos } from "@/lib/data";
import { rangoDeMes } from "@/lib/remitos";
import { hotelDateKey } from "@/lib/time";
import type { CtaCteClientKind, RemitosSalud } from "@/lib/types";
import RemitosClient from "./RemitosClient";

export const dynamic = "force-dynamic";

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SALUD_VACIA: RemitosSalud = {
  ultima_ingesta_at: null, ultima_evaluacion_at: null, evaluando_viejos: 0, a_revisar: 0,
  piezas_abiertas: 0, umbral_confianza: 0.95, controlar_desde: 1, max_intentos_firma: 5,
};

export default async function RemitosPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; mes?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (role !== "admin") redirect("/forbidden");

  const { cliente, mes } = await searchParams;
  const ahora = new Date();
  const mesFiltro = mes && MES_RE.test(mes) ? mes : hotelDateKey(ahora).slice(0, 7);
  const { desde, hasta } = rangoDeMes(mesFiltro);

  // `cliente` viaja como "company:<uuid>" | "guest:<uuid>", igual que en el control.
  const [rawKind, rawId] = (cliente ?? "").split(":");
  const clientKind: CtaCteClientKind | undefined = rawKind === "company" || rawKind === "guest" ? rawKind : undefined;
  const clientId = clientKind && rawId ? rawId : undefined;

  // Lo que falla se dice en pantalla: una lista vacía por un error se confunde con
  // "no hay nada que controlar".
  const errores: string[] = [];
  const cargar = <T,>(p: Promise<T>, vacio: T, que: string): Promise<T> =>
    p.catch((e: unknown) => {
      console.error(`[remitos] ${que}:`, e);
      errores.push(que);
      return vacio;
    });

  const [rows, piezas, salud, accounts] = await Promise.all([
    cargar(listRemitos(desde, hasta, clientKind, clientId), [], "los remitos"),
    cargar(listRemitoPiezas(false), [], "las piezas a revisar"),
    cargar(getRemitosSalud(), SALUD_VACIA, "el estado de la ingesta"),
    cargar(getCtaCteAccounts(), [], "los clientes"),
  ]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-4 md:px-6 py-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Signature size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Remitos firmados</h1>
            <p className="text-sm text-slate-500">Qué remitos de cuenta corriente están escaneados y firmados, y cuáles faltan.</p>
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-3 md:p-5">
        <div className="max-w-[1400px] mx-auto">
          <RemitosClient
            rows={rows}
            piezas={piezas}
            salud={salud}
            accounts={accounts}
            cliente={cliente ?? ""}
            mes={mesFiltro}
            nowMs={ahora.getTime()}
            errores={errores}
          />
        </div>
      </div>
    </div>
  );
}
```

**Step 4:** `npm run typecheck && npm run lint && npm test && npm run build`. Todo en verde. Si lint marca `Date`/`new Date()` en el server component, aplicar el mismo patrón que `fiscal/control/page.tsx`: ahí `hotelDateKey(new Date())` pasa lint.

**Step 5:** commit `git commit -m "Remitos: pagina del panel, menu con pendientes y ruta solo admin"`.

---

## Fase 5 — n8n escribe en la base (automatización)

Misma rama `claude/remitos-b2-panel`.

### Task 5.1: lógica pura contra la base (TDD)

**Files:**
- Modify: `automatizaciones/remitos/n8n/logica.mjs`
- Test: `automatizaciones/remitos/test/logica.test.mjs`

**Step 1: tests que fallan.** Agregar a `logica.test.mjs`, y reemplazar el helper `plan` y los tests de `planificarLote` que usan `comprobantes`/`resultados`:

```js
import { pedidoPlanificacion, registroDePieza, numeroVisibleR } from "../n8n/logica.mjs";
import { formatearCodigo } from "../comun/codigo.mjs";

const codR = (n) => formatearCodigo("R", n);
const visR = (n) => `R-${String(n).padStart(6, "0")}`;
const identificadaR = (pagina, n, hash = `h${pagina}`.padEnd(64, "0")) => ({
  pagina, pieza: 1, ubicacion: String(pagina), modo: "pagina", estado: "identificado",
  prefijo: "R", numero: n, codigo: codR(n), numero_visible: visR(n), hash_sha256: hash,
  pdf_pagina_b64: "PDF", imagen_jpg_b64: "JPG",
});
const planificacion = (remitos, hashes = []) => ({ remitos, hashes_registrados: hashes });
const remito = (n, extra = {}) => ({ numero: n, existe: true, cliente: "EMPRESA DE PRUEBA SA", periodo: "2026-09", versiones: 0, ...extra });
const planDb = (w, pl, extra = {}) => planificarLote({
  archivo: { id: "arch1", name: "scan.pdf" }, worker: w, planificacion: pl, lotes: [], unidad: "Hotel", ahora: AHORA, ...extra,
});

test("base: archiva el R- que existe en la carpeta de su cliente y periodo", () => {
  const r = planDb(worker([identificadaR(1, 158)]), planificacion([remito(158)]));
  assert.equal(r.piezas[0].accion, "archivar");
  assert.equal(r.piezas[0].ruta_clave, "EMPRESA DE PRUEBA SA/Hotel/2026-09");
  assert.equal(r.piezas[0].archivo_nombre, "R-000158.pdf");
  assert.equal(r.piezas[0].numero_int, 158);
});

test("base: un R- que no existe y un T- de prueba van a revisar, nunca se imputan", () => {
  const t = { ...identificadaR(2, 5), prefijo: "T", codigo: formatearCodigo("T", 5), numero_visible: "T-000005" };
  const r = planDb(worker([identificadaR(1, 999), t]), planificacion([remito(999, { existe: false })]));
  assert.deepEqual(r.piezas.map((p) => [p.accion, p.motivo]), [["revisar", "codigo_inexistente"], ["revisar", "codigo_inexistente"]]);
});

test("base: re-escaneo sigue la version de la base; dos en el mismo lote no se pisan", () => {
  const r = planDb(worker([identificadaR(1, 158), identificadaR(2, 158)]), planificacion([remito(158, { versiones: 1 })]));
  assert.deepEqual(r.piezas.map((p) => p.archivo_nombre), ["R-000158_v2.pdf", "R-000158_v3.pdf"]);
});

test("base: lo que la base ya tiene registrado se saltea", () => {
  const p = identificadaR(1, 158);
  const r = planDb(worker([p]), planificacion([remito(158)], [p.hash_sha256]));
  assert.equal(r.piezas[0].accion, "saltear");
});

test("pedido a la base: numeros R- unicos y todas las huellas", () => {
  const w = worker([identificadaR(1, 160), identificadaR(2, 158), identificadaR(3, 160), aRevisar(4, "codigo_ilegible")]);
  assert.deepEqual(pedidoPlanificacion(w), {
    p_numeros: [158, 160],
    p_hashes: w.piezas.map((p) => p.hash_sha256),
  });
});

test("registro: lo archivado es un escaneo; lo que va a revisar, una pieza con lo que se leyo adentro", () => {
  const [archivada] = planDb(worker([identificadaR(1, 158)]), planificacion([remito(158)])).piezas;
  const subido = { id: "F1", webViewLink: "L1" };
  assert.deepEqual(registroDePieza(archivada, subido), {
    funcion: "rpc_remitos_registrar_escaneo",
    body: { p: { numero: 158, drive_file_id: "F1", drive_link: "L1", hash_sha256: archivada.hash_sha256,
      lote_archivo: "scan.pdf", lote_hash: "lotehash123456", ubicacion: "1" } },
  });
  const pegados = { ...aRevisar(2, "forma_no_reconocida"), numeros: [visR(1), visR(2)] };
  const [rev] = planDb(worker([pegados]), planificacion([])).piezas;
  assert.equal(registroDePieza(rev, subido).funcion, "rpc_remitos_registrar_pieza");
  assert.deepEqual(registroDePieza(rev, subido).body.p.numeros_leidos, [visR(1), visR(2)]);
  assert.equal(numeroVisibleR(7), "R-000007");
});
```

Borrar los tests de lo que desaparece:
- `elegirFirmasPendientes`, `mismaFila`, `firmaReintentada`, `reintentosDe`, `rangoFirma` y `letraColumna`;
- "fila de resultado", "la ingesta deja pendiente…";
- "la planilla Comprobantes que arma el generador es la que lee n8n".

Los tests de `planificarLote` que siguen valiendo se reescriben con `planDb`:
- idempotencia;
- lote duplicado;
- revisar con motivo;
- cartulina con ubicación;
- sufijo de números en `_Revisar`.

**Step 2:** `cd automatizaciones/remitos && npm test` → FALLAN los nuevos.

**Step 3: implementación** en `logica.mjs`.

- **`COLUMNAS`** queda solo con `Lotes`, `Errores` y `Estado`.
- **Se borran:** `filaResultado`, `FIRMA_PENDIENTE`, `firmaInicial`, `MARCA_REINTENTOS`, `reintentosDe`, `letraColumna`, `rangoFirma`, `elegirFirmasPendientes`, `mismaFila` y `firmaReintentada`.
- **`PROMPT_FIRMA`:** reemplazar las dos primeras líneas de la descripción del ticket por las de abajo. El resto del prompt no cambia.

```js
  "La imagen es un escaneo de un ticket termico angosto de un hotel que dice 'COMPROBANTE CTA. CTE.'",
  "y, abajo, tiene dos renglones con una linea para completar a mano: 'Firma' y 'Aclaración'.",
```

- **Agregar:**

```js
// --- Base del sistema (mig 116) ---------------------------------------------------------

/** Prefijo de los remitos reales. Los T- de prueba no estan en la base. */
const PREFIJO_REMITOS = "R";

function numeroVisibleR(numero) {
  return `${PREFIJO_REMITOS}-${String(numero).padStart(6, "0")}`;
}

/** Lo que se le pregunta a la base antes de planificar un lote (rpc_remitos_planificar). */
function pedidoPlanificacion(worker) {
  const numeros = new Set();
  for (const p of worker.piezas) {
    if (p.estado === "identificado" && p.prefijo === PREFIJO_REMITOS && Number.isInteger(p.numero)) numeros.add(p.numero);
  }
  return { p_numeros: [...numeros].sort((a, b) => a - b), p_hashes: worker.piezas.map((p) => p.hash_sha256) };
}

/** Que funcion de la base registra esta pieza ya subida a Drive, y con que datos. */
function registroDePieza(pag, subido) {
  const base = {
    drive_file_id: subido.id ?? "",
    drive_link: subido.webViewLink ?? "",
    hash_sha256: pag.hash_sha256,
    lote_archivo: pag.lote_archivo,
    lote_hash: pag.lote_hash,
    ubicacion: String(pag.pagina),
  };
  if (pag.accion === "archivar") {
    return { funcion: "rpc_remitos_registrar_escaneo", body: { p: { numero: pag.numero_int, ...base } } };
  }
  return {
    funcion: "rpc_remitos_registrar_pieza",
    body: { p: { ...base, motivo: pag.motivo, numeros_leidos: pag.numeros ?? [] } },
  };
}
```

- **`planificarLote({ archivo, worker, planificacion, lotes, unidad, ahora })`:** la firma nueva cambia `comprobantes, resultados` por `planificacion`.
  - `porNumero = new Map((planificacion?.remitos ?? []).filter((r) => r.existe).map((r) => [numeroVisibleR(r.numero), r]))`
  - `hashesGuardados = new Set(planificacion?.hashes_registrados ?? [])`
  - `versiones = new Map((planificacion?.remitos ?? []).map((r) => [numeroVisibleR(r.numero), Number(r.versiones) || 0]))`
  - En `base` se agrega `numeros: pag.numeros ?? []`.
  - Un identificado cuyo `pag.prefijo !== PREFIJO_REMITOS`, o que no está en `porNumero`, va a `revisar("codigo_inexistente", { numero: pag.numero_visible, codigo: pag.codigo })`.
  - La carpeta sale de `limpiarNombre(rem.cliente) || "SIN NOMBRE"` y el período de `String(rem.periodo)`.
  - La pieza archivada suma `numero_int: pag.numero`.
- **Exports:** actualizar la lista (sacar lo borrado y agregar `PREFIJO_REMITOS, numeroVisibleR, pedidoPlanificacion, registroDePieza`).

**Step 4:** `npm test` → PASA.

**Step 5:** commit `git commit -m "Remitos: la logica de la ingesta pregunta y registra en la base"`.

### Task 5.2: workflows contra la base

**Files:**
- Modify: `automatizaciones/remitos/n8n/construir.mjs`
- Test: `automatizaciones/remitos/test/workflows.test.mjs`

**Step 1: tests que fallan** (agregar a `workflows.test.mjs`)

```js
test("base: toda llamada a Supabase lleva la clave por credencial y la anon key por encabezado", () => {
  for (const wf of workflows) {
    for (const n of wf.nodes.filter((x) => String(x.parameters?.url ?? "").includes("/rest/v1/rpc/"))) {
      assert.equal(n.parameters.genericAuthType, "httpHeaderAuth", `${wf.name} / ${n.name}`);
      const headers = (n.parameters.headerParameters?.parameters ?? []).map((h) => h.name);
      assert.deepEqual(headers.sort(), ["Authorization", "apikey"], `${wf.name} / ${n.name}`);
    }
  }
  // La clave nunca viaja en un workflow: vive en la credencial de n8n.
  assert.doesNotMatch(JSON.stringify(workflows), /x-remitos-clave/);
});

test("ingesta: pregunta a la base y registra cada pieza; ya no usa Comprobantes ni Resultados", () => {
  const ing = workflows.find((w) => w.name === "Remitos - Ingesta");
  const texto = JSON.stringify(ing.nodes);
  assert.doesNotMatch(texto, /values\/Comprobantes|values\/Resultados|Resultados!A1:append/);
  assert.deepEqual(destino(ing, "Leer Lotes"), ["Pedido a la base"]);
  assert.deepEqual(destino(ing, "Pedido a la base"), ["Planificar (base)"]);
  assert.deepEqual(destino(ing, "Planificar (base)"), ["Planificar"]);
  assert.deepEqual(destino(ing, "Subir contenido"), ["Armar registro"]);
  assert.deepEqual(destino(ing, "Armar registro"), ["Registrar (base)"]);
  assert.deepEqual(destino(ing, "Registrar (base)"), ["Una página por vez"]);
  assert.match(texto, /rpc_remitos_latido/);
});

test("evaluar firmas: la base elige las pendientes y guarda cada firma", () => {
  const wf = evaluar();
  assert.deepEqual(destino(wf, "Pendientes (base)"), ["Elegir pendientes"]);
  assert.deepEqual(destino(wf, "¿Anduvo?", 0), ["Guardar firma (principal)"]);
  assert.deepEqual(destino(wf, "Interpretar respaldo"), ["Guardar firma (respaldo)"]);
  assert.deepEqual(destino(wf, "Sin archivo"), ["Guardar firma (sin archivo)"]);
  assert.deepEqual(destino(wf, "Guardar firma (respaldo)"), ["¿Seguir?"]);
  assert.doesNotMatch(JSON.stringify(wf.nodes), /values\/Resultados/);
});
```

Actualizar el test viejo de *Evaluar firmas* (el de `Leer fila (…)`/`Armar actualización (…)`) para que sea este último, y mantener el test del bucle ("adentro del bucle cada nodo lee el remito de su vuelta").

**Step 2:** `npm test` → FALLAN.

**Step 3: implementación** en `construir.mjs`.

- **`CONFIG_BASE`** suma `supabase_url: ""` y `supabase_anon_key: ""`, que llegan desde `config.local.json` en `config`.
- **Aviso al final del armado:**

```js
if (!CONFIG.supabase_url || !CONFIG.supabase_anon_key) console.log("  Falta supabase_url o supabase_anon_key en config.local.json (config)");
if (!CREDENCIALES.supabase) console.log("  Falta la credencial 'supabase' (Header Auth x-remitos-clave) en config.local.json");
```

- **Ayudante para Supabase** (antes de `wfIngesta`):

```js
// Llamada a una funcion de la base (mig 116). La clave de la integracion la pone
// la credencial Header Auth ("supabase"); la anon key de Supabase no es secreta
// (viaja en el navegador) y va como encabezado. `funcion` puede ser un nombre fijo
// o una expresion ("{{ $json.funcion }}").
function supa(name, pos, funcion, jsonExpr, extra = {}) {
  const url = `={{ ${CFG("supabase_url")} }}/rest/v1/rpc/${funcion}`;
  const n = http(name, pos, { method: "POST", url, json: jsonExpr, auth: "supabase", timeout: 30000, ...extra });
  n.parameters.sendHeaders = true;
  n.parameters.headerParameters = {
    parameters: [
      { name: "apikey", value: `={{ ${CFG("supabase_anon_key")} }}` },
      { name: "Authorization", value: `=Bearer {{ ${CFG("supabase_anon_key")} }}` },
    ],
  };
  return n;
}
```

- **`wfIngesta`:**
  - Después de `Latido`, agregar `supa("Latido (base)", …, "rpc_remitos_latido", "={{ JSON.stringify({ p_que: 'ingesta' }) }}", { executeOnce: true })` y conectarlo a `Listar _Entrada`.
  - Sacar `Leer Comprobantes` y `Leer Resultados`.
  - `¿Worker OK?` (salida 0) va a `Leer Lotes`. Encadenar `Leer Lotes` → `Pedido a la base` → `Planificar (base)` → `Planificar`, con:

```js
    codigo("Pedido a la base", `return [{ json: pedidoPlanificacion($('Worker').first().json.body) }];`, […]),
    supa("Planificar (base)", […], "rpc_remitos_planificar", "={{ JSON.stringify($json) }}"),
```

  - El nodo `Planificar` usa `planificacion: $('Planificar (base)').first().json` y `lotes: filasAObjetos($('Leer Lotes').first().json.values)`, en lugar de comprobantes y resultados.
  - `Preparar subida` vuelve a copiar la pieza sin firma:

```js
    codigo("Preparar subida", `
const pag = $json;
const { pdf_pagina_b64, ...resto } = pag;
return {
  json: resto,
  binary: { data: { data: pdf_pagina_b64, mimeType: 'application/pdf', fileName: pag.archivo_nombre, fileExtension: 'pdf' } },
};`, […], { cadaItem: true, conLogica: false }),
```

  - Reemplazar `Fila resultado` y `Anotar resultado` por:

```js
    codigo("Armar registro", `return { json: registroDePieza($('Preparar subida').item.json, $json) };`, […], { cadaItem: true }),
    supa("Registrar (base)", […], "{{ $json.funcion }}", "={{ JSON.stringify($json.body) }}"),
```

  - Conexiones: `Subir contenido` → `Armar registro` → `Registrar (base)` → `Una página por vez`.
- **`wfEvaluarFirmas`:**
  - Reemplazar `Leer Resultados` y `Elegir pendientes` por:

```js
      supa("Latido (base)", [x(2), F], "rpc_remitos_latido", "={{ JSON.stringify({ p_que: 'evaluacion' }) }}"),
      supa("Pendientes (base)", [x(3), F], "rpc_remitos_firmas_pendientes", `={{ JSON.stringify({ p_limite: ${CFG("firmas_por_corrida")} }) }}`),
      codigo("Elegir pendientes", `
// La base ya eligio cuales y en que orden. Si no hay ninguna, la corrida termina aca.
return $input.all().map(i => i.json).filter(p => p && p.escaneo_id && p.drive_file_id).map(json => ({ json }));`, [x(4), F], { conLogica: false }),
```

  - `Descargar PDF` usa `{{ $json.drive_file_id }}`.
  - `resultado()` devuelve `{ escaneo_id: p.escaneo_id, numero: p.numero, firma, modelo_usado, seguir: !cortarCorrida(firma) }`, con `const firma = ${firmaExpr};`.
  - Reemplazar los tres `escribir(...)` por tres nodos de guardado:

```js
  const guardar = (sufijo, pos) => supa(`Guardar firma (${sufijo})`, pos, "rpc_remitos_guardar_firma",
    "={{ JSON.stringify({ p_escaneo_id: $json.escaneo_id, p_firma: $json.firma.firma, p_confianza: $json.firma.firma === 'error' ? null : $json.firma.confianza, p_observacion: $json.firma.observacion, p_modelo: $json.modelo_usado }) }}");
```

  - `¿Seguir?` pasa a mirar `$('Interpretar respaldo').item.json.seguir`.
  - Conexiones: `Config` → `Latido (base)` → `Pendientes (base)` → `Elegir pendientes` → `Una por vez`. Además `¿Anduvo?` (0) → `Guardar firma (principal)` → `Pausa`, `Interpretar respaldo` → `Guardar firma (respaldo)` → `¿Seguir?` (0) → `Pausa`, y `Sin archivo` → `Guardar firma (sin archivo)` → `Pausa`.
  - Sacar `ULTIMA_COLUMNA_RESULTADOS` y el import de `letraColumna`.
- **`wfInstalacion`:** sacar la carga de `comprobantes.csv` (`rutaCsv`, `filasComprobantes`, `parsearCsv`). Las pestañas salen de `COLUMNAS`, que ahora son solo `Lotes`, `Errores` y `Estado`.
- **Generador (`generador/cli.mjs` y `manifiesto.mjs`):** dejar de escribir `comprobantes.csv`, sacar `aCsv`, y en el README decir que los `T-` sirven solo para probar el worker sin n8n.

**Step 4:** `npm test` → PASA. `node n8n/construir.mjs` → arma 7 workflows. Si falta configuración, avisa.

**Step 5:** commit `git commit -m "Remitos: la ingesta y la evaluacion de firmas leen y escriben en la base"`.

### Task 5.3: README y diseño

- **`automatizaciones/remitos/README.md`:**
  - La etapa 2 (con base) reemplaza a la planilla como fuente.
  - Credencial nueva *Supabase - Remitos*: Header Auth, nombre `x-remitos-clave`.
  - Claves nuevas en `config.local.json`: `config.supabase_url`, `config.supabase_anon_key` y `credenciales.supabase`.
  - Tabla de fallas actualizada con la base caída, la clave mal y `codigo_inexistente` para los `T-`.
  - Cómo rotar la clave (Task 6.1).
- **`docs/plans/2026-09-22-remitos-integracion-design.md`:** estado "implementado" y lo que haya cambiado durante la implementación.
- Commit.

### Task 5.4: PR de B2

`git push -u origin claude/remitos-b2-panel` y `gh pr create`. El PR explica:
- la migración 116, que ya está aplicada;
- el panel;
- los workflows a reimportar;
- la credencial nueva;
- el orden de despliegue.

Terminar la descripción con la línea de Claude Code. 👤 **AGUSTÍN:** mergear.

---

## Fase 6 — Clave, despliegue, prueba real y activación

### Task 6.1: clave de la integración

1. Generarla localmente. El script imprime solo la huella; la clave queda en `salida/`, fuera de git:

```bash
cd automatizaciones/remitos && node -e "
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const clave = randomBytes(32).toString('base64url');
fs.mkdirSync('salida', { recursive: true });
fs.writeFileSync('salida/clave-remitos.local.txt', clave + '\n');
console.log(createHash('sha256').update(clave).digest('hex'));
"
```

2. 👤 **AGUSTÍN:** OK para cargar la huella en PROD.
3. Por el MCP, reemplazando `<HEX>` por lo que imprimió el script:

```sql
select public.exec_ddl($k$
INSERT INTO public.remitos_privado (id, clave_hash, updated_at)
VALUES (1, decode('<HEX>', 'hex'), NOW())
ON CONFLICT (id) DO UPDATE SET clave_hash = EXCLUDED.clave_hash, updated_at = NOW()
$k$)
```

4. 👤 **AGUSTÍN:** en n8n, credencial nueva *Header Auth* llamada **Supabase - Remitos**, con Name `x-remitos-clave` y Value igual al contenido de `automatizaciones/remitos/salida/clave-remitos.local.txt`. Pasar su id.
5. Completar `n8n/config.local.json`:
   - `config.supabase_url`: la URL del proyecto de PROD;
   - `config.supabase_anon_key`: la `NEXT_PUBLIC_SUPABASE_ANON_KEY` de `.env.local` del checkout principal, sin mostrar otras variables. Si no está, pedírsela a Agustín;
   - `credenciales.supabase`: `{ "id": "<id>", "name": "Supabase - Remitos" }`.

### Task 6.2: desplegar los workflows

1. `node n8n/construir.mjs`.
2. Actualizar `Remitos - Config` por MCP (`update_workflow` con nodes y connections de `salida/n8n/config.json`) y verificarlo con `get_workflow`.
3. 👤 **AGUSTÍN:** reimportar `salida/n8n/ingesta.json` en *Remitos - Ingesta* y `salida/n8n/evaluar-firmas.json` en *Remitos - Evaluar firmas*.
4. Verificar las dos importaciones con `node herramientas/comparar-workflow.mjs` (ver Task 0.1).
5. Prueba de conexión: 👤 **AGUSTÍN** corre *Remitos - Evaluar firmas* a mano. Con la base vacía no hay pendientes y la corrida termina en `Elegir pendientes`. Por el MCP, `select ultima_evaluacion_at from public.remitos_ajustes` tiene que tener la hora de la corrida.

### Task 6.3: prueba real

1. 👤 **AGUSTÍN:**
   - Imprimir 3 o 4 comprobantes reales con QR, es decir cargos posteriores a B1, o reimpresiones desde la ficha si no hay.
   - Firmar dos, dejar uno en blanco y superponer dos a propósito.
   - Escanear, subir a `_Entrada` y correr la Ingesta y después *Evaluar firmas*.
2. Verificar por el MCP:
   - `select * from public.remito_escaneos order by created_at desc limit 10`;
   - `remito_control`;
   - `remito_piezas_revisar`.
3. 👤 **AGUSTÍN:** abrir `/admin/remitos` del mes y confirmar cuatro cosas:
   - el semáforo;
   - "Ver escaneo";
   - que los firmados con 95% o más quedaron solos;
   - que la pieza con tickets pegados aparece con sus números y sin "Asignar".
4. Probar una acción de persona (por ejemplo "Volver a revisar") y ver que el chip muestra quién y cuándo.

### Task 6.4: activar

👤 **AGUSTÍN:** activar *Remitos - Ingesta*, *Remitos - Evaluar firmas* y *Remitos - Vigilancia*. Opcional: `aviso_numero` en *Remitos - Config*. Después, verificar por el MCP que `ultima_ingesta_at` se actualiza cada 5 minutos.

### Task 6.5: cierre

- **Memoria del proyecto** (`project_remitos_firmados.md` e índice `MEMORY.md`):
  - la migración 116 aplicada, con la fecha;
  - `controlar_desde`;
  - la credencial;
  - qué workflows están activos;
  - las trampas nuevas que hayan aparecido.
- **README y diseño** al día.
- **Pendiente para la fase C:** el aviso de faltantes al emitir la consolidada y el paquete PDF.
