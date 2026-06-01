"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Building2, CreditCard, Loader2, Percent, X } from "lucide-react";

import { loadAssociatedClientLedgerAction } from "./actions";
import type { AssociatedClient, AssociatedClientLedger } from "@/lib/types";

function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  checked_in: { label: "Hospedado", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  confirmed: { label: "Por llegar", cls: "bg-blue-100 text-blue-800 border-blue-200" },
  pending: { label: "Por llegar", cls: "bg-blue-100 text-blue-800 border-blue-200" },
  checked_out: { label: "Finalizado", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  cancelled: { label: "Cancelado", cls: "bg-red-50 text-red-700 border-red-200" },
};

type Props = {
  client: AssociatedClient | null;
  onClose: () => void;
};

export default function AssociatedClientLedgerModal({ client, onClose }: Props) {
  const [ledger, setLedger] = useState<AssociatedClientLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setLoading(true);
        setError(null);
        setLedger(null);
        return loadAssociatedClientLedgerAction(client.id);
      })
      .then((res) => {
        if (cancelled || !res) return;
        setLoading(false);
        if (res.success) setLedger(res.data ?? null);
        else setError(res.error);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!client) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
              <Building2 size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-800 truncate">{client.display_name}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <CreditCard size={12} />
                  {client.document_id}
                </span>
                <span className="flex items-center gap-1 text-emerald-600 font-bold">
                  <Percent size={12} />
                  {client.discount_percent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}% desc.
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="animate-spin mr-2" size={20} /> Cargando ficha…
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>
          ) : ledger ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Total facturado</p>
                  <p className="text-2xl font-bold text-slate-900">${money(ledger.facturado)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Cobrado</p>
                  <p className="text-2xl font-bold text-emerald-600">${money(ledger.cobrado)}</p>
                </div>
                <div
                  className={`rounded-xl border p-4 ${
                    ledger.saldo > 0 ? "border-red-200 bg-red-50" : "border-slate-200"
                  }`}
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Saldo (deuda)</p>
                  <p className={`text-2xl font-bold ${ledger.saldo > 0 ? "text-red-600" : "text-slate-900"}`}>
                    ${money(ledger.saldo)}
                  </p>
                </div>
              </div>

              <h3 className="text-sm font-bold text-slate-700 mb-2">
                Historial de estadías ({ledger.count})
              </h3>
              {ledger.reservations.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm border border-dashed border-slate-200 rounded-xl">
                  Este asociado todavía no tiene estadías registradas.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Fecha</th>
                        <th className="px-3 py-2">Hab.</th>
                        <th className="px-3 py-2">Pasajero</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Pagado</th>
                        <th className="px-3 py-2 text-right">Saldo</th>
                        <th className="px-3 py-2">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ledger.reservations.map((r) => {
                        const saldo = Math.max(0, r.total_price - r.paid_amount);
                        const st = STATUS_LABEL[r.status] ?? STATUS_LABEL.checked_out;
                        return (
                          <tr key={r.id} className={r.status === "cancelled" ? "opacity-50" : ""}>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {format(new Date(r.check_in_target), "dd MMM yy", { locale: es })}
                            </td>
                            <td className="px-3 py-2">{r.room_number ?? "—"}</td>
                            <td className="px-3 py-2 text-xs text-slate-600 max-w-[200px] truncate">
                              {r.passenger ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right">${money(r.total_price)}</td>
                            <td className="px-3 py-2 text-right text-emerald-600">${money(r.paid_amount)}</td>
                            <td
                              className={`px-3 py-2 text-right font-semibold ${
                                saldo > 0 ? "text-red-600" : "text-slate-500"
                              }`}
                            >
                              ${money(saldo)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold border ${st.cls}`}>
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
