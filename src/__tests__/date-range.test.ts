import { describe, expect, it } from "vitest";

import { buildBillingPresets, sinFacturarRedirectHref } from "@/lib/date-range";

describe("buildBillingPresets: atajo Últimos 10 días", () => {
  it("es el primer atajo y cuenta hoy más los 9 días anteriores", () => {
    expect(buildBillingPresets("2026-09-23")[0]).toEqual({
      label: "Últimos 10 días",
      from: "2026-09-14",
      to: "2026-09-23",
    });
  });

  it("cruza el cambio de mes sin salirse del calendario", () => {
    expect(buildBillingPresets("2026-10-03")[0]).toEqual({
      label: "Últimos 10 días",
      from: "2026-09-24",
      to: "2026-10-03",
    });
  });

  it("cruza el cambio de año", () => {
    expect(buildBillingPresets("2027-01-05")[0]).toEqual({
      label: "Últimos 10 días",
      from: "2026-12-27",
      to: "2027-01-05",
    });
  });

  it("deja los atajos de siempre después del nuevo", () => {
    expect(buildBillingPresets("2026-09-23").map((p) => p.label)).toEqual([
      "Últimos 10 días",
      "Este mes",
      "Mes anterior",
      "Últimos 90 días",
      "Este año",
      "Desde siempre",
    ]);
  });
});

describe("sinFacturarRedirectHref", () => {
  it("manda a Por facturar con el atajo de 10 días y lo pendiente", () => {
    expect(sinFacturarRedirectHref("2026-09-23")).toBe(
      "/admin/fiscal/control?desde=2026-09-14&hasta=2026-09-23&estado=pendiente"
    );
  });

  it("usa el mismo rango que el atajo, para que el botón quede marcado", () => {
    const [atajo] = buildBillingPresets("2026-10-03");
    expect(sinFacturarRedirectHref("2026-10-03")).toBe(
      `/admin/fiscal/control?desde=${atajo.from}&hasta=${atajo.to}&estado=pendiente`
    );
  });
});
