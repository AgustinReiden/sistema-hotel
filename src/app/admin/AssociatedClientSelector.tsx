"use client";

import { Building2 } from "lucide-react";

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
  placeholder = "Selecciona un asociado",
}: AssociatedClientSelectorProps) {
  const activeClients = clients.filter((client) => client.is_active);

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 mb-1.5">
        <span className="flex items-center gap-1.5">
          <Building2 size={14} />
          {label}
        </span>
      </label>
      <select
        id={inputId}
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
      >
        <option value="">{placeholder}</option>
        {activeClients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.display_name} · {client.document_id} ·{" "}
            {client.discount_percent.toLocaleString("es-AR", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}
            % desc.
          </option>
        ))}
      </select>
      {activeClients.length === 0 && (
        <p className="text-xs text-slate-500">No hay asociados activos cargados.</p>
      )}
    </div>
  );
}
