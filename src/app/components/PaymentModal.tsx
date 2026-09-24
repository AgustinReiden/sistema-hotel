"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { X, Loader2, DollarSign, CreditCard, Banknote, Landmark, Wallet, CircleDollarSign } from "lucide-react";
import { toast } from "sonner";

import { registerPaymentAction } from "@/app/admin/finances/actions";
import ParsedAmountHint from "@/app/admin/ParsedAmountHint";
import { formatAmountForInput, parseArMoney } from "@/lib/format";
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

const METHOD_GROUP_ID = "payment-method-group";
const METHOD_MISSING_MESSAGE = "Elegí cómo paga: efectivo, tarjeta, transferencia o Mercado Pago";

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
  /** Habilita el método "Cuenta corriente" (solo para clientes con cta cte habilitada). */
  accountCreditEnabled?: boolean;
  /**
   * Medio que viene marcado al abrir. Solo cuenta 'cuenta_corriente', y solo en el
   * check-out con la cuenta habilitada: una empresa con cuenta casi siempre fía. En
   * todo lo demás el medio arranca vacío y hay que elegirlo, porque un Efectivo
   * marcado de antemano se quedaba así aunque pagaran con tarjeta, y el arqueo no
   * cuadraba.
   */
  defaultMethod?: PaymentMethod;
  /** A nombre de quién queda lo fiado (la empresa). Si no llega, se usa clientName. */
  accountHolderName?: string | null;
  onSuccess?: () => void;
  onSubmitPayment?: (payload: {
    amount: number;
    paymentMethod: PaymentMethod;
  }) => Promise<ActionResult<{ paymentId: string | null }>>;
  /** Aviso opcional arriba del monto (ej. rótulo de salida anticipada). */
  noteText?: string;
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
  accountCreditEnabled = false,
  defaultMethod,
  accountHolderName,
  onSuccess,
  onSubmitPayment,
  noteText,
}: PaymentModalProps) {
  const numericBaseTotal = Number(baseTotalPrice ?? totalPrice);
  const numericDiscountPercent = Number(discountPercent ?? 0);
  const numericDiscountAmount = Number(discountAmount ?? 0);
  const numericTotal = Number(totalPrice);
  const numericPaid = Number(paidAmount);
  const debt = Math.max(0, numericTotal - numericPaid);
  const isCheckoutMode = Boolean(onSubmitPayment);
  const amountEditable = !isCheckoutMode;
  // Solo mostrar el recuadro de descuento cuando hay un descuento real. NO comparar
  // base vs total: un cargo extra sube el total por encima de la base y encendía un
  // "Descuento aplicado" inexistente.
  const showDiscountBreakdown =
    numericDiscountPercent > 0 || numericDiscountAmount > 0;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noOpenShift, setNoOpenShift] = useState(false);
  // Precargado ya formateado ("43.700,00"). Con debt.toString() un saldo con restos
  // de coma flotante ("0.19999999999999998") tiene más de 2 decimales y
  // parseArMoney no lo acepta.
  const [amount, setAmount] = useState(debt > 0 ? formatAmountForInput(debt) : "");
  // Sin medio de antemano (null): la recepcionista lo elige siempre. La única
  // excepción es fiar en el check-out de una empresa con cuenta corriente.
  const [method, setMethod] = useState<PaymentMethod | null>(
    defaultMethod === "cuenta_corriente" && accountCreditEnabled && isCheckoutMode
      ? "cuenta_corriente"
      : null
  );
  const [methodMissing, setMethodMissing] = useState(false);
  const methodGroupRef = useRef<HTMLDivElement>(null);

  const isAccountCredit = method === "cuenta_corriente";
  const holderName = accountHolderName || clientName;

  const chooseMethod = (next: PaymentMethod) => {
    setMethod(next);
    setMethodMissing(false);
  };

  // En check-out el monto es el saldo exacto, derivado EN VIVO de las props (no del
  // useState, que se congela al montar). Así, si se agrega un cargo extra mientras el
  // modal está abierto, el "Monto a abonar" se actualiza y el check-out no se traba.
  const displayAmount = isCheckoutMode ? formatAmountForInput(debt) : amount;

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNoOpenShift(false);

    // En check-out se cobra el saldo exacto (derivado en vivo); en pago suelto, lo tipeado.
    // parseArMoney y no parseFloat: "43.700" son cuarenta y tres mil pesos, no 43,70.
    const parsedAmount = isCheckoutMode ? debt : parseArMoney(amount);
    if (parsedAmount === null || parsedAmount <= 0) {
      setError("Ingresá un monto mayor a 0 (ej. 43.700 o 43.700,50).");
      setLoading(false);
      return;
    }

    // Sin medio no se registra nada: se avisa al lado de los medios y el foco va
    // ahí, para que se vea qué falta elegir.
    if (!method) {
      setMethodMissing(true);
      setLoading(false);
      methodGroupRef.current?.focus();
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
      toast.success(
        !isCheckoutMode
          ? "Pago registrado exitosamente."
          : method === "cuenta_corriente"
            ? `Check-out hecho. Queda a cuenta de ${holderName}.`
            : "Pago registrado y check-out realizado."
      );
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
      {/* Con scroll propio: en un celular, fiar (recuadro violeta, botón largo) o el
          aviso de "Elegí cómo paga" pasan el alto de la pantalla, y sin esto la X y
          el botón de cobrar quedaban recortados y sin forma de llegar. */}
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92dvh] overflow-y-auto overscroll-contain relative">
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

          {noteText && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-sm font-bold text-amber-800">
              {noteText}
            </div>
          )}

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
              <label htmlFor="payment-amount" className="block text-sm font-bold text-slate-700 mb-2">
                {isAccountCredit ? "Monto a cuenta corriente" : "Monto a abonar ($)"}
              </label>
              <input
                id="payment-amount"
                type="text"
                inputMode="decimal"
                value={displayAmount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => {
                  if (!amountEditable) return;
                  const parsed = parseArMoney(amount);
                  if (parsed !== null) setAmount(formatAmountForInput(parsed));
                }}
                placeholder="0"
                readOnly={!amountEditable}
                className={`w-full px-4 py-3 rounded-xl border outline-none transition-all text-xl font-bold ${
                  amountEditable
                    ? "border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 text-slate-800"
                    : "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                }`}
                required
              />
              {amountEditable && <ParsedAmountHint value={amount} />}
              <p className="mt-2 text-xs text-slate-500">
                {isCheckoutMode
                  ? "El check-out solo permite cobrar el saldo exacto pendiente."
                  : "Puedes registrar un pago parcial o total para esta reserva."}
              </p>
            </div>

            <div>
              <p id="payment-method-label" className="block text-sm font-bold text-slate-700 mb-2">Método de Pago</p>
              {/* Ningún medio viene marcado (salvo Cta. Cte. en empresas con cuenta): si
                  se cobra sin elegir, el foco vuelve acá con el aviso de abajo. */}
              <div
                id={METHOD_GROUP_ID}
                ref={methodGroupRef}
                role="radiogroup"
                aria-labelledby="payment-method-label"
                aria-invalid={methodMissing || undefined}
                aria-describedby={methodMissing ? "payment-method-error" : undefined}
                tabIndex={-1}
                className={`grid grid-cols-2 lg:grid-cols-3 gap-3 rounded-xl outline-none ${
                  methodMissing ? "ring-2 ring-red-300 ring-offset-2" : ""
                }`}
              >
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "cash" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="cash" checked={method === "cash"} onChange={() => chooseMethod("cash")} className="sr-only" />
                  <Banknote size={18} />
                  <span className="text-sm">Efectivo</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "mercado_pago" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="mercado_pago" checked={method === "mercado_pago"} onChange={() => chooseMethod("mercado_pago")} className="sr-only" />
                  <Wallet size={18} className="text-blue-500" />
                  <span className="text-sm whitespace-nowrap">Mercado Pago</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "bank_transfer" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="bank_transfer" checked={method === "bank_transfer"} onChange={() => chooseMethod("bank_transfer")} className="sr-only" />
                  <Landmark size={18} />
                  <span className="text-sm">Transferencia</span>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "credit_card" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="method" value="credit_card" checked={method === "credit_card"} onChange={() => chooseMethod("credit_card")} className="sr-only" />
                  <CreditCard size={18} />
                  <span className="text-sm">Tarjeta</span>
                </label>
                {/* Vale blanco (consumo interno) solo si NO hubo pagos previos: tiene que
                    cubrir el total de una sola vez, sin combinar con otro medio. */}
                {numericPaid === 0 && (
                  <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "vale_blanco" ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                    <input type="radio" name="method" value="vale_blanco" checked={method === "vale_blanco"} onChange={() => chooseMethod("vale_blanco")} className="sr-only" />
                    <Banknote size={18} className="text-slate-400" />
                    <span className="text-sm">Vale Blanco</span>
                  </label>
                )}
                {/* Cta. Cte. solo en el check-out: fiar no es un pago suelto, genera
                    el cargo en la cuenta del cliente. Fuera del check-out el RPC lo
                    rechaza (mig 89); mejor ni ofrecerlo. */}
                {accountCreditEnabled && isCheckoutMode && (
                  <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${method === "cuenta_corriente" ? "border-purple-500 bg-purple-50 text-purple-700 font-bold" : "border-slate-200 hover:border-slate-300 text-slate-600"}`}>
                    <input type="radio" name="method" value="cuenta_corriente" checked={method === "cuenta_corriente"} onChange={() => chooseMethod("cuenta_corriente")} className="sr-only" />
                    <Wallet size={18} className="text-purple-500" />
                    <span className="text-sm">Cta. Cte.</span>
                  </label>
                )}
              </div>
              {methodMissing && (
                <p id="payment-method-error" className="mt-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg">
                  {METHOD_MISSING_MESSAGE}
                </p>
              )}
              {/* Fiar se ve distinto de cobrar: si el pasajero paga de su bolsillo, se
                  cambia el medio y este recuadro desaparece. */}
              {isAccountCredit && (
                <div className="mt-3 bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm font-bold text-purple-800">
                  Queda a cuenta de {holderName}. Sale el remito para que firme el pasajero.
                </div>
              )}
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
            {!isCheckoutMode
              ? "Registrar Pago"
              : isAccountCredit
                ? "Cargar a la cuenta y cerrar"
                : "Registrar y Cerrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
