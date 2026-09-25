"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";

import { formatCuit } from "@/lib/arca/amounts";
import { formatAmount } from "@/lib/format";
import type { FiscalEnvironment } from "@/lib/types";

/**
 * Cuánto tarda "Confirmar" en habilitarse después de abrir el cuadro. En el celular el
 * cuadro sale desde abajo y "Confirmar" queda donde estaba el botón de la barra: sin esta
 * espera, un doble toque sobre la barra abre el cuadro con el primer toque y emite con el
 * segundo, sin que nadie lo haya leído. Un doble toque dura menos de 300 ms; leer el
 * cuadro, bastante más.
 */
export const CONFIRMAR_ESPERA_MS = 500;

/** Con qué documento sale el receptor: CUIT (A, o B a exento) o DNI (B a consumidor final). */
export type ConsolidadaDocumento =
  | { tipo: "CUIT"; numero: string }
  | { tipo: "DNI"; numero: string | null };

type Props = {
  letra: "A" | "B";
  receptorNombre: string;
  documento: ConsolidadaDocumento;
  condicionIvaLabel: string;
  /** Cuántas estadías entran en la factura. */
  estadias: number;
  total: number;
  /** De la primera entrada a la última salida, como lo calcula el servidor. */
  periodo: { desde: string; hasta: string } | null;
  /** Texto de la línea única, o null si sale detallado (una línea por estadía). */
  conceptoUnico: string | null;
  /**
   * En el detallado, cuántas líneas por estadía llevan un texto escrito a mano: esas
   * salen impresas tal cual, no con la habitación y las fechas automáticas.
   */
  lineasEditadas: number;
  /** Nota al pie ya saneada, o null si no hay. */
  nota: string | null;
  /** Estadías tildadas que no están en la página que se estaba viendo. */
  fueraDePagina: number;
  environment: FiscalEnvironment;
  puntoVenta: number | null;
  /** Plazo de la cuenta corriente (mig 98): días entre la emisión y el vencimiento. */
  diasVto: number;
  emitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Avisos que se dibujan arriba de los botones. Lo deja preparado para la fase C de
   * remitos (C2), que va a listar acá los remitos firmados que faltan y pedir el motivo
   * para emitir igual.
   */
  avisos?: ReactNode;
  /** Deshabilita "Confirmar" desde afuera (C2: mientras falte ese motivo). */
  bloquearConfirmar?: boolean;
};

/** "2026-09-01" → "01/09/2026". */
function fecha(key: string) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function textoVencimiento(dias: number) {
  if (dias === 0) return "vence el mismo día";
  return `vence a ${dias} ${dias === 1 ? "día" : "días"}`;
}

/**
 * Cómo sale el detalle impreso. Una línea con texto escrito a mano se imprime tal cual
 * (factura/[invoiceId]: `descripcion ?? automático`), así que de esa no se puede prometer
 * que lleve la habitación y las fechas.
 */
function textoDetalle(conceptoUnico: string | null, estadias: number, lineasEditadas: number) {
  if (conceptoUnico !== null) {
    return `Detalle: un solo concepto, «${conceptoUnico}», por el total. No figuran las habitaciones ni las fechas de cada estadía.`;
  }
  if (lineasEditadas <= 0) return "Detalle: una línea por estadía, con su habitación y sus fechas.";
  if (lineasEditadas >= estadias) {
    return "Detalle: una línea por estadía, con el texto que escribiste en «Detalle del comprobante».";
  }
  return `Detalle: una línea por estadía. ${
    lineasEditadas === 1 ? "Una sale" : `${lineasEditadas} salen`
  } con el texto que escribiste en «Detalle del comprobante»; las demás, con su habitación y sus fechas.`;
}

/**
 * "Revisá antes de emitir": lo último que se mira antes de mandar la consolidada a ARCA.
 * Dice letra, receptor, documento, estadías, período, total, vencimiento y la forma del
 * detalle. Una factura con CAE no se borra: se anula con nota de crédito y quedan los dos
 * papeles. Mismo criterio que el paso "confirmar" de InvoicePromptModal.
 */
export default function ConsolidadaConfirmModal({
  letra,
  receptorNombre,
  documento,
  condicionIvaLabel,
  estadias,
  total,
  periodo,
  conceptoUnico,
  lineasEditadas,
  nota,
  fueraDePagina,
  environment,
  puntoVenta,
  diasVto,
  emitting,
  onConfirm,
  onCancel,
  avisos,
  bloquearConfirmar = false,
}: Props) {
  // El servidor rechaza un DNI que no tenga 7 u 8 dígitos (P0022). Se avisa acá para no
  // llegar al rechazo con el cuadro ya confirmado.
  const dniDigits = documento.tipo === "DNI" ? (documento.numero ?? "").replace(/\D/g, "") : "";
  const dniInvalido = documento.tipo === "DNI" && dniDigits.length !== 7 && dniDigits.length !== 8;

  // El cuadro se monta al abrirse: "Confirmar" arranca deshabilitado y se habilita pasada
  // la espera (ver CONFIRMAR_ESPERA_MS).
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setListo(true), CONFIRMAR_ESPERA_MS);
    return () => window.clearTimeout(t);
  }, []);

  // El foco arranca en "Volver": un Enter de más no emite nada. Se pone a mano y sin
  // desplazar, no con autoFocus: "Volver" está al fondo del cuadro, y en un celular chico
  // el foco común bajaría el cuadro hasta ahí y dejaría fuera de la vista el título y la
  // banda de PRODUCCIÓN, que es lo primero que hay que leer.
  const volverRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    volverRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Revisá antes de emitir"
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]"
      >
        <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50">
          <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Revisá antes de emitir</h2>
            <p className="text-slate-500 text-sm font-medium">Factura consolidada de cuenta corriente</p>
          </div>
        </div>

        <div className="p-6 space-y-3">
          {environment === "produccion" ? (
            <div className="flex items-start gap-2 bg-rose-600 text-white rounded-xl px-3 py-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <p className="text-xs font-bold">
                {"PRODUCCIÓN: es una factura real ante ARCA. Si sale mal, se anula con nota de crédito."}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 bg-amber-100 border border-amber-300 text-amber-900 rounded-xl px-3 py-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <p className="text-xs font-bold">
                {"PRUEBA (homologación): el comprobante no tiene valor fiscal."}
              </p>
            </div>
          )}

          {/* Sale de los mismos datos que se mandan a ARCA (ver el receptor en ConsolidadaClient). */}
          <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Se va a emitir</p>
            <p className="text-2xl font-black text-slate-800 mt-1">Factura {letra}</p>
            {puntoVenta !== null && (
              <p className="text-xs text-slate-500">Punto de venta {puntoVenta}</p>
            )}

            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-3">A nombre de</p>
            <p className="text-lg font-bold text-slate-800 leading-tight break-words">
              {receptorNombre || "—"}
            </p>
            <p className="text-xs text-slate-500 font-mono mt-1">
              {documento.tipo === "CUIT"
                ? `CUIT ${formatCuit(documento.numero)}`
                : `DNI ${dniDigits || "(sin cargar)"}`}
            </p>
            <p className="text-xs text-slate-500">{condicionIvaLabel}</p>

            <p className="text-sm font-semibold text-slate-700 mt-3">
              {`${estadias} ${estadias === 1 ? "estadía" : "estadías"}`}
              {periodo ? ` · del ${fecha(periodo.desde)} al ${fecha(periodo.hasta)}` : ""}
            </p>
            <p className="text-2xl font-black text-slate-800 mt-1">{formatAmount(total)}</p>
            <p className="text-xs text-slate-500 mt-1">
              Condición de venta: cuenta corriente · {textoVencimiento(diasVto)}
            </p>
          </div>

          <div className="text-xs text-slate-600 space-y-1">
            <p>{textoDetalle(conceptoUnico, estadias, lineasEditadas)}</p>
            {nota && <p>Nota al pie: «{nota}»</p>}
          </div>

          {fueraDePagina > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-amber-800">
                Incluye {fueraDePagina}{" "}
                {fueraDePagina === 1 ? "estadía tildada" : "estadías tildadas"} en otras páginas de
                la lista: van en esta factura aunque no las estés viendo.
              </p>
            </div>
          )}

          {dniInvalido && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3">
              <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-rose-800">
                El DNI de la ficha del huésped ({dniDigits || "vacío"}) no sirve para facturar: tiene
                que tener 7 u 8 dígitos. Corregilo en Huéspedes antes de emitir.
              </p>
            </div>
          )}

          {avisos}

          <div className="flex gap-3 pt-1">
            {/* El foco arranca acá (ver volverRef): un Enter de más no emite nada. */}
            <button
              ref={volverRef}
              type="button"
              onClick={onCancel}
              disabled={emitting}
              className="px-5 py-4 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-base font-black rounded-2xl transition-colors"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!listo || emitting || dniInvalido || bloquearConfirmar}
              className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-base font-black rounded-2xl transition-colors flex items-center justify-center gap-2"
            >
              {emitting ? <Loader2 className="animate-spin" size={18} /> : <FileText size={18} />}
              Confirmar y emitir en ARCA
            </button>
          </div>
          <p className="text-[11px] text-slate-400 text-center">
            {emitting
              ? "Emitiendo en ARCA… no cierres esta ventana."
              : "Una vez emitida, corregirla exige una nota de crédito: quedan los dos comprobantes."}
          </p>
        </div>
      </div>
    </div>
  );
}
