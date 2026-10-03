// Aritmética y formatos puros del dominio ARCA. Sin red, sin `server-only`:
// todo testeable con vitest.

// El desglose de neto e IVA NO vive acá: lo calcula el SQL al crear la factura
// (mig 79/80/81, "Redondeo SOBRE EL TOTAL"), y el CHECK invoices_amounts_add_up
// garantiza neto + iva = total. Había una copia en TypeScript sin llamadores; se
// borró para que no exista una segunda fórmula que pueda separarse de la real.
// Si algún día hace falta un preview en el cliente, va con un test que lo compare
// contra el round() de Postgres.

/**
 * Fecha ARCA `yyyymmdd` de un instante ISO en la zona del hotel.
 * Mismo truco Intl `en-CA` (yyyy-mm-dd) que hotelDateKey en src/lib/time.ts.
 */
export function arcaDateFromIso(iso: string, tz: string): string {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return key.replaceAll("-", "");
}

/** "2026-07-16" (date de Postgres) → "20260716". */
export function arcaDateFromDateKey(dateKey: string): string {
  return dateKey.replaceAll("-", "");
}

/** "20260716" → "16/07/2026" para mostrar. */
export function formatArcaDate(yyyymmdd: string | null | undefined): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "—";
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}

/**
 * El DNI de la Factura B no sirve. Dice qué tiene que tener y no a dónde ir: el
 * texto viejo mandaba a "corregirlo en la reserva", y con la estadía cerrada
 * recepción no tiene dónde. Ahora se corrige ahí mismo, con "Corregir DNI".
 */
export const DNI_INVALIDO_MSG =
  "El DNI no sirve para facturar: tiene que tener 7 u 8 dígitos (sin puntos).";

/**
 * El texto con que las RPC de la base rechazan el DNI de la reserva (P0022, migs
 * 72 a 112). Sigue en PROD y queda guardado en `last_error`: se traduce en la
 * pantalla, porque reescribir funciones de PROD por un texto no vale la pena.
 *
 * Es a propósito "DNI DE LA RESERVA" y no cualquier "DNI": la consolidada también
 * tira P0022 por el documento ("DNI del huésped/receptor … Corregilo en la ficha"),
 * y ese mensaje queda como viene porque ahí no hay "Corregir DNI".
 */
const DNI_RESERVA_RPC = /DNI de la reserva no es v[aá]lido/i;

/**
 * ¿El error es el del DNI de la reserva? Reconoce el texto crudo de la base y el
 * ya traducido (`DNI_INVALIDO_MSG`). No mira el código: quien lo llama con un
 * error de Postgres chequea antes que sea P0022.
 */
export function esErrorDniReserva(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.includes(DNI_INVALIDO_MSG) || DNI_RESERVA_RPC.test(message);
}

/**
 * `last_error` de una factura, para mostrar en Facturación › Con error. El error
 * del DNI de la reserva cambia por el texto nuevo y el botón que lo arregla; el
 * resto (rechazos de ARCA, red, CUIT, consolidada) pasa tal cual.
 */
export function humanizarErrorFiscal(raw: string | null): string | null {
  if (raw === null) return null;
  if (esErrorDniReserva(raw)) return `${DNI_INVALIDO_MSG} Usá «Corregir DNI».`;
  return raw;
}

/**
 * Valida el documento del receptor para Factura B a consumidor final.
 * Regla v1: DNI de 7 u 8 dígitos → DocTipo 96. Sin fallback a "sin identificar"
 * (doc 99): el hotel siempre registra DNI, y así cumplimos RG 5615 por diseño.
 */
export function parseDniForArca(
  raw: string | null | undefined
): { docTipo: 96; docNro: string } | { error: string } {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 7 || digits.length === 8) {
    return { docTipo: 96, docNro: digits };
  }
  if (digits.length === 11) {
    return {
      error:
        "El documento de la reserva parece un CUIT. La Factura A a empresas la emite la oficina; para Factura B corregí el DNI del huésped (7 u 8 dígitos).",
    };
  }
  return { error: DNI_INVALIDO_MSG };
}

/** "00003-00001234" — presentación estándar PV-número. */
export function formatCbteNumero(ptoVta: number, cbteNro: number): string {
  return `${String(ptoVta).padStart(5, "0")}-${String(cbteNro).padStart(8, "0")}`;
}

/** true para notas de crédito: 3 = NC A, 8 = NC B. */
export function isNotaCredito(cbteTipo: number): boolean {
  return cbteTipo === 3 || cbteTipo === 8;
}

/** Letra del comprobante. A: Factura A (1) y NC A (3). B: Factura B (6) y NC B (8). */
export function cbteLetra(cbteTipo: number): "A" | "B" {
  return cbteTipo === 1 || cbteTipo === 3 ? "A" : "B";
}

/** "Factura" | "Nota de crédito", para toasts y títulos. */
export function cbteNombre(cbteTipo: number): string {
  return isNotaCredito(cbteTipo) ? "Nota de crédito" : "Factura";
}

/** CUIT con guiones para el impreso: 30123456789 → 30-12345678-9. */
export function formatCuit(cuit: string | null | undefined): string {
  const d = (cuit ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cuit ?? "—";
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/**
 * Dígito verificador de CUIT (módulo 11). Para el schema de config fiscal:
 * evita cargar un CUIT con tipeo errado y descubrirlo recién contra ARCA.
 */
export function isValidCuit(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(d[10]);
}
