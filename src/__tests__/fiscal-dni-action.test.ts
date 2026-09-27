import { beforeEach, describe, expect, it, vi } from "vitest";

import { DNI_INVALIDO_MSG } from "@/lib/arca/amounts";

/**
 * "Guardar DNI" de la pregunta de factura: corrige el DNI de una estadía cerrada.
 *
 * El gate de rol NO se mockea: corre el `assertStaff` de verdad sobre una sesión
 * de Supabase de mentira. Quién puede corregir qué estadía lo decide la RPC (turno
 * propio y sin CAE, mig 73): acá se mira que la acción traduzca sus respuestas y
 * que no emita nada por su cuenta.
 */

const H = vi.hoisted(() => ({
  role: "receptionist" as string | null,
  fixReservationDniForInvoice: vi.fn(),
  emitInvoice: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: H.revalidatePath }));

vi.mock("@/lib/data", () => ({
  fixReservationDniForInvoice: H.fixReservationDniForInvoice,
}));

vi.mock("@/lib/arca/emitter", () => ({ emitInvoice: H.emitInvoice }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: H.role ? { id: "usuario-1" } : null } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: H.role }, error: null }),
        }),
      }),
    }),
  }),
}));

import { fixReservationDniAction } from "@/app/admin/fiscal/actions";

/** Lo que tira PostgREST cuando la RPC hace RAISE con un SQLSTATE propio. */
function rpcError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

describe("fixReservationDniAction", () => {
  beforeEach(() => {
    H.role = "receptionist";
    H.fixReservationDniForInvoice.mockReset();
    H.fixReservationDniForInvoice.mockResolvedValue(undefined);
    H.emitInvoice.mockReset();
    H.revalidatePath.mockReset();
  });

  it("recepción corrige el DNI, se refrescan las vistas fiscales y NO se emite nada", async () => {
    const result = await fixReservationDniAction("res-1", "30123456");

    expect(result).toEqual({ success: true });
    expect(H.fixReservationDniForInvoice).toHaveBeenCalledWith("res-1", "30123456");
    expect(H.emitInvoice).not.toHaveBeenCalled();
    expect(H.revalidatePath).toHaveBeenCalledWith("/admin/fiscal");
  });

  it("la estadía de otro turno (P0023) dice «Pedile al administrador»", async () => {
    H.fixReservationDniForInvoice.mockRejectedValue(
      rpcError(
        "P0023",
        "Solo podes corregir check-outs de tu turno abierto. Pedile al administrador."
      )
    );

    const result = await fixReservationDniAction("res-1", "30123456");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("P0023");
    expect(result.error).toContain("Pedile al administrador");
    expect(H.revalidatePath).not.toHaveBeenCalled();
  });

  it("ya facturada (P0020): avisa que el DNI de una factura emitida no se cambia", async () => {
    H.fixReservationDniForInvoice.mockRejectedValue(
      rpcError(
        "P0020",
        "La reserva ya tiene factura emitida: no se puede cambiar el DNI del receptor."
      )
    );

    const result = await fixReservationDniAction("res-1", "30123456");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("P0020");
    expect(result.error).toContain("ya tiene la factura emitida");
  });

  it("un DNI que la base no acepta (P0022) devuelve el texto nuevo, no «en la reserva»", async () => {
    H.fixReservationDniForInvoice.mockRejectedValue(
      rpcError(
        "P0022",
        "El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta."
      )
    );

    const result = await fixReservationDniAction("res-1", "12345");

    expect(result).toEqual({ success: false, error: DNI_INVALIDO_MSG, code: "P0022" });
  });

  it("sin sesión no llega a la base", async () => {
    H.role = null;

    const result = await fixReservationDniAction("res-1", "30123456");

    expect(result.success).toBe(false);
    expect(H.fixReservationDniForInvoice).not.toHaveBeenCalled();
  });
});
