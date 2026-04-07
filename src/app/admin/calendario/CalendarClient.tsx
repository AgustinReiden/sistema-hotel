"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";
import { CreditCard, Phone, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";

import NewReservationModal from "../NewReservationModal";
import { handleCancelReservation, handleCreateReservation } from "../actions";
import { getCalendarCellState } from "@/lib/calendar";
import type { Reservation, Room, UserRole } from "@/lib/types";

type CalendarClientProps = {
  rooms: Room[];
  reservations: Reservation[];
  startDate: string;
  daysCount: number;
  role: UserRole;
  standardCheckInTime: string;
  standardCheckOutTime: string;
};

type CreateDraft = {
  roomId: number;
  checkIn: string;
  checkOut: string;
};

type ReservationPlacement = {
  reservation: Reservation;
  stayStartIndex: number;
  staySpan: number;
  checkoutIndex: number | null;
  startsBeforeRange: boolean;
  endsAfterRange: boolean;
};

const CELL_WIDTH = 120;
const ROOM_COLUMN_WIDTH = 240;
const ROW_HEIGHT = 84;
const BAR_TOP = 10;
const BAR_HEIGHT = 50;

function getReservationTone(status: Reservation["status"]) {
  switch (status) {
    case "pending":
      return {
        barClass: "bg-slate-200 border-slate-300 text-slate-700",
        accent: "rgba(100, 116, 139, 0.92)",
      };
    case "checked_in":
      return {
        barClass: "bg-blue-500 border-blue-600 text-white",
        accent: "rgba(37, 99, 235, 0.95)",
      };
    default:
      return {
        barClass: "bg-emerald-500 border-emerald-600 text-white",
        accent: "rgba(5, 150, 105, 0.95)",
      };
  }
}

function buildReservationPlacement(
  reservation: Reservation,
  start: Date,
  daysCount: number
): ReservationPlacement | null {
  const checkInDay = startOfDay(new Date(reservation.check_in_target));
  const checkOutDay = startOfDay(new Date(reservation.check_out_target));

  const checkInIndex = differenceInCalendarDays(checkInDay, start);
  const checkoutIndex = differenceInCalendarDays(checkOutDay, start);
  const stayStartIndex = Math.max(0, checkInIndex);
  const stayEndIndex = Math.min(daysCount, checkoutIndex);
  const staySpan = Math.max(0, stayEndIndex - stayStartIndex);
  const checkoutVisible = checkoutIndex >= 0 && checkoutIndex < daysCount ? checkoutIndex : null;

  if (staySpan === 0 && checkoutVisible === null) {
    return null;
  }

  return {
    reservation,
    stayStartIndex,
    staySpan,
    checkoutIndex: checkoutVisible,
    startsBeforeRange: checkInIndex < 0,
    endsAfterRange: checkoutIndex >= daysCount,
  };
}

function buildDiagonalOverlay(color: string) {
  return `linear-gradient(135deg, ${color} 0%, ${color} 47%, transparent 47%, transparent 100%)`;
}

function buildDiagonalLine(color: string) {
  return `linear-gradient(135deg, transparent 48.4%, ${color} 48.4%, ${color} 51.6%, transparent 51.6%)`;
}

export default function CalendarClient({
  rooms,
  reservations,
  startDate,
  daysCount,
  role,
  standardCheckInTime,
  standardCheckOutTime,
}: CalendarClientProps) {
  const router = useRouter();
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const start = useMemo(() => startOfDay(new Date(startDate)), [startDate]);
  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, index) => addDays(start, index)),
    [daysCount, start]
  );
  const roomsById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const canCancel = role === "admin" || role === "receptionist";

  const openCreateModal = (roomId: number, day: Date) => {
    const checkInDate = format(day, "yyyy-MM-dd");
    const checkOutDate = format(addDays(day, 1), "yyyy-MM-dd");

    setCreateDraft({
      roomId,
      checkIn: `${checkInDate}T${standardCheckInTime}`,
      checkOut: `${checkOutDate}T${standardCheckOutTime}`,
    });
  };

  const openReservationDetails = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setCancelReason("");
  };

  const handleCancelSelectedReservation = () => {
    if (!selectedReservation || !cancelReason.trim()) return;

    startTransition(async () => {
      const result = await handleCancelReservation(selectedReservation.id, cancelReason.trim());

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Reserva cancelada correctamente.");
      setSelectedReservation(null);
      setCancelReason("");
      router.refresh();
    });
  };

  const selectedRoom = selectedReservation ? roomsById.get(selectedReservation.room_id) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between mb-5 gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            Confirmada
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-500" />
            Check-in
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-400" />
            Pendiente
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-sm bg-white border border-slate-300 [background-image:linear-gradient(135deg,rgba(15,23,42,0.75)_0%,rgba(15,23,42,0.75)_47%,transparent_47%,transparent_100%)]" />
            Checkout
          </span>
        </div>
        <p className="text-sm text-slate-500">
          Click en una fecha vacia para reservar. Click sobre una barra o checkout para ver la reserva.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <div className="min-w-max">
          <div className="flex border-b border-slate-200 sticky top-0 z-20 bg-slate-50">
            <div
              className="shrink-0 p-4 font-semibold text-slate-700 border-r border-slate-200 sticky left-0 z-20 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]"
              style={{ width: `${ROOM_COLUMN_WIDTH}px` }}
            >
              Habitacion
            </div>
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className="shrink-0 p-3 text-center border-r border-slate-200 bg-slate-50/70"
                style={{ width: `${CELL_WIDTH}px` }}
              >
                <p className="text-xs text-slate-500 uppercase font-medium">{format(day, "E", { locale: es })}</p>
                <p className="text-sm font-bold text-slate-800">{format(day, "dd MMM", { locale: es })}</p>
              </div>
            ))}
          </div>

          {rooms.map((room) => {
            const roomReservations = reservations
              .filter((reservation) => reservation.room_id === room.id)
              .sort(
                (left, right) =>
                  new Date(left.check_in_target).getTime() - new Date(right.check_in_target).getTime()
              );

            const placements = roomReservations
              .map((reservation) => buildReservationPlacement(reservation, start, daysCount))
              .filter((placement): placement is ReservationPlacement => placement !== null);

            return (
              <div key={room.id} className="flex border-b border-slate-100 hover:bg-slate-50/20">
                <div
                  className="shrink-0 p-4 font-medium text-slate-800 bg-white border-r border-slate-200 sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0]"
                  style={{ width: `${ROOM_COLUMN_WIDTH}px`, minHeight: `${ROW_HEIGHT}px` }}
                >
                  Hab. {room.room_number}
                  <span className="text-xs text-slate-500 block">{room.room_type}</span>
                </div>

                <div
                  className="relative shrink-0"
                  style={{ width: `${daysCount * CELL_WIDTH}px`, height: `${ROW_HEIGHT}px` }}
                >
                  <div className="absolute inset-0 flex">
                    {days.map((day) => (
                      <button
                        type="button"
                        key={`${room.id}-${day.toISOString()}`}
                        onClick={() => openCreateModal(room.id, day)}
                        className="h-full shrink-0 border-r border-slate-100 hover:bg-slate-50 transition-colors"
                        style={{ width: `${CELL_WIDTH}px` }}
                        aria-label={`Crear reserva para habitación ${room.room_number} el ${format(day, "dd/MM/yyyy")}`}
                      />
                    ))}
                  </div>

                  {placements.map((placement) => {
                    if (placement.staySpan === 0) return null;

                    const tone = getReservationTone(placement.reservation.status);
                    const width = placement.staySpan * CELL_WIDTH;
                    const showText = width >= 150;
                    const left = placement.stayStartIndex * CELL_WIDTH;

                    return (
                      <button
                        type="button"
                        key={`stay-${placement.reservation.id}`}
                        onClick={() => openReservationDetails(placement.reservation)}
                        className={`absolute z-10 border-y border-x px-4 text-left shadow-sm transition-transform hover:-translate-y-0.5 ${tone.barClass} ${
                          placement.startsBeforeRange ? "" : "rounded-l-2xl"
                        } ${
                          placement.checkoutIndex !== null || placement.endsAfterRange ? "" : "rounded-r-2xl"
                        }`}
                        style={{
                          left: `${left}px`,
                          top: `${BAR_TOP}px`,
                          width: `${width}px`,
                          height: `${BAR_HEIGHT}px`,
                        }}
                      >
                        {showText && (
                          <div className="flex h-full flex-col justify-center overflow-hidden">
                            <p className="text-sm font-semibold truncate">{placement.reservation.client_name}</p>
                            <p className="text-xs opacity-90">
                              {placement.reservation.status === "checked_in" ? "En estadia" : "Reserva"}
                            </p>
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {placements.map((placement) => {
                    if (placement.checkoutIndex === null) return null;

                    const checkoutDay = days[placement.checkoutIndex];
                    const cellState = getCalendarCellState(roomReservations, room.id, checkoutDay);
                    const sharedWithAnotherStay =
                      Boolean(cellState.stayReservation) &&
                      cellState.stayReservation?.id !== placement.reservation.id;
                    const tone = getReservationTone(placement.reservation.status);
                    const left = placement.checkoutIndex * CELL_WIDTH;

                    return (
                      <div
                        key={`checkout-${placement.reservation.id}`}
                        className="absolute"
                        style={{
                          left: `${left}px`,
                          top: `${BAR_TOP}px`,
                          width: `${CELL_WIDTH}px`,
                          height: `${BAR_HEIGHT}px`,
                        }}
                      >
                        {!sharedWithAnotherStay && (
                          <button
                            type="button"
                            onClick={() => openReservationDetails(placement.reservation)}
                            className={`absolute inset-0 z-10 border-y border-r bg-white/95 text-slate-500 shadow-sm ${
                              placement.staySpan === 0 && !placement.startsBeforeRange ? "rounded-l-2xl" : ""
                            } rounded-r-2xl`}
                          >
                            <span className="absolute bottom-2 right-3 text-[11px] font-semibold">Salida</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openReservationDetails(placement.reservation)}
                          className="absolute inset-0 z-20"
                          style={{
                            clipPath: sharedWithAnotherStay ? "polygon(0 0, 100% 0, 0 100%)" : undefined,
                          }}
                        >
                          <span
                            className="absolute inset-0"
                            style={{
                              backgroundImage: buildDiagonalOverlay(tone.accent),
                              borderTopLeftRadius: "16px",
                              borderBottomLeftRadius: sharedWithAnotherStay ? "0px" : "16px",
                              borderTopRightRadius: sharedWithAnotherStay ? "0px" : "16px",
                              borderBottomRightRadius: sharedWithAnotherStay ? "0px" : "16px",
                            }}
                          />
                        </button>

                        <div
                          className="absolute inset-0 z-30 pointer-events-none"
                          style={{
                            backgroundImage: buildDiagonalLine("rgba(15, 23, 42, 0.45)"),
                            borderTopLeftRadius: "16px",
                            borderBottomLeftRadius: sharedWithAnotherStay ? "0px" : "16px",
                            borderTopRightRadius: sharedWithAnotherStay ? "0px" : "16px",
                            borderBottomRightRadius: sharedWithAnotherStay ? "0px" : "16px",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <NewReservationModal
        isOpen={Boolean(createDraft)}
        onClose={() => setCreateDraft(null)}
        rooms={rooms}
        initialValues={createDraft ?? undefined}
        title="Nueva Reserva desde Calendario"
        onSubmit={async (data) => {
          const result = await handleCreateReservation(data);
          if (result.success) {
            setCreateDraft(null);
            router.refresh();
          }
          return result;
        }}
      />

      {selectedReservation && selectedRoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Detalle de Reserva</h3>
                <p className="text-sm text-slate-500">
                  Habitacion {selectedRoom.room_number} - {selectedRoom.room_type}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReservation(null)}
                className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Pasajero</p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <UserRound size={16} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-slate-400">Nombre</p>
                        <p className="font-semibold text-slate-800">{selectedReservation.client_name}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CreditCard size={16} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-slate-400">DNI o CUIT</p>
                        <p className="font-medium text-slate-700">{selectedReservation.client_dni || "Sin dato"}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Phone size={16} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-slate-400">Telefono</p>
                        <p className="font-medium text-slate-700">{selectedReservation.client_phone || "Sin dato"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Estadia y Montos</p>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Check-in</p>
                      <p className="font-semibold text-slate-800">{format(new Date(selectedReservation.check_in_target), "dd/MM/yyyy HH:mm")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Check-out</p>
                      <p className="font-semibold text-slate-800">{format(new Date(selectedReservation.check_out_target), "dd/MM/yyyy HH:mm")}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-slate-400">Total</p>
                        <p className="font-semibold text-slate-800">${selectedReservation.total_price.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Pagado</p>
                        <p className="font-semibold text-emerald-700">${selectedReservation.paid_amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Saldo</p>
                      <p className="font-semibold text-amber-700">
                        ${Math.max(0, selectedReservation.total_price - selectedReservation.paid_amount).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {canCancel && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                  <label className="block text-sm font-semibold text-red-800 mb-2" htmlFor="calendar-cancel-reason">
                    Motivo de cancelacion
                  </label>
                  <textarea
                    id="calendar-cancel-reason"
                    rows={4}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-red-200 bg-white focus:border-red-400 focus:ring outline-none resize-none"
                    placeholder="Ej. El pasajero cancelo el viaje."
                  />
                  <div className="flex justify-end mt-4">
                    <button
                      type="button"
                      onClick={handleCancelSelectedReservation}
                      disabled={isPending || !cancelReason.trim()}
                      className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50"
                    >
                      Cancelar Reserva
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
