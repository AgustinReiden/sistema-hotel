"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CreditCard, Loader2, Percent, Search, UserRound } from "lucide-react";

import { searchGuestsAction } from "./actions";
import type { AssociatedClient, GuestDirectoryEntry } from "@/lib/types";

type ClientSearchProps = {
  associatedClients: AssociatedClient[];
  onSelectGuest: (entry: GuestDirectoryEntry) => void;
  onSelectCompany: (company: AssociatedClient) => void;
  inputId?: string;
};

function shortDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

/**
 * Buscador UNIFICADO del alta de reserva / check-in: en un solo input se busca por nombre o DNI y
 * aparecen HUÉSPEDES (padrón) y EMPRESAS/CONVENIOS juntos. Lo que se elige define el modo:
 * huésped -> flujo persona; empresa -> se despliega abajo el pasajero. No hay toggle previo.
 */
export default function ClientSearch({
  associatedClients,
  onSelectGuest,
  onSelectCompany,
  inputId = "clientSearch",
}: ClientSearchProps) {
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState<GuestDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const trimmed = query.trim();
  const normalizedQuery = trimmed.toLowerCase();

  const companyMatches = useMemo(() => {
    if (normalizedQuery.length < 2) return [];
    return associatedClients
      .filter((c) => c.is_active)
      .filter(
        (c) =>
          c.display_name.toLowerCase().includes(normalizedQuery) ||
          c.document_id.toLowerCase().includes(normalizedQuery)
      )
      .slice(0, 10);
  }, [associatedClients, normalizedQuery]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!active) return;
      if (trimmed.length < 2) {
        setGuests([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const found = await searchGuestsAction(trimmed);
      if (!active) return;
      setGuests(found);
      setLoading(false);
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  const reset = () => {
    setQuery("");
    setGuests([]);
  };

  const handleGuest = (entry: GuestDirectoryEntry) => {
    onSelectGuest(entry);
    reset();
  };
  const handleCompany = (company: AssociatedClient) => {
    onSelectCompany(company);
    reset();
  };

  const showDropdown = touched && trimmed.length >= 2;
  const hasResults = companyMatches.length > 0 || guests.length > 0;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700">
        <span className="flex items-center gap-1.5">
          <Search size={14} />
          Buscar huésped o empresa
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
        <div className="rounded-xl border border-slate-200 bg-white max-h-64 overflow-y-auto divide-y divide-slate-100 shadow-sm">
          {companyMatches.map((c) => (
            <button
              key={`company-${c.id}`}
              type="button"
              onClick={() => handleCompany(c)}
              className="w-full px-4 py-2.5 text-left transition-colors flex items-center justify-between gap-3 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Building2 size={14} className="text-sky-600 shrink-0" />
                  <span className="truncate">{c.display_name}</span>
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700 shrink-0">
                    Empresa
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 pl-6">
                  <CreditCard size={12} />
                  {c.document_id || "Sin CUIT"}
                </div>
              </div>
              {c.discount_percent > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 shrink-0">
                  <Percent size={11} />
                  {c.discount_percent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                </span>
              )}
            </button>
          ))}

          {guests.map((g) => (
            <button
              key={`guest-${g.key}`}
              type="button"
              onClick={() => handleGuest(g)}
              className="w-full px-4 py-2.5 text-left transition-colors flex items-center justify-between gap-3 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <UserRound size={14} className="text-emerald-600 shrink-0" />
                  <span className="truncate">{g.client_name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 pl-6">
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
          ))}

          {!loading && !hasResults && (
            <div className="px-4 py-3 text-sm text-slate-500">
              No hay coincidencias. Si es un huésped nuevo, cargá los datos abajo.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
