import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalSearchMatches } from "@/lib/global-search";

/**
 * Acción del buscador global (F1-5a). La búsqueda en la base se mockea: lo que se
 * mira es qué le llega a cada rol. Recepción ve "Debe" o "No debe", sin monto y
 * sin links; el admin ve el monto y los links con el filtro puesto.
 */

const H = vi.hoisted(() => ({
  staff: true,
  admin: false,
  searchGlobal: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  assertStaff: vi.fn(async (message?: string) => {
    if (!H.staff) throw new Error(message ?? "No autorizado.");
    return {};
  }),
  isCurrentUserAdmin: vi.fn(async () => H.admin),
}));

vi.mock("@/lib/data", () => ({
  searchGlobal: H.searchGlobal,
}));

import { globalSearchAction } from "@/app/admin/search-actions";

const matches: GlobalSearchMatches = {
  habitaciones: [],
  huespedes: [
    {
      kind: "huesped",
      key: "huesped:g1",
      nombre: "Juan Prueba",
      detalle: "Doc. 30.123.456",
      filtro: "30.123.456",
      facts: {
        descuento: 10,
        saldoCuenta: 1500,
        ultimaEstadia: { salida: "2026-09-12T13:00:00Z", habitacion: "7" },
        reservaActiva: null,
      },
    },
  ],
  empresas: [
    {
      kind: "empresa",
      key: "empresa:c1",
      nombre: "Empresa Ficticia SA",
      detalle: "CUIT 30-12345678-1",
      filtro: "30-12345678-1",
      facts: { descuento: 15, saldoCuenta: 0, ultimaEstadia: null, reservaActiva: null },
    },
  ],
  pasajeros: [],
};

beforeEach(() => {
  H.staff = true;
  H.admin = false;
  H.searchGlobal.mockReset();
  H.searchGlobal.mockResolvedValue(matches);
});

describe("globalSearchAction", () => {
  it("como recepción no hay href ni monto", async () => {
    const result = await globalSearchAction("30.123.456");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const json = JSON.stringify(result.data);
    expect(json).not.toContain("href");
    expect(json).not.toContain("1500");
    expect(result.data?.huespedes[0].resumen?.saldoTexto).toBe("Debe");
    expect(result.data?.huespedes[0].resumen?.saldo).toBeNull();
    expect(result.data?.empresas[0].resumen?.saldoTexto).toBe("No debe");
    expect(H.searchGlobal).toHaveBeenCalledWith("30.123.456");
  });

  it("como admin trae el monto y los links", async () => {
    H.admin = true;
    const result = await globalSearchAction("30.123.456");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const huesped = result.data!.huespedes[0];
    expect(huesped.resumen?.saldo).toBe(1500);
    expect(huesped.resumen?.saldoTexto).toContain("1.500");
    expect(huesped.href).toBe("/admin/guests?view=directorio&q=30.123.456");
    expect(huesped.hrefCuenta).toBe(`/admin/cuentas?q=${encodeURIComponent(huesped.titulo)}`);
    expect(result.data!.empresas[0].href).toBe("/admin/asociados?q=30-12345678-1");
  });

  it("con una letra no busca", async () => {
    const result = await globalSearchAction("p");
    expect(result.success).toBe(true);
    expect(H.searchGlobal).not.toHaveBeenCalled();
    if (!result.success) return;
    expect(result.data).toEqual({ habitaciones: [], huespedes: [], empresas: [], pasajeros: [] });
  });

  it("un número de habitación sí busca aunque sea un solo carácter", async () => {
    await globalSearchAction("7");
    expect(H.searchGlobal).toHaveBeenCalledWith("7");
  });

  it("fuera del staff no busca", async () => {
    H.staff = false;
    const result = await globalSearchAction("30.123.456");
    expect(result.success).toBe(false);
    expect(H.searchGlobal).not.toHaveBeenCalled();
  });

  it("si la búsqueda falla devuelve un error en castellano", async () => {
    H.searchGlobal.mockRejectedValue(new Error("boom"));
    const result = await globalSearchAction("perez");
    expect(result.success).toBe(false);
  });
});
