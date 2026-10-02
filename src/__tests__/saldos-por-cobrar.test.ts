import { describe, expect, it } from "vitest";

import { partirSaldosPorCobrar } from "@/lib/saldos-por-cobrar";

const fila = (id: number, status: string, total: number | string, pagado: number | string) => ({
  id,
  status,
  total_price: total,
  paid_amount: pagado,
});

describe("partirSaldosPorCobrar", () => {
  it("un alojado con deuda va a 'Deben los alojados'", () => {
    const r = partirSaldosPorCobrar([fila(1, "checked_in", 100000, 40000)]);
    expect(r.alojados).toEqual({ total: 60000, cantidad: 1 });
    expect(r.reservados).toEqual({ total: 0, cantidad: 0 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: 1, grupo: "alojado", saldo: 60000 });
  });

  it("una reserva confirmada que todavía no llegó va a 'Reservado sin cobrar'", () => {
    const r = partirSaldosPorCobrar([fila(2, "confirmed", 80000, 0)]);
    expect(r.reservados).toEqual({ total: 80000, cantidad: 1 });
    expect(r.alojados).toEqual({ total: 0, cantidad: 0 });
    expect(r.items[0]).toMatchObject({ id: 2, grupo: "por_llegar", saldo: 80000 });
  });

  it("lo que está pagado (o pagado de más) no suma ni aparece", () => {
    const r = partirSaldosPorCobrar([
      fila(3, "checked_in", 50000, 50000),
      fila(4, "confirmed", 50000, 70000),
    ]);
    expect(r.items).toEqual([]);
    expect(r.alojados.total).toBe(0);
    expect(r.reservados.total).toBe(0);
  });

  it("los montos pueden venir como texto (numeric de Postgres)", () => {
    const r = partirSaldosPorCobrar([fila(5, "checked_in", "1000.50", "0.25")]);
    expect(r.alojados.total).toBe(1000.25);
  });

  it("separa los dos grupos y no los mezcla en el total", () => {
    const r = partirSaldosPorCobrar([
      fila(1, "checked_in", 100, 0),
      fila(2, "confirmed", 200, 50),
      fila(3, "checked_in", 300, 100),
      fila(4, "checked_out", 999, 0),
    ]);
    expect(r.alojados).toEqual({ total: 300, cantidad: 2 });
    expect(r.reservados).toEqual({ total: 150, cantidad: 1 });
    expect(r.items.map((i) => i.id)).toEqual([1, 2, 3]);
  });
});
