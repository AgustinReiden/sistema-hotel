"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, Loader2, Search, UserRound } from "lucide-react";

import { searchCompanyPassengersAction } from "./actions";
import type { CompanyPassenger } from "@/lib/types";

type CompanyPassengerSelectorProps = {
  companyId: string;
  onSelect: (passenger: CompanyPassenger) => void;
  inputId?: string;
};

/**
 * Buscador de pasajeros DENTRO de una empresa (tabla company_passengers). Al elegir uno se
 * autocompleta nombre + DNI. Si no esta, se carga abajo y se crea al confirmar (dedup por DNI
 * dentro de la empresa).
 */
export default function CompanyPassengerSelector({
  companyId,
  onSelect,
  inputId = "companyPassengerSearch",
}: CompanyPassengerSelectorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanyPassenger[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  // El reset al cambiar de empresa lo maneja el padre remontando con key={companyId}.
  useEffect(() => {
    const trimmed = query.trim();
    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      if (trimmed === lastSelected || trimmed.length < 2 || !companyId) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const found = await searchCompanyPassengersAction(companyId, trimmed);
      if (!active) return;
      setResults(found);
      setLoading(false);
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, lastSelected, companyId]);

  const handleSelect = (passenger: CompanyPassenger) => {
    setLastSelected(passenger.full_name.trim());
    setQuery(passenger.full_name);
    setResults([]);
    onSelect(passenger);
  };

  const trimmed = query.trim();
  const showDropdown = touched && trimmed.length >= 2 && trimmed !== lastSelected;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-xs font-semibold text-slate-600">
        Buscar pasajero de la empresa
      </label>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => {
            setTouched(true);
            setLastSelected(null);
            setQuery(e.target.value);
          }}
          placeholder="Nombre o DNI…"
          autoComplete="off"
          className="w-full pl-9 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
        />
        {loading && (
          <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
        )}
      </div>

      {showDropdown && (
        <div className="rounded-xl border border-slate-200 bg-white max-h-48 overflow-y-auto divide-y divide-slate-100 shadow-sm">
          {loading ? (
            <div className="px-4 py-3 text-sm text-slate-500">Buscando…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">
              No figura en esta empresa. Cargalo abajo y se crea solo.
            </div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className="w-full px-4 py-2.5 text-left transition-colors flex items-center gap-2 hover:bg-slate-50"
              >
                <Check size={14} className="text-emerald-600 shrink-0" />
                <span className="text-sm font-semibold text-slate-800 truncate">{p.full_name}</span>
                <span className="flex items-center gap-1 text-xs text-slate-500 ml-auto shrink-0">
                  <CreditCard size={12} />
                  {p.document_id || "Sin DNI"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {!companyId && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <UserRound size={12} /> Elegí primero la empresa.
        </p>
      )}
    </div>
  );
}
