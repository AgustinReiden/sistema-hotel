import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * doCheckoutSplit (F2-4): el check-out cobrado en varios medios va en UNA llamada a
 * rpc_staff_checkout_split (mig 119), que inserta los pagos y cierra la estadía en la
 * misma transacción. Acá se prueba qué se le manda a la base y cómo se lee lo que
 * devuelve. Datos ficticios.
 */

const H = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  response: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      H.calls.push({ fn, args });
      return H.response;
    },
  }),
}));

import { doCheckoutSplit } from "@/lib/data";

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  H.calls = [];
  H.response = { data: null, error: null };
});

describe("doCheckoutSplit", () => {
  it("manda todos los pagos juntos, en el orden en que se cargaron", async () => {
    H.response = {
      data: { payment_id: "pago-1", payment_ids: ["pago-1", "pago-2"], movement_id: null },
      error: null,
    };

    const result = await doCheckoutSplit({
      reservationId: RESERVATION_ID,
      payments: [
        { method: "cash", amount: 20000 },
        { method: "credit_card", amount: 23700 },
      ],
      early: false,
    });

    expect(H.calls).toEqual([
      {
        fn: "rpc_staff_checkout_split",
        args: {
          p_reservation_id: RESERVATION_ID,
          p_payments: [
            { method: "cash", amount: 20000 },
            { method: "credit_card", amount: 23700 },
          ],
          p_early: false,
        },
      },
    ]);
    expect(result).toEqual({ paymentIds: ["pago-1", "pago-2"], paymentId: "pago-1", movementId: null });
  });

  it("la salida anticipada viaja en la misma llamada", async () => {
    H.response = { data: { payment_id: "a", payment_ids: ["a", "b", "c"] }, error: null };

    const result = await doCheckoutSplit({
      reservationId: RESERVATION_ID,
      payments: [
        { method: "cash", amount: 1000 },
        { method: "debit_card", amount: 2000 },
        { method: "mercado_pago", amount: 3000 },
      ],
      early: true,
    });

    expect(H.calls[0]?.args.p_early).toBe(true);
    expect(result).toEqual({ paymentIds: ["a", "b", "c"], paymentId: "a", movementId: null });
  });

  it("si la base rechaza, propaga el error tal cual (no se cobró nada)", async () => {
    const error = {
      code: "22023",
      message: "La suma de los pagos no da justo el saldo de la estadía.",
    };
    H.response = { data: null, error };

    await expect(
      doCheckoutSplit({
        reservationId: RESERVATION_ID,
        payments: [
          { method: "cash", amount: 1 },
          { method: "credit_card", amount: 2 },
        ],
        early: false,
      })
    ).rejects.toBe(error);
  });
});
