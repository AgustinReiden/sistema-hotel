"use client";

import { BedDouble, DoorOpen, TriangleAlert, X } from "lucide-react";

function money(n: number) {
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
}

type Props = {
  clientName: string;
  reservedUntilLabel: string;
  departureLabel: string;
  originalNights: number;
  chargedNights: number;
  originalTotal: number;
  newTotal: number;
  newBalance: number;
  paidAmount: number;
  isOverpaid: boolean;
  isPending: boolean;
  onChargeEarly: () => void;
  onChargeFull: () => void;
  onClose: () => void;
};

/**
 * Paso de "salida anticipada": el huésped se va antes de la fecha reservada.
 * Muestra el recálculo (noches reservadas vs. a cobrar, total viejo vs. nuevo) y
 * deja elegir explícitamente entre cobrar solo lo dormido o la reserva completa.
 */
export default function EarlyCheckoutModal({
  clientName,
  reservedUntilLabel,
  departureLabel,
  originalNights,
  chargedNights,
  originalTotal,
  newTotal,
  newBalance,
  paidAmount,
  isOverpaid,
  isPending,
  onChargeEarly,
  onChargeFull,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden relative">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <DoorOpen size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Salida anticipada</h2>
              <p className="text-slate-500 text-sm font-medium">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-slate-600 mb-5">
            Reservó hasta el <strong>{reservedUntilLabel}</strong> ({originalNights} noche
            {originalNights === 1 ? "" : "s"}). Se retira el <strong>{departureLabel}</strong>.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                <BedDouble size={13} />
                A cobrar
              </p>
              <p className="text-lg font-bold text-slate-800">
                {chargedNights} noche{chargedNights === 1 ? "" : "s"}
              </p>
              <p className="text-sm font-bold text-emerald-700">{money(newTotal)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Reserva completa
              </p>
              <p className="text-lg font-bold text-slate-500">
                {originalNights} noche{originalNights === 1 ? "" : "s"}
              </p>
              <p className="text-sm font-bold text-slate-500">{money(originalTotal)}</p>
            </div>
          </div>

          {isOverpaid ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <TriangleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                El huésped ya pagó <strong>{money(paidAmount)}</strong> y por {chargedNights} noche
                {chargedNights === 1 ? "" : "s"} le corresponde <strong>{money(newTotal)}</strong>:
                queda un saldo a favor. Esta salida anticipada la tiene que cerrar un administrador.
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-600">Saldo a cobrar ahora</span>
              <span className="text-xl font-bold text-amber-600">{money(newBalance)}</span>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3 justify-end bg-slate-50">
          <button
            type="button"
            onClick={onChargeFull}
            disabled={isPending}
            className="px-4 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-60"
          >
            Cobrar reserva completa
          </button>
          <button
            type="button"
            onClick={onChargeEarly}
            disabled={isPending || isOverpaid}
            className="px-4 py-2.5 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <DoorOpen size={18} />
            Cobrar {chargedNights} noche{chargedNights === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
