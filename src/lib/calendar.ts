import { isSameDay, startOfDay } from "date-fns";

import type { Reservation } from "./types";

export type CalendarCellState = {
  stayReservation: Reservation | null;
  checkoutReservation: Reservation | null;
};

export function getCalendarCellState(
  reservations: Reservation[],
  roomId: number,
  day: Date
): CalendarCellState {
  const currentDay = startOfDay(day);

  let stayReservation: Reservation | null = null;
  let checkoutReservation: Reservation | null = null;

  for (const reservation of reservations) {
    if (reservation.room_id !== roomId) continue;

    const checkIn = startOfDay(new Date(reservation.check_in_target));
    const checkOut = startOfDay(new Date(reservation.check_out_target));

    if (currentDay >= checkIn && currentDay < checkOut) {
      stayReservation = reservation;
    }

    if (isSameDay(currentDay, checkOut)) {
      checkoutReservation = reservation;
    }
  }

  return { stayReservation, checkoutReservation };
}
