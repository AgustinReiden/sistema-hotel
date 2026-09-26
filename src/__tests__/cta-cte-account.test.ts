import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El cliente de cuenta corriente con el que abre la factura consolidada
 * (getCtaCteAccount).
 *
 * La página validaba el cliente de la URL buscándolo en la lista entera de cuentas
 * (getCtaCteAccounts), que además ignora los errores de las consultas de empresas y de
 * huéspedes: con una de esas caída, un cliente válido se leía como "no es de cuenta
 * corriente" y la página mandaba a Control. Ahora se lee sólo ese cliente, por su id,
 * con el mismo criterio (cuenta corriente prendida, o algún movimiento aunque después
 * se la hayan apagado), y un error de lectura se tira.
 *
 * Se mockea la sesión de Supabase y corre la función de verdad.
 */

type Consulta = { table: string; select: string | null; eq: [string, unknown][] };

const H = vi.hoisted(() => ({
  consultas: [] as Consulta[],
  cliente: { data: null as unknown, error: null as unknown },
  movimientos: { data: [] as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const consulta: Consulta = { table, select: null, eq: [] };
      H.consultas.push(consulta);
      const builder = {
        select: (cols: string) => {
          consulta.select = cols;
          return builder;
        },
        eq: (col: string, value: unknown) => {
          consulta.eq.push([col, value]);
          return builder;
        },
        // La ficha del cliente.
        maybeSingle: async () => H.cliente,
        // Los movimientos: la consulta se espera directo, sin maybeSingle.
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(H.movimientos).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

import { getCtaCteAccount } from "@/lib/data";

const EMPRESA_ID = "11111111-1111-4111-8111-111111111111";
const HUESPED_ID = "22222222-2222-4222-8222-222222222222";

describe("getCtaCteAccount: el cliente de cuenta corriente de la consolidada, por id", () => {
  beforeEach(() => {
    H.consultas.length = 0;
    H.cliente = { data: null, error: null };
    H.movimientos = { data: [], error: null };
  });

  it("empresa con la cuenta corriente prendida y sin movimientos: es cliente, con saldo 0", async () => {
    H.cliente = {
      data: {
        id: EMPRESA_ID,
        display_name: "Empresa Ficticia SA",
        document_id: "30123456781",
        cuenta_corriente_habilitada: true,
      },
      error: null,
    };

    await expect(getCtaCteAccount("company", EMPRESA_ID)).resolves.toEqual({
      kind: "company",
      id: EMPRESA_ID,
      name: "Empresa Ficticia SA",
      document_id: "30123456781",
      balance: 0,
    });
    // Sólo este cliente y sus movimientos, por id.
    const ficha = H.consultas.find((c) => c.table === "associated_clients");
    expect(ficha?.eq).toEqual([["id", EMPRESA_ID]]);
    const movs = H.consultas.find((c) => c.table === "cuenta_corriente_movimientos");
    expect(movs?.eq).toEqual([["associated_client_id", EMPRESA_ID]]);
    expect(H.consultas).toHaveLength(2);
  });

  it("huésped con la cuenta corriente apagada pero con movimientos: es cliente, y el saldo es cargos menos pagos", async () => {
    H.cliente = {
      data: {
        id: HUESPED_ID,
        full_name: "Juan Prueba",
        document_id: "30123456",
        cuenta_corriente_habilitada: false,
      },
      error: null,
    };
    H.movimientos = {
      data: [
        { tipo: "cargo", amount: "15000.10" },
        { tipo: "cargo", amount: 5000 },
        { tipo: "pago", amount: "7000" },
      ],
      error: null,
    };

    await expect(getCtaCteAccount("guest", HUESPED_ID)).resolves.toEqual({
      kind: "guest",
      id: HUESPED_ID,
      name: "Juan Prueba",
      document_id: "30123456",
      balance: 13000.1,
    });
    expect(H.consultas.find((c) => c.table === "guests")?.eq).toEqual([["id", HUESPED_ID]]);
    expect(H.consultas.find((c) => c.table === "cuenta_corriente_movimientos")?.eq).toEqual([
      ["guest_id", HUESPED_ID],
    ]);
  });

  it("con la cuenta corriente apagada y sin movimientos, no es cliente de cuenta corriente", async () => {
    H.cliente = {
      data: {
        id: HUESPED_ID,
        full_name: "Juan Prueba",
        document_id: "30123456",
        cuenta_corriente_habilitada: false,
      },
      error: null,
    };

    await expect(getCtaCteAccount("guest", HUESPED_ID)).resolves.toBeNull();
  });

  it("si el cliente no existe, null", async () => {
    await expect(getCtaCteAccount("company", EMPRESA_ID)).resolves.toBeNull();
  });

  it("un id que no es un uuid no va a la base: no es de ningún cliente", async () => {
    await expect(getCtaCteAccount("company", "no-existe")).resolves.toBeNull();
    expect(H.consultas).toHaveLength(0);
  });

  it("si falla la lectura del cliente o de sus movimientos, tira el error en lugar de decir que no es cliente", async () => {
    H.cliente = { data: null, error: { message: "fallo de lectura" } };
    await expect(getCtaCteAccount("company", EMPRESA_ID)).rejects.toMatchObject({
      message: "fallo de lectura",
    });

    H.cliente = {
      data: {
        id: EMPRESA_ID,
        display_name: "Empresa Ficticia SA",
        document_id: null,
        cuenta_corriente_habilitada: true,
      },
      error: null,
    };
    H.movimientos = { data: null, error: { message: "fallo de movimientos" } };
    await expect(getCtaCteAccount("company", EMPRESA_ID)).rejects.toMatchObject({
      message: "fallo de movimientos",
    });
  });
});
