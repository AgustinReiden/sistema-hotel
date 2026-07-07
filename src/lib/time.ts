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

// Fecha con día de semana en la zona del hotel, tipo "lunes, 06 jul". Se arma con
// formatToParts para controlar el separador y quitar el punto del mes abreviado.
export function formatHotelWeekdayDate(
  iso: string | null | undefined,
  timezone?: string
): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    timeZone: timezone || DEFAULT_TZ,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const month = get("month").replace(".", "");
  return `${get("weekday")}, ${get("day")} ${month}`;
}

// Fecha local del hotel como clave comparable "YYYY-MM-DD". Sirve para comparar
// "qué día es hoy" contra la fecha de salida sin que la hora ni la zona del
// navegador/servidor lo corran de día.
export function hotelDateKey(iso: string | number | Date, timezone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone || DEFAULT_TZ,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Cantidad de noches calendario (zona del hotel) entre dos instantes. Puede ser
// negativa si `toIso` es anterior a `fromIso`; el llamador aplica el mínimo.
export function countHotelNights(
  fromIso: string | number | Date,
  toIso: string | number | Date,
  timezone?: string
): number {
  const [fy, fm, fd] = hotelDateKey(fromIso, timezone).split("-").map(Number);
  const [ty, tm, td] = hotelDateKey(toIso, timezone).split("-").map(Number);
  // Se comparan las fechas como medianoche UTC para no arrastrar horas ni DST.
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / (1000 * 60 * 60 * 24));
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
