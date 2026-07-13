// Navegación del calendario: mueve la ventana visible (◀ Anterior / Hoy / ▶ Siguiente) y
// permite saltar a una fecha puntual. Server component (solo <Link> + <form method="GET">):
// conserva el estado en la URL con ?start=YYYY-MM-DD. La ventana siempre es de daysCount días.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysToDateKey } from "@/lib/analytics";

const BASE = "/admin/calendario";

/** "2026-07-10" → "10/07/2026" */
function formatKey(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

export default function CalendarNav({
  startDateKey,
  daysCount,
  todayKey,
}: {
  /** Clave "YYYY-MM-DD" de la primera columna visible. */
  startDateKey: string;
  /** Cantidad de días de la ventana (paginación no solapada). */
  daysCount: number;
  /** Hoy en la zona del hotel: marca el botón "Hoy" como activo. */
  todayKey: string;
}) {
  const prevKey = addDaysToDateKey(startDateKey, -daysCount);
  const nextKey = addDaysToDateKey(startDateKey, daysCount);
  const lastKey = addDaysToDateKey(startDateKey, daysCount - 1);
  const isToday = startDateKey === todayKey;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {/* Navegación de la ventana */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`${BASE}?start=${prevKey}`}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-700"
          aria-label="Ventana anterior"
        >
          <ChevronLeft size={16} /> Anterior
        </Link>
        <Link
          href={BASE}
          aria-current={isToday ? "page" : undefined}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            isToday
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
          }`}
        >
          Hoy
        </Link>
        <Link
          href={`${BASE}?start=${nextKey}`}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-700"
          aria-label="Ventana siguiente"
        >
          Siguiente <ChevronRight size={16} />
        </Link>
        <span className="ml-1 hidden text-sm font-medium text-slate-500 sm:inline">
          {formatKey(startDateKey)} – {formatKey(lastKey)}
        </span>
      </div>

      {/* Ir a una fecha puntual (la ventana arranca en la fecha elegida) */}
      <form method="GET" action={BASE} className="flex items-end gap-2">
        <div className="flex flex-col">
          <label htmlFor="start" className="mb-1 text-xs font-semibold text-slate-500">
            Ir a fecha
          </label>
          <input
            id="start"
            type="date"
            name="start"
            defaultValue={startDateKey}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700"
        >
          Ir
        </button>
      </form>
    </div>
  );
}
