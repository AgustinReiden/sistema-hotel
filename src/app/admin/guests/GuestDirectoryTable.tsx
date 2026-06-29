"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit, Loader2, Percent, Trash2 } from "lucide-react";
import { toast } from "sonner";

import GuestModal from "./GuestModal";
import { deleteGuestAction } from "./actions";
import { formatHotelDate } from "@/lib/time";
import type { GuestDirectoryEntry } from "@/lib/types";

export default function GuestDirectoryTable({
  guests,
  searchQuery,
  timezone,
}: {
  guests: GuestDirectoryEntry[];
  searchQuery: string;
  timezone: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (guest: GuestDirectoryEntry) => {
    if (!guest.id) return;
    if (
      !confirm(
        `¿Borrar a "${guest.client_name}" del padrón de huéspedes?\n\nLas reservas pasadas no se tocan; solo se quita del directorio.`
      )
    )
      return;

    setDeletingId(guest.id);
    const result = await deleteGuestAction(guest.id);
    if (result.success) {
      toast.success("Huésped borrado del padrón.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
    setDeletingId(null);
  };

  return (
    <div className="bg-white border text-left border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
            <th className="px-6 py-4">Huésped</th>
            <th className="px-6 py-4">Contacto</th>
            <th className="px-6 py-4">Origen</th>
            <th className="px-6 py-4">Descuento</th>
            <th className="px-6 py-4 text-center">Estadías</th>
            <th className="px-6 py-4">Última visita</th>
            <th className="px-6 py-4 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {guests.map((guest) => (
            <tr key={guest.key} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {guest.client_name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900">{guest.client_name}</span>
                    {guest.client_dni && (
                      <span className="text-[11px] text-slate-500">
                        {guest.guest_doc_type ? `${guest.guest_doc_type} ` : ""}
                        {guest.client_dni}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-slate-600">
                {guest.client_phone || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-col text-xs text-slate-600 max-w-[180px]">
                  {guest.guest_locality && <span className="truncate">{guest.guest_locality}</span>}
                  {guest.guest_nationality && (
                    <span className="text-slate-400 truncate">{guest.guest_nationality}</span>
                  )}
                  {!guest.guest_locality && !guest.guest_nationality && (
                    <span className="text-slate-300">—</span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4">
                {guest.discount_percent > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                    <Percent size={11} />
                    {guest.discount_percent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <span className="text-slate-300 text-sm">—</span>
                )}
              </td>
              <td className="px-6 py-4 text-center">
                {guest.stays_count > 0 ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                    {guest.stays_count}
                  </span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
              <td className="px-6 py-4 text-sm text-slate-600">
                {formatHotelDate(guest.last_check_in, timezone)}
              </td>
              <td className="px-6 py-4 text-right">
                {guest.id ? (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setEditingId(guest.id)}
                      className="inline-flex items-center justify-center p-2 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors cursor-pointer"
                      title="Editar huésped"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(guest)}
                      disabled={deletingId === guest.id}
                      className="inline-flex items-center justify-center p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      title="Borrar del padrón"
                    >
                      {deletingId === guest.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-400" title="Aparece por reservas pasadas; todavía no tiene ficha propia.">
                    de reservas
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {guests.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          {searchQuery
            ? "No hay huéspedes que coincidan con la búsqueda."
            : "Todavía no hay huéspedes registrados."}
        </div>
      )}

      <GuestModal guestId={editingId} onClose={() => setEditingId(null)} onSaved={() => router.refresh()} />
    </div>
  );
}
