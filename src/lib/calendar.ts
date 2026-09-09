import { hotelDateKey } from "./time";
import type { Reservation } from "./types";

export type CalendarCellState = {
  stayReservation: Reservation | null;
  checkoutReservation: Reservation | null;
};

/**
 * `day` se compara por su clave "YYYY-MM-DD" en la zona del HOTEL, no la del
 * servidor/navegador: una reserva que entra a las 22:00 hora hotel ya es el dia
 * siguiente en UTC, y startOfDay/isSameDay (date-fns) comparaban con el reloj
 * local del proceso en vez de con el dia real del hotel.
 */
export function getCalendarCellState(
  reservations: Reservation[],
  roomId: number,
  day: Date,
  timezone?: string
): CalendarCellState {
  const currentDayKey = hotelDateKey(day, timezone);

  let stayReservation: Reservation | null = null;
  let checkoutReservation: Reservation | null = null;

  for (const reservation of reservations) {
    if (reservation.room_id !== roomId) continue;

    const checkInKey = hotelDateKey(reservation.check_in_target, timezone);
    const checkOutKey = hotelDateKey(reservation.check_out_target, timezone);

    if (currentDayKey >= checkInKey && currentDayKey < checkOutKey) {
      stayReservation = reservation;
    }

    if (currentDayKey === checkOutKey) {
      checkoutReservation = reservation;
    }
  }

  return { stayReservation, checkoutReservation };
}
