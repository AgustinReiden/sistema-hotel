"use client";

import { useMemo, useState } from "react";
import { Building2, Check, CreditCard, Percent, Search } from "lucide-react";

import type { AssociatedClient } from "@/lib/types";

type AssociatedClientSelectorProps = {
  clients: AssociatedClient[];
  selectedId: string;
  onSelect: (id: string) => void;
  inputId: string;
  label: string;
  placeholder?: string;
};

export default function AssociatedClientSelector({
  clients,
  selectedId,
  onSelect,
  inputId,
  label,
  placeholder = "Buscar por nombre o DNI/CUIT…",
}: AssociatedClientSelectorProps) {
  const [query, setQuery] = useState("");

  const activeClients = useMemo(() => clients.filter((client) => client.is_active), [clients]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return activeClients;
    return activeClients.filter(
      (c) =>
        c.display_name.toLowerCase().includes(normalizedQuery) ||
        c.document_id.toLowerCase().includes(normalizedQuery)
    );
  }, [activeClients, normalizedQuery]);

  const selectedClient = activeClients.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700">
        <span className="flex items-center gap-1.5">
          <Building2 size={14} />
          {label}
        </span>
      </label>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
        />
      </div>

      {activeClients.length === 0 ? (
        <p className="text-xs text-slate-500">No hay asociados activos cargados.</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white max-h-52 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">
              No se encontraron asociados para “{query.trim()}”.
            </div>
          ) : (
            filtered.map((client) => {
              const isSelected = client.id === selectedId;
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => onSelect(client.id)}
                  className={`w-full px-4 py-2.5 text-left transition-colors flex items-center justify-between gap-3 ${
                    isSelected ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      {isSelected && <Check size={14} className="text-emerald-600 shrink-0" />}
                      <span className="truncate">{client.display_name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <CreditCard size={12} />
                      {client.document_id}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 shrink-0">
                    <Percent size={11} />
                    {client.discount_percent.toLocaleString("es-AR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {selectedClient && (
        <p className="text-xs font-medium text-emerald-700">
          Seleccionado: {selectedClient.display_name}
        </p>
      )}
    </div>
  );
}
