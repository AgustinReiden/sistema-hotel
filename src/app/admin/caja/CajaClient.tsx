"use client";

import { useState } from "react";
import Link from "next/link";
import { Wallet, DollarSign, Banknote, CreditCard, Landmark, FileText, Clock, CircleDollarSign } from "lucide-react";

import OpenShiftModal from "./OpenShiftModal";
import CloseShiftModal from "./CloseShiftModal";
import { formatHotelTime, formatHotelDateTime } from "@/lib/time";
import type { ShiftSummary } from "@/lib/types";

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const METHOD_META: Record<string, { label: string; icon: React.ReactNode }> = {
  cash: { label: "Efectivo", icon: <Banknote size={16} /> },
  mercado_pago: { label: "Mercado Pago", icon: <Wallet size={16} className="text-blue-500" /> },
  bank_transfer: { label: "Transferencia", icon: <Landmark size={16} /> },
  credit_card: { label: "T. Crédito", icon: <CreditCard size={16} /> },
  debit_card: { label: "T. Débito", icon: <CreditCard size={16} /> },
  vale_blanco: { label: "Vale Blanco", icon: <Banknote size={16} className="text-slate-400" /> },
  cuenta_corriente: { label: "Cta. Cte.", icon: <Wallet size={16} className="text-purple-500" /> },
  other: { label: "Otro", icon: <Wallet size={16} /> },
};

type Props = {
  summary: ShiftSummary | null;
  isAdmin: boolean;
  hotelTimezone: string;
};

export default function CajaClient({ summary, isAdmin, hotelTimezone }: Props) {
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);

  return (
    <div className="p-8 pb-20 overflow-y-auto w-full">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Caja</h1>
          <p className="text-slate-500">
            Control del turno: abrir, registrar cobros y cerrar contando el efectivo.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            href="/admin/caja/rendiciones"
            className={
              isAdmin
                ? "px-5 py-3 text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-sm transition-colors flex items-center gap-2"
                : "px-4 py-2 text-sm font-bold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors flex items-center gap-2"
            }
          >
            <FileText size={isAdmin ? 18 : 16} />
            {isAdmin ? "Ver Rendiciones" : "Mis Rendiciones"}
          </Link>
        </div>
      </div>

      {!summary ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
          <div className="inline-flex w-16 h-16 rounded-full bg-slate-100 text-slate-400 items-center justify-center mb-4">
            <Wallet size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">No hay turno abierto</h2>
          <p className="text-slate-500 mb-6 max-w-md mx-auto">
            Para poder cobrar pagos y checkouts necesitas abrir la caja primero.
          </p>
          <button
            onClick={() => setOpenModalOpen(true)}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm transition-colors inline-flex items-center gap-2"
          >
            <DollarSign size={18} />
            Abrir Caja
          </button>
          <OpenShiftModal isOpen={openModalOpen} onClose={() => setOpenModalOpen(false)} />
        </div>
      ) : (
        <>
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Clock size={22} />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  Turno Abierto
                </p>
                <p className="text-lg font-bold text-slate-800">
                  Desde {formatHotelTime(summary.shift.opened_at, hotelTimezone)}
                  <span className="text-slate-500 font-normal text-sm ml-2">
                    ({formatHotelDateTime(summary.shift.opened_at, hotelTimezone)})
                  </span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Abrio: {summary.openedByEmail ?? "—"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setCloseModalOpen(true)}
              className="w-full sm:w-auto px-5 py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <Wallet size={18} />
              Cerrar Turno
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
                <CircleDollarSign size={14} />
                Total Cobrado
              </div>
              <p className="text-3xl font-bold text-slate-900">
                ${formatMoney(summary.totalIncome)}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                {summary.paymentsCount} pago{summary.paymentsCount === 1 ? "" : "s"} en el turno
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
                <Banknote size={14} />
                Efectivo del turno
              </div>
              <p className="text-3xl font-bold text-emerald-600">
                ${formatMoney(summary.cashIncome)}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Lo que hay que rendir en efectivo.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
                <Wallet size={14} />
                Otros medios
              </div>
              <p className="text-3xl font-bold text-slate-900">
                ${formatMoney(summary.totalIncome - summary.cashIncome)}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Tarjetas, transferencias, vales, etc.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Desglose por método</h3>
              <ul className="space-y-3">
                {Object.entries(summary.totalsByMethod).map(([method, amount]) => {
                  const meta = METHOD_META[method] ?? METHOD_META.other;
                  if (amount === 0) return null;
                  return (
                    <li key={method} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-600 font-medium">
                        {meta.icon}
                        {meta.label}
                      </span>
                      <span className="font-bold text-slate-800">
                        ${formatMoney(amount)}
                      </span>
                    </li>
                  );
                })}
                {summary.totalIncome === 0 && (
                  <li className="text-sm text-slate-500 italic">Sin cobros todavía.</li>
                )}
              </ul>
            </div>

            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50">
                <h3 className="text-lg font-bold text-slate-800">Pagos del turno</h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
                {summary.payments.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 font-medium text-sm">
                    Todavía no se registraron pagos en este turno.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {summary.payments.map((p) => {
                      const meta = METHOD_META[p.payment_method] ?? METHOD_META.other;
                      return (
                        <li
                          key={p.id}
                          className="p-4 hover:bg-slate-50 flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                              {meta.icon}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-800 text-sm truncate">
                                {p.client_name}
                                {p.room_number && (
                                  <span className="text-slate-500 font-normal">
                                    {" "}(Hab. {p.room_number})
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatHotelTime(p.created_at, hotelTimezone)} · {meta.label}
                              </p>
                            </div>
                          </div>
                          <span className="font-bold text-emerald-600 shrink-0">
                            +${formatMoney(p.amount)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <CloseShiftModal
            isOpen={closeModalOpen}
            onClose={() => setCloseModalOpen(false)}
            shiftId={summary.shift.id}
            cashIncome={summary.cashIncome}
            totalsByMethod={summary.totalsByMethod}
          />
        </>
      )}
    </div>
  );
}
