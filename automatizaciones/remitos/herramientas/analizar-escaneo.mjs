// Corre el worker LOCAL sobre escaneos reales y guarda cada recorte para mirarlo.
// Es la herramienta para diagnosticar una prueba con papel.
//
//   node herramientas/analizar-escaneo.mjs --pdf escaneo.pdf [--pdf otro.pdf] [--salida salida/diag]
//
// El worker es deterministico: el hash de cada pieza local es el mismo que anoto
// produccion. Si coincide, el recorte que se mira aca ES el que se archivo.
// Muestra, por pieza: ubicacion, numero o motivo, a que resolucion se leyo el
// codigo (200 = primera pasada; 300 = hizo falta releer), giro, medidas y hash.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { procesarEscaneo } from "../worker/procesar.mjs";

const args = process.argv.slice(2);
const valores = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const pdfs = valores("--pdf");
const [salida = join("salida", "diag")] = valores("--salida");
if (pdfs.length === 0) {
  console.error("Uso: node herramientas/analizar-escaneo.mjs --pdf escaneo.pdf [--pdf otro.pdf] [--salida carpeta]");
  process.exit(2);
}

for (const ruta of pdfs) {
  const r = await procesarEscaneo(await readFile(ruta));
  const dir = join(salida, basename(ruta).replace(/\.[^.]+$/, ""));
  await mkdir(dir, { recursive: true });
  console.log(`\n== ${basename(ruta)}: ${r.total_paginas} hoja(s), ${r.piezas.length} pieza(s), hash_archivo ${r.hash_archivo.slice(0, 12)}`);
  for (const p of r.piezas) {
    const que = p.estado === "identificado" ? p.numero_visible : `REVISAR ${p.motivo}`;
    const adentro = p.numeros?.length ? ` [adentro: ${p.numeros.join(", ")}]` : "";
    await writeFile(join(dir, `${p.ubicacion}_${p.estado === "identificado" ? p.numero_visible : p.motivo}.jpg`), Buffer.from(p.imagen_jpg_b64, "base64"));
    console.log(
      `  ${p.ubicacion.padStart(5)}  ${(que + adentro).padEnd(40)} dpi ${String(p.dpi_lectura ?? "-").padStart(3)}` +
        `  giro ${String(p.rotacion ?? "-").padStart(3)}  ${p.medidas_mm ? p.medidas_mm.join("x") + " mm" : "hoja"}  ${p.hash_sha256.slice(0, 12)}`
    );
  }
  console.log(`  recortes en ${dir}`);
}
