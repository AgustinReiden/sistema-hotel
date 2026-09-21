// Genera comprobantes de prueba imprimibles.
//
//   Prueba de humo (antes que nada):
//     node generador/cli.mjs --muestras
//       -> salida/muestras.html: el mismo ticket con QR 15mm, QR 25mm y Code128.
//
//   Lote de prueba:
//     node generador/cli.mjs --datos salida/datos.local.json [--formato qr-grande] [--desde 1]
//       -> salida/comprobantes.html  (imprimir en la comandera desde Chrome)
//       -> salida/comprobantes.csv   (importar en la pestana "Comprobantes" de la Sheet)
//
//   --formato acepta uno o varios separados por coma: qr-chico, qr-grande, code128.
//   Se elige con el resultado de la prueba de humo.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { formatearCodigo, numeroVisible } from "../comun/codigo.mjs";
import { FORMATOS, documento, htmlMuestra, htmlTicket } from "./ticket.mjs";
import { PREFIJO_PRUEBA, aCsv, armarManifiesto } from "./manifiesto.mjs";

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : porDefecto;
};

const SALIDA = opcion("--salida", "salida");
const HOTEL_POR_DEFECTO = { nombre: "El Refugio", direccion: "", zona: "America/Argentina/Tucuman" };

await mkdir(SALIDA, { recursive: true });

if (args.includes("--muestras")) {
  // Numeros 900+ reservados para muestras: no chocan con el lote (que arranca en 1).
  const secciones = [];
  let n = 901;
  for (const formato of Object.keys(FORMATOS)) {
    const c = { codigo: formatearCodigo(PREFIJO_PRUEBA, n), numero_visible: numeroVisible(PREFIJO_PRUEBA, n) };
    secciones.push(await htmlMuestra(c, HOTEL_POR_DEFECTO, formato));
    console.log(`  ${c.numero_visible}  ->  ${FORMATOS[formato].etiqueta}`);
    n++;
  }
  const destino = join(SALIDA, "muestras.html");
  await writeFile(destino, documento("Muestras de codigo", secciones));
  console.log(`\nMuestras en ${destino}. Imprimir desde Chrome en la comandera.`);
  process.exit(0);
}

const rutaDatos = opcion("--datos");
if (!rutaDatos) {
  console.error("Uso: node generador/cli.mjs --muestras | --datos datos.json [--formato qr-grande] [--desde 1]");
  process.exit(2);
}

const formatos = opcion("--formato", "qr-grande").split(",").map((s) => s.trim());
for (const f of formatos) {
  if (!FORMATOS[f]) {
    console.error(`Formato desconocido: ${f}. Validos: ${Object.keys(FORMATOS).join(", ")}`);
    process.exit(2);
  }
}
const desde = Number(opcion("--desde", "1"));

const datos = JSON.parse(await readFile(rutaDatos, "utf8"));
const hotel = { ...HOTEL_POR_DEFECTO, ...datos.hotel };
const manifiesto = armarManifiesto(datos.movimientos, { zona: hotel.zona, desde });

const secciones = [];
for (const c of manifiesto) secciones.push(await htmlTicket(c, hotel, formatos));

await writeFile(join(SALIDA, "comprobantes.html"), documento("Comprobantes de prueba", secciones));
await writeFile(join(SALIDA, "comprobantes.csv"), aCsv(manifiesto));

const porCliente = Object.groupBy(manifiesto, (c) => `${c.carpeta_cliente} / ${c.periodo}`);
console.log(`\n${manifiesto.length} comprobantes (${manifiesto[0].numero} a ${manifiesto.at(-1).numero}), formato ${formatos.join(" + ")}\n`);
for (const [k, v] of Object.entries(porCliente)) console.log(`  ${String(v.length).padStart(3)}  ${k}`);
console.log(`\n  ${join(SALIDA, "comprobantes.html")}  -> imprimir`);
console.log(`  ${join(SALIDA, "comprobantes.csv")}   -> importar en la Sheet, pestana "Comprobantes"\n`);
