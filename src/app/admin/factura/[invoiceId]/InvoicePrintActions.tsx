"use client";

import { useState } from "react";
import { Download, Printer, X } from "lucide-react";

/**
 * Barra de acciones del comprobante ya emitido. Sólo aparece cuando la página se
 * abrió para MIRAR la factura (sin ?autoprint=1): en el camino de autoimpresión la
 * ventana se imprime sola y se cierra, y una barra ahí sería un botón que compite
 * con el diálogo del sistema.
 *
 * Por qué "Guardar PDF" abre el mismo diálogo que "Imprimir": el PDF lo genera el
 * navegador eligiendo "Guardar como PDF" (o "Microsoft Print to PDF") como destino.
 * Armarlo del lado del servidor sería un segundo renderizador del comprobante, y
 * dos renderizadores del mismo papel fiscal terminan diciendo cosas distintas el
 * día que uno se toca y el otro no. Como el destino no se puede preseleccionar
 * desde la web, el botón explica el paso en vez de fingir que descarga solo.
 */
export default function InvoicePrintActions() {
  const [mostrarAyudaPdf, setMostrarAyudaPdf] = useState(false);

  const imprimir = () => {
    setMostrarAyudaPdf(false);
    window.print();
  };

  return (
    <div className="no-print">
      <div className="acciones">
        <button type="button" onClick={imprimir} className="btn btn-primario">
          <Printer size={15} /> Imprimir
        </button>
        <button
          type="button"
          onClick={() => setMostrarAyudaPdf((v) => !v)}
          className="btn btn-secundario"
        >
          <Download size={15} /> Guardar PDF
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="btn btn-fantasma"
          aria-label="Cerrar"
          title="Cerrar"
        >
          <X size={15} />
        </button>
      </div>

      {mostrarAyudaPdf && (
        <div className="ayuda">
          <p>
            Se abre el cuadro de impresión. En <strong>Destino</strong> elegí{" "}
            <strong>Guardar como PDF</strong> y dale a Guardar.
          </p>
          <button type="button" onClick={imprimir} className="btn btn-primario btn-ancho">
            Abrir el cuadro de impresión
          </button>
        </div>
      )}

      <style>{`
        .acciones {
          display: flex;
          gap: 8px;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          padding: 10px 12px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 10px;
          font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background-color 0.15s ease;
        }
        .btn-ancho { width: 100%; justify-content: center; margin-top: 8px; }
        .btn-primario { background: #059669; color: #fff; }
        .btn-primario:hover { background: #047857; }
        .btn-secundario { background: #fff; color: #334155; border-color: #cbd5e1; }
        .btn-secundario:hover { background: #f1f5f9; }
        .btn-fantasma { background: transparent; color: #64748b; padding: 8px 10px; }
        .btn-fantasma:hover { background: #e2e8f0; }
        .ayuda {
          margin: 0;
          padding: 10px 12px;
          background: #ecfdf5;
          border-bottom: 1px solid #a7f3d0;
          font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
          font-size: 12.5px;
          color: #065f46;
          line-height: 1.45;
        }
        .ayuda p { margin: 0; }
      `}</style>
    </div>
  );
}
