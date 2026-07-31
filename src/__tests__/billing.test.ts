import { describe, expect, it } from "vitest";

import {
  BANK_PAYMENT_METHODS,
  initialInvoiceStep,
  isBankPaymentMethod,
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
