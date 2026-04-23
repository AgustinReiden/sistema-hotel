import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

import { listShifts } from "@/lib/data";

export const revalidate = 0;

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(n: number | null) {
  if (n === null) return "—";
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function CajaReportesPage() {
  const shifts = await listShifts({ limit: 60 });

  return (
    <div className="p-8 pb-20 overflow-y-auto w-full">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/caja"
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-2"
          >
            <ArrowLeft size={14} />
            Volver a Caja
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">Reportes de Caja</h1>
          <p className="text-slate-500">Historial de turnos abiertos y cerrados.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {shifts.length === 0 ? (
          <div className="p-10 text-center text-slate-500 font-medium">
            Todavía no hay turnos registrados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Estado</th>
                  <th className="text-left px-4 py-3 font-semibold">Abierto</th>
                  <th className="text-left px-4 py-3 font-semibold">Cerrado</th>
                  <th className="text-right px-4 py-3 font-semibold">Esperado</th>
                  <th className="text-right px-4 py-3 font-semibold">Contado</th>
                  <th className="text-right px-4 py-3 font-semibold">Diferencia</th>
                  <th className="text-right px-4 py-3 font-semibold">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shifts.map((s) => {
                  const diff = s.discrepancy;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        {s.status === "open" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
                            <Clock size={12} />
                            Abierto
                          </span>
                        ) : diff === 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
                            <CheckCircle2 size={12} />
                            Cuadrado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
                            <AlertTriangle size={12} />
                            Con diferencia
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDateTime(s.opened_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDateTime(s.closed_at)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {formatMoney(s.expected_cash)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {formatMoney(s.actual_cash)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          diff === null
                            ? "text-slate-400"
                            : diff === 0
                              ? "text-emerald-600"
                              : diff > 0
                                ? "text-blue-600"
                                : "text-red-600"
                        }`}
                      >
                        {diff === null ? "—" : (diff > 0 ? "+" : "") + formatMoney(diff)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/caja/reportes/${s.id}`}
                          className="text-brand-600 hover:text-brand-700 font-bold text-xs"
                        >
                          Ver / Imprimir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
