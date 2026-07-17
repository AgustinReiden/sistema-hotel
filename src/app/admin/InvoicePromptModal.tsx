"use client";

import { useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { emitInvoiceForReservationAction } from "./fiscal/actions";

export type InvoicePromptData = {
  reservationId: string;
  clientName: string | null;
  total: number;
};

type Props = {
  data: InvoicePromptData | null;
  onClose: () => void;
};

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function openInvoicePrint(invoiceId: string) {
  if (typeof window === "undefined") return;
  window.open(
    `/admin/factura/${invoiceId}?autoprint=1`,
    `factura-${invoiceId}`,
    "width=420,height=720"
  );
}

/**
 * Prompt post check-out "¿Emitir factura?": el playero solo elige SÍ o NO
 * (pedido del gerente). SÍ emite la Factura B contra ARCA; si ARCA no responde
 * queda pendiente en /admin/fiscal — el check-out ya está hecho y no se traba.
 */
export default function InvoicePromptModal({ data, onClose }: Props) {
  const [emitting, setEmitting] = useState(false);

  if (!data) return null;

  const handleYes = async () => {
    if (emitting) return; // anti doble click
    setEmitting(true);
    const result = await emitInvoiceForReservationAction(data.reservationId);
    setEmitting(false);

    if (!result.success) {
      toast.error(result.error);
      onClose();
      return;
    }

    const outcome = result.data!;
    if (outcome.status === "authorized") {
      // Cubre tanto la emisión nueva como el caso "ya estaba facturada" (reimprime).
      toast.success(outcome.userMessage);
      if (outcome.invoiceId) openInvoicePrint(outcome.invoiceId);
    } else if (outcome.status === "rejected") {
      toast.error(outcome.userMessage, {
        description: "Corregí el DNI y reintentá desde Facturación → Pendientes y con error.",
        duration: 9000,
      });
    } else {
      toast.warning(outcome.userMessage, { duration: 9000 });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">¿Emitir factura?</h2>
              <p className="text-slate-500 text-sm font-medium">
                {data.clientName ?? "Huésped"} — ${formatMoney(data.total)}
              </p>
            </div>
          </div>
          {!emitting && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={24} />
            </button>
          )}
        </div>

        <div className="p-6">
          {emitting ? (
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-slate-600">
              <Loader2 className="animate-spin" size={28} />
              <p className="text-sm font-semibold">Emitiendo factura en ARCA…</p>
              <p className="text-xs text-slate-400">No cierres esta ventana.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={handleYes}
                className="py-6 bg-emerald-600 hover:bg-emerald-700 text-white text-2xl font-black rounded-2xl transition-colors"
              >
                SÍ
              </button>
              <button
                type="button"
                onClick={onClose}
                className="py-6 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 text-2xl font-black rounded-2xl transition-colors"
              >
                NO
              </button>
            </div>
          )}
          {!emitting && (
            <p className="text-[11px] text-slate-400 mt-4 text-center">
              Si elegís NO, podés emitirla igual desde Facturación mientras dure tu turno.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
