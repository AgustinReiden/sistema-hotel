import { CalendarDays } from "lucide-react";

import CalendarClient from "./CalendarClient";
import {
  getActiveAssociatedClients,
  getCurrentUserRole,
  getHotelSettings,
  getTimelineData,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [{ rooms, reservations, startDate, daysCount }, hotelSettings, role, associatedClients] =
    await Promise.all([
    getTimelineData(14),
    getHotelSettings(),
    getCurrentUserRole(),
    getActiveAssociatedClients(),
  ]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-100 rounded-lg">
            <CalendarDays size={20} className="text-slate-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Calendario de Reservas (Próximos {daysCount} días)</h1>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <CalendarClient
          rooms={rooms}
          reservations={reservations}
          startDate={startDate.toISOString()}
          daysCount={daysCount}
          role={role}
          associatedClients={associatedClients}
          standardCheckInTime={hotelSettings.standard_check_in_time.slice(0, 5)}
          standardCheckOutTime={hotelSettings.standard_check_out_time.slice(0, 5)}
        />
      </div>
    </div>
  );
}
