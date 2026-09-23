// Monedas invalidas ya avisadas. El aviso sirve una vez: formatMoney se llama por
// celda, y repetirlo en una tabla de 200 filas solo tapa la consola.
const warnedInvalidCurrencies = new Set<string>();

/**
 * Importe con simbolo de moneda. Si `currency` no es un codigo ISO 4217, Intl tira
 * RangeError y se cae a ARS: el hotel cobra en pesos, asi que mostrar de mas en
 * pesos es lo unico que no confunde a nadie. Antes el respaldo era USD, o sea que
 * un tipeo en la configuracion mostraba toda la caja en dolares SIN avisar. Ahora
 * avisa por consola una vez por moneda, para que se corrija la configuracion.
 */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    if (!warnedInvalidCurrencies.has(currency)) {
      warnedInvalidCurrencies.add(currency);
      console.warn(
        `formatMoney: "${currency}" no es un codigo de moneda valido (ISO 4217). Los importes se muestran en ARS. Revisa la moneda en la configuracion del hotel.`
      );
    }
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

const LOCAL_AMOUNT_FORMATTER = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${LOCAL_AMOUNT_FORMATTER.format(Math.abs(amount))}`;
}

/**
 * Igual que formatAmount pero sin el signo "$": para mostrar dentro de un <input>
 * editable, donde el "$" solo molesta (parseArMoney no lo entiende de vuelta al
 * parsear lo que el usuario dejó tipeado).
 */
export function formatAmountForInput(amount: number): string {
  return LOCAL_AMOUNT_FORMATTER.format(amount);
}

export function formatSignedAmount(amount: number | null): string {
  if (amount === null) return "---";

  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${formatAmount(Math.abs(amount))}`;
}

export function formatShiftCode(shiftNumber: number, minDigits = 6): string {
  return String(Math.trunc(shiftNumber)).padStart(minDigits, "0");
}

// Miles con punto bien agrupados: "43.700", "1.500.000". El primer grupo no
// arranca en 0 ("0.500" no es quinientos pesos escrito por nadie).
const AR_THOUSANDS = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
// Con coma decimal: entero liso o agrupado con puntos, y hasta 2 decimales. La
// coma sola al final ("1.500,") es lo que queda a medio tipear y vale como entero.
const AR_WITH_COMMA = /^([1-9]\d{0,2}(?:\.\d{3})+|\d+),(\d{0,2})$/;
// Punto decimal con 1 o 2 decimales ("1500.5", "1500.50"), o entero liso.
const PLAIN_DECIMAL = /^\d+(?:\.\d{0,2})?$/;

/**
 * Parsea un monto tipeado como se escribe en Argentina ("43.700", "1.500.000",
 * "1.500,50") o con punto decimal ("1500.50").
 *
 * - Con coma: la coma es decimal y los puntos son miles.
 * - Sin coma: un punto seguido de exactamente 3 dígitos, o varios puntos, son
 *   miles ("43.700" = 43700). No existen montos con 3 decimales, así que no hay
 *   ambigüedad. Un punto con 1 o 2 dígitos es decimal ("1500.5").
 *
 * Antes, sin coma el punto era siempre decimal: "43.700" daba 43,70 y
 * "1.500.000" no se entendía. Así se escribe en Argentina, y el arqueo a ciegas
 * no deja corregir el monto una vez enviado.
 *
 * Todo lo que no encaja devuelve null en vez de adivinar: miles mal agrupados
 * ("1.50.000", "1234.567"), más de 2 decimales, notación científica, negativos.
 * El campo muestra en vivo cómo se leyó (ParsedAmountHint), así que un null se
 * ve al tipear y no recién al enviar.
 */
export function parseArMoney(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let normalized: string;
  const withComma = AR_WITH_COMMA.exec(trimmed);
  if (withComma) {
    normalized = `${withComma[1].replace(/\./g, "")}.${withComma[2] || "0"}`;
  } else if (trimmed.includes(",")) {
    return null;
  } else if (AR_THOUSANDS.test(trimmed)) {
    normalized = trimmed.replace(/\./g, "");
  } else if (PLAIN_DECIMAL.test(trimmed)) {
    normalized = trimmed;
  } else {
    return null;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Converts a local date + time in a given IANA timezone to an ISO 8601 string
 * with the correct UTC offset (e.g. "2024-01-15T14:00:00-03:00").
 */
export function localToISO(dateStr: string, timeStr: string, timezone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);

  const approxDate = new Date(y, m - 1, d, h, min);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
    year: "numeric",
  });
  const parts = formatter.formatToParts(approxDate);
  const gmtPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
  const offset = gmtPart === "GMT" ? "+00:00" : gmtPart.replace("GMT", "");

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:00${offset}`;
}
