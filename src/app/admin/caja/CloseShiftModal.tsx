"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Landmark,
  Loader2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { closeShiftAction } from "./actions";
import type { PaymentMethod } from "@/lib/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  cashIncome: number;
  totalsByMethod: Record<PaymentMethod, number>;
};

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const METHOD_META: Record<PaymentMethod, { label: string; icon: React.ReactNode }> = {
  cash: { label: "Efectivo", icon: <Banknote size={14} /> },
  mercado_pago: { label: "Mercado Pago", icon: <Wallet size={14} className="text-blue-500" /> },
  bank_transfer: { label: "Transferencia", icon: <Landmark size={14} /> },
  credit_card: { label: "Tarjeta Crédito", icon: <CreditCard size={14} /> },
  debit_card: { label: "Tarjeta Débito", icon: <CreditCard size={14} /> },
  vale_blanco: { label: "Vale Blanco", icon: <Banknote size={14} className="text-slate-400" /> },
  cuenta_corriente: { label: "Cta. Corriente", icon: <Wallet size={14} className="text-purple-500" /> },
  other: { label: "Otro", icon: <Wallet size={14} /> },
};

export default function CloseShiftModal({
  isOpen,
  onClose,
  shiftId,
  cashIncome,
  totalsByMethod,
}: Props) {
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const expected = cashIncome;
  const parsedActual = parseFloat(actualCash.replace(",", "."));
  const diff = !isNaN(parsedActual) ? parsedActual - expected : null;

  // Otros métodos (no efectivo) que el recepcionista también debe declarar/rendir
  const otherMethods = (Object.entries(totalsByMethod) as [PaymentMethod, number][])
    .filter(([method, amount]) => method !== "cash" && amount > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isNaN(parsedActual) || parsedActual < 0) {
      setError("Ingresa el efectivo contado (cero o mayor).");
      return;
    }

    setLoading(true);
    const result = await closeShiftAction({
      shiftId,
      actualCash: parsedActual,
      notes: notes.trim() || undefined,
    });
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    const d = result.data!.discrepancy;
    if (d === 0) {
      toast.success("Turno cerrado: caja cuadra.");
    } else if (d > 0) {
      toast.success(`Turno cerrado con sobrante de $${formatMoney(d)}.`);
    } else {
      toast.warning(`Turno cerrado con faltante de $${formatMoney(Math.abs(d))}.`);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
              <Wallet size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Rendir Caja</h2>
              <p className="text-slate-500 text-sm font-medium">
                Conta el efectivo real y cerramos el turno.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Cobros en efectivo del turno</span>
              <span className="font-semibold text-emerald-600">${formatMoney(cashIncome)}</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between">
              <span className="font-bold text-slate-700">= Esperado en caja</span>
              <span className="font-bold text-slate-900 text-lg">${formatMoney(expected)}</span>
            </div>
          </div>

          {otherMethods.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-2">
                También debes rendir por otros medios
              </p>
              <ul className="space-y-1.5 text-sm">
                {otherMethods.map(([method, amount]) => {
                  const meta = METHOD_META[method] ?? METHOD_META.other;
                  return (
                    <li key={method} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-indigo-700 font-medium">
                        {meta.icon}
                        {meta.label}
                      </span>
                      <span className="font-bold text-indigo-900">${formatMoney(amount)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-indigo-600 mt-2">
                Verificá que lo cobrado por cada medio coincida con los comprobantes/transferencias.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="actual-cash" className="block text-sm font-bold text-slate-700 mb-2">
              Efectivo contado ($)
            </label>
            <input
              id="actual-cash"
              type="number"
              step="0.01"
              min="0"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none text-xl font-bold text-slate-800"
              placeholder="0.00"
              required
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">
              Si no hubo cobros en efectivo, puede ser 0.
            </p>
          </div>

          {diff !== null && (
            <div
              className={`rounded-xl p-4 flex items-center gap-3 border ${
                diff === 0
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : diff > 0
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              {diff === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <div className="flex-1">
                <p className="text-sm font-bold">
                  {diff === 0
                    ? "Caja cuadra"
                    : diff > 0
                      ? `Sobrante: +$${formatMoney(diff)}`
                      : `Faltante: -$${formatMoney(Math.abs(diff))}`}
                </p>
                {diff !== 0 && (
                  <p className="text-xs opacity-80">
                    Esta diferencia queda registrada en la rendición del turno.
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="close-notes" className="block text-sm font-bold text-slate-700 mb-2">
              Notas (opcional)
            </label>
            <textarea
              id="close-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ej. Devolvi vuelto a huesped de Hab 5 por $200."
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring outline-none resize-none text-sm"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">{error}</p>
          )}
        </form>

        <div className="p-6 border-t border-slate-100 flex gap-3 justify-end bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            disabled={loading}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Wallet size={18} />}
            Cerrar Turno
          </button>
        </div>
      </div>
    </div>
  );
}
