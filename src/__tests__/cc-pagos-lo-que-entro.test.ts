import { describe, expect, it } from "vitest";

import { cancelaDesdeLoQueEntro, netoRecibido } from "@/lib/cc-pagos";

/**
 * F2-11: el modal de cobro pide "lo que entró" (lo que dice el extracto del banco) y
 * calcula lo que cancela. La regla de la mig 109 no cambia: `amount` sigue siendo lo
 * que CANCELA = lo que entró + las retenciones.
 */
describe("cancelaDesdeLoQueEntro", () => {
  it("transfirió $90.000 y retuvo $10.000 de Ganancias: cancela $100.000", () => {
    expect(
      cancelaDesdeLoQueEntro({ entro: 90000, retencionGanancias: 10000, retencionIibb: 0 })
    ).toBe(100000);
  });

  it("suma las dos retenciones", () => {
    expect(
      cancelaDesdeLoQueEntro({ entro: 96500, retencionGanancias: 2000, retencionIibb: 1500 })
    ).toBe(100000);
  });

  it("sin retenciones, cancela lo mismo que entró", () => {
    expect(cancelaDesdeLoQueEntro({ entro: 50000 })).toBe(50000);
    expect(
      cancelaDesdeLoQueEntro({ entro: 50000, retencionGanancias: null, retencionIibb: undefined })
    ).toBe(50000);
  });

  it("un pago absorbido entero por la retención cancela la retención", () => {
    expect(cancelaDesdeLoQueEntro({ entro: 0, retencionGanancias: 8000 })).toBe(8000);
  });

  it("redondea a centavos, sin arrastrar el error de coma flotante", () => {
    expect(
      cancelaDesdeLoQueEntro({ entro: 0.1, retencionGanancias: 0.2, retencionIibb: 0 })
    ).toBe(0.3);
  });

  it("es la inversa del neto: lo que entró vuelve a salir como neto recibido", () => {
    const pago = { entro: 87654.32, retencionGanancias: 1234.56, retencionIibb: 789.01 };
    const amount = cancelaDesdeLoQueEntro(pago);
    expect(netoRecibido({ amount, ...pago })).toBe(pago.entro);
  });

  it("un valor que no es número cuenta como cero, no como NaN", () => {
    expect(cancelaDesdeLoQueEntro({ entro: Number.NaN, retencionIibb: 5000 })).toBe(5000);
  });
});
