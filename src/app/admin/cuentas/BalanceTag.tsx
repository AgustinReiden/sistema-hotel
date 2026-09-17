/**
 * El saldo de una cuenta corriente, siempre dicho con la palabra: "debe" o "a favor".
 * El signo solo se lee mal (un −$5.000 puede entenderse como deuda o como crédito),
 * y esta etiqueta la leen recepcionistas apurados.
 *
 * Vive en su propio archivo porque la usan LAS DOS pantallas: el listado de saldos
 * (CuentasClient) y la ficha del cliente (FichaClienteModal). Si viviera en una de
 * ellas, la otra tendría que importarla y quedarían atadas sin motivo.
 */

/** Valor absoluto: el "debe"/"a favor" ya dice de qué lado está. */
export function money(n: number) {
  return `$${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
}

export default function BalanceTag({ balance }: { balance: number }) {
  if (balance > 0) {
    return <span className="font-bold text-red-600">{money(balance)} debe</span>;
  }
  if (balance < 0) {
    return <span className="font-bold text-emerald-600">{money(balance)} a favor</span>;
  }
  return <span className="font-semibold text-slate-400">$0,00</span>;
}
