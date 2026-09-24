"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { formatAmount } from "@/lib/format";
import { haceCuanto, motivoVencido, numeroRemitoVisible, textoVencidos } from "@/lib/remitos";
import type { RemitoPanelRow } from "@/lib/types";

type Props = {
  rows: RemitoPanelRow[];
  horas: number;
  nowMs: number;
  /** Las mismas acciones que el resto del panel (vienen de RemitosClient). */
  renderAcciones: (r: RemitoPanelRow) => ReactNode;
};

/**
 * Remitos que a las `horas` del check-out no están firmados (mig 124). No depende del
 * mes elegido: un vencido de otro mes sigue siendo un problema de hoy.
 */
export default function VencidosSection({ rows, horas, nowMs, renderAcciones }: Props) {
  if (rows.length === 0) return null;
  return (
    <section className="bg-white border border-rose-200 rounded-xl" aria-label="Remitos vencidos">
      <div className="px-4 py-3 border-b border-rose-100">
        <h2 className="text-sm font-bold text-rose-800 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          {`Vencidos (${rows.length})`}
        </h2>
        <p className="text-xs text-slate-600 mt-0.5">
          Pasaron más de {horas} h del check-out y el remito no está firmado.
        </p>
        <p className="text-sm font-semibold text-slate-700 mt-1">{textoVencidos(rows)}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.movimiento_id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-mono font-semibold">{numeroRemitoVisible(r.remito_numero)}</span>
                <span className="text-slate-600">
                  {" · "}
                  {r.cliente}
                  {r.room_number ? ` · Hab. ${r.room_number}` : ""}
                  {" · "}
                  {formatAmount(r.amount)}
                </span>
              </p>
              <p className="text-xs text-slate-600">
                Salió {haceCuanto(r.created_at, nowMs)} · <span className="font-semibold text-rose-700">{motivoVencido(r.estado)}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {r.escaneo_link && (
                <a
                  href={r.escaneo_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline mr-1"
                >
                  Ver <ExternalLink size={12} />
                </a>
              )}
              {renderAcciones(r)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
