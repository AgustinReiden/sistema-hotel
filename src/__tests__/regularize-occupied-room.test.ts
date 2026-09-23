import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseActionError } from "@/lib/error-utils";
import type { AssignWalkInPayload } from "@/lib/types";

/**
 * "Cargar la estadía" desde el aviso de pieza ocupada sin estadía.
 *
 * El gate de rol NO se mockea: se mockea la sesión de Supabase y corre el
 * `assertAdmin` de verdad, que es lo que la mig 106 cambió (antes era staff).
 */

const H = vi.hoisted(() => ({
  role: "admin" as string | null,
  assignWalkIn: vi.fn(),
  regularizeOccupiedRoom: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/data", () => ({
  assignWalkIn: H.assignWalkIn,
  regularizeOccupiedRoom: H.regularizeOccupiedRoom,
}));

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

import { regularizeOccupiedRoomAction } from "@/app/admin/actions";

const RESERVA = "7d1f3c1e-0a3b-4c2d-9e8f-1a2b3c4d5e6f";

const walkIn: AssignWalkInPayload = {
  mode: "person",
  roomId: 2,
  clientFirstName: "Pasajero",
  clientLastName: "De Prueba",
  clientDni: "30111222",
  nights: 1,
  stayType: "night",
  checkInDate: "2026-09-22",
};

/** El error que devuelve PROD hoy al cerrar el aviso: el CHECK de la mig 69. */
const checkViolation = {
  code: "23514",
  message:
    'new row for relation "admin_alerts" violates check constraint "admin_alerts_decision_check"',
};

beforeEach(() => {
  H.role = "admin";
  H.assignWalkIn.mockReset().mockResolvedValue(RESERVA);
  H.regularizeOccupiedRoom.mockReset().mockResolvedValue(undefined);
});

describe("regularizeOccupiedRoomAction", () => {
  it("el admin carga la estadía y cierra el aviso apuntando a esa reserva", async () => {
    const result = await regularizeOccupiedRoomAction({ alertId: 41, walkIn });

    expect(result).toEqual({
      success: true,
      data: { reservationId: RESERVA, alertPendiente: false },
    });
    expect(H.assignWalkIn).toHaveBeenCalledTimes(1);
    // La fecha retroactiva tiene que llegar a la base: zod descarta lo que no declara.
    expect(H.assignWalkIn.mock.calls[0][0]).toMatchObject({
      roomId: 2,
      checkInDate: "2026-09-22",
    });
    expect(H.regularizeOccupiedRoom).toHaveBeenCalledWith(41, RESERVA);
  });

  it("el recepcionista no decide si la pieza se cobra: corta antes de cargar nada", async () => {
    H.role = "receptionist";

    const result = await regularizeOccupiedRoomAction({ alertId: 41, walkIn });

    expect(result).toEqual({
      success: false,
      error: "Solo el administrador decide si esta pieza se cobra.",
      code: undefined,
    });
    expect(H.assignWalkIn).not.toHaveBeenCalled();
    expect(H.regularizeOccupiedRoom).not.toHaveBeenCalled();
  });

  it("sin sesión tampoco carga nada", async () => {
    H.role = null;

    const result = await regularizeOccupiedRoomAction({ alertId: 41, walkIn });

    expect(result.success).toBe(false);
    expect(H.assignWalkIn).not.toHaveBeenCalled();
  });

  it("si el aviso no se puede cerrar (el CHECK de PROD), la estadía que ya entró se informa como cargada", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    H.regularizeOccupiedRoom.mockRejectedValue(checkViolation);

    const result = await regularizeOccupiedRoomAction({ alertId: 41, walkIn });

    // Decir "no se pudo" llevaría a cargarla otra vez y duplicar la reserva.
    expect(result).toEqual({
      success: true,
      data: { reservationId: RESERVA, alertPendiente: true },
    });
    expect(H.assignWalkIn).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("si la estadía no entra, no toca el aviso y muestra el motivo de la base", async () => {
    H.assignWalkIn.mockRejectedValue({
      code: "23P01",
      message: "La habitacion ya esta ocupada en esas fechas.",
    });

    const result = await regularizeOccupiedRoomAction({ alertId: 41, walkIn });

    expect(result).toEqual({
      success: false,
      error: "La habitacion ya esta ocupada en esas fechas.",
      code: "23P01",
    });
    expect(H.regularizeOccupiedRoom).not.toHaveBeenCalled();
  });

  it("un payload inválido no llega a la base", async () => {
    const result = await regularizeOccupiedRoomAction({
      alertId: 41,
      walkIn: { ...walkIn, checkInDate: "22/09/2026" },
    });

    expect(result).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(H.assignWalkIn).not.toHaveBeenCalled();
    expect(H.regularizeOccupiedRoom).not.toHaveBeenCalled();
  });
});

describe("errores de rpc_regularize_occupied_room", () => {
  it.each([
    ["42501", "Solo el administrador decide si esta pieza se cobra."],
    ["P0002", "Aviso no encontrado."],
    ["P0002", "Reserva no encontrada."],
    ["22023", "Este aviso no se regulariza cargando una estadia."],
    ["22023", "La estadia tiene que estar con el huesped adentro para cerrar el aviso."],
    ["22023", "Esa estadia es de otra habitacion."],
  ])("%s «%s» se muestra tal cual", (code, message) => {
    expect(parseActionError({ code, message }, "Fallback")).toEqual({ error: message, code });
  });

  it("la violación del CHECK no filtra el nombre de la constraint", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = parseActionError(checkViolation, "Fallback");

    expect(result.code).toBe("23514");
    expect(result.error).not.toContain("admin_alerts");
    expect(result.error).toContain("error inesperado");
    spy.mockRestore();
  });
});
