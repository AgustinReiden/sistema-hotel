"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X, Wallet } from "lucide-react";
import { toast } from "sonner";

import { closeShiftAction } from "./actions";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  openingCash: number;
  cashIncome: number;
};

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CloseShiftModal({
  isOpen,
  onClose,
  shiftId,
  openingCash,
  cashIncome,
}: Props) {
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const expected = openingCash + cashIncome;
  const parsedActual = parseFloat(actualCash.replace(",", "."));
  const diff = !isNaN(parsedActual) ? parsedActual - expected : null;

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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
              <Wallet size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Cerrar Turno</h2>
              <p className="text-slate-500 text-sm font-medium">
                Conta el efectivo real y cerramos la caja.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Efectivo inicial</span>
              <span className="font-semibold text-slate-800">${formatMoney(openingCash)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">+ Cobros en efectivo</span>
              <span className="font-semibold text-emerald-600">${formatMoney(cashIncome)}</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between">
              <span className="font-bold text-slate-700">= Esperado en caja</span>
              <span className="font-bold text-slate-900 text-lg">${formatMoney(expected)}</span>
            </div>
          </div>

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
                    Esta diferencia queda registrada en el cierre del turno.
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

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Wallet size={18} />}
              Cerrar Turno
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
