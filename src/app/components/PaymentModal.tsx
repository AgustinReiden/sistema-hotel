"use client";

import { useState } from "react";
import Link from "next/link";
import { X, Loader2, DollarSign, CreditCard, Banknote, Landmark, Wallet, CircleDollarSign } from "lucide-react";
import { toast } from "sonner";

import { registerPaymentAction } from "@/app/admin/finances/actions";
import type { ActionResult, PaymentMethod } from "@/lib/types";

function openReceipt(paymentId: string) {
  // Abre el recibo imprimible en una ventana nueva con auto-print.
  // En Chrome con --kiosk-printing imprime sin diálogo.
  if (typeof window === "undefined") return;
  window.open(
    `/admin/recibo/${paymentId}?autoprint=1&copy=original`,
    "recibo-" + paymentId,
    "width=420,height=720"
  );
}

// Mensaje exacto que emite el RPC cuando falta turno abierto (errcode P0003).
function isNoOpenShiftError(error: string | undefined, code: string | undefined): boolean {
  if (!error) return false;
  if (code === "P0003") return true;
  return /abrir\s+la\s+caja/i.test(error);
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  baseTotalPrice?: number | string;
  discountPercent?: number | string;
  discountAmount?: number | string;
  totalPrice: number | string;
  paidAmount: number | string;
  reservationId?: string;
  onSuccess?: () => void;
  onSubmitPayment?: (payload: {
    amount: number;
    paymentMethod: PaymentMethod;
  }) => Promise<ActionResult<{ paymentId: string | null }>>;
}

export default function PaymentModal({
  isOpen,
  onClose,
  clientName,
  baseTotalPrice,
  discountPercent,
  discountAmount,
  totalPrice,
  paidAmount,
  reservationId,
  onSuccess,
  onSubmitPayment,
}: PaymentModalProps) {
  const numericBaseTotal = Number(baseTotalPrice ?? totalPrice);
  const numericDiscountPercent = Number(discountPercent ?? 0);
  const numericDiscountAmount = Number(discountAmount ?? 0);
  const numericTotal = Number(totalPrice);
  const numericPaid = Number(paidAmount);
  const debt = Math.max(0, numericTotal - numericPaid);
  const isCheckoutMode = Boolean(onSubmitPayment);
  const amountEditable = !isCheckoutMode;
  const showDiscountBreakdown =
    numericDiscountPercent > 0 || numericDiscountAmount > 0 || numericBaseTotal !== numericTotal;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noOpenShift, setNoOpenShift] = useState(false);
  const [amount, setAmount] = useState(debt > 0 ? debt.toString() : "0");
  const [method, setMethod] = useState<PaymentMethod>("cash");

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNoOpenShift(false);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("El monto debe ser numerico y mayor a 0.");
      setLoading(false);
      return;
    }

    let result: ActionResult<{ paymentId: string | null }>;

    if (onSubmitPayment) {
      result = await onSubmitPayment({
        amount: parsedAmount,
        paymentMethod: method,
      });
    } else {
      if (!reservationId) {
        setError("Reserva no encontrada.");
        setLoading(false);
        return;
      }

      result = await registerPaymentAction(reservationId, parsedAmount, method);
    }

    setLoading(false);

    if (result.success) {
      toast.success(isCheckoutMode ? "Pago registrado y check-out realizado." : "Pago registrado exitosamente.");
      // Abrir recibo imprimible (si el RPC devolvió payment_id)
      const paymentId = (result.data as { paymentId?: string | null } | undefined)?.paymentId;
      if (paymentId) {
        openReceipt(paymentId);
      }
      onSuccess?.();
      onClose();
    } else {
      if (isNoOpenShiftError(result.error, result.code)) {
        setNoOpenShift(true);
        setError(null);
      } else {
        setError(result.error);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200 w-full h-full text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden relative">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <DollarSign size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{isCheckoutMode ? "Cobrar y Finalizar" : "Cargar Pago"}</h2>
              <p className="text-slate-500 text-sm font-medium">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between mb-6 gap-4">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Estadia</p>
              <p className="text-lg font-bold text-slate-800">${numericTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Pagado Prev.</p>
              <p className="text-lg font-bold text-emerald-600">${numericPaid.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Restante</p>
              <p className="text-xl font-bold text-amber-600">${debt.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          {showDiscountBreakdown && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl mb-6">
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-3">
                Descuento aplicado
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-emerald-600 uppercase font-bold mb-1">Total base</p>
                  <p className="font-semibold text-slate-800">
                    ${numericBaseTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-emerald-600 uppercase font-bold mb-1">% Descuento</p>
                  <p className="font-semibold text-slate-800">
                    {numericDiscountPercent.toLocaleString("es-AR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                    %
                  </p>
                </div>
                <div>
                  <p className="text-xs text-emerald-600 uppercase font-bold mb-1">Descuento</p>
                  <p className="font-semibold text-slate-800">
                    -${numericDiscountAmount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          )}

          <form id="payment-form" onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Monto a abonar ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                readOnly={!amountEditable}
                className={`w-full px-4 py-3 rounded-xl border outline-none transition-all text-xl font-bold ${
                  amountEditable
                    ? "border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 text-slate-800"
                    : "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                }`}
                required
              />
              <p className="mt-2 text-xs text-slate-500">
                {isCheckoutMode
                  ? "El check-out solo permite cobrar el saldo exacto pendiente."
                  : "Puedes registrar un pago parcial o total para esta reserva."}
              </p>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Metodo de Pago</label>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "cash" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="cash" checked={method === "cash"} onChange={() => setMethod("cash")} className="sr-only" />
                  <Banknote size={18} />
                  <span className="text-sm">Efectivo</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "mercado_pago" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="mercado_pago" checked={method === "mercado_pago"} onChange={() => setMethod("mercado_pago")} className="sr-only" />
                  <Wallet size={18} className="text-blue-500" />
                  <span className="text-sm whitespace-nowrap">Mercado Pago</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "bank_transfer" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="bank_transfer" checked={method === "bank_transfer"} onChange={() => setMethod("bank_transfer")} className="sr-only" />
                  <Landmark size={18} />
                  <span className="text-sm">Transferencia</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "credit_card" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="credit_card" checked={method === "credit_card"} onChange={() => setMethod("credit_card")} className="sr-only" />
                  <CreditCard size={18} />
                  <span className="text-sm">Tarjeta</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "vale_blanco" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="vale_blanco" checked={method === "vale_blanco"} onChange={() => setMethod("vale_blanco")} className="sr-only" />
                  <Banknote size={18} className="text-slate-400" />
                  <span className="text-sm">Vale Blanco</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "cuenta_corriente" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="cuenta_corriente" checked={method === "cuenta_corriente"} onChange={() => setMethod("cuenta_corriente")} className="sr-only" />
                  <Wallet size={18} className="text-purple-500" />
                  <span className="text-sm">Cta. Cte.</span>
                </label>
              </div>
            </div>

            {noOpenShift && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
                  <CircleDollarSign size={18} />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-amber-900 text-sm">Caja cerrada</p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Necesitas abrir la caja antes de cobrar. Los pagos se asocian al turno abierto.
                  </p>
                  <Link
                    href="/admin/caja"
                    className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
                  >
                    Ir a Caja
                  </Link>
                </div>
              </div>
            )}
            {error && <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">{error}</p>}
          </form>
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="payment-form"
            disabled={loading}
            className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-70"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <DollarSign size={20} />}
            {isCheckoutMode ? "Registrar y Cerrar" : "Registrar Pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
