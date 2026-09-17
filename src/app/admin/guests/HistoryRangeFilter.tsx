"use client";

import { useRouter } from "next/navigation";

import DateRangeFilter from "../DateRangeFilter";
import { buildBillingPresets } from "@/lib/date-range";

type Props = {
  /** Rango elegido, o "" y "" cuando se está viendo la ventana por defecto. */
  from: string;
  to: string;
  /** "Hoy" en la zona del hotel, resuelto en el server. */
  todayKey: string;
  /** Se conservan al navegar: el filtro de fechas no tiene por qué perder la búsqueda. */
  search: string;
  includeCancelled: boolean;
};

/**
 * Filtro de fechas de la pestaña Historial. Existe como componente aparte porque
 * `guests/page.tsx` es un server component y `DateRangeFilter` necesita manejar
 * clicks: acá vive el único pedacito de cliente que hace falta.
 *
 * "Todo" (allowAll) vuelve a la ventana por defecto de los últimos 60 días, no trae
 * la historia completa del hotel: es el estado en el que abre la pantalla.
 */
export default function HistoryRangeFilter({
  from,
  to,
  todayKey,
  search,
  includeCancelled,
}: Props) {
  const router = useRouter();

  const aplicar = (desde: string, hasta: string) => {
    const params = new URLSearchParams({ view: "historial" });
    if (search) params.set("q", search);
    if (includeCancelled) params.set("cancelled", "1");
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    // Sin `page`: cambiar el período siempre arranca en la primera página.
    router.push(`/admin/guests?${params.toString()}`);
  };

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <DateRangeFilter
        from={from}
        to={to}
        presets={buildBillingPresets(todayKey)}
        onChange={aplicar}
        allowAll
      />
      <p className="text-xs text-slate-400 mt-2">
        Sin período elegido se ven los últimos 60 días.
      </p>
    </div>
  );
}
