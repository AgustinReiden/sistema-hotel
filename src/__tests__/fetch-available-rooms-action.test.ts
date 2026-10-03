import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Room } from "@/lib/types";

/**
 * Habitaciones libres para el selector de "Nueva reserva" (F0-10). Si la consulta falla
 * devuelve null y no []: el modal no puede decir "La Hab. 5 no está libre" por un error
 * de red o de la base, porque [] quiere decir que no hay ninguna libre.
 */

const H = vi.hoisted(() => ({
  getAvailableRooms: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/data", () => ({
  getAvailableRooms: H.getAvailableRooms,
}));

import { fetchAvailableRoomsAction } from "@/app/admin/actions";

const hab7 = { id: 7, room_number: "7" } as Room;

beforeEach(() => {
  H.getAvailableRooms.mockReset();
});

describe("fetchAvailableRoomsAction", () => {
  it("devuelve las libres para esas fechas", async () => {
    H.getAvailableRooms.mockResolvedValue([hab7]);

    await expect(
      fetchAvailableRoomsAction("2026-10-12T17:00:00.000Z", "2026-10-14T13:00:00.000Z")
    ).resolves.toEqual([hab7]);
  });

  it("si la consulta falla devuelve null, no una lista vacía", async () => {
    H.getAvailableRooms.mockRejectedValue(new Error("fetch failed"));

    await expect(
      fetchAvailableRoomsAction("2026-10-12T17:00:00.000Z", "2026-10-14T13:00:00.000Z")
    ).resolves.toBeNull();
  });

  it("con la salida antes de la entrada devuelve una lista vacía sin consultar", async () => {
    await expect(
      fetchAvailableRoomsAction("2026-10-14T13:00:00.000Z", "2026-10-12T17:00:00.000Z")
    ).resolves.toEqual([]);
    expect(H.getAvailableRooms).not.toHaveBeenCalled();
  });
});
