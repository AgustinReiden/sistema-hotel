"use client";

import { useId } from "react";
import { Printer } from "lucide-react";

export type PrintBlockedModalProps = {
  /** Qué ya quedó hecho (ej. "El check-out quedó hecho y la estadía quedó a cuenta de X."). */
  titulo: string;
  /** Qué papel falta y por qué. */
  detalle: string;
  /** Texto del botón que vuelve a abrir el impreso (ej. "Imprimir remito"). */
  botonLabel: string;
  /** Vuelve a abrir la ventana. Es un click del usuario, así que el navegador la deja abrir. */
  onPrint: () => void;
  onClose: () => void;
};

/**
 * Falta el papel: la operación ya quedó asentada, pero el navegador bloqueó la
 * ventana del impreso (recibo, remito).
 *
 * Es un cuadro propio y no un toast porque ese estado no se puede perder de vista
 * con un aviso que se desvanece solo: no se cierra con un click afuera ni con el
 * tiempo, solo con sus botones. Mismo diseño que ReciboPendiente
 * (cuentas/RegisterPaymentModal.tsx). Va por encima de los demás modales del panel
 * (z-[70]), porque el papel es lo que hay que resolver primero.
 */
export default function PrintBlockedModal({
  titulo,
  detalle,
  botonLabel,
  onPrint,
  onClose,
}: PrintBlockedModalProps) {
  const tituloId = useId();
  const detalleId = useId();

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={detalleId}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-100 rounded-lg shrink-0">
            <Printer size={20} className="text-amber-600" />
          </div>
          <div>
            <h2 id={tituloId} className="text-lg font-bold text-slate-800">
              {titulo}
            </h2>
            <p id={detalleId} className="text-sm text-slate-500 mt-1">
              {detalle}
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="flex-1 px-4 py-2.5 bg-brand-700 text-white font-semibold rounded-xl hover:bg-brand-800 flex items-center justify-center gap-2"
          >
            <Printer size={18} /> {botonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
