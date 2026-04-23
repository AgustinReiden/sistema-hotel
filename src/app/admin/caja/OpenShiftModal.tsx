"use client";

import { useState } from "react";
import { DollarSign, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { openShiftAction } from "./actions";

export default function OpenShiftModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [openingCash, setOpeningCash] = useState("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseFloat(openingCash.replace(",", "."));
    if (isNaN(parsed) || parsed < 0) {
      setError("Ingresa un monto valido (cero o mayor).");
      return;
    }

    setLoading(true);
    const result = await openShiftAction({ openingCash: parsed });
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success("Caja abierta. Ya podes cobrar.");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <DollarSign size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Abrir Caja</h2>
              <p className="text-slate-500 text-sm font-medium">
                Empieza tu turno para registrar pagos.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label htmlFor="opening-cash" className="block text-sm font-bold text-slate-700 mb-2">
              Efectivo inicial en caja ($)
            </label>
            <input
              id="opening-cash"
              type="number"
              step="0.01"
              min="0"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none text-xl font-bold text-slate-800"
              required
              autoFocus
            />
            <p className="mt-2 text-xs text-slate-500">
              Conta el efectivo que tenes fisicamente antes de empezar. Si arrancas con caja vacia, deja en 0.
            </p>
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
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <DollarSign size={18} />}
              Abrir Caja
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
