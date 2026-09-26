import { describe, expect, it } from "vitest";

import { clampStepper, dayLabel, nochesLabel, nochesYSalida, parseStepperDraft } from "@/lib/stepper";

describe("parseStepperDraft", () => {
  it("vacío no es un número: null", () => {
    expect(parseStepperDraft("", 1, 30)).toBeNull();
  });

  it("un número dentro del rango se lee tal cual", () => {
    expect(parseStepperDraft("3", 1, 30)).toBe(3);
    expect(parseStepperDraft("30", 1, 30)).toBe(30);
    expect(parseStepperDraft("1", 1, 30)).toBe(1);
  });

  it("fuera del rango: null", () => {
    expect(parseStepperDraft("0", 1, 30)).toBeNull();
    expect(parseStepperDraft("45", 1, 30)).toBeNull();
  });

  it("lo que no es un entero sin signo: null", () => {
    expect(parseStepperDraft("a", 1, 30)).toBeNull();
    expect(parseStepperDraft("3a", 1, 30)).toBeNull();
    expect(parseStepperDraft("-3", 1, 30)).toBeNull();
    expect(parseStepperDraft("2.5", 1, 30)).toBeNull();
    expect(parseStepperDraft(" ", 1, 30)).toBeNull();
  });
});

describe("clampStepper", () => {
  it("lo que se pasa queda en el límite", () => {
    expect(clampStepper(45, 1, 30)).toBe(30);
    expect(clampStepper(0, 1, 30)).toBe(1);
    expect(clampStepper(-2, 1, 20)).toBe(1);
  });

  it("dentro del rango no cambia", () => {
    expect(clampStepper(7, 1, 30)).toBe(7);
  });
});

describe("nochesLabel", () => {
  it("singular y plural", () => {
    expect(nochesLabel(1)).toBe("1 noche");
    expect(nochesLabel(3)).toBe("3 noches");
  });
});

describe("dayLabel", () => {
  it("de la clave del día a dd/mm", () => {
    expect(dayLabel("2026-09-26")).toBe("26/09");
    expect(dayLabel("2026-01-05")).toBe("05/01");
  });
});

describe("nochesYSalida", () => {
  it("con día de salida dice cuándo sale", () => {
    expect(nochesYSalida(3, "2026-09-26")).toBe("3 noches · sale el 26/09");
    expect(nochesYSalida(1, "2026-09-24")).toBe("1 noche · sale el 24/09");
  });

  it("sin día de salida, solo las noches", () => {
    expect(nochesYSalida(3, null)).toBe("3 noches");
    expect(nochesYSalida(2)).toBe("2 noches");
  });
});
