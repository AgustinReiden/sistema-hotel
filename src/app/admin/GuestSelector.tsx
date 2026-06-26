"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, Loader2, Percent, Search, UserRound } from "lucide-react";

import { searchGuestsAction } from "./actions";
import type { GuestDirectoryEntry } from "@/lib/types";

type GuestSelectorProps = {
  onSelect: (entry: GuestDirectoryEntry) => void;
  inputId?: string;
};

function shortDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

/**
 * Buscador del padron de huespedes (nombre o DNI). Es la columna vertebral del alta de reserva:
 * al elegir una persona se autocompletan sus datos. Si no esta, se carga abajo y se guarda sola.
 */
export default function GuestSelector({ onSelect, inputId = "guestSearch" }: GuestSelectorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuestDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  // Nombre recien elegido: evita re-buscar cuando el query queda con ese nombre.
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      if (trimmed === lastSelected || trimmed.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const found = await searchGuestsAction(trimmed);
      if (!active) return;
      setResults(found);
      setLoading(false);
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, lastSelected]);

  const handleSelect = (entry: GuestDirectoryEntry) => {
    setLastSelected(entry.client_name.trim());
    setQuery(entry.client_name);
    setResults([]);
    onSelect(entry);
  };

  const trimmed = query.trim();
  const showDropdown = touched && trimmed.length >= 2 && trimmed !== lastSelected;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700">
        <span className="flex items-center gap-1.5">
          <UserRound size={14} />
          Buscar huésped en el padrón
        </span>
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
          placeholder="Nombre o DNI/CUIT…"
          autoComplete="off"
          className="w-full pl-9 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
        />
        {loading && (
          <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
        )}
      </div>

      {showDropdown && (
        <div className="rounded-xl border border-slate-200 bg-white max-h-56 overflow-y-auto divide-y divide-slate-100 shadow-sm">
          {loading ? (
            <div className="px-4 py-3 text-sm text-slate-500">Buscando…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">
              No está en el padrón. Cargá los datos abajo y se guardará solo.
            </div>
          ) : (
            results.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => handleSelect(g)}
                className="w-full px-4 py-2.5 text-left transition-colors flex items-center justify-between gap-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Check size={14} className="text-emerald-600 shrink-0" />
                    <span className="truncate">{g.client_name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <CreditCard size={12} />
                      {g.client_dni || "Sin DNI"}
                    </span>
                    {g.stays_count > 0 && (
                      <span className="text-slate-400">
                        · {g.stays_count} estadía{g.stays_count === 1 ? "" : "s"}
                        {g.last_check_in ? ` · últ. ${shortDate(g.last_check_in)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {g.discount_percent > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 shrink-0">
                    <Percent size={11} />
                    {g.discount_percent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
