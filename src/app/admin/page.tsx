import { AlertTriangle } from "lucide-react";
import { format, isAfter } from "date-fns";
import { es } from "date-fns/locale";

import NewReservationButton from "./NewReservationButton";
import RoomCard from "./RoomCard";
import { getDashboardData } from "@/lib/data";


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
  reservationId: string | null;
  reservationStatus: string | null;
  totalPrice: number;
  paidAmount: number;
  basePrice: number;
};

function isRoomOccupiedNow(reservation: { status: string }): boolean {
  return reservation.status === "checked_in";
}

function isRoomConfirmed(reservation: { status: string }): boolean {
  return reservation.status === "confirmed";
}

export default async function Dashboard() {
  const { rooms, reservations } = await getDashboardData();
  const now = new Date();

  let lateCheckoutsCount = 0;

  const mappedRooms: DashboardRoom[] = rooms.map((room) => {
    const roomReservations = reservations.filter((reservation) => reservation.room_id === room.id);
    const activeReservation = roomReservations.find((reservation) =>
      isRoomOccupiedNow(reservation)
    );
    const confirmedReservation = !activeReservation
      ? roomReservations.find((r) => isRoomConfirmed(r))
      : undefined;

    let status = room.status;
    let isLate = false;
    let checkout: string | null = null;
    let client: string | null = null;
    let reservationId: string | null = null;
    let reservationStatus: string | null = null;
    let totalPrice = 0;
    let paidAmount = 0;

    if (activeReservation) {
      status = "occupied";
      client = activeReservation.client_name;
      checkout = format(new Date(activeReservation.check_out_target), "dd MMM HH:mm", {
        locale: es,
      });
      reservationId = activeReservation.id;
      reservationStatus = activeReservation.status;
      totalPrice = activeReservation.total_price;
      paidAmount = activeReservation.paid_amount;

      if (isAfter(now, new Date(activeReservation.check_out_target))) {
        isLate = true;
        lateCheckoutsCount++;
      }
    } else if (confirmedReservation) {
      // Show confirmed reservations as a "pending check-in" state
      client = confirmedReservation.client_name;
      checkout = format(new Date(confirmedReservation.check_out_target), "dd MMM HH:mm", {
        locale: es,
      });
      reservationId = confirmedReservation.id;
      reservationStatus = confirmedReservation.status;
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
      reservationId,
      reservationStatus,
      totalPrice,
      paidAmount,
      basePrice: room.base_price,
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
          <NewReservationButton rooms={rooms} />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
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
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      </div>
    </>
  );
}
