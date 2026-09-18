"use client";

import { useRouter } from "next/navigation";

import DateRangeFilter from "../DateRangeFilter";
import { buildBillingPresets } from "@/lib/date-range";

/** Por qué fecha se recorta el período y se ordena la lista. */
export type HistoryOrder = "entrada" | "salida";

type Props = {
  /** Rango elegido, o "" y "" cuando se está viendo la ventana por defecto. */
  from: string;
  to: string;
  /** "Hoy" en la zona del hotel, resuelto en el server. */
  todayKey: string;
  /** Se conservan al navegar: el filtro de fechas no tiene por qué perder la búsqueda. */
  search: string;
  includeCancelled: boolean;
  orden: HistoryOrder;
};

const ORDEN_OPCIONES: { value: HistoryOrder; label: string }[] = [
  { value: "entrada", label: "Por entrada" },
  { value: "salida", label: "Por salida" },
];

/**
 * Filtro de fechas de la pestaña Historial. Existe como componente aparte porque
 * `guests/page.tsx` es un server component y `DateRangeFilter` necesita manejar
 * clicks: acá vive el único pedacito de cliente que hace falta.
 *
 * "Todo" (allowAll) vuelve a la ventana por defecto de los últimos 60 días, no trae
 * la historia completa del hotel: es el estado en el que abre la pantalla.
 *
 * EL SELECTOR ENTRADA/SALIDA cambia las DOS cosas a la vez —qué entra en el período
 * y en qué orden se lista— porque separarlas dejaba el agujero que motivó el pedido:
 * ordenado por entrada, una estadía que salió ayer pero entró hace tres meses no
 * estaba en la lista y parecía no existir.
 */
export default function HistoryRangeFilter({
  from,
  to,
  todayKey,
  search,
  includeCancelled,
  orden,
}: Props) {
  const router = useRouter();

  const navegar = (desde: string, hasta: string, nuevoOrden: HistoryOrder) => {
    const params = new URLSearchParams({ view: "historial" });
    if (search) params.set("q", search);
    if (includeCancelled) params.set("cancelled", "1");
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (nuevoOrden === "salida") params.set("orden", "salida");
    // Sin `page`: cambiar el período o el criterio siempre arranca en la primera página.
    router.push(`/admin/guests?${params.toString()}`);
  };

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <DateRangeFilter
        from={from}
        to={to}
        presets={buildBillingPresets(todayKey)}
        onChange={(desde, hasta) => navegar(desde, hasta, orden)}
        allowAll
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Fechas y orden:</span>
        <div
          className="inline-flex overflow-hidden rounded-lg border border-slate-200"
          role="group"
          aria-label="Ordenar por fecha de entrada o de salida"
        >
          {ORDEN_OPCIONES.map((opcion) => {
            const activo = orden === opcion.value;
            return (
              <button
                key={opcion.value}
                type="button"
                aria-pressed={activo}
                onClick={() => navegar(from, to, opcion.value)}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                  activo ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:text-brand-700"
                }`}
              >
                {opcion.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-2">
        {orden === "salida"
          ? "El período y el orden van por la fecha de SALIDA. Sin período elegido se ven los últimos 60 días."
          : "El período y el orden van por la fecha de ENTRADA. Sin período elegido se ven los últimos 60 días."}
      </p>
    </div>
  );
}
