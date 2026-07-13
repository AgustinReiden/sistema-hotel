import { CalendarDays } from "lucide-react";

import CalendarClient from "./CalendarClient";
import CalendarNav from "./CalendarNav";
import NewReservationButton from "../NewReservationButton";
import {
  getActiveAssociatedClients,
  getCurrentUserRole,
  getHotelSettings,
  getTimelineData,
} from "@/lib/data";

export const dynamic = "force-dynamic";

// Ventana visible del calendario: máximo 14 días. Por defecto arranca hoy; con ?start=YYYY-MM-DD
// se ancla en otra fecha para navegar hacia adelante/atrás sin superar ese máximo.
const CALENDAR_WINDOW_DAYS = 14;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const { start } = await searchParams;

  const [{ rooms, reservations, startDate, daysCount }, hotelSettings, role, associatedClients] =
    await Promise.all([
      getTimelineData(CALENDAR_WINDOW_DAYS, start),
      getHotelSettings(),
      getCurrentUserRole(),
      getActiveAssociatedClients(),
    ]);

  const tz = hotelSettings.timezone || "America/Argentina/Tucuman";
  const dateKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Clave "YYYY-MM-DD" de la primera columna (startDate = medianoche del ancla en la zona del hotel).
  const startDateKey = dateKeyFmt.format(startDate);
  // Hoy en la zona del hotel: para resaltar el botón "Hoy" de la navegación.
  const todayKey = dateKeyFmt.format(new Date());

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-100 rounded-lg">
            <CalendarDays size={20} className="text-slate-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Calendario de Reservas</h1>
        </div>
        <NewReservationButton
          rooms={rooms}
          associatedClients={associatedClients}
          standardCheckInTime={hotelSettings.standard_check_in_time.slice(0, 5)}
          standardCheckOutTime={hotelSettings.standard_check_out_time.slice(0, 5)}
        />
      </header>

      <div className="flex-1 overflow-auto p-4">
        <CalendarNav startDateKey={startDateKey} daysCount={daysCount} todayKey={todayKey} />
        <CalendarClient
          rooms={rooms}
          reservations={reservations}
          startDateKey={startDateKey}
          timezone={tz}
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
