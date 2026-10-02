import { describe, expect, it } from "vitest";

import { buildBillingPresets, resolveCleaningRange, sinFacturarRedirectHref } from "@/lib/date-range";

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

describe("resolveCleaningRange", () => {
  const hoy = "2026-09-23";

  it("sin parámetros: del 1° del mes a hoy, rotulado como mes en curso", () => {
    expect(resolveCleaningRange({}, hoy)).toEqual({
      fromKey: "2026-09-01",
      toKey: "2026-09-23",
      isAll: false,
      isDefault: true,
      label: "Mes en curso: 01/09/2026 al 23/09/2026",
    });
  });

  it("todo=1: todo el historial, sin límites de fecha", () => {
    expect(resolveCleaningRange({ todo: "1" }, hoy)).toEqual({
      fromKey: null,
      toKey: null,
      isAll: true,
      isDefault: false,
      label: "Todo el historial",
    });
  });

  it("todo con otro valor no cuenta", () => {
    expect(resolveCleaningRange({ todo: "0" }, hoy).isAll).toBe(false);
  });

  it("desde y hasta válidos: Del … al …", () => {
    expect(resolveCleaningRange({ from: "2026-08-01", to: "2026-08-31" }, hoy)).toEqual({
      fromKey: "2026-08-01",
      toKey: "2026-08-31",
      isAll: false,
      isDefault: false,
      label: "Del 01/08/2026 al 31/08/2026",
    });
  });

  it("ordena un rango invertido", () => {
    const r = resolveCleaningRange({ from: "2026-08-31", to: "2026-08-01" }, hoy);
    expect(r.fromKey).toBe("2026-08-01");
    expect(r.toKey).toBe("2026-08-31");
  });

  it("fechas inválidas vuelven al mes en curso", () => {
    const r = resolveCleaningRange({ from: "ayer", to: "2026-13" }, hoy);
    expect(r.isDefault).toBe(true);
    expect(r.fromKey).toBe("2026-09-01");
    expect(r.toKey).toBe("2026-09-23");
  });

  it("solo desde: llega hasta hoy", () => {
    const r = resolveCleaningRange({ from: "2026-09-10" }, hoy);
    expect(r).toMatchObject({ fromKey: "2026-09-10", toKey: "2026-09-23", isDefault: false });
    expect(r.label).toBe("Del 10/09/2026 al 23/09/2026");
  });

  it("solo hasta: arranca el 1° del mes de esa fecha", () => {
    const r = resolveCleaningRange({ to: "2026-08-15" }, hoy);
    expect(r).toMatchObject({ fromKey: "2026-08-01", toKey: "2026-08-15", isDefault: false });
  });
});
