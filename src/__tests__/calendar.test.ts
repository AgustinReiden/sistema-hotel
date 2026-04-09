import { describe, expect, it } from "vitest";

import { getCalendarCellState } from "@/lib/calendar";
import type { Reservation } from "@/lib/types";

function makeReservation(overrides: Partial<Reservation> & { id: string; room_id: number }): Reservation {
  return {
    id: overrides.id,
    room_id: overrides.room_id,
    associated_client_id: overrides.associated_client_id ?? null,
    client_name: overrides.client_name ?? "Test Guest",
    client_phone: overrides.client_phone ?? null,
    client_dni: overrides.client_dni ?? null,
    check_in_target: overrides.check_in_target ?? "2026-04-07T14:00:00-03:00",
    check_out_target: overrides.check_out_target ?? "2026-04-08T10:00:00-03:00",
    status: overrides.status ?? "confirmed",
    actual_check_in: overrides.actual_check_in ?? null,
    actual_check_out: overrides.actual_check_out ?? null,
    base_total_price: overrides.base_total_price ?? 10000,
    discount_percent: overrides.discount_percent ?? 0,
    discount_amount: overrides.discount_amount ?? 0,
    total_price: overrides.total_price ?? 10000,
    paid_amount: overrides.paid_amount ?? 0,
    whatsapp_notified: overrides.whatsapp_notified ?? false,
  };
}

describe("getCalendarCellState", () => {
  it("marks stay on the night cell and checkout on the departure day", () => {
    const reservation = makeReservation({
      id: "res-1",
      room_id: 1,
      check_in_target: "2026-04-07T14:00:00-03:00",
      check_out_target: "2026-04-08T10:00:00-03:00",
    });

    const checkInDay = getCalendarCellState([reservation], 1, new Date("2026-04-07T12:00:00-03:00"));
    const checkoutDay = getCalendarCellState([reservation], 1, new Date("2026-04-08T12:00:00-03:00"));

    expect(checkInDay.stayReservation?.id).toBe("res-1");
    expect(checkInDay.checkoutReservation).toBeNull();
    expect(checkoutDay.stayReservation).toBeNull();
    expect(checkoutDay.checkoutReservation?.id).toBe("res-1");
  });

  it("shows checkout diagonal and new stay on the same day when reservations touch", () => {
    const leavingReservation = makeReservation({
      id: "res-out",
      room_id: 4,
      client_name: "Leaving Guest",
      check_in_target: "2026-04-07T14:00:00-03:00",
      check_out_target: "2026-04-08T10:00:00-03:00",
    });
    const arrivingReservation = makeReservation({
      id: "res-in",
      room_id: 4,
      client_name: "Arriving Guest",
      check_in_target: "2026-04-08T14:00:00-03:00",
      check_out_target: "2026-04-10T10:00:00-03:00",
    });

    const sharedDay = getCalendarCellState(
      [leavingReservation, arrivingReservation],
      4,
      new Date("2026-04-08T12:00:00-03:00")
    );

    expect(sharedDay.checkoutReservation?.id).toBe("res-out");
    expect(sharedDay.stayReservation?.id).toBe("res-in");
  });
});
