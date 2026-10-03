// Saldos por cobrar de Cobros del día, partidos en dos números que no se mezclan:
// lo que deben los que están alojados (plata que ya se consumió) y lo reservado que
// todavía no se cobró (gente que aún no llegó). Módulo puro, sin acceso a la base.

export type FilaSaldo = {
  status: string;
  total_price: number | string;
  paid_amount: number | string;
};

export type GrupoSaldo = "alojado" | "por_llegar";

export type ItemSaldo<T extends FilaSaldo> = T & { saldo: number; grupo: GrupoSaldo };

export type TotalSaldo = { total: number; cantidad: number };

const aCentavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Recibe reservas `checked_in` y `confirmed` (cualquier otro estado se ignora) y devuelve
 * las que tienen saldo, en el mismo orden, con el grupo y el saldo de cada una, más el
 * total y la cantidad de cada grupo. Lo pagado de más no genera saldo.
 */
export function partirSaldosPorCobrar<T extends FilaSaldo>(
  rows: T[]
): { items: ItemSaldo<T>[]; alojados: TotalSaldo; reservados: TotalSaldo } {
  const items: ItemSaldo<T>[] = [];
  const alojados: TotalSaldo = { total: 0, cantidad: 0 };
  const reservados: TotalSaldo = { total: 0, cantidad: 0 };

  for (const row of rows) {
    const grupo: GrupoSaldo | null =
      row.status === "checked_in" ? "alojado" : row.status === "confirmed" ? "por_llegar" : null;
    if (!grupo) continue;
    const saldo = aCentavos(Number(row.total_price) - Number(row.paid_amount));
    if (!(saldo > 0)) continue;
    items.push({ ...row, saldo, grupo });
    const destino = grupo === "alojado" ? alojados : reservados;
    destino.total = aCentavos(destino.total + saldo);
    destino.cantidad += 1;
  }

  return { items, alojados, reservados };
}
