"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  Loader2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { markRoomCleanAction } from "./actions";
import { formatHotelDateTime } from "@/lib/time";
import type { CleaningType, MaintenanceRoom } from "@/lib/types";

type Props = {
  rooms: MaintenanceRoom[];
  hotelTimezone: string;
  loadError?: string;
};

const CLEANING_TYPES: { value: CleaningType; label: string }[] = [
  { value: "habitacion_ocupada", label: "Habitacion estaba ocupada" },
  { value: "limpieza_mantenimiento", label: "Limpieza de mantenimiento" },
];

function activeCheckout(room: MaintenanceRoom): string | null {
  return room.active_late_check_out_until ?? room.active_check_out_target;
}

function reasonText(room: MaintenanceRoom): string {
  switch (room.cleaning_required_reason) {
    case "overnight_stay":
      return room.status === "occupied"
        ? "Estadia activa desde la noche anterior."
        : "Tuvo una estadia real la noche anterior.";
    case "status_maintenance":
      return "Habitacion fuera de servicio.";
    case "status_cleaning":
      return "Check-out realizado, pendiente de limpieza.";
    default:
      return "Lista para proximo huesped.";
  }
}

export default function MaintenanceDashboard({ rooms, hotelTimezone, loadError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<MaintenanceRoom | null>(null);
  const [notes, setNotes] = useState("");
  const [cleaningType, setCleaningType] = useState<CleaningType | "">("");

  const pending = useMemo(() => rooms.filter((room) => room.requires_cleaning), [rooms]);
  const available = useMemo(
    () => rooms.filter((room) => !room.requires_cleaning && room.status === "available"),
    [rooms]
  );
  const occupied = useMemo(
    () => rooms.filter((room) => !room.requires_cleaning && room.status === "occupied"),
    [rooms]
  );

  const openModal = (room: MaintenanceRoom) => {
    setSelected(room);
    setNotes("");
    setCleaningType("");
  };

  const closeModal = () => {
    setSelected(null);
    setNotes("");
    setCleaningType("");
  };

  const submit = () => {
    if (!selected) return;
    const needsType = !selected.requires_cleaning;
    if (needsType && !cleaningType) {
      toast.error("Selecciona el tipo de limpieza.");
      return;
    }

    const roomId = selected.id;
    const trimmed = notes.trim();
    const type = needsType ? cleaningType : undefined;

    startTransition(async () => {
      const result = await markRoomCleanAction(
        roomId,
        selected.requires_cleaning ? trimmed || undefined : undefined,
        type || undefined
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(`Limpieza de Hab. ${selected.room_number} registrada.`);

      closeModal();
      router.refresh();
    });
  };

  const renderCard = (room: MaintenanceRoom) => {
    const needs = room.requires_cleaning;
    const isMaint = room.status === "maintenance";
    const isOccupied = room.status === "occupied";
    const checkout = activeCheckout(room);
    const border = isMaint
      ? "border-red-300"
      : needs
        ? "border-amber-300"
        : isOccupied
          ? "border-slate-300"
          : "border-emerald-300";
    const headerBg = isMaint
      ? "bg-red-50 border-red-100"
      : needs
        ? "bg-amber-50 border-amber-100"
        : isOccupied
          ? "bg-slate-100 border-slate-200"
          : "bg-emerald-50 border-emerald-100";
    const pill = isMaint
      ? "bg-red-500 text-white border-red-600"
      : needs
        ? "bg-amber-500 text-white border-amber-600"
        : isOccupied
          ? "bg-slate-500 text-white border-slate-600"
          : "bg-emerald-500 text-white border-emerald-600";
    const pillLabel = isMaint
      ? "Mantenimiento"
      : needs
        ? "Limpieza"
        : isOccupied
          ? "Ocupada"
          : "Lista";

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
            {isMaint ? (
              <Wrench size={12} />
            ) : needs ? (
              <Sparkles size={12} />
            ) : isOccupied ? (
              <BedDouble size={12} />
            ) : (
              <CheckCircle2 size={12} />
            )}
            {pillLabel}
          </span>
        </div>

        <div className="p-5 space-y-3">
          {room.active_client ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">
                Huesped actual
              </p>
              <p className="font-semibold text-slate-800 truncate">{room.active_client}</p>
              {checkout && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Check-out: {formatHotelDateTime(checkout, hotelTimezone)}
                </p>
              )}
            </div>
          ) : room.last_checkout_client && (needs || room.status === "cleaning") ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">
                Ultimo huesped
              </p>
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

          {needs && (
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {reasonText(room)}
            </p>
          )}

          <button
            onClick={() => openModal(room)}
            disabled={isPending}
            className={`w-full py-3 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm ${
              needs
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-slate-500 hover:bg-slate-600"
            }`}
          >
            <Sparkles size={18} />
            {needs ? "Registrar limpieza" : "Marcar limpieza"}
          </button>
        </div>
      </div>
    );
  };

  const selectedNeedsType = selected ? !selected.requires_cleaning : false;

  return (
    <div className="p-6 pb-20 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Tu tablero</h1>
        <p className="text-slate-500">
          {pending.length === 0
            ? "No hay habitaciones pendientes de limpieza."
            : `${pending.length} habitacion${pending.length === 1 ? "" : "es"} necesita${pending.length === 1 ? "" : "n"} limpieza.`}
        </p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 flex items-start gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{loadError}</p>
        </div>
      )}

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Sparkles size={14} className="text-amber-500" />
            Pendientes ({pending.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pending.map(renderCard)}
          </div>
        </section>
      )}

      {available.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-500" />
            Listas ({available.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map(renderCard)}
          </div>
        </section>
      )}

      {occupied.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BedDouble size={14} className="text-slate-500" />
            Ocupadas ({occupied.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {occupied.map(renderCard)}
          </div>
        </section>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Confirmar limpieza</h2>
                  <p className="text-sm text-slate-500">
                    Hab. {selected.room_number} - {selected.room_type}
                  </p>
                </div>
              </div>
              <button
                onClick={closeModal}
                disabled={isPending}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {selectedNeedsType ? (
                <div>
                  <label
                    htmlFor="cleaning-type"
                    className="block text-sm font-bold text-slate-700 mb-2"
                  >
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
                <>
                  <p className="text-sm text-slate-600">
                    Se va a registrar la limpieza pendiente. Si la habitacion esta ocupada,
                    seguira figurando como ocupada despues de confirmar.
                  </p>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">
                      Notas (opcional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={3}
                      maxLength={300}
                      placeholder="Ej. Falta reponer toallas."
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring outline-none resize-none text-sm"
                    />
                  </div>
                </>
              )}

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
                  disabled={isPending || (selectedNeedsType && !cleaningType)}
                  className="px-5 py-2.5 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  {isPending ? (
                    <Loader2 className="animate-spin" size={18} />
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
