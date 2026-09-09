import { describe, expect, it } from "vitest";

import {
  BANK_PAYMENT_METHODS,
  DETALLE_LINEA_MAX,
  DETALLE_NOTA_MAX,
  defaultStayDescription,
  initialInvoiceStep,
  isBankPaymentMethod,
  sanitizeDetalleLine,
  stepAfterYes,
} from "@/lib/billing";
import type { PaymentMethod } from "@/lib/types";

// Los 8 valores del enum (types.ts y el CHECK de payments en la mig 10).
const ALL_METHODS: PaymentMethod[] = [
  "cash",
  "credit_card",
  "debit_card",
  "bank_transfer",
  "other",
  "mercado_pago",
  "vale_blanco",
  "cuenta_corriente",
];

describe("isBankPaymentMethod", () => {
  it("son bancarios tarjeta (crédito y débito), transferencia y Mercado Pago", () => {
    expect(isBankPaymentMethod("credit_card")).toBe(true);
    expect(isBankPaymentMethod("debit_card")).toBe(true);
    expect(isBankPaymentMethod("bank_transfer")).toBe(true);
    expect(isBankPaymentMethod("mercado_pago")).toBe(true);
  });

  it("no son bancarios efectivo, vale blanco, cuenta corriente ni 'otro'", () => {
    expect(isBankPaymentMethod("cash")).toBe(false);
    expect(isBankPaymentMethod("vale_blanco")).toBe(false);
    expect(isBankPaymentMethod("cuenta_corriente")).toBe(false);
    // 'other' queda afuera a propósito: su semántica es indefinida.
    expect(isBankPaymentMethod("other")).toBe(false);
  });

  it("tolera null/undefined/vacío (check-out sin cobro)", () => {
    expect(isBankPaymentMethod(undefined)).toBe(false);
    expect(isBankPaymentMethod(null)).toBe(false);
    expect(isBankPaymentMethod("")).toBe(false);
  });

  it("cubre los 8 del enum sin dejar ninguno sin clasificar", () => {
    const bancarios = ALL_METHODS.filter(isBankPaymentMethod);
    expect(bancarios.sort()).toEqual([...BANK_PAYMENT_METHODS].sort());
    expect(bancarios).toHaveLength(4);
  });
});

describe("initialInvoiceStep", () => {
  // Efectivo o check-out sin cobro: el SÍ/NO de siempre.
  it("sin obligación ni datos cargados arranca en el SÍ/NO", () => {
    expect(
      initialInvoiceStep({ startAtTipo: false, mandatory: false, prefillComplete: false })
    ).toBe("ask");
  });

  it("sin obligación, el SÍ/NO manda aunque la ficha esté completa", () => {
    // No se saltea la pregunta: en efectivo el huésped puede no querer factura.
    expect(
      initialInvoiceStep({ startAtTipo: false, mandatory: false, prefillComplete: true })
    ).toBe("ask");
  });

  it("pago bancario saltea el SÍ/NO y va a elegir el tipo", () => {
    expect(
      initialInvoiceStep({ startAtTipo: false, mandatory: true, prefillComplete: false })
    ).toBe("tipo");
  });

  it("pago bancario + ficha completa va directo a confirmar", () => {
    expect(
      initialInvoiceStep({ startAtTipo: false, mandatory: true, prefillComplete: true })
    ).toBe("confirmDirecto");
  });

  it("desde Facturación (startAtTipo) nunca muestra el SÍ/NO", () => {
    expect(
      initialInvoiceStep({ startAtTipo: true, mandatory: false, prefillComplete: false })
    ).toBe("tipo");
    expect(
      initialInvoiceStep({ startAtTipo: true, mandatory: false, prefillComplete: true })
    ).toBe("confirmDirecto");
  });

  it("matriz completa: el SÍ/NO aparece sólo si no hay obligación ni entrada directa", () => {
    for (const startAtTipo of [false, true]) {
      for (const mandatory of [false, true]) {
        for (const prefillComplete of [false, true]) {
          const step = initialInvoiceStep({ startAtTipo, mandatory, prefillComplete });
          if (!startAtTipo && !mandatory) {
            expect(step).toBe("ask");
          } else {
            expect(step).toBe(prefillComplete ? "confirmDirecto" : "tipo");
          }
        }
      }
    }
  });
});

describe("stepAfterYes", () => {
  it("con ficha completa confirma; sin ficha pregunta el tipo", () => {
    expect(stepAfterYes(true)).toBe("confirmDirecto");
    expect(stepAfterYes(false)).toBe("tipo");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Detalle editable de la factura consolidada (mig 93).
// Espejo de app_sanitize_detalle / app_default_stay_description: lo que se
// pruebe acá tiene que valer igual en la base.
// ═══════════════════════════════════════════════════════════════════════════

describe("sanitizeDetalleLine", () => {
  it("deja pasar un texto normal", () => {
    expect(sanitizeDetalleLine("Orden de compra 4512")).toBe("Orden de compra 4512");
  });

  it("recorta los espacios de los bordes", () => {
    expect(sanitizeDetalleLine("   Hab. 5   ")).toBe("Hab. 5");
  });

  it("colapsa espacios repetidos", () => {
    expect(sanitizeDetalleLine("Hab.    5   -   agosto")).toBe("Hab. 5 - agosto");
  });

  it("convierte saltos de línea y tabs en un espacio: romperían el ticket", () => {
    expect(sanitizeDetalleLine("Hab. 5\nagosto")).toBe("Hab. 5 agosto");
    expect(sanitizeDetalleLine("Hab.\t5\r\nagosto")).toBe("Hab. 5 agosto");
  });

  it("saca caracteres de control invisibles", () => {
    expect(sanitizeDetalleLine("Hab.\u00005\u0007 agosto")).toBe("Hab. 5 agosto");
  });

  it("recorta al máximo de la línea", () => {
    const largo = "x".repeat(500);
    expect(sanitizeDetalleLine(largo)).toHaveLength(DETALLE_LINEA_MAX);
  });

  it("acepta un máximo distinto (la nota al pie)", () => {
    const largo = "y".repeat(500);
    expect(sanitizeDetalleLine(largo, DETALLE_NOTA_MAX)).toHaveLength(DETALLE_NOTA_MAX);
  });

  it("no parte un emoji al medio cuando el corte cae justo en el límite", () => {
    // 👍 ocupa DOS unidades UTF-16. Con `slice(0, 5)` el corte se quedaba con la
    // mitad de la pareja y el ticket imprimía "abcd�". El emoji entra entero o no
    // entra, igual que con el LEFT() de app_sanitize_detalle (mig 90), que en
    // Postgres cuenta caracteres.
    const cortado = sanitizeDetalleLine("abcd👍efg", 5);
    expect(cortado).toBe("abcd👍");
    // Un emoji cuenta UNO contra el límite, no dos.
    expect(Array.from(cortado ?? "")).toHaveLength(5);
    // Y no queda ningún surrogate suelto (lo que se veía como "�").
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cortado ?? "")).toBe(false);
  });

  it("descarta el emoji entero si no entra en el límite", () => {
    expect(sanitizeDetalleLine("abcd👍efg", 4)).toBe("abcd");
  });

  it("no deja un espacio colgando cuando el recorte cae en el medio de una palabra", () => {
    const texto = `${"a".repeat(DETALLE_LINEA_MAX - 1)} bbb`;
    const out = sanitizeDetalleLine(texto);
    expect(out).toBe("a".repeat(DETALLE_LINEA_MAX - 1));
    expect(out?.endsWith(" ")).toBe(false);
  });

  it("devuelve null cuando no queda nada, para que el servidor ponga el texto automático", () => {
    expect(sanitizeDetalleLine("")).toBeNull();
    expect(sanitizeDetalleLine("   ")).toBeNull();
    expect(sanitizeDetalleLine("\n\t")).toBeNull();
    expect(sanitizeDetalleLine(null)).toBeNull();
    expect(sanitizeDetalleLine(undefined)).toBeNull();
  });
});

describe("defaultStayDescription", () => {
  it("arma habitación + período en formato argentino", () => {
    expect(
      defaultStayDescription({ room_number: "5", fch_desde: "2026-08-12", fch_hasta: "2026-08-15" })
    ).toBe("Hab. 5 - 12/08/2026 al 15/08/2026");
  });

  it("sin habitación no dice 'Hab. null'", () => {
    expect(
      defaultStayDescription({ room_number: null, fch_desde: "2026-08-12", fch_hasta: "2026-08-15" })
    ).toBe("Estadia 12/08/2026 al 15/08/2026");
    expect(
      defaultStayDescription({ room_number: "  ", fch_desde: "2026-08-12", fch_hasta: "2026-08-15" })
    ).toBe("Estadia 12/08/2026 al 15/08/2026");
  });

  it("el texto automático entra en una línea del ticket", () => {
    const out = defaultStayDescription({
      room_number: "12",
      fch_desde: "2026-12-31",
      fch_hasta: "2027-01-15",
    });
    expect(out.length).toBeLessThanOrEqual(DETALLE_LINEA_MAX);
    // Y sobrevive al saneo sin cambiar: es lo que se guarda cuando nadie edita.
    expect(sanitizeDetalleLine(out)).toBe(out);
  });
});
