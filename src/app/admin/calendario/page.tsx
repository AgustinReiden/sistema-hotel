import { CalendarDays } from "lucide-react";

import CalendarClient from "./CalendarClient";
import CalendarNav from "./CalendarNav";
import NewReservationButton from "../NewReservationButton";
import { PageHeader } from "../PageShell";
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
// En el teléfono 14 columnas son ~1000px: casi tres pantallas de scroll horizontal. Con
// ?days=7 la grilla entra de un vistazo. Sólo se aceptan esos dos valores: la ventana es
// también la paginación (Anterior/Siguiente saltan daysCount días).
const CALENDAR_NARROW_DAYS = 7;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; days?: string }>;
}) {
  const { start, days } = await searchParams;
  const windowDays = days === String(CALENDAR_NARROW_DAYS) ? CALENDAR_NARROW_DAYS : CALENDAR_WINDOW_DAYS;

  const [{ rooms, reservations, startDate, daysCount }, hotelSettings, role, associatedClients] =
    await Promise.all([
      getTimelineData(windowDays, start),
      getHotelSettings(),
      getCurrentUserRole(),
      getActiveAssociatedClients(),
    ]);

  const tz = hotelSettings.timezone || "America/Argentina/Tucuman";
  // "Ahora" del servidor: el cliente lo usa para decidir qué llegadas ya se pueden
  // registrar, sin depender del reloj de la PC de recepción.
  const nowIso = new Date().toISOString();
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
      <PageHeader
        icon={<CalendarDays size={20} className="text-slate-600" />}
        title="Calendario de Reservas"
      >
        <NewReservationButton
          rooms={rooms}
          associatedClients={associatedClients}
          standardCheckInTime={hotelSettings.standard_check_in_time.slice(0, 5)}
          standardCheckOutTime={hotelSettings.standard_check_out_time.slice(0, 5)}
        />
      </PageHeader>

      <div className="flex-1 overflow-auto p-3 md:p-4">
        <CalendarNav startDateKey={startDateKey} daysCount={daysCount} todayKey={todayKey} />
        <CalendarClient
          rooms={rooms}
          reservations={reservations}
          startDateKey={startDateKey}
          nowIso={nowIso}
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
