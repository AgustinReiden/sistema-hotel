import { describe, expect, it } from "vitest";

import { resolveGuestsView, upcomingStatus } from "@/lib/upcoming";

const TZ = "America/Argentina/Tucuman";
// Hoy es el 15/09 en hora del hotel (UTC-3).
const HOY = "2026-09-15";

describe("resolveGuestsView", () => {
  it("recepción siempre cae en Por llegar y redirige si pidió otra vista", () => {
    expect(resolveGuestsView("historial", "receptionist")).toEqual({ view: "por_llegar", redirect: true });
    expect(resolveGuestsView("directorio", "receptionist")).toEqual({ view: "por_llegar", redirect: true });
    expect(resolveGuestsView(undefined, "receptionist")).toEqual({ view: "por_llegar", redirect: true });
    expect(resolveGuestsView("cualquier-cosa", "receptionist")).toEqual({ view: "por_llegar", redirect: true });
  });

  it("recepción que ya está en Por llegar no se redirige", () => {
    expect(resolveGuestsView("por_llegar", "receptionist")).toEqual({ view: "por_llegar", redirect: false });
  });

  it("el dueño conserva la vista pedida y el Directorio por defecto", () => {
    expect(resolveGuestsView("historial", "admin")).toEqual({ view: "historial", redirect: false });
    expect(resolveGuestsView("por_llegar", "admin")).toEqual({ view: "por_llegar", redirect: false });
    expect(resolveGuestsView(undefined, "admin")).toEqual({ view: "directorio", redirect: false });
    expect(resolveGuestsView("cualquier-cosa", "admin")).toEqual({ view: "directorio", redirect: false });
  });
});

describe("upcomingStatus", () => {
  it("una entrada de ayer es Atrasada", () => {
    expect(upcomingStatus({ status: "confirmed", check_in_target: "2026-09-14T17:00:00Z" }, HOY, TZ)).toBe("atrasada");
  });

  it("la de hoy o una futura es Confirmada", () => {
    expect(upcomingStatus({ status: "confirmed", check_in_target: "2026-09-15T17:00:00Z" }, HOY, TZ)).toBe("confirmada");
    expect(upcomingStatus({ status: "confirmed", check_in_target: "2026-10-01T17:00:00Z" }, HOY, TZ)).toBe("confirmada");
  });

  it("una solicitud web sin confirmar es Solicitud, aunque la fecha ya pasó", () => {
    expect(upcomingStatus({ status: "pending", check_in_target: "2026-09-20T17:00:00Z" }, HOY, TZ)).toBe("solicitud");
    expect(upcomingStatus({ status: "pending", check_in_target: "2026-09-01T17:00:00Z" }, HOY, TZ)).toBe("solicitud");
  });

  it("cuenta el día en hora del hotel, no en UTC", () => {
    // 01:00 UTC del 16/09 son las 22:00 del 15/09 en Tucumán: es hoy, no mañana.
    expect(upcomingStatus({ status: "confirmed", check_in_target: "2026-09-16T01:00:00Z" }, HOY, TZ)).toBe("confirmada");
    // 02:00 UTC del 15/09 son las 23:00 del 14/09 en Tucumán: es ayer.
    expect(upcomingStatus({ status: "confirmed", check_in_target: "2026-09-15T02:00:00Z" }, HOY, TZ)).toBe("atrasada");
  });
});
