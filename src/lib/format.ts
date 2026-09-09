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

export function formatSignedAmount(amount: number | null): string {
  if (amount === null) return "---";

  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${formatAmount(Math.abs(amount))}`;
}

export function formatShiftCode(shiftNumber: number, minDigits = 6): string {
  return String(Math.trunc(shiftNumber)).padStart(minDigits, "0");
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
