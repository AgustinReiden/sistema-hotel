// Aritmética y formatos puros del dominio ARCA. Sin red, sin `server-only`:
// todo testeable con vitest.

/**
 * Desglose de un precio final CON IVA incluido (hospedaje): neto redondeado a
 * 2 decimales y el IVA absorbe la diferencia, así neto + iva == total exacto
 * (ARCA valida la suma y la tabla invoices tiene el mismo CHECK).
 */
export function computeAmounts(
  total: number,
  ivaPct: number
): { neto: number; iva: number } {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const totalR = round2(total);
  const neto = round2(totalR / (1 + ivaPct / 100));
  const iva = round2(totalR - neto);
  return { neto, iva };
}

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
  return {
    error:
      "El DNI de la reserva no es válido para facturar (necesita 7 u 8 dígitos). Corregilo en la reserva y reintentá.",
  };
}

/** "00003-00001234" — presentación estándar PV-número. */
export function formatCbteNumero(ptoVta: number, cbteNro: number): string {
  return `${String(ptoVta).padStart(5, "0")}-${String(cbteNro).padStart(8, "0")}`;
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
