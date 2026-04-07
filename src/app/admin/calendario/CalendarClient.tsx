"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, CreditCard, Phone, UserRound, XCircle } from "lucide-react";
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

function buildCellGradient(color: string) {
  return `linear-gradient(135deg, ${color} 0%, ${color} 49%, transparent 50%, transparent 100%)`;
}

function getReservationTone(status: Reservation["status"]) {
  switch (status) {
    case "pending":
      return {
        fill: "bg-slate-100 border-slate-300 text-slate-700",
        diagonal: "rgba(148, 163, 184, 0.9)",
      };
    case "checked_in":
      return {
        fill: "bg-blue-100 border-blue-300 text-blue-800",
        diagonal: "rgba(59, 130, 246, 0.9)",
      };
    default:
      return {
        fill: "bg-emerald-100 border-emerald-300 text-emerald-800",
        diagonal: "rgba(16, 185, 129, 0.9)",
      };
  }
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

  const start = useMemo(() => new Date(startDate), [startDate]);
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

  const handleCellClick = (room: Room, day: Date) => {
    const { stayReservation, checkoutReservation } = getCalendarCellState(reservations, room.id, day);

    if (stayReservation) {
      openReservationDetails(stayReservation);
      return;
    }

    if (checkoutReservation) {
      openReservationDetails(checkoutReservation);
      return;
    }

    openCreateModal(room.id, day);
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
      <div className="flex items-center justify-between mb-5 gap-4">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-300 border border-emerald-400" />
            Confirmada
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-300 border border-blue-400" />
            Check-in
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3 py-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-300 border border-slate-400" />
            Pendiente
          </span>
        </div>
        <div className="text-sm text-slate-500">
          Click en una fecha vacia para crear una reserva. Click en una reserva para verla o cancelarla.
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <div className="flex border-b border-slate-200 min-w-max sticky top-0 z-20 bg-slate-50">
          <div className="w-48 shrink-0 p-4 font-semibold text-slate-700 border-r border-slate-200 sticky left-0 z-20 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]">
            Habitacion
          </div>
          {days.map((day) => (
            <div key={day.toISOString()} className="w-32 shrink-0 p-3 text-center border-r border-slate-200 bg-slate-50/70">
              <p className="text-xs text-slate-500 uppercase font-medium">{format(day, "E", { locale: es })}</p>
              <p className="text-sm font-bold text-slate-800">{format(day, "dd MMM", { locale: es })}</p>
            </div>
          ))}
        </div>

        <div className="min-w-max">
          {rooms.map((room) => (
            <div key={room.id} className="flex border-b border-slate-100 hover:bg-slate-50/40 group">
              <div className="w-48 shrink-0 p-4 font-medium text-slate-800 bg-white group-hover:bg-slate-50 border-r border-slate-200 sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0]">
                Hab. {room.room_number}
                <span className="text-xs text-slate-500 block">{room.room_type}</span>
              </div>

              <div className="flex">
                {days.map((day, dayIndex) => {
                  const { stayReservation, checkoutReservation } = getCalendarCellState(reservations, room.id, day);
                  const stayTone = stayReservation ? getReservationTone(stayReservation.status) : null;
                  const checkoutTone = checkoutReservation ? getReservationTone(checkoutReservation.status) : null;
                  const showLabel =
                    stayReservation &&
                    (isSameDay(day, new Date(stayReservation.check_in_target)) || dayIndex === 0);

                  return (
                    <button
                      type="button"
                      key={`${room.id}-${day.toISOString()}`}
                      onClick={() => handleCellClick(room, day)}
                      className="relative w-32 h-20 shrink-0 border-r border-slate-100 text-left transition-colors hover:bg-slate-50"
                    >
                      {(stayReservation || checkoutReservation) ? (
                        <div
                          className={`absolute inset-1 rounded-lg border overflow-hidden shadow-sm ${
                            stayTone?.fill ?? "bg-white border-slate-200 text-slate-500"
                          }`}
                        >
                          {checkoutReservation && (
                            <div
                              className="absolute inset-0 pointer-events-none"
                              style={{
                                backgroundImage: buildCellGradient(
                                  (checkoutTone ?? getReservationTone(checkoutReservation.status)).diagonal
                                ),
                              }}
                            />
                          )}
                          {showLabel && stayReservation && (
                            <div className="relative z-10 p-2">
                              <p className="text-[11px] font-bold truncate">{stayReservation.client_name}</p>
                              <p className="text-[10px] opacity-80 capitalize">
                                {stayReservation.status === "checked_in" ? "En estadia" : stayReservation.status}
                              </p>
                            </div>
                          )}
                          {!stayReservation && checkoutReservation && (
                            <div className="relative z-10 p-2 flex h-full items-end justify-end">
                              <span className="text-[10px] font-semibold text-slate-500">Salida</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 text-slate-300">
                          <CalendarDays size={16} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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
