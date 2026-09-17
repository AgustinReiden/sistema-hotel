import { describe, expect, it } from "vitest";

import { buildReservationPlacement, classifyReservations, isFinishedStay } from "@/lib/calendar";
import type { Reservation } from "@/lib/types";

const TZ = "America/Argentina/Tucuman";
/** "Ahora" fijo para todos los casos: jueves 9 de abril de 2026, mediodia del hotel. */
const NOW = "2026-04-09T12:00:00-03:00";

function makeReservation(overrides: Partial<Reservation> & { id: string; room_id: number }): Reservation {
  return {
    id: overrides.id,
    room_id: overrides.room_id,
    associated_client_id: overrides.associated_client_id ?? null,
    company_passenger_id: overrides.company_passenger_id ?? null,
    client_name: overrides.client_name ?? "Test Guest",
    client_phone: overrides.client_phone ?? null,
    client_dni: overrides.client_dni ?? null,
    check_in_target: overrides.check_in_target ?? "2026-04-07T14:00:00-03:00",
    check_out_target: overrides.check_out_target ?? "2026-04-08T10:00:00-03:00",
    late_check_out_until: overrides.late_check_out_until ?? null,
    status: overrides.status ?? "confirmed",
    actual_check_in: overrides.actual_check_in ?? null,
    actual_check_out: overrides.actual_check_out ?? null,
    base_total_price: overrides.base_total_price ?? 10000,
    discount_percent: overrides.discount_percent ?? 0,
    discount_amount: overrides.discount_amount ?? 0,
    total_price: overrides.total_price ?? 10000,
    paid_amount: overrides.paid_amount ?? 0,
    guest_count: overrides.guest_count ?? 1,
    notes: overrides.notes ?? null,
    whatsapp_notified: overrides.whatsapp_notified ?? false,
  };
}

describe("buildReservationPlacement", () => {
  it("ubica una estadia entera dentro de la ventana", () => {
    const reservation = makeReservation({
      id: "res-1",
      room_id: 1,
      check_in_target: "2026-04-09T14:00:00-03:00",
      check_out_target: "2026-04-11T10:00:00-03:00",
    });

    const placement = buildReservationPlacement(reservation, "2026-04-07", 14, TZ);

    expect(placement).not.toBeNull();
    expect(placement?.visibleStartIndex).toBe(2);
    // Del 09 al 11 inclusive: la salida tambien ocupa columna (ahi va la diagonal).
    expect(placement?.cellSpan).toBe(3);
    expect(placement?.startsBeforeRange).toBe(false);
    expect(placement?.endsAfterRange).toBe(false);
  });

  it("recorta una estadia que arranco antes de la ventana", () => {
    const reservation = makeReservation({
      id: "res-2",
      room_id: 1,
      check_in_target: "2026-04-04T14:00:00-03:00",
      check_out_target: "2026-04-09T10:00:00-03:00",
    });

    const placement = buildReservationPlacement(reservation, "2026-04-07", 14, TZ);

    expect(placement?.visibleStartIndex).toBe(0);
    expect(placement?.startsBeforeRange).toBe(true);
    expect(placement?.endsAfterRange).toBe(false);
    expect(placement?.cellSpan).toBe(3);
  });

  it("recorta una estadia que sigue despues de la ventana", () => {
    const reservation = makeReservation({
      id: "res-3",
      room_id: 1,
      check_in_target: "2026-04-08T14:00:00-03:00",
      check_out_target: "2026-04-30T10:00:00-03:00",
    });

    const placement = buildReservationPlacement(reservation, "2026-04-07", 7, TZ);

    expect(placement?.visibleStartIndex).toBe(1);
    expect(placement?.endsAfterRange).toBe(true);
    expect(placement?.cellSpan).toBe(6);
  });

  it("devuelve null si la estadia quedo fuera de la ventana", () => {
    const yaTermino = makeReservation({
      id: "res-viejo",
      room_id: 1,
      check_in_target: "2026-03-01T14:00:00-03:00",
      check_out_target: "2026-03-03T10:00:00-03:00",
    });
    const todaviaNoEmpieza = makeReservation({
      id: "res-lejano",
      room_id: 1,
      check_in_target: "2026-05-01T14:00:00-03:00",
      check_out_target: "2026-05-03T10:00:00-03:00",
    });

    expect(buildReservationPlacement(yaTermino, "2026-04-07", 14, TZ)).toBeNull();
    expect(buildReservationPlacement(todaviaNoEmpieza, "2026-04-07", 14, TZ)).toBeNull();
  });

  it("cuenta el dia hotelero de una entrada a las 22:00 (en UTC ya seria el dia siguiente)", () => {
    const reservation = makeReservation({
      id: "res-noche",
      room_id: 2,
      check_in_target: "2026-04-07T22:00:00-03:00",
      check_out_target: "2026-04-09T10:00:00-03:00",
    });

    const placement = buildReservationPlacement(reservation, "2026-04-07", 14, TZ);

    expect(placement?.visibleStartIndex).toBe(0);
  });
});

describe("isFinishedStay", () => {
  it("una estadia con check-out hecho es pasado", () => {
    const finalizada = makeReservation({ id: "a", room_id: 1, status: "checked_out" });
    expect(isFinishedStay(finalizada, NOW)).toBe(true);
  });

  it("el pasajero adentro sigue en curso aunque la salida prevista ya haya pasado", () => {
    // Medio dia / salida vencida sin check-out: el pasajero todavia esta en la habitacion.
    const adentro = makeReservation({
      id: "b",
      room_id: 1,
      status: "checked_in",
      check_in_target: "2026-04-06T14:00:00-03:00",
      check_out_target: "2026-04-08T10:00:00-03:00",
    });
    expect(isFinishedStay(adentro, NOW)).toBe(false);
  });

  it("una confirmada que nunca se uso y ya vencio es pasado", () => {
    const noShow = makeReservation({
      id: "c",
      room_id: 1,
      status: "confirmed",
      check_in_target: "2026-04-01T14:00:00-03:00",
      check_out_target: "2026-04-03T10:00:00-03:00",
    });
    expect(isFinishedStay(noShow, NOW)).toBe(true);
  });

  it("una confirmada que todavia no vencio no es pasado", () => {
    const porVenir = makeReservation({
      id: "d",
      room_id: 1,
      status: "confirmed",
      check_in_target: "2026-04-12T14:00:00-03:00",
      check_out_target: "2026-04-14T10:00:00-03:00",
    });
    expect(isFinishedStay(porVenir, NOW)).toBe(false);
  });
});

describe("classifyReservations", () => {
  it("marca como pasada la estadia con check-out hecho", () => {
    const finalizada = makeReservation({
      id: "res-fin",
      room_id: 1,
      status: "checked_out",
      check_in_target: "2026-04-05T14:00:00-03:00",
      check_out_target: "2026-04-07T10:00:00-03:00",
    });

    expect(classifyReservations([finalizada], NOW, TZ).get("res-fin")).toBe("finished");
  });

  it("una estadia pasada NO se queda con el cupo de proxima llegada", () => {
    // Es la regresion que aparece al traer el pasado a la grilla: la estadia vieja va
    // primera en el orden por fecha de entrada y se pintaba de amarillo como si el
    // pasajero estuviera por llegar.
    const finalizada = makeReservation({
      id: "res-fin",
      room_id: 1,
      status: "checked_out",
      check_in_target: "2026-04-05T14:00:00-03:00",
      check_out_target: "2026-04-07T10:00:00-03:00",
    });
    const proxima = makeReservation({
      id: "res-prox",
      room_id: 1,
      status: "confirmed",
      check_in_target: "2026-04-12T14:00:00-03:00",
      check_out_target: "2026-04-14T10:00:00-03:00",
    });
    const masAdelante = makeReservation({
      id: "res-lejos",
      room_id: 1,
      status: "confirmed",
      check_in_target: "2026-04-20T14:00:00-03:00",
      check_out_target: "2026-04-22T10:00:00-03:00",
    });

    const categories = classifyReservations([finalizada, proxima, masAdelante], NOW, TZ);

    expect(categories.get("res-fin")).toBe("finished");
    expect(categories.get("res-prox")).toBe("next");
    expect(categories.get("res-lejos")).toBe("future");
  });

  it("el pasajero adentro sigue activo aunque su salida prevista ya haya pasado", () => {
    const adentro = makeReservation({
      id: "res-adentro",
      room_id: 1,
      status: "checked_in",
      check_in_target: "2026-04-06T14:00:00-03:00",
      check_out_target: "2026-04-08T10:00:00-03:00",
    });

    expect(classifyReservations([adentro], NOW, TZ).get("res-adentro")).toBe("active");
  });

  it("una reserva sin confirmar que todavia no vencio queda pendiente", () => {
    const sinConfirmar = makeReservation({
      id: "res-pend",
      room_id: 1,
      status: "pending",
      check_in_target: "2026-04-15T14:00:00-03:00",
      check_out_target: "2026-04-16T10:00:00-03:00",
    });

    expect(classifyReservations([sinConfirmar], NOW, TZ).get("res-pend")).toBe("pending");
  });

  it("marca en rojo la llegada cuyo dia de entrada ya paso y la estadia sigue corriendo", () => {
    const atrasada = makeReservation({
      id: "res-atras",
      room_id: 1,
      status: "confirmed",
      check_in_target: "2026-04-07T14:00:00-03:00",
      check_out_target: "2026-04-14T10:00:00-03:00",
    });

    expect(classifyReservations([atrasada], NOW, TZ).get("res-atras")).toBe("overdue");
  });

  it("un no-show viejo va a pasado, no a rojo ni a amarillo", () => {
    const noShow = makeReservation({
      id: "res-noshow",
      room_id: 1,
      status: "confirmed",
      check_in_target: "2026-04-01T14:00:00-03:00",
      check_out_target: "2026-04-03T10:00:00-03:00",
    });

    expect(classifyReservations([noShow], NOW, TZ).get("res-noshow")).toBe("finished");
  });

  it("la clasificacion no depende del orden en que venga el array", () => {
    const finalizada = makeReservation({
      id: "res-fin",
      room_id: 1,
      status: "checked_out",
      check_in_target: "2026-04-05T14:00:00-03:00",
      check_out_target: "2026-04-07T10:00:00-03:00",
    });
    const proxima = makeReservation({
      id: "res-prox",
      room_id: 1,
      status: "confirmed",
      check_in_target: "2026-04-12T14:00:00-03:00",
      check_out_target: "2026-04-14T10:00:00-03:00",
    });

    const desordenado = classifyReservations([proxima, finalizada], NOW, TZ);

    expect(desordenado.get("res-prox")).toBe("next");
    expect(desordenado.get("res-fin")).toBe("finished");
  });
});
