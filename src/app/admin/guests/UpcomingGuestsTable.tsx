import { formatHotelShortDateTime } from "@/lib/time";
import type { UpcomingGuest } from "@/lib/types";

export default function UpcomingGuestsTable({
  guests,
  searchQuery,
  timezone,
}: {
  guests: UpcomingGuest[];
  searchQuery: string;
  timezone: string;
}) {
  return (
    <div className="bg-white border text-left border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
            <th className="px-6 py-4">Huésped</th>
            <th className="px-6 py-4">Habitación</th>
            <th className="px-6 py-4">Entrada</th>
            <th className="px-6 py-4">Salida</th>
            <th className="px-6 py-4">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {guests.map((guest) => (
            <tr key={guest.id} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {guest.client_name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900">{guest.client_name}</span>
                    {guest.client_dni && (
                      <span className="text-[11px] text-slate-500">{guest.client_dni}</span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                  Hab. {guest.room_number}
                </span>
              </td>
              <td className="px-6 py-4 text-sm text-slate-900 font-medium">
                {formatHotelShortDateTime(guest.check_in_target, timezone)}
              </td>
              <td className="px-6 py-4 text-sm text-slate-600">
                {formatHotelShortDateTime(guest.check_out_target, timezone)}
              </td>
              <td className="px-6 py-4">
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                  Por Llegar
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {guests.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          {searchQuery
            ? "No hay próximas llegadas que coincidan con la búsqueda."
            : "No hay huéspedes por llegar."}
        </div>
      )}
    </div>
  );
}
