import Link from "next/link";
import { AlertTriangle, ClipboardList, Sparkles } from "lucide-react";
import { format, isAfter } from "date-fns";
import { es } from "date-fns/locale";

import NewReservationButton from "./NewReservationButton";
import RoomCard from "./RoomCard";
import {
  getActiveAssociatedClients,
  getCurrentUserRole,
  getDashboardData,
  getPendingSolicitudesCount,
  getUnresolvedAdminAlertsCount,
} from "@/lib/data";

export const dynamic = "force-dynamic";

type DashboardRoom = {
  id: number;
  number: string;
  type: string;
  status: string;
  client: string | null;
  checkout: string | null;
  check_out_target: string | null;
  isLate: boolean;
  hasLateCheckout: boolean;
  canChargeLateCheckout: boolean;
  reservationId: string | null;
  reservationStatus: string | null;
  baseTotalPrice: number;
  discountPercent: number;
  discountAmount: number;
  totalPrice: number;
  paidAmount: number;
  basePrice: number;
  hasArrivalToday: boolean;
};

function getDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isRoomOccupiedNow(reservation: { status: string }) {
  return reservation.status === "checked_in";
}

function isRoomConfirmedToday(
  reservation: { status: string; check_in_target: string },
  todayKey: string,
  timeZone: string
) {
  return (
    reservation.status === "confirmed" &&
    getDateKey(new Date(reservation.check_in_target), timeZone) === todayKey
  );
}

export default async function Dashboard() {
  const [{ rooms, reservations, hotelSettings }, associatedClients, role, pendingSolicitudesCount, unresolvedAlertsCount] = await Promise.all([
    getDashboardData(),
    getActiveAssociatedClients(),
    getCurrentUserRole(),
    getPendingSolicitudesCount(),
    getUnresolvedAdminAlertsCount().catch(() => 0),
  ]);
  const isAdmin = role === "admin";
  const now = new Date();
  const todayKey = getDateKey(now, hotelSettings.timezone);

  let lateCheckoutsCount = 0;

  const mappedRooms: DashboardRoom[] = rooms.map((room) => {
    const roomReservations = reservations.filter((reservation) => reservation.room_id === room.id);
    const activeReservation = roomReservations.find((reservation) =>
      isRoomOccupiedNow(reservation)
    );
    const confirmedReservation = !activeReservation && room.status === "available"
      ? roomReservations.find((reservation) =>
        isRoomConfirmedToday(reservation, todayKey, hotelSettings.timezone)
      )
      : undefined;

    let status = room.status;
    let isLate = false;
    let hasLateCheckout = false;
    let canChargeLateCheckout = false;
    let checkout: string | null = null;
    let client: string | null = null;
    let reservationId: string | null = null;
    let reservationStatus: string | null = null;
    let baseTotalPrice = 0;
    let discountPercent = 0;
    let discountAmount = 0;
    let totalPrice = 0;
    let paidAmount = 0;

    if (activeReservation) {
      status = "occupied";
      hasLateCheckout = Boolean(activeReservation.late_check_out_until);
      const effectiveCheckOut =
        activeReservation.late_check_out_until ?? activeReservation.check_out_target;
      client = activeReservation.client_name;
      checkout = format(new Date(effectiveCheckOut), "dd MMM HH:mm", {
        locale: es,
      });
      reservationId = activeReservation.id;
      reservationStatus = activeReservation.status;
      baseTotalPrice = activeReservation.base_total_price;
      discountPercent = activeReservation.discount_percent;
      discountAmount = activeReservation.discount_amount;
      totalPrice = activeReservation.total_price;
      paidAmount = activeReservation.paid_amount;

      canChargeLateCheckout =
        isAfter(now, new Date(activeReservation.check_out_target)) &&
        !activeReservation.late_check_out_until;
      if (isAfter(now, new Date(effectiveCheckOut))) {
        isLate = true;
        lateCheckoutsCount++;
      }
    } else if (confirmedReservation) {
      client = confirmedReservation.client_name;
      checkout = format(new Date(confirmedReservation.check_out_target), "dd MMM HH:mm", {
        locale: es,
      });
      reservationId = confirmedReservation.id;
      reservationStatus = confirmedReservation.status;
      baseTotalPrice = confirmedReservation.base_total_price;
      discountPercent = confirmedReservation.discount_percent;
      discountAmount = confirmedReservation.discount_amount;
      totalPrice = confirmedReservation.total_price;
      paidAmount = confirmedReservation.paid_amount;
    }

    return {
      id: room.id,
      number: room.room_number,
      type: room.room_type,
      status,
      client,
      checkout,
      check_out_target: activeReservation?.check_out_target ?? null,
      isLate,
      hasLateCheckout,
      canChargeLateCheckout,
      reservationId,
      reservationStatus,
      baseTotalPrice,
      discountPercent,
      discountAmount,
      totalPrice,
      paidAmount,
      basePrice: room.base_price,
      hasArrivalToday: Boolean(confirmedReservation),
    };
  });

  return (
    <>
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-50 shadow-sm shrink-0">
        <h1 className="text-xl font-bold text-slate-800">
          Vista Global: {format(now, "eeee, dd MMM", { locale: es })}
        </h1>
        <div className="flex items-center space-x-4">
          {lateCheckoutsCount > 0 && (
            <div className="px-4 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium border border-amber-200 shadow-sm flex items-center">
              <AlertTriangle size={14} className="mr-2" />
              {lateCheckoutsCount} Check-out Retrasado
            </div>
          )}
          <NewReservationButton
            rooms={rooms}
            associatedClients={associatedClients}
            standardCheckInTime={hotelSettings.standard_check_in_time}
            standardCheckOutTime={hotelSettings.standard_check_out_time}
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        {isAdmin && unresolvedAlertsCount > 0 && (
          <div className="mb-6 bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Sparkles size={20} />
              </div>
              <div>
                <p className="font-bold text-amber-900">
                  Tenés {unresolvedAlertsCount} alerta{unresolvedAlertsCount === 1 ? "" : "s"} de mantenimiento
                </p>
                <p className="text-sm text-amber-700">
                  Limpiezas no esperadas registradas por mantenimiento. Revisa el panel.
                </p>
              </div>
            </div>
            <Link
              href="/admin/mantenimiento"
              className="shrink-0 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center gap-2"
            >
              <Sparkles size={16} />
              Ver alertas
            </Link>
          </div>
        )}
        {pendingSolicitudesCount > 0 && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <ClipboardList size={20} />
              </div>
              <div>
                <p className="font-bold text-blue-900">
                  Tenés {pendingSolicitudesCount} solicitud{pendingSolicitudesCount === 1 ? "" : "es"} pendiente{pendingSolicitudesCount === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-blue-700">
                  Reservas web esperando que las confirmes o rechaces.
                </p>
              </div>
            </div>
            <Link
              href="/admin/solicitudes"
              className="shrink-0 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center gap-2"
            >
              <ClipboardList size={16} />
              Ir a Solicitudes
            </Link>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500 mb-1">Total Habitaciones</p>
            <p className="text-3xl font-bold text-slate-800">{rooms.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500 mb-1">Ocupadas</p>
            <p className="text-3xl font-bold text-slate-800">
              {mappedRooms.filter((room) => room.status === "occupied").length}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500 mb-1">Por Limpiar</p>
            <p className="text-3xl font-bold text-slate-800">
              {mappedRooms.filter((room) => room.status === "cleaning").length}
            </p>
          </div>
        </div>

        <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center">
          Estado Actual de Habitaciones
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {mappedRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              associatedClients={associatedClients}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      </div>
    </>
  );
}
