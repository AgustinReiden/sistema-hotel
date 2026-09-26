"use client";

import { Printer } from "lucide-react";
import { toast } from "sonner";

import { formatAmount } from "@/lib/format";
import { openPrintWindow } from "@/lib/print-window";
import { numeroVisible } from "@/lib/remito-codigo";
import type { ShiftCreditChargeRow } from "@/lib/types";

/**
 * Reimprime el remito de un fiado del turno: el mismo papel del check-out (mismo
 * número, mismo QR) con la leyenda "REIMPRESIÓN". Sirve cuando el remito no salió o
 * se trabó el papel, para no rendir el turno sin la firma del cliente.
 */
function reimprimirRemito(movementId: string) {
  const abrio = openPrintWindow(
    `/admin/comprobante-cc/${movementId}?autoprint=1&reimpresion=1`,
    `comprobante-cc-${movementId}`
  );
  if (!abrio) {
    toast.error(
      "El navegador bloqueó la ventana. Permití ventanas emergentes para este sitio y volvé a apretar."
    );
  }
}

type Props = {
  charges: ShiftCreditChargeRow[];
};

/** Los fiados del turno, uno por línea, con su remito y el botón para reimprimirlo. */
export default function CreditChargesList({ charges }: Props) {
  return (
    <ul className="space-y-2">
      {charges.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 text-xs">
          <div className="min-w-0">
            <span className="block text-slate-600 truncate">
              {c.client_name}
              {c.room_number && <span className="text-slate-400"> (Hab. {c.room_number})</span>}
            </span>
            {c.remito_numero !== null && (
              <span className="block font-mono text-slate-500">
                {`Remito ${numeroVisible(c.remito_numero)}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-bold text-amber-800">{formatAmount(c.amount)}</span>
            <button
              type="button"
              onClick={() => reimprimirRemito(c.id)}
              aria-label={`Reimprimir remito de ${c.client_name}`}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 transition-colors"
            >
              <Printer size={14} aria-hidden="true" />
              Reimprimir
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
