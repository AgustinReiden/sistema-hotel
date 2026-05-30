"use client";

import ThermalAutoPrint from "@/app/admin/components/ThermalAutoPrint";

type ReceiptAutoPrintProps = {
  nextUrl?: string;
  closeOnDone?: boolean;
};

export default function ReceiptAutoPrint(props: ReceiptAutoPrintProps) {
  return (
    <>
      <ThermalAutoPrint {...props} />
      {/* Respaldo manual: si la ventana no se cierra sola tras imprimir, este boton
          (oculto en la impresion) permite cerrarla con un clic. */}
      <button
        type="button"
        onClick={() => window.close()}
        className="no-print fixed bottom-4 right-4 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-bold shadow-lg hover:bg-slate-700"
      >
        Cerrar
      </button>
    </>
  );
}
