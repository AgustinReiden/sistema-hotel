"use client";

import { useState } from "react";
import { Building2, CreditCard, Percent } from "lucide-react";

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
  placeholder = "Buscar por nombre o DNI/CUIT",
}: AssociatedClientSelectorProps) {
  const selectedClient = clients.find((client) => client.id === selectedId) ?? null;
  const [query, setQuery] = useState("");
  const displayedQuery = query === "" ? selectedClient?.display_name ?? "" : query;

  const normalizedQuery = displayedQuery.trim().toLowerCase();
  const filteredClients = clients
    .filter((client) => {
      if (!normalizedQuery) return true;
      return (
        client.display_name.toLowerCase().includes(normalizedQuery) ||
        client.document_id.toLowerCase().includes(normalizedQuery)
      );
    })
    .slice(0, 8);

  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        value={displayedQuery}
        onChange={(e) => {
          const nextValue = e.target.value;
          setQuery(nextValue);
          if (
            selectedClient &&
            nextValue.trim().toLowerCase() !== selectedClient.display_name.trim().toLowerCase()
          ) {
            onSelect("");
          }
        }}
        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
        placeholder={placeholder}
        autoComplete="off"
      />

      <div className="rounded-xl border border-slate-200 bg-white max-h-52 overflow-y-auto divide-y divide-slate-100">
        {filteredClients.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-500">No se encontraron asociados.</div>
        ) : (
          filteredClients.map((client) => {
            const isSelected = client.id === selectedId;
            return (
              <button
                key={client.id}
                type="button"
                onClick={() => {
                  onSelect(client.id);
                  setQuery(client.display_name);
                }}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  isSelected ? "bg-emerald-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <Building2 size={14} className="text-slate-400" />
                      {client.display_name}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <CreditCard size={12} />
                      {client.document_id}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    <Percent size={12} />
                    {client.discount_percent.toLocaleString("es-AR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
