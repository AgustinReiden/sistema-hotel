import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La lectura del nombre y el DNI del huésped que hace «Revisá antes de emitir» de la
 * factura consolidada (loadGuestDocumentAction).
 *
 * El chequeo de rol NO se mockea: se mockea la sesión de Supabase y corre el de la
 * acción de verdad. Lo que se mira es que sea sólo del admin, que lea sólo ese huésped
 * y sólo esos dos datos, y que no escriba nada.
 */

type Consulta = { table: string; select: string | null; eq: [string, unknown][] };

const H = vi.hoisted(() => ({
  role: "admin" as string | null,
  consultas: [] as Consulta[],
  escrituras: [] as string[],
  huesped: { data: null as unknown, error: null as unknown },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/arca/emitter", () => ({ emitInvoice: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: H.role ? { id: "usuario-1" } : null } }),
    },
    from: (table: string) => {
      const consulta: Consulta = { table, select: null, eq: [] };
      if (table !== "profiles") H.consultas.push(consulta);
      const escribe = () => {
        H.escrituras.push(table);
        return builder;
      };
      const builder = {
        select: (cols: string) => {
          consulta.select = cols;
          return builder;
        },
        eq: (col: string, value: unknown) => {
          consulta.eq.push([col, value]);
          return builder;
        },
        update: escribe,
        insert: escribe,
        upsert: escribe,
        delete: escribe,
        // El perfil del que está logueado.
        single: async () => ({ data: { role: H.role }, error: null }),
        // La ficha del huésped.
        maybeSingle: async () => H.huesped,
      };
      return builder;
    },
  }),
}));

import { loadGuestDocumentAction } from "@/app/admin/fiscal/consolidada/actions";

const HUESPED_ID = "22222222-2222-4222-8222-222222222222";

describe("loadGuestDocumentAction: nombre y DNI del huésped para el cuadro de la consolidada", () => {
  beforeEach(() => {
    H.role = "admin";
    H.consultas.length = 0;
    H.escrituras.length = 0;
    H.huesped = { data: null, error: null };
  });

  it("admin: lee sólo el nombre y el DNI de ese huésped, por su id, y no escribe nada", async () => {
    H.huesped = { data: { full_name: "Juan Prueba", document_id: "30123456" }, error: null };

    await expect(loadGuestDocumentAction(HUESPED_ID)).resolves.toEqual({
      success: true,
      data: { fullName: "Juan Prueba", documentId: "30123456" },
    });
    expect(H.consultas).toHaveLength(1);
    expect(H.consultas[0]).toEqual({
      table: "guests",
      select: "full_name, document_id",
      eq: [["id", HUESPED_ID]],
    });
    expect(H.escrituras).toEqual([]);
  });

  it("un huésped sin DNI cargado vuelve con el documento en null", async () => {
    H.huesped = { data: { full_name: "Juan Prueba", document_id: null }, error: null };

    await expect(loadGuestDocumentAction(HUESPED_ID)).resolves.toEqual({
      success: true,
      data: { fullName: "Juan Prueba", documentId: null },
    });
  });

  it.each([
    ["recepción", "receptionist"],
    ["sin sesión", null],
  ])("%s: no lee la ficha", async (_caso, role) => {
    H.role = role;
    H.huesped = { data: { full_name: "Juan Prueba", document_id: "30123456" }, error: null };

    const result = await loadGuestDocumentAction(HUESPED_ID);

    expect(result.success).toBe(false);
    expect(H.consultas).toHaveLength(0);
  });

  it("si el huésped no existe o la lectura falla, contesta con error (la pantalla sigue con lo que tenía)", async () => {
    await expect(loadGuestDocumentAction(HUESPED_ID)).resolves.toEqual({
      success: false,
      error: "No se encontró el huésped.",
    });

    H.huesped = { data: null, error: { message: "fallo de lectura" } };
    const fallo = await loadGuestDocumentAction(HUESPED_ID);
    expect(fallo.success).toBe(false);
  });
});
