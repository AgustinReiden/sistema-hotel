import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El fiado del turno trae el número de remito (getShiftSummary).
 *
 * La Caja muestra "Remito R-000017" y deja reimprimirlo con ese dato. Si la columna
 * se cae del select, el componente esconde la línea sin avisar y el tipo de la fila
 * (armado a mano) no lo detecta: por eso se corre la función de verdad con la sesión
 * de Supabase mockeada y se mira qué pide y qué devuelve.
 */

type Consulta = { table: string; select: string | null; eq: [string, unknown][] };

const H = vi.hoisted(() => ({
  consultas: [] as Consulta[],
  resultados: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const consulta: Consulta = { table, select: null, eq: [] };
      H.consultas.push(consulta);
      const resultado = () => H.resultados[table] ?? { data: null, error: null };
      const builder = {
        select: (cols: string) => {
          consulta.select = cols;
          return builder;
        },
        eq: (col: string, value: unknown) => {
          consulta.eq.push([col, value]);
          return builder;
        },
        order: () => builder,
        maybeSingle: async () => resultado(),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(resultado()).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

import { getShiftSummary } from "@/lib/data";

function cargo(overrides: Record<string, unknown>) {
  return {
    id: "mov-1",
    amount: "80000",
    created_at: "2026-09-25T11:00:00.000Z",
    reservation_id: "res-1",
    remito_numero: 17,
    reservations: {
      checkout_cash_shift_id: "turno-1",
      client_name: "Empresa Ficticia SA",
      rooms: { room_number: "4" },
    },
    ...overrides,
  };
}

describe("getShiftSummary: el fiado del turno trae el número de remito", () => {
  beforeEach(() => {
    H.consultas.length = 0;
    H.resultados = {
      cash_shifts: {
        data: {
          id: "turno-1",
          shift_number: 12,
          opened_at: "2026-09-25T09:00:00.000Z",
          closed_at: null,
          opened_by: "usuario-1",
          closed_by: null,
          opening_cash: "0",
          expected_cash: null,
          actual_cash: null,
          discrepancy: null,
          notes: null,
          status: "open",
        },
        error: null,
      },
      payments: { data: [], error: null },
      reservations: { count: 2, error: null },
      cuenta_corriente_movimientos: { data: [], error: null },
      profiles: { data: { full_name: "Recepción Prueba" }, error: null },
    };
  });

  it("pide remito_numero de los cargos del turno", async () => {
    await getShiftSummary("turno-1");

    const fiado = H.consultas.find((c) => c.table === "cuenta_corriente_movimientos");
    expect(fiado?.select).toMatch(/\bremito_numero\b/);
    expect(fiado?.eq).toEqual([
      ["tipo", "cargo"],
      ["reservations.checkout_cash_shift_id", "turno-1"],
    ]);
  });

  it("lo devuelve como número en cada fiado, aunque llegue como texto", async () => {
    H.resultados.cuenta_corriente_movimientos = {
      data: [
        cargo({ id: "mov-1", remito_numero: "17" }),
        cargo({
          id: "mov-2",
          amount: 45000.5,
          remito_numero: 18,
          reservations: {
            checkout_cash_shift_id: "turno-1",
            client_name: "Juan Prueba",
            rooms: [{ room_number: "7" }],
          },
        }),
        cargo({ id: "mov-3", amount: 1000, remito_numero: null }),
      ],
      error: null,
    };

    const resumen = await getShiftSummary("turno-1");

    expect(resumen?.creditCharges).toEqual([
      {
        id: "mov-1",
        amount: 80000,
        created_at: "2026-09-25T11:00:00.000Z",
        reservation_id: "res-1",
        client_name: "Empresa Ficticia SA",
        room_number: "4",
        remito_numero: 17,
      },
      {
        id: "mov-2",
        amount: 45000.5,
        created_at: "2026-09-25T11:00:00.000Z",
        reservation_id: "res-1",
        client_name: "Juan Prueba",
        room_number: "7",
        remito_numero: 18,
      },
      {
        id: "mov-3",
        amount: 1000,
        created_at: "2026-09-25T11:00:00.000Z",
        reservation_id: "res-1",
        client_name: "Empresa Ficticia SA",
        room_number: "4",
        remito_numero: null,
      },
    ]);
    expect(resumen?.creditCharged).toBe(126000.5);
  });
});
