import { isPendingArrival } from "./arrivals";
import { hotelDateKey } from "./time";
import type { Reservation } from "./types";

// Lógica pura de la grilla del calendario (habitación × día): dónde cae cada reserva y
// de qué color se pinta. Vive acá y no dentro del componente para poder testearla: es
// donde se esconden los corrimientos de un día y los errores de clasificación.

/**
 * Categoría visual de una reserva en la grilla.
 *  - finished: la estadía ya terminó. Es el pasado: se dibuja en gris y quieto.
 *  - active:   el pasajero está adentro.
 *  - overdue:  el día de entrada ya pasó, la estadía sigue corriendo y falta el check-in.
 *  - next:     la próxima llegada de esa habitación.
 *  - future:   el resto de las que vienen después.
 *  - pending:  reserva sin confirmar.
 */
export type ReservationCategory =
  | "finished"
  | "active"
  | "next"
  | "future"
  | "pending"
  | "overdue";

export type ReservationPlacement = {
  reservation: Reservation;
  visibleStartIndex: number;
  cellSpan: number;
  startsBeforeRange: boolean;
  endsAfterRange: boolean;
};

/** Días enteros entre dos claves "YYYY-MM-DD". Inmune a la zona horaria y al DST. */
function diffDaysKeys(aKey: string, bKey: string): number {
  const [ay, am, ad] = aKey.split("-").map(Number);
  const [by, bm, bd] = bKey.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/**
 * Ubica una reserva en la ventana visible: en qué columna arranca, cuántas ocupa y si se
 * sale por alguno de los dos bordes (eso define si la barra se dibuja con la punta en
 * diagonal o cortada al ras). Devuelve null si la reserva cae fuera de la ventana.
 */
export function buildReservationPlacement(
  reservation: Reservation,
  startKey: string,
  daysCount: number,
  timezone: string
): ReservationPlacement | null {
  const checkInIndex = diffDaysKeys(hotelDateKey(reservation.check_in_target, timezone), startKey);
  const checkoutIndex = diffDaysKeys(hotelDateKey(reservation.check_out_target, timezone), startKey);

  if (checkoutIndex < 0 || checkInIndex >= daysCount) return null;

  const visibleStartIndex = Math.max(0, checkInIndex);
  const visibleEndIndex = Math.min(daysCount - 1, checkoutIndex);

  if (visibleStartIndex > visibleEndIndex) return null;

  const startsBeforeRange = checkInIndex < 0;
  const endsAfterRange = checkoutIndex >= daysCount;

  const cellSpan = visibleEndIndex - visibleStartIndex + 1;

  return {
    reservation,
    visibleStartIndex,
    cellSpan,
    startsBeforeRange,
    endsAfterRange,
  };
}

/**
 * ¿Esta estadía ya terminó? El orden de los casos importa:
 *  - `checked_in` gana SIEMPRE, aunque la salida prevista ya haya pasado: el pasajero
 *    sigue físicamente en la habitación (medio día pendiente) y tiene que verse verde.
 *  - `checked_out` es el caso normal: recepción cerró la estadía.
 *  - El resto con la salida vencida son reservas que nunca se usaron (el no-show viejo
 *    que queda colgado en `confirmed`). No son accionables — `isPendingArrival` ya deja
 *    de ofrecerlas — así que también son pasado. Antes no se notaba porque las ventanas
 *    pasadas venían vacías; ahora que se navega el histórico, aparecerían en rojo o en
 *    amarillo como si alguien todavía pudiera hacer algo con ellas.
 */
export function isFinishedStay(
  reservation: Pick<Reservation, "status" | "check_out_target">,
  nowIso: string
): boolean {
  if (reservation.status === "checked_in") return false;
  if (reservation.status === "checked_out") return true;
  return new Date(reservation.check_out_target).getTime() <= new Date(nowIso).getTime();
}

/**
 * Texto que va adentro de la barra de una estadía pasada. Se distingue la que ocurrió de
 * la que nadie usó: pintarlas iguales y llamarlas a las dos "Finalizada" sería mentir
 * sobre quién durmió en esa habitación.
 */
export function finishedStayLabel(reservation: Pick<Reservation, "status">): string {
  return reservation.status === "checked_out" ? "Finalizada" : "No se presentó";
}

/**
 * Clasifica las reservas de UNA habitación. El orden importa: "la próxima llegada" es una
 * sola por habitación, así que se recorre por fecha de entrada ascendente y el primer
 * candidato se queda con el amarillo.
 *
 * Las pasadas se resuelven antes que nada y NO consumen ese cupo: son historia, no la
 * próxima llegada. Sin esa guarda, al traer el pasado a la grilla la estadía más vieja de
 * la habitación se pintaría de amarillo como si el pasajero estuviera por llegar.
 */
export function classifyReservations(
  roomReservations: Reservation[],
  nowIso: string,
  timezone: string
): Map<string, ReservationCategory> {
  const ordered = [...roomReservations].sort(
    (left, right) =>
      new Date(left.check_in_target).getTime() - new Date(right.check_in_target).getTime()
  );
  const todayKey = hotelDateKey(nowIso, timezone);
  const categories = new Map<string, ReservationCategory>();
  let foundNext = false;

  for (const reservation of ordered) {
    if (isFinishedStay(reservation, nowIso)) {
      categories.set(reservation.id, "finished");
      continue;
    }
    if (reservation.status === "pending") {
      categories.set(reservation.id, "pending");
      continue;
    }
    if (reservation.status === "checked_in") {
      categories.set(reservation.id, "active");
      continue;
    }
    if (isPendingArrival(reservation, nowIso, timezone) && !foundNext) {
      // El día de entrada ya pasó y sigue sin check-in: se marca en rojo para que
      // recepción la vea de lejos y la registre.
      const isOverdue = hotelDateKey(reservation.check_in_target, timezone) < todayKey;
      categories.set(reservation.id, isOverdue ? "overdue" : "next");
      foundNext = true;
      continue;
    }
    if (!foundNext) {
      categories.set(reservation.id, "next");
      foundNext = true;
    } else {
      categories.set(reservation.id, "future");
    }
  }

  return categories;
}
