// Manifiesto de comprobantes de prueba (T-): la numeracion y los datos de cada
// ticket que imprime el generador. Sirven para probar el worker sin n8n: los
// remitos reales (R-) salen del sistema y n8n los busca en la base (mig 116). Un
// T- escaneado con la ingesta va a _Revisar como codigo_inexistente.

import { formatearCodigo, numeroVisible } from "../comun/codigo.mjs";

export const PREFIJO_PRUEBA = "T";

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
      // Solo para imprimir, no van al CSV.
      numero_visible: numeroVisible(PREFIJO_PRUEBA, numero),
      nro: numero,
    };
  });
}

/**
 * "7-20" o "1,3,7-9" -> los numeros pedidos, en orden. Sirve para imprimir parte
 * de un lote: la numeracion sale del orden de TODO el lote y no cambia.
 */
export function parsearSeleccion(texto) {
  const numeros = new Set();
  for (const parte of String(texto ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte);
    if (!m) throw new Error(`Seleccion invalida: "${parte}". Ejemplos: "7-20", "1,3,7-9".`);
    const desde = Number(m[1]);
    const hasta = m[2] === undefined ? desde : Number(m[2]);
    if (hasta < desde) throw new Error(`Rango al reves: "${parte}".`);
    for (let n = desde; n <= hasta; n++) numeros.add(n);
  }
  if (numeros.size === 0) throw new Error("Seleccion vacia.");
  return [...numeros].sort((a, b) => a - b);
}

/** Las filas del manifiesto con esos numeros. Pedir uno que no existe es un error, no un faltante mudo. */
export function seleccionar(manifiesto, numeros) {
  const porNro = new Map(manifiesto.map((c) => [c.nro, c]));
  const faltan = numeros.filter((n) => !porNro.has(n));
  if (faltan.length) {
    throw new Error(`No existen en el lote: ${faltan.map((n) => numeroVisible(PREFIJO_PRUEBA, n)).join(", ")}.`);
  }
  return numeros.map((n) => porNro.get(n));
}
