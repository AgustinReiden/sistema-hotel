import { describe, expect, it, vi } from "vitest";

import {
  formatAmount,
  formatAmountForInput,
  formatMoney,
  formatShiftCode,
  formatSignedAmount,
  localToISO,
  parseArMoney,
} from "@/lib/format";

describe("formatMoney", () => {
  it("formats ARS correctly", () => {
    const result = formatMoney(1500.5, "ARS");
    expect(result).toContain("1.500,50");
  });

  it("formats USD correctly", () => {
    const result = formatMoney(99.99, "USD");
    expect(result).toContain("99,99");
  });

  it("formats zero", () => {
    const result = formatMoney(0, "ARS");
    expect(result).toContain("0,00");
  });

  it("handles large numbers", () => {
    const result = formatMoney(1000000, "ARS");
    expect(result).toContain("1.000.000");
  });

  it("cae a ARS, no a USD, si la moneda no es un codigo ISO 4217", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // El respaldo era USD: un tipeo en la configuracion mostraba toda la caja
      // del hotel en dolares sin avisar.
      const enPesos = formatMoney(1500.5, "ARS");
      const conMonedaRota = formatMoney(1500.5, "MONEDA_INEXISTENTE");
      expect(conMonedaRota).toBe(enPesos);
    } finally {
      warn.mockRestore();
    }
  });

  it("avisa una sola vez por moneda invalida, no una por importe", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // formatMoney se llama por celda; avisar en cada fila taparia la consola.
      formatMoney(100, "PESOS_ARG");
      formatMoney(250, "PESOS_ARG");
      formatMoney(999, "PESOS_ARG");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("PESOS_ARG");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("formatAmount", () => {
  it("formats amounts with peso sign", () => {
    expect(formatAmount(1234.5)).toBe("$1.234,50");
  });

  it("keeps the minus sign before the peso sign", () => {
    expect(formatAmount(-250)).toBe("-$250,00");
  });
});

describe("formatSignedAmount", () => {
  it("returns placeholder for null", () => {
    expect(formatSignedAmount(null)).toBe("---");
  });

  it("adds an explicit plus sign for positive values", () => {
    expect(formatSignedAmount(350)).toBe("+$350,00");
  });

  it("shows minus sign for negative values", () => {
    expect(formatSignedAmount(-125.5)).toBe("-$125,50");
  });

  it("shows zero without explicit sign", () => {
    expect(formatSignedAmount(0)).toBe("$0,00");
  });
});

describe("formatShiftCode", () => {
  it("pads numeric shift codes to 6 digits by default", () => {
    expect(formatShiftCode(27)).toBe("000027");
  });

  it("accepts a custom minimum length", () => {
    expect(formatShiftCode(27, 4)).toBe("0027");
  });
});

describe("parseArMoney", () => {
  it("parses formato argentino con miles y decimales", () => {
    expect(parseArMoney("1.500,00")).toBe(1500);
  });

  it("parses punto decimal simple (sin coma)", () => {
    expect(parseArMoney("1500.50")).toBe(1500.5);
  });

  it("parses coma decimal sin separador de miles", () => {
    expect(parseArMoney("12,5")).toBe(12.5);
  });

  it("devuelve null para texto que no es un numero", () => {
    expect(parseArMoney("abc")).toBeNull();
  });

  it("devuelve null para negativos", () => {
    expect(parseArMoney("-5")).toBeNull();
  });

  it("devuelve null para vacio o solo espacios", () => {
    expect(parseArMoney("")).toBeNull();
    expect(parseArMoney("   ")).toBeNull();
  });

  it("acepta cero", () => {
    expect(parseArMoney("0")).toBe(0);
  });

  // Así se escribe en Argentina. Antes "43.700" daba 43,70 y en el arqueo a ciegas
  // el monto no se puede corregir una vez enviado.
  it("punto seguido de 3 dígitos es separador de miles", () => {
    expect(parseArMoney("43.700")).toBe(43700);
    expect(parseArMoney("2.500")).toBe(2500);
    expect(parseArMoney("150.000")).toBe(150000);
  });

  it("varios puntos son separadores de miles", () => {
    expect(parseArMoney("1.500.000")).toBe(1500000);
  });

  it("punto con 1 o 2 dígitos sigue siendo decimal", () => {
    expect(parseArMoney("1500.5")).toBe(1500.5);
    expect(parseArMoney("43.70")).toBe(43.7);
  });

  it("miles con punto y decimales con coma", () => {
    expect(parseArMoney("1.500.000,50")).toBe(1500000.5);
    expect(parseArMoney("1500,50")).toBe(1500.5);
  });

  it("lo que queda a medio tipear vale como entero", () => {
    expect(parseArMoney("1.500,")).toBe(1500);
    expect(parseArMoney("1500.")).toBe(1500);
  });

  it("devuelve null en vez de adivinar si el formato no es claro", () => {
    // Miles mal agrupados.
    expect(parseArMoney("1.50.000")).toBeNull();
    expect(parseArMoney("1234.567")).toBeNull();
    expect(parseArMoney("0.500")).toBeNull();
    // Más de 2 decimales, o coma de miles al estilo inglés.
    expect(parseArMoney("12,555")).toBeNull();
    expect(parseArMoney("1,500.50")).toBeNull();
    // Cosas que Number() acepta pero nadie tipea como monto.
    expect(parseArMoney("1e3")).toBeNull();
    expect(parseArMoney("0x10")).toBeNull();
    expect(parseArMoney("Infinity")).toBeNull();
  });

  it("entiende de vuelta lo que escribe formatAmountForInput", () => {
    for (const n of [0, 5, 43700, 1500000.5, 123456789.99]) {
      expect(parseArMoney(formatAmountForInput(n))).toBe(n);
    }
  });
});

describe("localToISO", () => {
  it("creates correct ISO string for Argentina timezone", () => {
    const result = localToISO("2026-03-15", "14:00", "America/Argentina/Buenos_Aires");
    expect(result).toMatch(/^2026-03-15T14:00:00/);
    expect(result).toMatch(/-03:00$/);
  });

  it("pads single-digit months and days", () => {
    const result = localToISO("2026-01-05", "09:30", "America/Argentina/Buenos_Aires");
    expect(result).toMatch(/^2026-01-05T09:30:00/);
  });

  it("handles UTC timezone", () => {
    const result = localToISO("2026-06-15", "12:00", "UTC");
    expect(result).toBe("2026-06-15T12:00:00+00:00");
  });
});
