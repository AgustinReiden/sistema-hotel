import { describe, expect, it } from "vitest";

import {
  cancelaDesdeLoQueEntro,
  FALTA_LO_QUE_ENTRO,
  netoRecibido,
  problemasDeLoTipeado,
} from "@/lib/cc-pagos";

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

/**
 * Los importes ilegibles no pueden valer 0 en silencio: con amount = lo que entró + las
 * retenciones, un "lo que entró" que no se entiende dejaba pasar un cobro de $0 con solo
 * la retención, y una retención que no se entiende bajaba lo que cancela.
 */
describe("problemasDeLoTipeado", () => {
  const vacio = { entro: "90.000", retencionGanancias: "", retencionIibb: "" };

  it("lo que se entiende, y las retenciones vacías, no tienen problema", () => {
    expect(problemasDeLoTipeado(vacio)).toEqual([]);
    expect(
      problemasDeLoTipeado({ entro: "90000", retencionGanancias: "10.000,50", retencionIibb: "0" })
    ).toEqual([]);
  });

  it("un 0 escrito es válido: un pago absorbido por la retención", () => {
    expect(problemasDeLoTipeado({ ...vacio, entro: "0", retencionGanancias: "8.000" })).toEqual([]);
  });

  it("lo que entró vacío se pide, aunque haya retenciones", () => {
    expect(problemasDeLoTipeado({ ...vacio, entro: "", retencionGanancias: "10.000" })).toEqual([
      FALTA_LO_QUE_ENTRO,
    ]);
    expect(problemasDeLoTipeado({ ...vacio, entro: "   " })).toEqual([FALTA_LO_QUE_ENTRO]);
  });

  it.each(["$ 90.000,00", "90,000.00", "90.000,5,", "abc"])(
    "lo que entró ilegible (%s) se avisa",
    (entro) => {
      const problemas = problemasDeLoTipeado({ ...vacio, entro });
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toContain("No se entiende lo que entró");
    }
  );

  it("una retención ilegible se avisa con su nombre", () => {
    const g = problemasDeLoTipeado({ ...vacio, retencionGanancias: "$10.000" });
    expect(g).toHaveLength(1);
    expect(g[0]).toContain("la retención de Ganancias");
    const i = problemasDeLoTipeado({ ...vacio, retencionIibb: "10,000" });
    expect(i).toHaveLength(1);
    expect(i[0]).toContain("la retención de Ingresos Brutos");
  });
});
