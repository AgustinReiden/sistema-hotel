import { describe, expect, it } from "vitest";

import { PAYMENT_METHOD_META, paymentMethodLabel } from "@/lib/payment-methods";
import type { PaymentMethod } from "@/lib/types";

// Un Record<PaymentMethod, true> obliga al compilador a que esta lista tenga TODOS los
// valores del tipo: si alguien agrega un medio de pago y no lo suma acá, no compila.
const TODOS: Record<PaymentMethod, true> = {
  cash: true,
  credit_card: true,
  debit_card: true,
  bank_transfer: true,
  other: true,
  mercado_pago: true,
  vale_blanco: true,
  cuenta_corriente: true,
};

describe("paymentMethodLabel", () => {
  it("traduce bank_transfer a Transferencia", () => {
    expect(paymentMethodLabel("bank_transfer")).toBe("Transferencia");
  });

  it("sin método dice Sin método", () => {
    expect(paymentMethodLabel(null)).toBe("Sin método");
    expect(paymentMethodLabel("")).toBe("Sin método");
  });

  it("un valor desconocido se imprime tal cual: el texto es libre en la base", () => {
    expect(paymentMethodLabel("xyz")).toBe("xyz");
  });

  it("el cheque tiene etiqueta aunque no sea un PaymentMethod de caja", () => {
    expect(paymentMethodLabel("cheque")).toBe("Cheque");
  });
});

describe("PAYMENT_METHOD_META", () => {
  it("todo valor de PaymentMethod tiene etiqueta, ícono y tono", () => {
    for (const metodo of Object.keys(TODOS)) {
      const meta = PAYMENT_METHOD_META[metodo];
      expect(meta, metodo).toBeDefined();
      expect(meta.label.length, metodo).toBeGreaterThan(0);
      expect(meta.icon, metodo).toBeTruthy();
      expect(meta.tone.length, metodo).toBeGreaterThan(0);
    }
  });

  it("ninguna etiqueta deja a la vista el valor interno", () => {
    for (const [metodo, meta] of Object.entries(PAYMENT_METHOD_META)) {
      expect(meta.label, metodo).not.toContain("_");
    }
  });
});
