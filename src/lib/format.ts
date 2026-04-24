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
