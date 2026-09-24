import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La ficha que precarga la factura consolidada (getCtaCteBillingProfile).
 *
 * La pantalla manda 'consumidor_final' cuando no ve una condición frente al IVA
 * (decisión del 24/09): si la ficha no llega, un huésped en Responsable Inscripto se
 * ve como consumidor final y sale Factura B con DNI. Antes sólo se leían las fichas
 * con la cuenta corriente prendida, y la consolidada también factura a los clientes
 * con saldo a los que después se les apagó.
 *
 * Se mockea la sesión de Supabase y corre la función de verdad.
 */

type Consulta = { table: string; select: string | null; eq: [string, unknown][] };

const H = vi.hoisted(() => ({
  consultas: [] as Consulta[],
  resultado: { data: null as unknown, error: null as unknown },
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
        maybeSingle: async () => H.resultado,
      };
      return builder;
    },
  }),
}));

import { getCtaCteBillingProfile } from "@/lib/data";

describe("getCtaCteBillingProfile: la ficha que precarga la consolidada", () => {
  beforeEach(() => {
    H.consultas.length = 0;
    H.resultado = { data: null, error: null };
  });

  it("lee la ficha del huésped aunque tenga la cuenta corriente apagada: sale en Responsable Inscripto con su CUIT", async () => {
    H.resultado = {
      data: {
        id: "huesped-1",
        cuenta_corriente_habilitada: false,
        condicion_iva: "responsable_inscripto",
        cuit: "20-30123456-3",
        full_name: "Pedro Prueba",
        razon_social: "Pedro Prueba Servicios",
        domicilio_fiscal: "Calle Inventada 200",
      },
      error: null,
    };

    const ficha = await getCtaCteBillingProfile("guest", "huesped-1");

    expect(ficha).toMatchObject({
      condicionIva: "responsable_inscripto",
      cuit: "20301234563",
      razonSocial: "Pedro Prueba Servicios",
      domicilio: "Calle Inventada 200",
      complete: true,
    });
    expect(H.consultas).toHaveLength(1);
    expect(H.consultas[0].table).toBe("guests");
    // Sólo por id: nada de filtrar por cuenta_corriente_habilitada.
    expect(H.consultas[0].eq).toEqual([["id", "huesped-1"]]);
    // El document_id del huésped es el DNI, no un CUIT: no se pide.
    expect(H.consultas[0].select).not.toMatch(/document_id/);
  });

  it("empresa: lee su ficha por id y el CUIT sale de document_id", async () => {
    H.resultado = {
      data: {
        id: "empresa-1",
        cuenta_corriente_habilitada: false,
        condicion_iva: "responsable_inscripto",
        document_id: "30123456781",
        display_name: "Empresa Ficticia SA",
        razon_social: null,
        domicilio: "Calle Inventada 100",
      },
      error: null,
    };

    const ficha = await getCtaCteBillingProfile("company", "empresa-1");

    expect(ficha).toMatchObject({
      condicionIva: "responsable_inscripto",
      cuit: "30123456781",
      razonSocial: "Empresa Ficticia SA",
      domicilio: "Calle Inventada 100",
    });
    expect(H.consultas[0].table).toBe("associated_clients");
    expect(H.consultas[0].eq).toEqual([["id", "empresa-1"]]);
  });

  it("sin ficha devuelve null", async () => {
    await expect(getCtaCteBillingProfile("guest", "huesped-1")).resolves.toBeNull();
  });

  it("si la lectura falla, tira el error en lugar de devolver la ficha vacía", async () => {
    H.resultado = { data: null, error: { message: "fallo de lectura" } };

    await expect(getCtaCteBillingProfile("guest", "huesped-1")).rejects.toMatchObject({
      message: "fallo de lectura",
    });
  });
});
