"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  EyeOff,
  Landmark,
  Loader2,
  Printer,
  Wallet,
  X,
} from "lucide-react";

import { closeShiftAction } from "./actions";
import { logout } from "@/app/login/actions";
import type { PaymentMethod } from "@/lib/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  totalsByMethod: Record<PaymentMethod, number>;
};

type CloseResult = {
  expected_cash: number;
  actual_cash: number;
  discrepancy: number;
  shouldLogout: boolean;
};

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const METHOD_META: Record<PaymentMethod, { label: string; icon: ReactNode }> = {
  cash: { label: "Efectivo", icon: <Banknote size={14} /> },
  mercado_pago: { label: "Mercado Pago", icon: <Wallet size={14} className="text-blue-500" /> },
  bank_transfer: { label: "Transferencia", icon: <Landmark size={14} /> },
  credit_card: { label: "Tarjeta credito", icon: <CreditCard size={14} /> },
  debit_card: { label: "Tarjeta debito", icon: <CreditCard size={14} /> },
  vale_blanco: { label: "Vale Blanco", icon: <Banknote size={14} className="text-slate-400" /> },
  cuenta_corriente: {
    label: "Cta. Corriente",
    icon: <Wallet size={14} className="text-purple-500" />,
  },
  other: { label: "Otro", icon: <Wallet size={14} /> },
};

export default function CloseShiftModal({
  isOpen,
  onClose,
  shiftId,
  totalsByMethod,
}: Props) {
  const router = useRouter();
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<CloseResult | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Recepcionista: al cerrar la caja, abre el comprobante de rendicion (auto-imprime con
  // kiosk) y, dado un margen para que cargue con la sesion aun valida, cierra sesion.
  useEffect(() => {
    if (!closed?.shouldLogout) return;
    window.open(
      `/admin/caja/rendiciones/${shiftId}?autoprint=1`,
      `rendicion-${shiftId}`,
      "width=420,height=720"
    );
    const timer = window.setTimeout(() => {
      logout();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [closed, shiftId]);

  if (!isOpen) return null;

  const parsedActual = parseFloat(actualCash.replace(",", "."));
  const otherMethods = (Object.entries(totalsByMethod) as [PaymentMethod, number][])
    .filter(([method, amount]) => method !== "cash" && amount > 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isNaN(parsedActual) || parsedActual < 0) {
      setError("Ingresa el efectivo declarado (cero o mayor).");
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

    setClosed(result.data!);
  };

  const handleFinish = async () => {
    if (closed?.shouldLogout) {
      setFinishing(true);
      await logout(); // cierra sesion y redirige a /login
      return;
    }
    onClose();
    router.refresh();
  };

  // Vista de resultado: se muestra la rendicion una vez cerrada la caja.
  if (closed) {
    const d = closed.discrepancy;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
          <div className="p-6 text-center">
            <div className="inline-flex w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center mb-3">
              <CheckCircle2 size={28} />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-1">Caja cerrada</h2>
            <p className="text-sm text-slate-500 mb-5">
              {d === 0
                ? "La caja cuadra perfecto."
                : d > 0
                  ? `Quedo un sobrante de $${formatMoney(d)}.`
                  : `Quedo un faltante de $${formatMoney(Math.abs(d))}.`}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-xl border border-slate-200 p-3 text-left">
                <p className="text-xs text-slate-500">Efectivo esperado</p>
                <p className="font-bold text-slate-800">${formatMoney(closed.expected_cash)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-left">
                <p className="text-xs text-slate-500">Efectivo declarado</p>
                <p className="font-bold text-slate-800">${formatMoney(closed.actual_cash)}</p>
              </div>
            </div>
            {closed.shouldLogout ? (
              <>
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600">
                  <Loader2 className="animate-spin" size={18} />
                  Imprimiendo comprobante y cerrando sesion…
                </div>
                <p className="text-[11px] text-slate-400 mt-3">
                  La proxima vez que ingreses se abre la caja de nuevo.
                </p>
              </>
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `/admin/caja/rendiciones/${shiftId}?autoprint=1`,
                      `rendicion-${shiftId}`,
                      "width=420,height=720"
                    )
                  }
                  className="flex-1 px-5 py-2.5 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Printer size={18} />
                  Imprimir comprobante
                </button>
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={finishing}
                  className="flex-1 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {finishing ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                  Listo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

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
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-start gap-3">
            <EyeOff size={18} className="text-slate-400 shrink-0 mt-0.5" />
            <div className="text-sm text-slate-600">
              El efectivo esperado se mantiene oculto hasta que declares cuanto hay
              fisicamente en caja. La diferencia saldra en la rendicion final.
            </div>
          </div>

          {otherMethods.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-2">
                Otros medios a controlar
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
                Verifica que lo cobrado por cada medio coincida con sus comprobantes.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="actual-cash" className="block text-sm font-bold text-slate-700 mb-2">
              Efectivo declarado ($)
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
              Aca registras cuanto efectivo hay fisicamente en caja al cierre.
            </p>
          </div>

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
            onClick={(e) => handleSubmit(e as unknown as FormEvent)}
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
