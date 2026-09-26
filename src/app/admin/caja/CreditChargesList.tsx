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

/**
 * Los fiados del turno con su remito y el botón para reimprimirlo. Cada fiado va en
 * dos renglones: arriba el cliente y el monto; abajo la habitación, el remito y el
 * botón. La lista vive en una tarjeta angosta (un tercio de la grilla en pantalla
 * grande) y en un solo renglón el monto y el botón le comían el ancho al nombre.
 */
export default function CreditChargesList({ charges }: Props) {
  return (
    <ul className="space-y-3">
      {charges.map((c) => (
        <li key={c.id} className="text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-slate-600">{c.client_name}</span>
            <span className="shrink-0 font-bold text-amber-800">{formatAmount(c.amount)}</span>
          </div>
          {/* Si no entra al lado, el botón baja a su propio renglón, a la derecha. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-slate-500">
              {c.room_number && <span>Hab. {c.room_number}</span>}
              {c.room_number && c.remito_numero !== null && <span aria-hidden="true"> · </span>}
              {c.remito_numero !== null && (
                <span className="font-mono whitespace-nowrap">
                  {`Remito ${numeroVisible(c.remito_numero)}`}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => reimprimirRemito(c.id)}
              aria-label={`Reimprimir remito de ${c.client_name}`}
              className="ml-auto inline-flex shrink-0 items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 transition-colors"
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
