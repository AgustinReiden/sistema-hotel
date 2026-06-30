"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, DollarSign, Loader2, ScrollText, Search, UserRound, Wallet, X } from "lucide-react";
import { toast } from "sonner";

import { loadCtaCteAccountAction, registerAccountPaymentAction } from "./actions";
import type { CtaCteAccount, CtaCteMovimiento } from "@/lib/types";

function money(n: number) {
  return `$${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
}

function BalanceTag({ balance }: { balance: number }) {
  if (balance > 0) {
    return <span className="font-bold text-red-600">{money(balance)} debe</span>;
  }
  if (balance < 0) {
    return <span className="font-bold text-emerald-600">{money(balance)} a favor</span>;
  }
  return <span className="font-semibold text-slate-400">$0,00</span>;
}

export default function CuentasClient({ accounts }: { accounts: CtaCteAccount[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [payTarget, setPayTarget] = useState<CtaCteAccount | null>(null);
  const [movTarget, setMovTarget] = useState<CtaCteAccount | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.document_id ?? "").toLowerCase().includes(q)
    );
  }, [accounts, query]);

  return (
    <>
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <div className="relative max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o DNI/CUIT…"
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              <th className="px-6 py-4">Cliente</th>
              <th className="px-6 py-4">Tipo</th>
              <th className="px-6 py-4">DNI/CUIT</th>
              <th className="px-6 py-4">Saldo</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((a) => (
              <tr key={`${a.kind}-${a.id}`} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-900">{a.name}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
                    {a.kind === "company" ? (
                      <>
                        <Building2 size={14} className="text-sky-600" /> Empresa
                      </>
                    ) : (
                      <>
                        <UserRound size={14} className="text-emerald-600" /> Huésped
                      </>
                    )}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">{a.document_id || "—"}</td>
                <td className="px-6 py-4 text-sm">
                  <BalanceTag balance={a.balance} />
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setMovTarget(a)}
                      className="inline-flex items-center justify-center p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Ver movimientos"
                    >
                      <ScrollText size={18} />
                    </button>
                    <button
                      onClick={() => setPayTarget(a)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                      title="Registrar pago a cuenta"
                    >
                      <DollarSign size={16} /> Pago
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          {query ? "No hay cuentas que coincidan." : "No hay clientes con cuenta corriente habilitada."}
        </div>
      )}

      {payTarget && (
        <RegisterPaymentModal
          account={payTarget}
          onClose={() => setPayTarget(null)}
          onSaved={() => {
            setPayTarget(null);
            router.refresh();
          }}
        />
      )}

      {movTarget && <MovementsModal account={movTarget} onClose={() => setMovTarget(null)} />}
    </>
  );
}

const METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "bank_transfer", label: "Transferencia" },
  { value: "mercado_pago", label: "Mercado Pago" },
  { value: "other", label: "Otro" },
];

function RegisterPaymentModal({
  account,
  onClose,
  onSaved,
}: {
  account: CtaCteAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(account.balance > 0 ? account.balance.toString() : "");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("El monto debe ser mayor a 0.");
      return;
    }
    setSaving(true);
    const result = await registerAccountPaymentAction({
      kind: account.kind,
      clientId: account.id,
      amount: parsed,
      method,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (result.success) {
      toast.success("Pago a cuenta registrado.");
      onSaved();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Wallet size={18} className="text-emerald-600" />
            Registrar pago a cuenta
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">{account.name}</p>
            <p className="text-slate-500">
              Saldo actual: <BalanceTag balance={account.balance} />
            </p>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Monto</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-lg font-bold"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Método (informativo)</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              No impacta el arqueo de caja; queda como registro de la cuenta corriente.
            </p>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Notas</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              placeholder="Opcional. Ej. comprobante N° / transferencia"
            />
          </div>
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
              Registrar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MovementsModal({ account, onClose }: { account: CtaCteAccount; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [movements, setMovements] = useState<CtaCteMovimiento[]>([]);
  const [balance, setBalance] = useState(account.balance);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadCtaCteAccountAction(account.kind, account.id);
      if (!active) return;
      if (result.success && result.data) {
        setMovements(result.data.movements);
        setBalance(result.data.balance);
      } else if (!result.success) {
        toast.error(result.error);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [account.kind, account.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{account.name}</h2>
            <p className="text-sm text-slate-500">
              Saldo: <BalanceTag balance={balance} />
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center text-slate-500 py-8">
              <Loader2 size={20} className="animate-spin mr-2" /> Cargando…
            </div>
          ) : movements.length === 0 ? (
            <p className="text-center text-slate-500 py-8">Sin movimientos.</p>
          ) : (
            <div className="space-y-2">
              {movements.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {m.tipo === "cargo" ? "Cargo (estadía)" : "Pago a cuenta"}
                      {m.payment_method ? ` · ${m.payment_method}` : ""}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(m.created_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                      {m.notes ? ` · ${m.notes}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-bold ${m.tipo === "cargo" ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {m.tipo === "cargo" ? "+" : "−"}
                    {money(m.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
