// Genera comprobantes de prueba imprimibles, con el diseño compacto del sistema.
//
//   Hoja de muestras (para elegir el tamaño del QR):
//     node generador/cli.mjs --muestras [--tamanos 14,16,18]
//       -> salida/muestras.html: dos tickets por tamaño de QR.
//
//   Lote de prueba:
//     node generador/cli.mjs --datos salida/datos.local.json [--qr-mm 16] [--desde 1] [--solo 7-20]
//       -> salida/comprobantes.html  (imprimir en la comandera desde Chrome)
//       -> salida/comprobantes.csv   (importar en la pestana "Comprobantes" de la Sheet)
//
//   --qr-mm cambia el lado del QR; por defecto, el del sistema (comun/ticket-compacto.mjs).
//   --solo imprime parte del lote ("7-20", "1,3,7-9") sin cambiar la numeracion.
//   El CSV sale siempre completo: es la pestana Comprobantes entera.
//   El encabezado (nombre y direccion del hotel) sale de los datos; en las muestras
//   tambien, si existe salida/datos.local.json, asi miden lo mismo que el ticket real.

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { formatearCodigo, numeroVisible } from "../comun/codigo.mjs";
import { QR_MM } from "../comun/ticket-compacto.mjs";
import { documento, htmlTicket } from "./ticket.mjs";
import { PREFIJO_PRUEBA, aCsv, armarManifiesto, parsearSeleccion, seleccionar } from "./manifiesto.mjs";

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : porDefecto;
};

const SALIDA = opcion("--salida", "salida");
const HOTEL_POR_DEFECTO = { nombre: "El Refugio", direccion: "", zona: "America/Argentina/Tucuman" };

await mkdir(SALIDA, { recursive: true });

if (args.includes("--muestras")) {
  const rutaHotel = opcion("--datos", join("salida", "datos.local.json"));
  const hotel = existsSync(rutaHotel)
    ? { ...HOTEL_POR_DEFECTO, ...JSON.parse(await readFile(rutaHotel, "utf8")).hotel }
    : HOTEL_POR_DEFECTO;
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
      secciones.push(await htmlTicket(c, hotel, { qrMm: lado, leyenda: `MUESTRA ${lado} mm` }));
      console.log(`  ${c.numero_visible}  ->  QR ${lado} mm`);
    }
  }
  const destino = join(SALIDA, "muestras.html");
  await writeFile(destino, documento("Muestras del ticket compacto", secciones));
  console.log(`\nMuestras en ${destino}. Imprimir de a uno en la comandera, escanear con la cartulina.`);
  process.exit(0);
}

const rutaDatos = opcion("--datos");
if (!rutaDatos) {
  console.error("Uso: node generador/cli.mjs --muestras [--tamanos 14,16,18] | --datos datos.json [--qr-mm 16] [--desde 1] [--solo 7-20]");
  process.exit(2);
}

const qrMm = Number(opcion("--qr-mm", String(QR_MM)));
if (!(qrMm >= 8 && qrMm <= 30)) {
  console.error(`--qr-mm fuera de rango: ${opcion("--qr-mm")}. Va en milimetros, de 8 a 30.`);
  process.exit(2);
}
const desde = Number(opcion("--desde", "1"));

const datos = JSON.parse(await readFile(rutaDatos, "utf8"));
const hotel = { ...HOTEL_POR_DEFECTO, ...datos.hotel };
const manifiesto = armarManifiesto(datos.movimientos, { zona: hotel.zona, desde });
const solo = opcion("--solo");
let aImprimir = manifiesto;
if (solo) {
  try {
    aImprimir = seleccionar(manifiesto, parsearSeleccion(solo));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

const secciones = [];
for (const c of aImprimir) secciones.push(await htmlTicket(c, hotel, { qrMm }));

await writeFile(join(SALIDA, "comprobantes.html"), documento("Comprobantes de prueba", secciones));
await writeFile(join(SALIDA, "comprobantes.csv"), aCsv(manifiesto));

const porCliente = Object.groupBy(manifiesto, (c) => `${c.carpeta_cliente} / ${c.periodo}`);
console.log(`\n${manifiesto.length} comprobantes (${manifiesto[0].numero} a ${manifiesto.at(-1).numero}), QR de ${qrMm} mm\n`);
for (const [k, v] of Object.entries(porCliente)) console.log(`  ${String(v.length).padStart(3)}  ${k}`);
if (solo) console.log(`\n  Para imprimir: ${aImprimir.length} (${aImprimir.map((c) => c.numero).join(", ")})`);
console.log(`\n  ${join(SALIDA, "comprobantes.html")}  -> imprimir`);
console.log(`  ${join(SALIDA, "comprobantes.csv")}   -> importar en la Sheet, pestana "Comprobantes"\n`);
