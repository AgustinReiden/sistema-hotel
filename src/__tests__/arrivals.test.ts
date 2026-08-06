import { describe, expect, it } from "vitest";

import { findPendingArrival, isPendingArrival } from "@/lib/arrivals";

const TZ = "America/Argentina/Tucuman";

function makeArrival(overrides: {
  status?: string;
  check_in_target: string;
  check_out_target: string;
  id?: string;
}) {
  return {
    id: overrides.id ?? "res-1",
    status: overrides.status ?? "confirmed",
    check_in_target: overrides.check_in_target,
    check_out_target: overrides.check_out_target,
  };
}

describe("isPendingArrival", () => {
  it("acepta la llegada del día", () => {
    const reservation = makeArrival({
      check_in_target: "2026-08-05T17:00:00Z",
      check_out_target: "2026-08-06T13:00:00Z",
    });

    expect(isPendingArrival(reservation, "2026-08-05T18:30:00Z", TZ)).toBe(true);
  });

  it("mantiene la llegada de ayer mientras la estadía siga corriendo", () => {
    // Caso real: entró el 04 a la noche y el check-in quedó sin hacer.
    const reservation = makeArrival({
      check_in_target: "2026-08-04T17:00:00Z",
      check_out_target: "2026-08-12T13:00:00Z",
    });

    expect(isPendingArrival(reservation, "2026-08-05T15:00:00Z", TZ)).toBe(true);
  });

  it("descarta el no-show cuya estadía ya venció", () => {
    const reservation = makeArrival({
      check_in_target: "2026-08-03T17:00:00Z",
      check_out_target: "2026-08-04T13:00:00Z",
    });

    expect(isPendingArrival(reservation, "2026-08-05T15:00:00Z", TZ)).toBe(false);
  });

  it("no adelanta la llegada de mañana", () => {
    const reservation = makeArrival({
      check_in_target: "2026-08-06T17:00:00Z",
      check_out_target: "2026-08-07T13:00:00Z",
    });

    expect(isPendingArrival(reservation, "2026-08-05T15:00:00Z", TZ)).toBe(false);
  });

  it("ignora las reservas que no están confirmadas", () => {
    const base = {
      check_in_target: "2026-08-05T17:00:00Z",
      check_out_target: "2026-08-06T13:00:00Z",
    };

    expect(isPendingArrival(makeArrival({ ...base, status: "checked_in" }), "2026-08-05T18:00:00Z", TZ)).toBe(false);
    expect(isPendingArrival(makeArrival({ ...base, status: "pending" }), "2026-08-05T18:00:00Z", TZ)).toBe(false);
    expect(isPendingArrival(makeArrival({ ...base, status: "cancelled" }), "2026-08-05T18:00:00Z", TZ)).toBe(false);
  });
});

describe("findPendingArrival", () => {
  it("marca como atrasada la llegada de un día anterior", () => {
    const diegoPalma = makeArrival({
      check_in_target: "2026-08-04T17:00:00Z",
      check_out_target: "2026-08-12T13:00:00Z",
    });

    const result = findPendingArrival([diegoPalma], "2026-08-05T15:00:00Z", TZ);

    expect(result?.reservation.id).toBe("res-1");
    expect(result?.arrivalDateKey).toBe("2026-08-04");
    expect(result?.isOverdue).toBe(true);
  });

  it("en la franja nocturna la llegada del día todavía no está atrasada", () => {
    // 23:00 del 04 en Tucumán ya es el 05 en UTC: la fecha del hotel manda.
    const reservation = makeArrival({
      check_in_target: "2026-08-04T17:00:00Z",
      check_out_target: "2026-08-12T13:00:00Z",
    });

    const result = findPendingArrival([reservation], "2026-08-05T02:00:00Z", TZ);

    expect(result?.isOverdue).toBe(false);
  });

  it("con dos candidatas gana la entrada más reciente", () => {
    const vieja = makeArrival({
      id: "res-vieja",
      check_in_target: "2026-08-04T17:00:00Z",
      check_out_target: "2026-08-12T13:00:00Z",
    });
    const deHoy = makeArrival({
      id: "res-hoy",
      check_in_target: "2026-08-05T17:00:00Z",
      check_out_target: "2026-08-06T13:00:00Z",
    });

    const result = findPendingArrival([vieja, deHoy], "2026-08-05T18:00:00Z", TZ);

    expect(result?.reservation.id).toBe("res-hoy");
    expect(result?.isOverdue).toBe(false);
  });

  it("devuelve null cuando no hay ninguna llegada esperando", () => {
    const futura = makeArrival({
      check_in_target: "2026-08-10T17:00:00Z",
      check_out_target: "2026-08-11T13:00:00Z",
    });

    expect(findPendingArrival([futura], "2026-08-05T15:00:00Z", TZ)).toBeNull();
    expect(findPendingArrival([], "2026-08-05T15:00:00Z", TZ)).toBeNull();
  });
});
