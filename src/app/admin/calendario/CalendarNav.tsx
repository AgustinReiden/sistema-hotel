// Navegación del calendario: mueve la ventana visible (◀ Anterior / Hoy / ▶ Siguiente),
// permite saltar a una fecha puntual y elegir de cuántos días es la ventana. Server
// component (solo <Link> + <form method="GET">): conserva el estado en la URL con
// ?start=YYYY-MM-DD y ?days=N. La ventana siempre es de daysCount días.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysToDateKey } from "@/lib/analytics";

const BASE = "/admin/calendario";
const DEFAULT_DAYS = 14;
const WINDOW_OPTIONS = [7, 14];

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

  // El tamaño de ventana viaja en todos los links: sin esto, elegir 7 días y tocar
  // "Siguiente" volvía a 14 y había que elegirlo de nuevo en cada movimiento.
  const daysParam = daysCount === DEFAULT_DAYS ? "" : `&days=${daysCount}`;
  const href = (key: string) => `${BASE}?start=${key}${daysParam}`;

  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      {/* Navegación de la ventana */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href(prevKey)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-700"
          aria-label="Ventana anterior"
        >
          <ChevronLeft size={16} /> Anterior
        </Link>
        <Link
          href={daysParam ? `${BASE}?${daysParam.slice(1)}` : BASE}
          aria-current={isToday ? "page" : undefined}
          className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
            isToday
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
          }`}
        >
          Hoy
        </Link>
        <Link
          href={href(nextKey)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-700"
          aria-label="Ventana siguiente"
        >
          Siguiente <ChevronRight size={16} />
        </Link>
        <span className="ml-1 hidden text-sm font-medium text-slate-500 sm:inline">
          {formatKey(startDateKey)} – {formatKey(lastKey)}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* Cuántos días entran en la ventana. En el teléfono 7 entran sin scroll lateral. */}
        <div
          className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white"
          role="group"
          aria-label="Días visibles"
        >
          {WINDOW_OPTIONS.map((option) => {
            const active = daysCount === option;
            const optionParam = option === DEFAULT_DAYS ? "" : `&days=${option}`;
            return (
              <Link
                key={option}
                href={`${BASE}?start=${startDateKey}${optionParam}`}
                aria-current={active ? "true" : undefined}
                className={`px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active ? "bg-brand-600 text-white" : "text-slate-600 hover:text-brand-700"
                }`}
              >
                {option} días
              </Link>
            );
          })}
        </div>

        {/* Ir a una fecha puntual (la ventana arranca en la fecha elegida) */}
        <form method="GET" action={BASE} className="flex items-end gap-2">
          {daysCount !== DEFAULT_DAYS && <input type="hidden" name="days" value={daysCount} />}
          <div className="flex flex-col">
            <label htmlFor="start" className="mb-1 text-xs font-semibold text-slate-500">
              Ir a fecha
            </label>
            <input
              id="start"
              type="date"
              name="start"
              defaultValue={startDateKey}
              // text-base en el celular: abajo de 16px Safari hace zoom al enfocar el campo
              // y la pantalla queda corrida.
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:ring-2 focus:ring-brand-500 md:text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            Ir
          </button>
        </form>
      </div>
    </div>
  );
}
