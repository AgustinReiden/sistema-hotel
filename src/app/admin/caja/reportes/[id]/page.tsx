import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { getShiftSummary } from "@/lib/data";
import PrintButton from "./PrintButton";

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

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  mercado_pago: "Mercado Pago",
  bank_transfer: "Transferencia",
  credit_card: "Tarjeta Crédito",
  debit_card: "Tarjeta Débito",
  vale_blanco: "Vale Blanco",
  cuenta_corriente: "Cta. Corriente",
  other: "Otro",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function ShiftReportPage({ params }: PageProps) {
  const { id } = await params;
  const summary = await getShiftSummary(id);
  if (!summary) notFound();

  const { shift, totalsByMethod, totalIncome, cashIncome, payments, openedByEmail, closedByEmail } = summary;

  return (
    <div className="p-8 pb-20 overflow-y-auto w-full max-w-3xl mx-auto print:p-0 print:max-w-none">
      {/* Header (oculto al imprimir) */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href="/admin/caja/reportes"
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          <ArrowLeft size={14} />
          Volver
        </Link>
        <PrintButton />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 print:border-none print:shadow-none print:rounded-none">
        <div className="text-center mb-6 pb-6 border-b border-slate-200">
          <h1 className="text-2xl font-bold text-slate-900">Cierre de Caja</h1>
          <p className="text-sm text-slate-500 mt-1">
            Hotel El Refugio · Turno #{shift.id.slice(0, 8)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Abierto</p>
            <p className="text-slate-800 font-semibold">{formatDateTime(shift.opened_at)}</p>
            <p className="text-xs text-slate-500 mt-0.5">por {openedByEmail ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cerrado</p>
            <p className="text-slate-800 font-semibold">{formatDateTime(shift.closed_at)}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              por {closedByEmail ?? (shift.status === "open" ? "— (abierto)" : "—")}
            </p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
            Reconciliación de Efectivo
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Efectivo inicial</span>
              <span className="font-semibold text-slate-800">
                {formatMoney(shift.opening_cash)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">+ Cobros en efectivo</span>
              <span className="font-semibold text-emerald-600">{formatMoney(cashIncome)}</span>
            </div>
            <div className="border-t border-slate-300 pt-2 flex justify-between">
              <span className="font-bold text-slate-700">Esperado</span>
              <span className="font-bold text-slate-900">
                {formatMoney(shift.expected_cash)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Efectivo contado</span>
              <span className="font-semibold text-slate-800">{formatMoney(shift.actual_cash)}</span>
            </div>
            <div
              className={`border-t border-slate-300 pt-2 flex justify-between text-base ${
                shift.discrepancy === null
                  ? "text-slate-500"
                  : shift.discrepancy === 0
                    ? "text-emerald-700"
                    : shift.discrepancy > 0
                      ? "text-blue-700"
                      : "text-red-700"
              }`}
            >
              <span className="font-bold">Diferencia</span>
              <span className="font-bold">
                {shift.discrepancy === null
                  ? "—"
                  : (shift.discrepancy > 0 ? "+" : "") + formatMoney(shift.discrepancy)}
              </span>
            </div>
          </div>
          {shift.notes && (
            <p className="mt-4 text-xs text-slate-600 border-t border-slate-200 pt-3">
              <span className="font-bold">Notas:</span> {shift.notes}
            </p>
          )}
        </div>

        <div className="mb-6">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
            Desglose por Método
          </h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {Object.entries(totalsByMethod)
                .filter(([, v]) => v > 0)
                .map(([method, amount]) => (
                  <tr key={method}>
                    <td className="py-2 text-slate-600">
                      {METHOD_LABELS[method] ?? method}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-800">
                      {formatMoney(amount)}
                    </td>
                  </tr>
                ))}
              <tr className="border-t-2 border-slate-300">
                <td className="py-2 font-bold text-slate-900">Total cobrado</td>
                <td className="py-2 text-right font-bold text-slate-900">
                  {formatMoney(totalIncome)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
            Detalle de Pagos ({payments.length})
          </h2>
          {payments.length === 0 ? (
            <p className="text-sm text-slate-500 italic">Sin pagos en este turno.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 font-semibold">Hora</th>
                  <th className="text-left py-2 font-semibold">Huésped</th>
                  <th className="text-left py-2 font-semibold">Hab.</th>
                  <th className="text-left py-2 font-semibold">Método</th>
                  <th className="text-right py-2 font-semibold">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 text-slate-600">
                      {new Date(p.created_at).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2 text-slate-700 font-medium">{p.client_name}</td>
                    <td className="py-2 text-slate-600">{p.room_number ?? "—"}</td>
                    <td className="py-2 text-slate-600">
                      {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-800">
                      {formatMoney(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-10 pt-6 border-t border-slate-200 text-center text-xs text-slate-400 print:mt-16">
          <p>Firma recepcionista: ___________________________</p>
          <p className="mt-4">Impreso: {formatDateTime(new Date().toISOString())}</p>
        </div>
      </div>
    </div>
  );
}
