"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { handleAddExtraCharge } from "./actions";

type ChargeType = "minibar" | "damage" | "service" | "other";

const CHARGE_TYPES: Array<{ value: ChargeType; label: string; description: string }> = [
  { value: "minibar", label: "Minibar", description: "Consumo de bebidas/snacks" },
  { value: "damage", label: "Daño", description: "Rotura o faltante" },
  { value: "service", label: "Servicio", description: "Spa, lavandería, etc." },
  { value: "other", label: "Otro", description: "Describí el motivo" },
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  reservationId: string;
  clientName: string;
  currentTotal: number;
};

export default function ExtraChargesModal({
  isOpen,
  onClose,
  reservationId,
  clientName,
  currentTotal,
}: Props) {
  const [chargeType, setChargeType] = useState<ChargeType>("minibar");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const parsedAmount = parseFloat(amount.replace(",", "."));
  const newTotal = !isNaN(parsedAmount) && parsedAmount > 0 ? currentTotal + parsedAmount : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Ingresá un monto mayor a 0.");
      return;
    }
    if (chargeType === "other" && !description.trim()) {
      setError('Para cargos "Otro" es obligatorio describir.');
      return;
    }

    setLoading(true);
    const result = await handleAddExtraCharge(reservationId, chargeType, parsedAmount, description.trim());
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success(`Cargo de $${parsedAmount.toLocaleString("es-AR", { minimumFractionDigits: 2 })} agregado.`);
    setAmount("");
    setDescription("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Plus size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Cargar Extra</h2>
              <p className="text-slate-500 text-sm font-medium truncate">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Tipo de cargo</label>
            <div className="grid grid-cols-2 gap-2">
              {CHARGE_TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`flex flex-col p-3 border rounded-xl cursor-pointer transition-colors ${
                    chargeType === t.value
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="chargeType"
                    value={t.value}
                    checked={chargeType === t.value}
                    onChange={() => setChargeType(t.value)}
                    className="sr-only"
                  />
                  <span className={`text-sm font-bold ${chargeType === t.value ? "text-indigo-700" : "text-slate-700"}`}>
                    {t.label}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5">{t.description}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="extra-amount" className="block text-sm font-bold text-slate-700 mb-2">
              Monto ($)
            </label>
            <input
              id="extra-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring focus:ring-indigo-200 outline-none text-xl font-bold text-slate-800"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="extra-desc" className="block text-sm font-bold text-slate-700 mb-2">
              Descripción {chargeType === "other" ? "(obligatoria)" : "(opcional)"}
            </label>
            <textarea
              id="extra-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder={chargeType === "minibar" ? "Ej. 2x Coca + Mani" : "Detalle del cargo..."}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring outline-none resize-none text-sm"
            />
          </div>

          {newTotal !== null && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm flex justify-between">
              <span className="text-slate-600">Nuevo total de la reserva</span>
              <span className="font-bold text-slate-900">
                ${newTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {error && <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">{error}</p>}

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
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              Cargar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
