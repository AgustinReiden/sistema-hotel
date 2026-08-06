import { hotelDateKey } from "./time";

// Llegadas pendientes: reservas confirmadas cuyo día de entrada ya llegó y que
// todavía no tienen el check-in hecho.
//
// Antes la recepción sólo veía la reserva el día exacto de la llegada: si el
// pasajero entraba de noche y el check-in quedaba para el otro día, la reserva
// desaparecía del dashboard y la habitación figuraba libre (se le podía asignar
// a cualquiera). La ventana ahora se mantiene abierta mientras la estadía siga
// corriendo, y se corta cuando la reserva vence: así los no-show viejos no
// reviven para siempre.

export type ArrivalCandidate = {
  status: string;
  check_in_target: string;
  check_out_target: string;
};

export type PendingArrival<T> = {
  reservation: T;
  /** Clave "YYYY-MM-DD" del día de entrada reservado, en la zona del hotel. */
  arrivalDateKey: string;
  /** La entrada era de un día anterior: el check-in quedó atrasado. */
  isOverdue: boolean;
};

/** ¿Esta reserva está esperando el check-in en este momento? */
export function isPendingArrival(
  reservation: ArrivalCandidate,
  now: Date | string | number,
  timezone: string
): boolean {
  if (reservation.status !== "confirmed") return false;

  const nowMs = new Date(now).getTime();
  // La estadía ya terminó (no-show): la reserva no vuelve a ofrecerse nunca más.
  if (new Date(reservation.check_out_target).getTime() <= nowMs) return false;

  // El día de entrada ya llegó. Se compara por día del hotel y no por instante
  // para que una entrada temprana (antes del horario estándar) también cuente.
  return hotelDateKey(reservation.check_in_target, timezone) <= hotelDateKey(now, timezone);
}

/**
 * La llegada pendiente de una habitación, o null si no hay ninguna. Si hay más
 * de una candidata gana la de entrada más reciente: el pasajero que está en el
 * mostrador es el de hoy, no el que nunca apareció.
 */
export function findPendingArrival<T extends ArrivalCandidate>(
  reservations: T[],
  now: Date | string | number,
  timezone: string
): PendingArrival<T> | null {
  const todayKey = hotelDateKey(now, timezone);

  let best: PendingArrival<T> | null = null;
  for (const reservation of reservations) {
    if (!isPendingArrival(reservation, now, timezone)) continue;

    const arrivalDateKey = hotelDateKey(reservation.check_in_target, timezone);
    if (best && arrivalDateKey < best.arrivalDateKey) continue;

    best = {
      reservation,
      arrivalDateKey,
      isOverdue: arrivalDateKey < todayKey,
    };
  }

  return best;
}
