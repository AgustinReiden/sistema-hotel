import { describe, expect, it } from "vitest";

import {
  ALERT_KIND_GENERIC_LABEL,
  ALERT_KIND_LABEL,
  alertActionKind,
  alertKindLabel,
  formatAlertsCount,
} from "@/lib/admin-alerts";

// Qué botones lleva cada aviso de la campana sale de su kind. Si un kind nuevo cae en
// otro grupo sin querer, el dueño ve "Marcar leída" donde la base exige una nota (mig 105)
// o pierde "Autorizar tarifa anterior".
describe("alertActionKind", () => {
  it("el pedido de tarifa vieja se autoriza o se rechaza", () => {
    expect(alertActionKind("room_change_keep_old_tariff_request")).toBe("tarifa");
  });

  it("la pieza ocupada sin estadía se regulariza o se cierra con nota", () => {
    expect(alertActionKind("room_occupied_without_active_reservation")).toBe("ocupada");
  });

  it.each([
    "reservation_overpayment",
    "shift_close_overdue_reservation",
    "cleaning_without_active_reservation",
    "un_kind_que_no_existe",
    "",
  ])("%s se marca leída", (kind) => {
    expect(alertActionKind(kind)).toBe("leida");
  });
});

describe("rótulos de los avisos", () => {
  it("los cinco kinds que genera la base tienen rótulo en español", () => {
    expect(Object.keys(ALERT_KIND_LABEL).sort()).toEqual([
      "cleaning_without_active_reservation",
      "reservation_overpayment",
      "room_change_keep_old_tariff_request",
      "room_occupied_without_active_reservation",
      "shift_close_overdue_reservation",
    ]);
    expect(alertKindLabel("room_change_keep_old_tariff_request")).toBe("Tarifa para autorizar");
    expect(alertKindLabel("room_occupied_without_active_reservation")).toBe(
      "Habitación usada sin estadía"
    );
    expect(alertKindLabel("reservation_overpayment")).toBe("Pago de más");
    expect(alertKindLabel("shift_close_overdue_reservation")).toBe("Salida vencida al cerrar la caja");
    expect(alertKindLabel("cleaning_without_active_reservation")).toBe("Limpieza sin estadía");
  });

  it("un kind desconocido lleva el rótulo genérico", () => {
    expect(alertKindLabel("algo_nuevo")).toBe(ALERT_KIND_GENERIC_LABEL);
    expect(ALERT_KIND_GENERIC_LABEL).toBe("Aviso");
  });
});

// La RPC trae como mucho 100 avisos (LIMIT 100): de 100 para arriba el número no es exacto.
describe("formatAlertsCount", () => {
  it.each([
    [1, "1"],
    [42, "42"],
    [99, "99"],
    [100, "99+"],
    [250, "99+"],
  ])("%i se muestra como %s", (n, texto) => {
    expect(formatAlertsCount(n)).toBe(texto);
  });
});
