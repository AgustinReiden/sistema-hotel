"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit, FolderArchive, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import AssociatedClientModal from "./AssociatedClientModal";
import {
  createAssociatedClientAction,
  toggleAssociatedClientStatusAction,
  updateAssociatedClientAction,
} from "./actions";
import type { AssociatedClient } from "@/lib/types";

export default function AssociatedClientsClientTable({
  initialClients,
  searchQuery,
}: {
  initialClients: AssociatedClient[];
  searchQuery: string;
}) {
  const router = useRouter();
  const [selectedClient, setSelectedClient] = useState<AssociatedClient | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);

  const handleToggleStatus = async (client: AssociatedClient) => {
    const nextIsActive = !client.is_active;
    const actionLabel = nextIsActive ? "reactivar" : "archivar";
    if (!confirm(`¿Seguro que deseas ${actionLabel} este asociado?`)) return;

    setChangingStatusId(client.id);
    const result = await toggleAssociatedClientStatusAction(client.id, nextIsActive);

    if (result.success) {
      toast.success(nextIsActive ? "Asociado reactivado." : "Asociado archivado.");
      router.refresh();
    } else {
      toast.error(result.error);
    }

    setChangingStatusId(null);
  };

  return (
    <>
      <div className="p-4 border-b border-slate-200 flex justify-end bg-slate-50">
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-medium flex items-center transition-colors shadow-sm"
        >
          <Plus size={18} className="mr-2" />
          Nuevo Asociado
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              <th className="px-6 py-4">Asociado</th>
              <th className="px-6 py-4">DNI/CUIT</th>
              <th className="px-6 py-4">Teléfono</th>
              <th className="px-6 py-4">Descuento</th>
              <th className="px-6 py-4">Estado</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {initialClients.map((client) => (
              <tr
                key={client.id}
                className={`transition-colors ${client.is_active ? "hover:bg-slate-50/80" : "bg-slate-50/60 text-slate-500"}`}
              >
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className={`font-semibold ${client.is_active ? "text-slate-900" : "text-slate-600"}`}>
                      {client.display_name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {client.notes ? client.notes : "Sin notas"}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-medium">{client.document_id}</td>
                <td className="px-6 py-4 text-sm">{client.phone || "Sin dato"}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    {client.discount_percent.toLocaleString("es-AR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                    %
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
                      client.is_active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {client.is_active ? "Activo" : "Archivado"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setSelectedClient(client)}
                      className="inline-flex items-center justify-center p-2 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors cursor-pointer"
                      title="Editar Asociado"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => handleToggleStatus(client)}
                      disabled={changingStatusId === client.id}
                      className="inline-flex items-center justify-center p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      title={client.is_active ? "Archivar Asociado" : "Reactivar Asociado"}
                    >
                      {client.is_active ? <FolderArchive size={18} /> : <RotateCcw size={18} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {initialClients.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          {searchQuery
            ? "No hay asociados que coincidan con la búsqueda."
            : "Todavía no hay asociados cargados."}
        </div>
      )}

      <AssociatedClientModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Nuevo Asociado"
        onSubmit={async (payload) => {
          const result = await createAssociatedClientAction(payload);
          if (result.success) router.refresh();
          return result;
        }}
      />

      <AssociatedClientModal
        isOpen={Boolean(selectedClient)}
        onClose={() => setSelectedClient(null)}
        initialClient={selectedClient}
        title="Editar Asociado"
        onSubmit={async (payload) => {
          if (!selectedClient) return { success: false, error: "Asociado no encontrado." };
          const result = await updateAssociatedClientAction(selectedClient.id, payload);
          if (result.success) router.refresh();
          return result;
        }}
      />
    </>
  );
}
