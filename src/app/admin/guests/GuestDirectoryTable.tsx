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
  return (
    <div className="bg-white border text-left border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
            <th className="px-6 py-4">Huésped</th>
            <th className="px-6 py-4">Contacto</th>
            <th className="px-6 py-4">Origen</th>
            <th className="px-6 py-4 text-center">Estadías</th>
            <th className="px-6 py-4">Última visita</th>
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
              <td className="px-6 py-4 text-center">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  {guest.stays_count}
                </span>
              </td>
              <td className="px-6 py-4 text-sm text-slate-600">
                {formatHotelDate(guest.last_check_in, timezone)}
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
    </div>
  );
}
