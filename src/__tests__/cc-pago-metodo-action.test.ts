import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F2-11: el cobro a cuenta corriente ya no arranca en "Efectivo". Si la pantalla
 * manda el pago sin decir cómo entró, la acción lo rechaza con un mensaje en
 * castellano en vez de guardarlo con un medio inventado.
 */

const H = vi.hoisted(() => ({
  registerAccountPayment: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/server-auth", () => ({
  assertAdmin: vi.fn(async () => ({})),
}));

vi.mock("@/lib/data", () => ({
  addPaymentImputaciones: vi.fn(),
  getCtaCteMovements: vi.fn(),
  listCcAccountStays: vi.fn(),
  listClientInvoices: vi.fn(),
  listClientOpenInvoices: vi.fn(),
  listClientOpenStays: vi.fn(),
  listClientPayments: vi.fn(),
  registerAccountPayment: H.registerAccountPayment,
  revertPaymentImputacion: vi.fn(),
}));

import { registerAccountPaymentAction } from "@/app/admin/cuentas/actions";

const base = {
  kind: "company" as const,
  clientId: "empresa-1",
  amount: 100000,
  retencionGanancias: 10000,
  retencionIibb: 0,
  imputaciones: [],
};

describe("registerAccountPaymentAction: el medio de pago es obligatorio", () => {
  beforeEach(() => {
    H.registerAccountPayment.mockReset();
    H.registerAccountPayment.mockResolvedValue({ movementId: "mov-1", reciboCcNumero: 1 });
  });

  it.each([
    ["vacío", ""],
    ["en blanco", "   "],
    ["ausente", undefined],
  ])("sin método (%s) no guarda y dice qué falta", async (_caso, method) => {
    const result = await registerAccountPaymentAction({ ...base, method });

    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error).toContain("Elegí cómo entró el pago");
    expect(H.registerAccountPayment).not.toHaveBeenCalled();
  });

  it("con el método elegido guarda, y amount sigue siendo lo que cancela", async () => {
    const result = await registerAccountPaymentAction({ ...base, method: "bank_transfer" });

    expect(result.success).toBe(true);
    expect(H.registerAccountPayment).toHaveBeenCalledTimes(1);
    expect(H.registerAccountPayment.mock.calls[0][0]).toMatchObject({
      amount: 100000,
      method: "bank_transfer",
      retencionGanancias: 10000,
    });
  });
});
