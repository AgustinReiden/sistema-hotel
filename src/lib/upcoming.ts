import { hotelDateKey } from "@/lib/time";
import type { ReservationStatus, UserRole } from "@/lib/types";

export type GuestsView = "directorio" | "historial" | "por_llegar";

/**
 * Qué vista de /admin/guests le toca a este rol. Recepción solo ve Por llegar (en solo
 * lectura): el Historial deja cancelar estadías cerradas y el Directorio es del dueño, así
 * que pida lo que pida cae en Por llegar, y `redirect` dice si hay que mandarla a la URL
 * con `?view=por_llegar`. El dueño conserva la vista pedida, con el Directorio por defecto.
 */
export function resolveGuestsView(
  view: string | undefined,
  role: UserRole
): { view: GuestsView; redirect: boolean } {
  if (role === "receptionist") {
    return { view: "por_llegar", redirect: view !== "por_llegar" };
  }
  if (view === "historial" || view === "por_llegar") return { view, redirect: false };
  return { view: "directorio", redirect: false };
}

export type UpcomingStatus = "solicitud" | "confirmada" | "atrasada";

/**
 * El estado que se muestra en cada fila de Por llegar. Una solicitud web sin confirmar
 * (`pending`) es "solicitud"; una confirmada cuya entrada es anterior a hoy, en hora del
 * hotel, es "atrasada" (no vino); el resto, "confirmada". `todayKey` es "YYYY-MM-DD".
 */
export function upcomingStatus(
  guest: { status: ReservationStatus; check_in_target: string },
  todayKey: string,
  timezone: string
): UpcomingStatus {
  if (guest.status === "pending") return "solicitud";
  return hotelDateKey(guest.check_in_target, timezone) < todayKey ? "atrasada" : "confirmada";
}
