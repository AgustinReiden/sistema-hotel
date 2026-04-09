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
import type { AssociatedClient, Reservation, Room, UserRole } from "@/lib/types";

type CalendarClientProps = {
  rooms: Room[];
  reservations: Reservation[];
  startDate: string;
  daysCount: number;
  role: UserRole;
  associatedClients: AssociatedClient[];
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
  visibleStartIndex: number;
  cellSpan: number;
  startsBeforeRange: boolean;
  endsAfterRange: boolean;
};

const CELL_WIDTH = 120;
const ROOM_COLUMN_WIDTH = 240;
const ROW_HEIGHT = 84;
const BAR_TOP = 4;
const BAR_HEIGHT = 76;

function getReservationPalette(category: "active" | "next" | "future" | "pending") {
  switch (category) {
    case "pending":
      return { from: "#94a3b8", to: "#64748b" }; // slate (grey)
    case "active":
      return { from: "#34d399", to: "#10b981" }; // emerald (green)
    case "next":
      return { from: "#fbbf24", to: "#f59e0b" }; // amber (yellow)
    case "future":
      return { from: "#60a5fa", to: "#3b82f6" }; // blue
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

  if (checkoutIndex < 0 || checkInIndex >= daysCount) return null;

  const visibleStartIndex = Math.max(0, checkInIndex);
  const visibleEndIndex = Math.min(daysCount - 1, checkoutIndex);

  if (visibleStartIndex > visibleEndIndex) return null;

  const startsBeforeRange = checkInIndex < 0;
  const endsAfterRange = checkoutIndex >= daysCount;

  const cellSpan = visibleEndIndex - visibleStartIndex + 1;

  return {
    reservation,
    visibleStartIndex,
    cellSpan,
    startsBeforeRange,
    endsAfterRange,
  };
}



export default function CalendarClient({
  rooms,
  reservations,
  startDate,
  daysCount,
  role,
  associatedClients,
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
      <style>{`
        .ribbon-gradient-anim {
          background-size: 200% 100%;
          animation: ribbon-bg 5s linear infinite;
        }
        @keyframes ribbon-bg {
          0% { background-position: 0% 50%; }
          100% { background-position: -200% 50%; }
        }
        .animate-float-ribbon {
          animation: float-ribbon 4s ease-in-out infinite;
        }
        @keyframes float-ribbon {
          0%, 100% { transform: translateY(0); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.05)); }
          50% { transform: translateY(-3px); filter: drop-shadow(0 8px 8px rgba(0,0,0,0.1)); }
        }
        .animate-float-ribbon:hover {
          animation-play-state: paused;
          transform: translateY(-4px);
          filter: drop-shadow(0 10px 15px rgba(0,0,0,0.15));
        }
      `}</style>
      <div className="flex flex-wrap items-center justify-between mb-5 gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-400" />
            Activa
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-amber-400" />
            Próxima
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-400" />
            Futuras
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-400" />
            Pendiente
          </span>
        </div>
        <p className="text-sm text-slate-500">
          Click en una fecha vacia para reservar. Click sobre una barra o checkout para ver la reserva.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <div className="min-w-max">
          <div className="flex border-b border-slate-200 sticky top-0 z-30 bg-slate-50">
            <div
              className="shrink-0 p-4 font-semibold text-slate-700 border-r border-slate-200 sticky left-0 z-40 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]"
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

            let foundNext = false;
            const categoryMap = new Map<string, "active" | "next" | "future" | "pending">();
            roomReservations.forEach((r) => {
              if (r.status === "pending") {
                categoryMap.set(r.id, "pending");
              } else if (r.status === "checked_in") {
                categoryMap.set(r.id, "active");
              } else {
                if (!foundNext) {
                  categoryMap.set(r.id, "next");
                  foundNext = true;
                } else {
                  categoryMap.set(r.id, "future");
                }
              }
            });

            return (
              <div key={room.id} className="flex border-b border-slate-100 hover:bg-slate-50/20">
                <div
                  className="shrink-0 p-4 font-medium text-slate-800 bg-white border-r border-slate-200 sticky left-0 z-20 shadow-[1px_0_0_0_#e2e8f0]"
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
                    const { cellSpan, startsBeforeRange, endsAfterRange } = placement;
                    const category = categoryMap.get(placement.reservation.id) ?? "pending";
                    const palette = getReservationPalette(category);
                    const width = cellSpan * CELL_WIDTH;
                    
                    const gap = 6;
                    const paddingV = 4;
                    const tl_x = startsBeforeRange ? 0 : gap;
                    const bl_x = startsBeforeRange ? 0 : CELL_WIDTH + gap;
                    const tr_x = endsAfterRange ? width : width - CELL_WIDTH - gap;
                    const br_x = endsAfterRange ? width : width - gap;

                    const points = `${tl_x},${paddingV} ${tr_x},${paddingV} ${br_x},${BAR_HEIGHT - paddingV} ${bl_x},${BAR_HEIGHT - paddingV}`;
                    
                    const left = placement.visibleStartIndex * CELL_WIDTH;
                    const horizontalWidth = (cellSpan - (endsAfterRange ? 0 : 1)) * CELL_WIDTH;
                    const showText = horizontalWidth >= 100;

                    return (
                      <div
                        key={`stay-${placement.reservation.id}`}
                        className="absolute z-10 animate-float-ribbon group pointer-events-none"
                        style={{
                          left: `${left}px`,
                          top: `${BAR_TOP}px`,
                          width: `${width}px`,
                          height: `${BAR_HEIGHT}px`,
                        }}
                      >
                        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                          <defs>
                            <linearGradient id={`grad-${placement.reservation.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor={palette.from} />
                              <stop offset="100%" stopColor={palette.to} />
                            </linearGradient>
                          </defs>
                          <polygon 
                            points={points} 
                            fill={`url(#grad-${placement.reservation.id})`} 
                            stroke={`url(#grad-${placement.reservation.id})`} 
                            strokeWidth="4" 
                            strokeLinejoin="round" 
                            className="drop-shadow-sm transition-opacity group-hover:opacity-90 pointer-events-auto cursor-pointer"
                            onClick={() => openReservationDetails(placement.reservation)}
                          />
                        </svg>

                        {showText && (
                          <div className="relative z-10 flex h-full flex-col justify-center items-center pointer-events-none">
                            <p className="text-[14px] font-black tracking-tight text-white drop-shadow-md whitespace-nowrap">
                              {placement.reservation.client_name}
                            </p>
                            <p className="text-[10px] uppercase font-black tracking-widest text-white/90 drop-shadow-md whitespace-nowrap">
                              {placement.reservation.status === "checked_in" ? "En estadia" : (placement.reservation.status === "pending" ? "Pendiente" : "Confirmada")}
                            </p>
                          </div>
                        )}
                        {!endsAfterRange && (
                          <span className="absolute bottom-[6px] right-[24px] z-10 text-[9px] font-black uppercase tracking-widest text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] pointer-events-none">
                            Salida
                          </span>
                        )}
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
        associatedClients={associatedClients}
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
