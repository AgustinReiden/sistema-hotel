export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "USD",
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
 * Parsea un monto tipeado en formato argentino ("1.500,00") o con punto
 * decimal simple ("1500.50", lo que devuelve un <input type="number">). La
 * coma decide el formato: si hay coma, los puntos son separadores de miles y
 * se descartan; si no hay coma, el punto es decimal y se deja como está.
 * `parseFloat(x.replace(",", "."))` sobre "1.500,00" da 1.5 (mal) porque dos
 * puntos hacen que parseFloat corte ahí. Devuelve null si no es un número
 * válido o es negativo.
 */
export function parseArMoney(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
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
