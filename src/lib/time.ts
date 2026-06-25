// Helpers para formatear tiempos en la timezone del hotel (por default Tucumán).
// Evitan que `toLocaleString` use la zona del navegador o del servidor.

const DEFAULT_TZ = "America/Argentina/Tucuman";

export function formatHotelTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone || DEFAULT_TZ,
  });
}

export function formatHotelDateTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone || DEFAULT_TZ,
  });
}

export function formatHotelDate(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone || DEFAULT_TZ,
  });
}

// Formato corto tipo "25 jun 13:00" en la zona del hotel. Se arma con formatToParts
// para evitar comas/puntos que mete el locale y para forzar 24 hs.
export function formatHotelShortDateTime(
  iso: string | null | undefined,
  timezone?: string
): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone || DEFAULT_TZ,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const month = get("month").replace(".", "");
  return `${get("day")} ${month} ${get("hour")}:${get("minute")}`;
}

// Fecha corta tipo "25 jun 26" en la zona del hotel.
export function formatHotelShortDate(
  iso: string | null | undefined,
  timezone?: string
): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: timezone || DEFAULT_TZ,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month").replace(".", "")} ${get("year")}`;
}
