import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Habitaciones y categorías (precios) son sólo del admin.
 *
 * El chequeo de rol NO se mockea: se mockea la sesión de Supabase y corre el de
 * las acciones de verdad. Lo que se mira es que recepción no llegue a escribir.
 */

const H = vi.hoisted(() => ({
  role: "receptionist" as string | null,
  update: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: H.role ? { id: "usuario-1" } : null } }),
    },
    from: (table: string) => ({
      select: () => ({
        // El perfil del que está logueado.
        eq: () => ({
          single: async () => ({ data: { role: H.role }, error: null }),
        }),
        // Las categorías existentes: editar una habitación busca la suya por nombre.
        order: async () => ({
          data: [{ id: 3, name: "Doble", half_day_price: 30000, is_active: true }],
          error: null,
        }),
      }),
      update: (payload: unknown) => {
        H.update(table, payload);
        return { eq: async () => ({ error: null }) };
      },
      insert: (payload: unknown) => {
        H.insert(table, payload);
        return {
          select: () => ({ single: async () => ({ data: { id: 9 }, error: null }) }),
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
      },
      delete: () => {
        H.remove(table);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

import {
  createRoomAction,
  deleteRoomAction,
  setRoomActiveAction,
  updateRoomAction,
} from "@/app/admin/rooms/actions";
import {
  createRoomCategoryAction,
  deleteRoomCategoryAction,
  updateRoomCategoryAction,
} from "@/app/admin/categorias/actions";

const SOLO_ADMIN = "Solo el administrador puede modificar habitaciones y tarifas.";

const habitacion = {
  room_number: "5",
  room_type: "Doble",
  capacity: 2,
  beds_configuration: "1 Cama doble",
  base_price: 50000,
  half_day_price: 30000,
};

const categoria = {
  name: "Doble",
  capacity: 2,
  base_price: 50000,
  half_day_price: 30000,
};

beforeEach(() => {
  H.role = "receptionist";
  H.update.mockReset();
  H.insert.mockReset();
  H.remove.mockReset();
});

describe("recepción no modifica habitaciones ni tarifas", () => {
  it("editar una habitación: lo dice y no toca nada", async () => {
    const result = await updateRoomAction(5, habitacion);

    expect(result).toEqual({ success: false, error: SOLO_ADMIN });
    expect(H.update).not.toHaveBeenCalled();
    expect(H.insert).not.toHaveBeenCalled();
  });

  it("activar o desactivar una habitación: lo dice y no toca nada", async () => {
    expect(await setRoomActiveAction(5, false)).toEqual({ success: false, error: SOLO_ADMIN });
    expect(await setRoomActiveAction(5, true)).toEqual({ success: false, error: SOLO_ADMIN });
    expect(H.update).not.toHaveBeenCalled();
  });

  it("editar una categoría (el precio): lo dice y no toca nada", async () => {
    const result = await updateRoomCategoryAction(3, { ...categoria, base_price: 1 });

    expect(result).toEqual({ success: false, error: SOLO_ADMIN });
    expect(H.update).not.toHaveBeenCalled();
  });

  it("tampoco crea ni borra habitaciones o categorías", async () => {
    expect(await createRoomAction(habitacion)).toEqual({ success: false, error: SOLO_ADMIN });
    expect(await deleteRoomAction(5)).toEqual({ success: false, error: SOLO_ADMIN });
    expect(await createRoomCategoryAction(categoria)).toEqual({ success: false, error: SOLO_ADMIN });
    expect(await deleteRoomCategoryAction(3)).toEqual({ success: false, error: SOLO_ADMIN });

    expect(H.insert).not.toHaveBeenCalled();
    expect(H.remove).not.toHaveBeenCalled();
    expect(H.update).not.toHaveBeenCalled();
  });

  it("sin sesión sigue siendo 'No autorizado.'", async () => {
    H.role = null;

    expect(await updateRoomAction(5, habitacion)).toEqual({ success: false, error: "No autorizado." });
    expect(await updateRoomCategoryAction(3, categoria)).toEqual({ success: false, error: "No autorizado." });
    expect(H.update).not.toHaveBeenCalled();
  });
});

describe("el admin sigue modificando como hoy", () => {
  beforeEach(() => {
    H.role = "admin";
  });

  it("edita una habitación", async () => {
    const result = await updateRoomAction(5, habitacion);

    expect(result).toEqual({ success: true });
    expect(H.update).toHaveBeenCalledWith("room_categories", expect.objectContaining({ name: "Doble" }));
    expect(H.update).toHaveBeenCalledWith("rooms", expect.objectContaining({ category_id: 3, room_number: "5" }));
  });

  it("activa una habitación", async () => {
    const result = await setRoomActiveAction(5, true);

    expect(result).toEqual({ success: true });
    expect(H.update).toHaveBeenCalledWith("rooms", { is_active: true });
  });

  it("edita una categoría", async () => {
    const result = await updateRoomCategoryAction(3, categoria);

    expect(result).toEqual({ success: true });
    expect(H.update).toHaveBeenCalledWith(
      "room_categories",
      expect.objectContaining({ name: "Doble", base_price: 50000, half_day_price: 30000 })
    );
  });
});
