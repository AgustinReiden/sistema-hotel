"use client";

// Filtro de rango de fechas controlado, sin navegación propia: cada pantalla decide
// qué hacer en onChange (unas navegan por querystring, otras solo cambian estado
// local). A propósito, no asumir router.push acá.

import type { RangePreset } from "@/lib/date-range";

type Props = {
  from: string;
  to: string;
  presets: RangePreset[];
  onChange: (from: string, to: string) => void;
  allowAll?: boolean;
  className?: string;
};

export default function DateRangeFilter({ from, to, presets, onChange, allowAll, className }: Props) {
  const inputClass =
    "px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm";

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="flex flex-wrap gap-2">
        {allowAll && (
          <button
            type="button"
            onClick={() => onChange("", "")}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              from === "" && to === ""
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
            }`}
          >
            Todo
          </button>
        )}
        {presets.map((p) => {
          const active = p.from === from && p.to === to;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.from, p.to)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="date-range-from">
            Desde
          </label>
          <input
            id="date-range-from"
            type="date"
            value={from}
            onChange={(e) => onChange(e.target.value, to)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="date-range-to">
            Hasta
          </label>
          <input
            id="date-range-to"
            type="date"
            value={to}
            onChange={(e) => onChange(from, e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
