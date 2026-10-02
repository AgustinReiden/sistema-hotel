import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * searchGlobal (F1-5a) contra una base de mentira en memoria: el mock entiende los
 * filtros que usa la función (eq, in, is, or con eq/in/ilike, order, limit), así que
 * lo que se prueba es la consulta de verdad y el armado del resultado. Datos ficticios.
 */

type Row = Record<string, unknown>;

const H = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  consultas: [] as { table: string; or: string[] }[],
}));

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function orMatches(row: Row, filter: string): boolean {
  return splitTop(filter).some((part) => {
    const [col, op, ...rest] = part.split(".");
    const value = rest.join(".");
    if (op === "eq") return String(row[col]) === value;
    if (op === "ilike") return likeToRegExp(value).test(String(row[col] ?? ""));
    if (op === "in") {
      const list = value.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
      return list.includes(String(row[col]));
    }
    throw new Error(`filtro no soportado: ${part}`);
  });
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: ((row: Row) => boolean)[] = [];
      const consulta = { table, or: [] as string[] };
      H.consultas.push(consulta);
      let order: { col: string; asc: boolean } | null = null;
      let limit = Infinity;
      const builder = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
          filters.push((row) => row[col] === value);
          return builder;
        },
        in: (col: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[col]));
          return builder;
        },
        is: (col: string, value: unknown) => {
          filters.push((row) => (row[col] ?? null) === value);
          return builder;
        },
        or: (filter: string) => {
          consulta.or.push(filter);
          filters.push((row) => orMatches(row, filter));
          return builder;
        },
        order: (col: string, opts: { ascending: boolean }) => {
          order = { col, asc: opts.ascending };
          return builder;
        },
        limit: (n: number) => {
          limit = n;
          return builder;
        },
        then: (resolve: (value: { data: Row[]; error: null }) => void) => {
          let rows = (H.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
          if (order) {
            const { col, asc } = order;
            rows = [...rows].sort((a, b) =>
              String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)
            );
          }
          resolve({ data: rows.slice(0, limit), error: null });
        },
      };
      return builder;
    },
  }),
}));

import { searchGlobal } from "@/lib/data";

const GUEST_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const PASSENGER_ID = "33333333-3333-4333-8333-333333333333";

function stay(overrides: Row): Row {
  return {
    guest_id: null,
    associated_client_id: null,
    company_passenger_id: null,
    client_name: "Juan Prueba",
    client_dni: null,
    room_id: 1,
    rooms: { room_number: "1" },
    ...overrides,
  };
}

beforeEach(() => {
  H.consultas = [];
  H.tables = {
    rooms: [
      { id: 7, room_number: "7", status: "occupied", is_active: true },
      { id: 8, room_number: "8", status: "available", is_active: true },
      { id: 10, room_number: "10", status: "available", is_active: false },
    ],
    guests: [
      { id: GUEST_ID, full_name: "Juan Prueba", document_id: "30123456", discount_percent: 10, cuenta_corriente_habilitada: true },
      { id: "44444444-4444-4444-8444-444444444444", full_name: "Ana Ejemplo", document_id: "27111222", discount_percent: 0, cuenta_corriente_habilitada: false },
    ],
    associated_clients: [
      {
        id: COMPANY_ID,
        display_name: "Empresa Ficticia SA",
        razon_social: "Empresa Ficticia Sociedad Anonima",
        document_id: "30-12345678-1",
        discount_percent: 15,
        cuenta_corriente_habilitada: true,
        is_active: true,
      },
    ],
    company_passengers: [
      { id: PASSENGER_ID, associated_client_id: COMPANY_ID, full_name: "Pedro Pasajero", document_id: "25999888" },
    ],
    reservations: [
      // Estadía vieja del huésped, sin ficha enlazada y con el DNI con puntos.
      stay({ client_dni: "30.123.456", status: "checked_out", check_in_target: "2026-05-01T17:00:00Z", check_out_target: "2026-05-03T13:00:00Z", rooms: { room_number: "4" } }),
      // Estadía en curso, enlazada a la ficha.
      stay({ guest_id: GUEST_ID, client_dni: "30123456", status: "checked_in", room_id: 7, check_in_target: "2026-10-01T17:00:00Z", check_out_target: "2099-10-04T13:00:00Z", rooms: { room_number: "7" } }),
      // Una persona sin ficha de huésped.
      stay({ client_name: "Carla Sinficha", client_dni: "28.555.666", status: "checked_out", check_in_target: "2026-07-01T17:00:00Z", check_out_target: "2026-07-02T13:00:00Z", rooms: { room_number: "2" } }),
      // La empresa, con su pasajero.
      stay({ associated_client_id: COMPANY_ID, company_passenger_id: PASSENGER_ID, client_name: "Pedro Pasajero", status: "checked_out", check_in_target: "2026-09-01T17:00:00Z", check_out_target: "2026-09-05T13:00:00Z", rooms: { room_number: "5" } }),
    ],
    cuenta_corriente_movimientos: [
      { associated_client_id: null, guest_id: GUEST_ID, tipo: "cargo", amount: 2000 },
      { associated_client_id: null, guest_id: GUEST_ID, tipo: "pago", amount: 500 },
      { associated_client_id: COMPANY_ID, guest_id: null, tipo: "cargo", amount: "1000" },
      { associated_client_id: COMPANY_ID, guest_id: null, tipo: "pago", amount: "1000" },
    ],
  };
});

describe("searchGlobal", () => {
  it("un DNI con puntos encuentra al huésped, con saldo, reserva activa y última estadía", async () => {
    const result = await searchGlobal("30.123.456");
    expect(result.huespedes).toHaveLength(1);
    const juan = result.huespedes[0];
    expect(juan.nombre).toBe("Juan Prueba");
    expect(juan.facts.descuento).toBe(10);
    expect(juan.facts.saldoCuenta).toBe(1500);
    expect(juan.facts.reservaActiva).toMatchObject({ estado: "checked_in", habitacion: "7" });
    // La estadía vieja no tenía la ficha enlazada: se reconoce por el DNI.
    expect(juan.facts.ultimaEstadia).toMatchObject({ habitacion: "4" });
    expect(result.empresas).toHaveLength(0);
  });

  it("un CUIT con o sin guiones encuentra a la empresa, con su saldo de cuenta corriente", async () => {
    for (const term of ["30-12345678-1", "30123456781"]) {
      const result = await searchGlobal(term);
      expect(result.empresas).toHaveLength(1);
      const empresa = result.empresas[0];
      expect(empresa.nombre).toBe("Empresa Ficticia SA");
      expect(empresa.facts.descuento).toBe(15);
      expect(empresa.facts.saldoCuenta).toBe(0);
      expect(empresa.facts.ultimaEstadia).toMatchObject({ habitacion: "5" });
    }
  });

  it("un pasajero lleva el descuento de su empresa y no tiene cuenta propia", async () => {
    const result = await searchGlobal("pasajero");
    expect(result.pasajeros).toHaveLength(1);
    expect(result.pasajeros[0].detalle).toContain("Empresa Ficticia SA");
    expect(result.pasajeros[0].facts.descuento).toBe(15);
    expect(result.pasajeros[0].facts.saldoCuenta).toBeNull();
    expect(result.pasajeros[0].filtro).toBe("30-12345678-1");
  });

  it("una persona sin ficha sale de las reservas, sin descuento ni cuenta", async () => {
    const result = await searchGlobal("28.555.666");
    expect(result.huespedes).toHaveLength(1);
    expect(result.huespedes[0].nombre).toBe("Carla Sinficha");
    expect(result.huespedes[0].detalle).toContain("Sin ficha");
    expect(result.huespedes[0].facts).toMatchObject({ descuento: 0, saldoCuenta: null });
  });

  it("una persona sin ficha se encuentra sin tildes ni orden, y por CUIT o parte del DNI con puntos", async () => {
    H.tables.reservations.push(
      stay({ client_name: "PÉREZ JOSÉ", client_dni: "20-30.999.888-3", status: "checked_out", check_in_target: "2026-06-01T17:00:00Z", check_out_target: "2026-06-02T13:00:00Z" })
    );
    for (const term of ["jose perez", "perez jose", "20-30999888-3", "30999888", "9998"]) {
      const result = await searchGlobal(term);
      expect(result.huespedes.map((h) => h.nombre), term).toEqual(["PÉREZ JOSÉ"]);
    }
  });

  it("si no opera a cuenta corriente el saldo es null", async () => {
    const result = await searchGlobal("ana");
    expect(result.huespedes[0].nombre).toBe("Ana Ejemplo");
    expect(result.huespedes[0].facts.saldoCuenta).toBeNull();
  });

  it("un número de habitación trae la habitación activa con quién está alojado", async () => {
    const result = await searchGlobal("7");
    expect(result.habitaciones).toEqual([
      {
        key: "habitacion:7",
        numero: "7",
        estado: "occupied",
        alojado: { nombre: "Juan Prueba", entrada: "2026-10-01T17:00:00Z", salida: "2099-10-04T13:00:00Z" },
      },
    ]);
    expect(result.huespedes).toHaveLength(0);
    // Solo habitaciones y quién está alojado: no lee personas.
    expect(H.consultas.map((c) => c.table)).toEqual(["rooms", "reservations"]);
  });

  it("una habitación inactiva no aparece", async () => {
    const result = await searchGlobal("10");
    expect(result.habitaciones).toHaveLength(0);
  });

  it("con una letra no consulta nada", async () => {
    const result = await searchGlobal("j");
    expect(result).toEqual({ habitaciones: [], huespedes: [], empresas: [], pasajeros: [] });
    expect(H.consultas).toHaveLength(0);
  });
});
