"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, FileText, Phone, Users as UsersIcon, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";

import NewReservationModal from "../NewReservationModal";
import { handleCancelReservation, handleCreateReservation } from "../actions";
import { formatHotelDateTime } from "@/lib/time";
import type { AssociatedClient, Reservation, Room, UserRole } from "@/lib/types";

// ── Fechas por CLAVE "YYYY-MM-DD" en la zona del hotel, independientes de la tz del
// navegador o del servidor. Así el calendario no se corre un día en la franja nocturna
// argentina (cuando en UTC ya es el día siguiente) ni en PCs con la hora mal configurada.
function dateKeyToUTCNoon(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
function addDaysToKey(key: string, n: number): string {
  const dt = dateKeyToUTCNoon(key);
  dt.setUTCDate(dt.getUTCDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function diffDaysKeys(aKey: string, bKey: string): number {
  const [ay, am, ad] = aKey.split("-").map(Number);
  const [by, bm, bd] = bKey.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}
/** Clave "YYYY-MM-DD" de un instante ISO, en la zona indicada. */
function hotelDateKeyOf(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
// Etiquetas formateadas desde la clave (mediodía UTC + tz UTC → sin corrimientos).
const WEEKDAY_FMT = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" });
const DAYMONTH_FMT = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "2-digit", month: "short" });
function weekdayLabel(key: string): string {
  return WEEKDAY_FMT.format(dateKeyToUTCNoon(key)).replace(".", "");
}
function dayMonthLabel(key: string): string {
  return DAYMONTH_FMT.format(dateKeyToUTCNoon(key)).replace(".", "");
}
function ddmmyyyy(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

type CalendarClientProps = {
  rooms: Room[];
  reservations: Reservation[];
  /** Clave "YYYY-MM-DD" de la primera columna (hoy en la zona del hotel). */
  startDateKey: string;
  timezone: string;
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

// Compacto: para que entren ~16 habitaciones a lo alto y 15 dias a lo ancho sin scroll
// en una pantalla de escritorio (estilo sistema viejo del hotel).
const CELL_WIDTH = 64;
const ROOM_COLUMN_WIDTH = 108;
const ROW_HEIGHT = 34;
const BAR_TOP = 3;
const BAR_HEIGHT = 26;

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
  startKey: string,
  daysCount: number,
  timezone: string
): ReservationPlacement | null {
  const checkInIndex = diffDaysKeys(hotelDateKeyOf(reservation.check_in_target, timezone), startKey);
  const checkoutIndex = diffDaysKeys(hotelDateKeyOf(reservation.check_out_target, timezone), startKey);

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
  startDateKey,
  timezone,
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

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, index) => addDaysToKey(startDateKey, index)),
    [daysCount, startDateKey]
  );
  const roomsById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const canCancel = role === "admin" || role === "receptionist";

  const openCreateModal = (roomId: number, dayKey: string) => {
    const checkOutKey = addDaysToKey(dayKey, 1);

    setCreateDraft({
      roomId,
      checkIn: `${dayKey}T${standardCheckInTime}`,
      checkOut: `${checkOutKey}T${standardCheckOutTime}`,
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-auto shadow-sm max-h-[calc(100vh-13rem)]">
        <div className="min-w-max">
          <div className="flex border-b border-slate-200 sticky top-0 z-30 bg-slate-50">
            <div
              className="shrink-0 px-2 py-1.5 text-sm font-semibold text-slate-700 border-r border-slate-200 sticky left-0 z-40 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]"
              style={{ width: `${ROOM_COLUMN_WIDTH}px` }}
            >
              Habitacion
            </div>
            {days.map((dayKey, dayIndex) => (
              <div
                key={dayKey}
                className={`shrink-0 py-1.5 px-1 text-center border-r border-slate-200 ${
                  dayIndex % 2 === 1 ? "bg-slate-100" : "bg-slate-50/70"
                }`}
                style={{ width: `${CELL_WIDTH}px` }}
              >
                <p className="text-[10px] text-slate-500 uppercase font-medium leading-tight">{weekdayLabel(dayKey)}</p>
                <p className="text-xs font-bold text-slate-800 leading-tight">{dayMonthLabel(dayKey)}</p>
              </div>
            ))}
          </div>

          {rooms.map((room, roomIndex) => {
            const roomReservations = reservations
              .filter((reservation) => reservation.room_id === room.id)
              .sort(
                (left, right) =>
                  new Date(left.check_in_target).getTime() - new Date(right.check_in_target).getTime()
              );

            const placements = roomReservations
              .map((reservation) =>
                buildReservationPlacement(reservation, startDateKey, daysCount, timezone)
              )
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

            // Zebra de filas: banda primaria blanco / gris para distinguir habitaciones.
            const rowBg = roomIndex % 2 === 1 ? "bg-slate-100" : "bg-white";

            return (
              <div key={room.id} className="flex border-b border-slate-100">
                <div
                  className={`shrink-0 px-2 py-1 text-sm font-medium text-slate-800 border-r border-slate-200 sticky left-0 z-20 shadow-[1px_0_0_0_#e2e8f0] flex flex-col justify-center leading-tight ${rowBg}`}
                  style={{ width: `${ROOM_COLUMN_WIDTH}px`, minHeight: `${ROW_HEIGHT}px` }}
                >
                  Hab. {room.room_number}
                  <span className="text-[9px] text-slate-500 block truncate">{room.room_type}</span>
                </div>

                <div
                  className={`relative shrink-0 ${rowBg}`}
                  style={{ width: `${daysCount * CELL_WIDTH}px`, height: `${ROW_HEIGHT}px` }}
                >
                  <div className="absolute inset-0 flex">
                    {days.map((dayKey, dayIndex) => (
                      <button
                        type="button"
                        key={`${room.id}-${dayKey}`}
                        onClick={() => openCreateModal(room.id, dayKey)}
                        className={`h-full shrink-0 border-r border-slate-100 transition-colors hover:bg-brand-50 ${
                          dayIndex % 2 === 1 ? "bg-slate-500/5" : ""
                        }`}
                        style={{ width: `${CELL_WIDTH}px` }}
                        aria-label={`Crear reserva para habitación ${room.room_number} el ${ddmmyyyy(dayKey)}`}
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
                    const showText = horizontalWidth >= 56;

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
                          <div className="relative z-10 flex h-full flex-col justify-center items-center pointer-events-none px-1 overflow-hidden">
                            <p className="text-[10px] font-black tracking-tight text-white drop-shadow-md whitespace-nowrap leading-none">
                              {placement.reservation.client_name}
                            </p>
                            <p className="text-[7px] uppercase font-black tracking-widest text-white/90 drop-shadow-md whitespace-nowrap leading-none mt-0.5">
                              {placement.reservation.status === "checked_in" ? "En estadia" : (placement.reservation.status === "pending" ? "Pendiente" : "Confirmada")}
                            </p>
                          </div>
                        )}
                        {!endsAfterRange && (
                          <span className="absolute bottom-[2px] right-[8px] z-10 text-[7px] font-black uppercase tracking-widest text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] pointer-events-none">
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
                    <div className="flex items-start gap-3">
                      <UsersIcon size={16} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-slate-400">Pasajeros</p>
                        <p className="font-medium text-slate-700">{selectedReservation.guest_count ?? 1}</p>
                      </div>
                    </div>
                    {selectedReservation.notes && (
                      <div className="flex items-start gap-3">
                        <FileText size={16} className="text-slate-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-slate-400">Observaciones</p>
                          <p className="font-medium text-slate-700 whitespace-pre-wrap">
                            {selectedReservation.notes}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Estadia y Montos</p>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Check-in</p>
                      <p className="font-semibold text-slate-800">{formatHotelDateTime(selectedReservation.check_in_target, timezone)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Check-out</p>
                      <p className="font-semibold text-slate-800">{formatHotelDateTime(selectedReservation.check_out_target, timezone)}</p>
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
