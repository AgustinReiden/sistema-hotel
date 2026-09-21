// Procesa un escaneo desde la linea de comandos, sin n8n ni Drive.
// Es la herramienta de la prueba de humo: escaneas, corres esto, y ves si se
// leyo el codigo de cada pagina.
//
//   node worker/cli.mjs escaneo.pdf [--salida carpeta]
//
// Con --salida guarda cada pagina suelta (PDF) y su imagen (JPG) para mirarlas.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

import { procesarEscaneo, ErrorEntrada } from "./procesar.mjs";

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const iSalida = args.indexOf("--salida");
const salida = iSalida >= 0 ? args[iSalida + 1] : null;

if (!archivo) {
  console.error("Uso: node worker/cli.mjs escaneo.pdf [--salida carpeta]");
  process.exit(2);
}

try {
  const r = await procesarEscaneo(await readFile(archivo));
  console.log(`\n${basename(archivo)} — ${r.formato_entrada}, ${r.total_paginas} hoja(s), ${r.piezas.length} pieza(s)\n`);

  for (const p of r.piezas) {
    const detalle =
      p.estado === "identificado"
        ? `${p.numero_visible}  (${p.formato_codigo}, rotacion ${p.rotacion}°, ${p.dpi_lectura} dpi)`
        : `REVISAR: ${p.motivo}${p.codigos ? ` [${p.codigos.join(", ")}]` : ""}`;
    const modo = p.modo === "cartulina" ? `cartulina ${p.medidas_mm?.join("x") ?? ""} mm` : "hoja entera";
    console.log(`  ${p.ubicacion.padStart(5)}  ${detalle}   [${modo}]`);

    if (salida) {
      await mkdir(salida, { recursive: true });
      const nombre = p.estado === "identificado" ? p.numero_visible : `pieza${p.ubicacion}_${p.motivo}`;
      await writeFile(join(salida, `${nombre}.pdf`), Buffer.from(p.pdf_pagina_b64, "base64"));
      await writeFile(join(salida, `${nombre}.jpg`), Buffer.from(p.imagen_jpg_b64, "base64"));
    }
  }

  const ok = r.piezas.filter((p) => p.estado === "identificado").length;
  console.log(`\n  ${ok} de ${r.piezas.length} identificadas${salida ? ` — piezas en ${salida}` : ""}\n`);
} catch (e) {
  if (e instanceof ErrorEntrada) {
    console.error(`No se pudo procesar: ${e.codigo} — ${e.message}`);
    process.exit(1);
  }
  throw e;
}
