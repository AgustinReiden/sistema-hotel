import { addDaysToDateKey, hotelDateKey, hotelTimeKey } from "./time";

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
 * La llegada pendiente de una habitación, o null si no hay ninguna.
 *
 * Dos candidatas a la vez sólo pueden ser una detrás de la otra (la base no deja
 * superponer reservas activas en la misma pieza), y eso pasa únicamente de madrugada:
 * entre las 00:00 y la hora de salida conviven la reserva de ANOCHE, que sigue
 * corriendo, y la de la tarde, que ya "entra hoy". Gana la que ya empezó: a las 00:30
 * el que está en el mostrador es el pasajero de anoche.
 *
 * Antes ganaba la de entrada más reciente. Pasó en la hab. 6 el 21/09: el pasajero de
 * JUFEC llegó a las 00:30, la tarjeta mostraba la reserva que entraba ese día a las
 * 14:00 y la suya no aparecía por ningún lado, así que no se le pudo hacer el
 * check-in. A partir de la hora de salida la de anoche vence y queda sola la de hoy.
 */
export function findPendingArrival<T extends ArrivalCandidate>(
  reservations: T[],
  now: Date | string | number,
  timezone: string
): PendingArrival<T> | null {
  const todayKey = hotelDateKey(now, timezone);
  const nowMs = new Date(now).getTime();
  const hasStarted = (reservation: ArrivalCandidate) =>
    new Date(reservation.check_in_target).getTime() <= nowMs;

  let best: PendingArrival<T> | null = null;
  for (const reservation of reservations) {
    if (!isPendingArrival(reservation, now, timezone)) continue;

    const arrivalDateKey = hotelDateKey(reservation.check_in_target, timezone);
    if (best) {
      const started = hasStarted(reservation);
      const bestStarted = hasStarted(best.reservation);
      if (bestStarted && !started) continue;
      if (started === bestStarted && arrivalDateKey < best.arrivalDateKey) continue;
    }

    best = {
      reservation,
      arrivalDateKey,
      isOverdue: arrivalDateKey < todayKey,
    };
  }

  return best;
}

/**
 * ¿Es de madrugada para el hotel? Entre las 00:00 y la hora de salida estándar la
 * noche de ayer todavía no terminó: el pasajero que entra ahora suele irse esa misma
 * mañana. El walk-in lo usa para preguntar qué noche se está vendiendo; la base lo
 * vuelve a validar con su propio reloj (mig 115).
 */
export function isEarlyMorning(
  now: Date | string | number,
  standardCheckOutTime: string,
  timezone: string
): boolean {
  return hotelTimeKey(now, timezone) < standardCheckOutTime.slice(0, 5);
}

/**
 * Desde qué día se cobra una pieza que limpieza encontró ocupada sin estadía cargada.
 *
 * ES EL DÍA ANTERIOR A LA DETECCIÓN, no el de la detección. Las mucamas recorren las
 * piezas a la mañana (en PROD las marcas caen cerca de las 11), así que lo que
 * encuentran es el rastro de LA NOCHE ANTERIOR. Cargarlo con la fecha de hoy correría
 * la salida a mañana y el sistema creería que el pasajero sigue adentro, justo cuando
 * la pieza ya está libre.
 *
 * Con el día anterior, una noche da salida hoy a la hora de check-out estándar: la
 * estadía queda vencida y pide el check-out, que es lo que efectivamente hay que hacer.
 */
export function occupancyCheckInDateKey(detectedAt: string, timezone: string): string {
  return addDaysToDateKey(hotelDateKey(detectedAt, timezone), -1);
}
