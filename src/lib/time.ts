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
