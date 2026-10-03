import { describe, expect, it } from "vitest";

import { FISCAL_VIEWS, parseFiscalView } from "@/app/admin/fiscal/views";

describe("solapas de /admin/fiscal", () => {
  it("sin ?view= el dueño cae en Con error, igual que recepción", () => {
    expect(parseFiscalView(undefined, true)).toBe("pendientes");
    expect(parseFiscalView(undefined, false)).toBe("pendientes");
  });

  it("el dueño puede abrir Emitidas y Con error", () => {
    expect(parseFiscalView("emitidas", true)).toBe("emitidas");
    expect(parseFiscalView("pendientes", true)).toBe("pendientes");
  });

  it("recepción siempre ve Con error, aunque le llegue otro ?view=", () => {
    expect(parseFiscalView("emitidas", false)).toBe("pendientes");
    expect(parseFiscalView("sin_facturar", false)).toBe("pendientes");
  });

  it("un ?view= viejo o inventado no deja la pantalla en blanco", () => {
    expect(parseFiscalView("sin_facturar", true)).toBe("pendientes");
    expect(parseFiscalView("cualquier-cosa", true)).toBe("pendientes");
  });

  it("la solapa Sin facturar ya no existe", () => {
    expect(FISCAL_VIEWS.map((v) => v.value)).toEqual(["emitidas", "pendientes"]);
    expect(FISCAL_VIEWS.map((v) => v.value)).not.toContain("sin_facturar");
  });
});
