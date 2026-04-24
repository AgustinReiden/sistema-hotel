import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertTriangle, Clock, User } from "lucide-react";

import { getCurrentUserRole, getHotelSettings, listShifts } from "@/lib/data";
import { formatAmount, formatShiftCode, formatSignedAmount } from "@/lib/format";
import { formatHotelDateTime } from "@/lib/time";

export const revalidate = 0;

function formatMoney(n: number | null) {
  if (n === null) return "---";
  return formatAmount(n);
}

export default async function CajaRendicionesPage() {
  const [shifts, role, hotelSettings] = await Promise.all([
    listShifts({ limit: 60 }),
    getCurrentUserRole(),
    getHotelSettings().catch(() => null),
  ]);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
  const isAdmin = role === "admin";

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
          <h1 className="text-3xl font-bold text-slate-900 mb-1">Rendiciones de Caja</h1>
          <p className="text-slate-500">
            {isAdmin
              ? "Historial de todos los turnos abiertos y cerrados por el personal."
              : "Historial de tus turnos."}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {shifts.length === 0 ? (
          <div className="p-10 text-center text-slate-500 font-medium">
            Todavia no hay turnos registrados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Estado</th>
                  <th className="text-left px-4 py-3 font-semibold">Turno</th>
                  {isAdmin && (
                    <th className="text-left px-4 py-3 font-semibold">Recepcionista</th>
                  )}
                  <th className="text-left px-4 py-3 font-semibold">Abierto</th>
                  <th className="text-left px-4 py-3 font-semibold">Cerrado</th>
                  <th className="text-right px-4 py-3 font-semibold">Esperado</th>
                  <th className="text-right px-4 py-3 font-semibold">Efectivo</th>
                  <th className="text-right px-4 py-3 font-semibold">Diferencia</th>
                  <th className="text-right px-4 py-3 font-semibold">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shifts.map((shift) => {
                  const diff = shift.discrepancy;
                  return (
                    <tr key={shift.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        {shift.status === "open" ? (
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
                      <td className="px-4 py-3 font-mono font-semibold text-slate-700">
                        #{formatShiftCode(shift.shift_number)}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-slate-700 font-semibold">
                            <User size={12} className="text-slate-400" />
                            {shift.opened_by_name ?? "---"}
                          </span>
                          {shift.closed_by_name &&
                            shift.closed_by_name !== shift.opened_by_name && (
                              <p className="text-[11px] text-slate-400 mt-0.5 ml-5">
                                Cerro: {shift.closed_by_name}
                              </p>
                            )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-slate-700">
                        {formatHotelDateTime(shift.opened_at, tz)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {shift.closed_at ? formatHotelDateTime(shift.closed_at, tz) : "---"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {formatMoney(shift.expected_cash)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {formatMoney(shift.actual_cash)}
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
                        {formatSignedAmount(diff)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/caja/rendiciones/${shift.id}`}
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
