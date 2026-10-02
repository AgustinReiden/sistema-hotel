// Navegación compartida de los tableros: presets de rango y filtro de fechas. Server
// component (solo Links + <form method="GET">). Las pestañas General / Por habitación
// están en la barra del panel (AdminTopBar), que conserva el rango al cambiar de pestaña.

import Link from "next/link";
import type { RangePreset } from "./shared";

const BASE = "/admin/analytics";

export default function DashboardNav({
  activeTab,
  fromKey,
  toKey,
  presets,
}: {
  activeTab: "general" | "rooms";
  fromKey: string;
  toKey: string;
  presets: RangePreset[];
}) {
  const basePath = activeTab === "general" ? BASE : `${BASE}/habitaciones`;
  return (
    <div className="mb-8 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Filtro de fechas */}
        <form method="GET" action={basePath} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label htmlFor="from" className="mb-1 text-xs font-semibold text-slate-500">
              Desde
            </label>
            <input
              id="from"
              type="date"
              name="from"
              defaultValue={fromKey}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="to" className="mb-1 text-xs font-semibold text-slate-500">
              Hasta
            </label>
            <input
              id="to"
              type="date"
              name="to"
              defaultValue={toKey}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            Filtrar
          </button>
        </form>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = p.from === fromKey && p.to === toKey;
          return (
            <Link
              key={p.label}
              href={`${basePath}?from=${p.from}&to=${p.to}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
