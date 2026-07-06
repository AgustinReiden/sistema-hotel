"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, X } from "lucide-react";

type Props = {
  from: string;
  to: string;
};

export default function CleaningLogFilters({ from, to }: Props) {
  const router = useRouter();
  const [desde, setDesde] = useState(from);
  const [hasta, setHasta] = useState(to);

  const apply = () => {
    const params = new URLSearchParams();
    if (desde) params.set("from", desde);
    if (hasta) params.set("to", hasta);
    // Al filtrar se vuelve a la primera página.
    const qs = params.toString();
    router.push(qs ? `/admin/mantenimiento?${qs}` : "/admin/mantenimiento");
  };

  const clear = () => {
    setDesde("");
    setHasta("");
    router.push("/admin/mantenimiento");
  };

  const hasFilter = Boolean(from || to);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="from" className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Desde
        </label>
        <input
          id="from"
          type="date"
          value={desde}
          max={hasta || undefined}
          onChange={(e) => setDesde(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 outline-none text-sm bg-white"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="to" className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Hasta
        </label>
        <input
          id="to"
          type="date"
          value={hasta}
          min={desde || undefined}
          onChange={(e) => setHasta(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 outline-none text-sm bg-white"
        />
      </div>
      <button
        onClick={apply}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm flex items-center gap-2 transition-colors"
      >
        <Filter size={15} />
        Aplicar
      </button>
      {hasFilter && (
        <button
          onClick={clear}
          className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold rounded-lg text-sm flex items-center gap-2 transition-colors"
        >
          <X size={15} />
          Limpiar
        </button>
      )}
    </div>
  );
}
