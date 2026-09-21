// Manifiesto de comprobantes de prueba: la tabla "numero -> cliente, periodo"
// que en esta etapa reemplaza a la base de datos. Se importa a la pestana
// "Comprobantes" de la Google Sheet y n8n la consulta para saber donde archivar.

import { formatearCodigo, numeroVisible } from "../comun/codigo.mjs";

export const PREFIJO_PRUEBA = "T";

export const COLUMNAS = [
  "numero", "codigo", "movimiento_id", "cliente", "carpeta_cliente", "documento",
  "habitacion", "check_in", "check_out", "created_at", "periodo", "monto", "verdad_firmado",
];

/** "AAAA-MM" del momento del cargo, en la zona del hotel. */
export function periodo(iso, zona) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit" })
    .formatToParts(new Date(iso));
  const y = partes.find((p) => p.type === "year").value;
  const m = partes.find((p) => p.type === "month").value;
  return `${y}-${m}`;
}

/**
 * Nombre de carpeta del cliente. Se arma con el NOMBRE DE LA CUENTA, no con el
 * CUIT: dos cuentas pueden compartir CUIT (ACME SA - PERFUMERIA y
 * ACME SA - DROGUERIA) y sus remitos van por separado.
 */
export function carpetaCliente(nombre) {
  return String(nombre)
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]+/g, "-") // caracteres que rompen rutas
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") || "SIN NOMBRE";
}

/**
 * Asigna numeros T-000001... en orden cronologico.
 * @param {object[]} movimientos filas de datos.local.json
 * @param {{ zona: string, desde?: number }} opciones
 */
export function armarManifiesto(movimientos, { zona, desde = 1 }) {
  const ordenados = [...movimientos].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const vistos = new Set();
  return ordenados.map((m, i) => {
    if (vistos.has(m.movimiento_id)) throw new Error(`Movimiento repetido: ${m.movimiento_id}`);
    vistos.add(m.movimiento_id);
    const numero = desde + i;
    return {
      numero: numeroVisible(PREFIJO_PRUEBA, numero),
      codigo: formatearCodigo(PREFIJO_PRUEBA, numero),
      movimiento_id: m.movimiento_id,
      cliente: m.cliente,
      carpeta_cliente: carpetaCliente(m.cliente),
      documento: m.documento ?? "",
      habitacion: m.habitacion ?? "",
      check_in: m.check_in ?? "",
      check_out: m.check_out ?? "",
      created_at: m.created_at,
      periodo: periodo(m.created_at, zona),
      monto: m.monto,
      verdad_firmado: "",
      // Solo para imprimir, no va al CSV.
      numero_visible: numeroVisible(PREFIJO_PRUEBA, numero),
    };
  });
}

function celdaCsv(v) {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function aCsv(filas) {
  const lineas = [COLUMNAS.join(",")];
  for (const f of filas) lineas.push(COLUMNAS.map((c) => celdaCsv(f[c])).join(","));
  return lineas.join("\n") + "\n";
}
