"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { markRoomCleanAction, markRoomNoKeyAction } from "./actions";
import { formatHotelDateTime, formatHotelTime } from "@/lib/time";
import type { CleaningType, MaintenanceRoom, TodayCleaning } from "@/lib/types";

type Props = {
  rooms: MaintenanceRoom[];
  cleanedToday: Record<number, TodayCleaning>;
  hotelTimezone: string;
  loadError?: string;
};

// Solo para habitaciones VACÍAS que se marcan sin estar pendientes.
const CLEANING_TYPES: { value: CleaningType; label: string }[] = [
  { value: "limpieza_mantenimiento", label: "Limpieza de mantenimiento (vacía)" },
  { value: "habitacion_ocupada", label: "Estaba ocupada (no debería)" },
];

type RoomGroup = "blocking" | "daily" | "ready" | "occupied" | "done";

function activeCheckout(room: MaintenanceRoom): string | null {
  return room.active_late_check_out_until ?? room.active_check_out_target;
}

function reasonText(room: MaintenanceRoom): string {
  switch (room.cleaning_required_reason) {
    case "overnight_stay":
      return "Limpieza diaria: hay un huésped alojado. No bloquea el check-in.";
    case "status_maintenance":
      return "Habitación fuera de servicio.";
    case "status_cleaning":
      return "Check-out realizado, pendiente de limpieza. Bloquea el próximo check-in.";
    default:
      return "Lista para próximo huésped.";
  }
}

function doneBadge(entry: TodayCleaning): string {
  if (entry.outcome === "not_cleaned_no_key") return "Sin llave";
  switch (entry.category) {
    case "checkout":
      return "Limpiada (check-out)";
    case "checkin_daily":
      return "Limpiada (diaria)";
    case "occupied_anomaly":
      return "Limpiada (ocupada s/reserva)";
    default:
      return "Limpiada";
  }
}

export default function MaintenanceDashboard({
  rooms,
  cleanedToday,
  hotelTimezone,
  loadError,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<MaintenanceRoom | null>(null);
  const [modalMode, setModalMode] = useState<"clean" | "nokey">("clean");
  const [notes, setNotes] = useState("");
  const [cleaningType, setCleaningType] = useState<CleaningType | "">("");

  const groupOf = (room: MaintenanceRoom): RoomGroup => {
    if (room.requires_cleaning) {
      return room.cleaning_required_reason === "overnight_stay" ? "daily" : "blocking";
    }
    if (cleanedToday[room.id]) return "done";
    return room.status === "occupied" ? "occupied" : "ready";
  };

  const blocking = rooms.filter((r) => groupOf(r) === "blocking");
  const daily = rooms.filter((r) => groupOf(r) === "daily");
  const ready = rooms.filter((r) => groupOf(r) === "ready");
  const occupied = rooms.filter((r) => groupOf(r) === "occupied");
  const done = rooms.filter((r) => groupOf(r) === "done");
  const pendingCount = blocking.length + daily.length;

  const openClean = (room: MaintenanceRoom) => {
    setSelected(room);
    setModalMode("clean");
    setNotes("");
    setCleaningType("");
  };

  const openNoKey = (room: MaintenanceRoom) => {
    setSelected(room);
    setModalMode("nokey");
    setNotes("");
    setCleaningType("");
  };

  const closeModal = () => {
    setSelected(null);
    setNotes("");
    setCleaningType("");
  };

  // Se pide tipo solo para habitaciones VACÍAS que no están pendientes.
  const selectedNeedsType = selected
    ? !selected.requires_cleaning && selected.status === "available"
    : false;

  const submit = () => {
    if (!selected) return;
    const roomId = selected.id;
    const roomNumber = selected.room_number;
    const trimmed = notes.trim();

    if (modalMode === "nokey") {
      startTransition(async () => {
        const result = await markRoomNoKeyAction(roomId, trimmed || undefined);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success(`Hab. ${roomNumber}: registrada como "sin llave".`);
        closeModal();
        router.refresh();
      });
      return;
    }

    if (selectedNeedsType && !cleaningType) {
      toast.error("Selecciona el tipo de limpieza.");
      return;
    }
    const type = selectedNeedsType ? cleaningType || undefined : undefined;

    startTransition(async () => {
      const result = await markRoomCleanAction(roomId, trimmed || undefined, type);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Limpieza de Hab. ${roomNumber} registrada.`);
      closeModal();
      router.refresh();
    });
  };

  const renderCard = (room: MaintenanceRoom) => {
    const group = groupOf(room);
    const isMaint = room.status === "maintenance";
    const isBlocking = group === "blocking";
    const isDaily = group === "daily";
    const isReady = group === "ready";
    const isDone = group === "done";
    const checkout = activeCheckout(room);
    const todayEntry = cleanedToday[room.id];

    const border = isMaint
      ? "border-red-300"
      : isBlocking
        ? "border-amber-300"
        : isDaily
          ? "border-sky-300"
          : isDone
            ? "border-emerald-300"
            : isReady
              ? "border-slate-200"
              : "border-slate-300";
    const headerBg = isMaint
      ? "bg-red-50 border-red-100"
      : isBlocking
        ? "bg-amber-50 border-amber-100"
        : isDaily
          ? "bg-sky-50 border-sky-100"
          : isDone
            ? "bg-emerald-50 border-emerald-100"
            : isReady
              ? "bg-white border-slate-100"
              : "bg-slate-100 border-slate-200";
    const pill = isMaint
      ? "bg-red-500 text-white border-red-600"
      : isBlocking
        ? "bg-amber-500 text-white border-amber-600"
        : isDaily
          ? "bg-sky-500 text-white border-sky-600"
          : isDone
            ? "bg-emerald-500 text-white border-emerald-600"
            : isReady
              ? "bg-slate-400 text-white border-slate-500"
              : "bg-slate-500 text-white border-slate-600";
    const pillLabel = isMaint
      ? "Mantenimiento"
      : isBlocking
        ? "Check-out"
        : isDaily
          ? "Limpieza diaria"
          : isDone
            ? "Limpiada hoy"
            : isReady
              ? "Lista"
              : "Ocupada";
    const pillIcon = isMaint ? (
      <Wrench size={12} />
    ) : isBlocking ? (
      <Lock size={12} />
    ) : isDaily ? (
      <Sparkles size={12} />
    ) : isDone ? (
      <CheckCircle2 size={12} />
    ) : isReady ? (
      <Sparkles size={12} />
    ) : (
      <BedDouble size={12} />
    );

    return (
      <div key={room.id} className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${border}`}>
        <div className={`px-5 py-4 border-b flex items-center justify-between ${headerBg}`}>
          <div>
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <BedDouble size={20} className="text-slate-500" />
              Hab. {room.room_number}
            </h3>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mt-0.5">
              {room.room_type}
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border flex items-center gap-1 ${pill}`}
          >
            {pillIcon}
            {pillLabel}
          </span>
        </div>

        <div className="p-5 space-y-3">
          {isDone && todayEntry ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
              <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 size={15} />
                {doneBadge(todayEntry)}
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Hoy a las {formatHotelTime(todayEntry.at, hotelTimezone)}
              </p>
            </div>
          ) : room.active_client ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">Huésped actual</p>
              <p className="font-semibold text-slate-800 truncate">{room.active_client}</p>
              {checkout && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Check-out: {formatHotelDateTime(checkout, hotelTimezone)}
                </p>
              )}
            </div>
          ) : room.last_checkout_client && (isBlocking || room.status === "cleaning") ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">Último huésped</p>
              <p className="font-semibold text-slate-800 truncate">{room.last_checkout_client}</p>
              {room.last_checkout_at && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Check-out: {formatHotelDateTime(room.last_checkout_at, hotelTimezone)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">{reasonText(room)}</p>
          )}

          {isBlocking && (
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {reasonText(room)}
            </p>
          )}
          {isDaily && (
            <p className="text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">
              {reasonText(room)}
            </p>
          )}

          {(isBlocking || isDaily || isReady) && (
            <button
              onClick={() => openClean(room)}
              disabled={isPending}
              className={`w-full py-3 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm ${
                isReady ? "bg-slate-500 hover:bg-slate-600" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              <Sparkles size={18} />
              {isReady ? "Marcar limpieza" : "Registrar limpieza"}
            </button>
          )}

          {isDaily && (
            <button
              onClick={() => openNoKey(room)}
              disabled={isPending}
              className="w-full py-2.5 disabled:opacity-60 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              <KeyRound size={16} />
              No se pudo limpiar (sin llave)
            </button>
          )}
        </div>
      </div>
    );
  };

  const section = (
    title: string,
    icon: React.ReactNode,
    list: MaintenanceRoom[],
    extraClass = "mb-8"
  ) =>
    list.length > 0 ? (
      <section className={extraClass}>
        <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-2">
          {icon}
          {title} ({list.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(renderCard)}
        </div>
      </section>
    ) : null;

  return (
    <div className="p-6 pb-20 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Tu tablero</h1>
        <p className="text-slate-500">
          {pendingCount === 0
            ? "No hay habitaciones pendientes de limpieza."
            : `${pendingCount} habitación${pendingCount === 1 ? "" : "es"} pendiente${pendingCount === 1 ? "" : "s"} de limpieza.`}
          {done.length > 0 && ` · ${done.length} limpiada${done.length === 1 ? "" : "s"} hoy.`}
        </p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 flex items-start gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{loadError}</p>
        </div>
      )}

      {section(
        "Por check-out — bloquean check-in",
        <Lock size={14} className="text-amber-500" />,
        blocking
      )}
      {section(
        "Limpieza diaria de ocupadas — no bloquea",
        <Sparkles size={14} className="text-sky-500" />,
        daily
      )}
      {section("Listas — para marcar", <Sparkles size={14} className="text-slate-400" />, ready)}
      {section("Ocupadas", <BedDouble size={14} className="text-slate-500" />, occupied)}
      {section(
        "Limpiadas hoy",
        <CheckCircle2 size={14} className="text-emerald-500" />,
        done,
        "mb-2"
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    modalMode === "nokey"
                      ? "bg-slate-200 text-slate-600"
                      : "bg-emerald-100 text-emerald-600"
                  }`}
                >
                  {modalMode === "nokey" ? <KeyRound size={20} /> : <Sparkles size={20} />}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    {modalMode === "nokey" ? "Sin llave" : "Confirmar limpieza"}
                  </h2>
                  <p className="text-sm text-slate-500">
                    Hab. {selected.room_number} - {selected.room_type}
                  </p>
                </div>
              </div>
              <button onClick={closeModal} disabled={isPending} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {modalMode === "nokey" ? (
                <p className="text-sm text-slate-600">
                  El huésped no dejó la llave y no se pudo limpiar. Queda registrado y la habitación
                  no vuelve a figurar como pendiente por hoy.
                </p>
              ) : selectedNeedsType ? (
                <div>
                  <label htmlFor="cleaning-type" className="block text-sm font-bold text-slate-700 mb-2">
                    Tipo de limpieza
                  </label>
                  <select
                    id="cleaning-type"
                    value={cleaningType}
                    onChange={(event) => setCleaningType(event.target.value as CleaningType | "")}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring outline-none text-sm bg-white"
                  >
                    <option value="">Seleccionar...</option>
                    {CLEANING_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  Se va a registrar la limpieza. Si la habitación está ocupada, seguirá figurando como
                  ocupada después de confirmar.
                </p>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Notas (opcional)</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder={modalMode === "nokey" ? "Ej. Golpeé y no atendió." : "Ej. Falta reponer toallas."}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring outline-none resize-none text-sm"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={closeModal}
                  disabled={isPending}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Volver
                </button>
                <button
                  onClick={submit}
                  disabled={isPending || (modalMode === "clean" && selectedNeedsType && !cleaningType)}
                  className={`px-5 py-2.5 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center gap-2 ${
                    modalMode === "nokey"
                      ? "bg-slate-600 hover:bg-slate-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {isPending ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : modalMode === "nokey" ? (
                    <KeyRound size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
