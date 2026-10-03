import { describe, expect, it } from "vitest";

import { invalidClass, missingMessage, pendingFields, type FieldCheck } from "@/lib/form-checks";

const checks: FieldCheck[] = [
  { id: "nombre", label: "Nombre", ok: false },
  { id: "apellido", label: "Apellido", ok: true },
  { id: "dni", label: "DNI", ok: false },
];

describe("pendingFields", () => {
  it("devuelve solo los que no están bien, en el orden en que se declararon", () => {
    expect(pendingFields(checks).map((check) => check.id)).toEqual(["nombre", "dni"]);
  });

  it("sin pendientes devuelve una lista vacía", () => {
    expect(pendingFields(checks.map((check) => ({ ...check, ok: true })))).toEqual([]);
  });
});

describe("missingMessage", () => {
  it("une los campos con comas", () => {
    expect(missingMessage(pendingFields(checks))).toBe("Falta completar: Nombre, DNI");
  });

  it("con un solo campo no lleva comas", () => {
    expect(missingMessage([{ id: "dni", label: "DNI", ok: false }])).toBe("Falta completar: DNI");
  });

  it("sin pendientes es vacío", () => {
    expect(missingMessage([])).toBe("");
  });

  it("un pendiente con frase propia va aparte de la lista de campos", () => {
    const precio: FieldCheck = {
      id: "precio",
      label: "Precio",
      ok: false,
      message: "Falta el precio de medio día: avisale al administrador.",
    };
    expect(missingMessage([precio])).toBe("Falta el precio de medio día: avisale al administrador.");
    expect(missingMessage([checks[0], precio, checks[2]])).toBe(
      "Falta completar: Nombre, DNI. Falta el precio de medio día: avisale al administrador."
    );
  });
});

describe("invalidClass", () => {
  const base = "border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500";

  it("sin error deja las clases como están", () => {
    expect(invalidClass(base, false)).toBe(base);
  });

  it("con error pasa el borde y el aro al rojo", () => {
    const rojo = invalidClass(base, true);
    expect(rojo).toContain("border-red-500");
    expect(rojo).toContain("focus:ring-red-500");
    expect(rojo).toContain("focus:border-red-500");
    expect(rojo).not.toContain("border-slate-200");
    expect(rojo).not.toContain("emerald");
  });
});
