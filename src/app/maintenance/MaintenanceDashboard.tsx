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
import type { Room } from "@/lib/types";

type RoomRow = Room & {
  last_checkout_client: string | null;
  last_checkout_at: string | null;
};

type Props = {
  rooms: RoomRow[];
  hotelTimezone: string;
};

function needsCleaning(r: RoomRow): boolean {
  return r.status === "cleaning" || r.status === "maintenance";
}

export default function MaintenanceDashboard({ rooms, hotelTimezone }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<RoomRow | null>(null);
  const [notes, setNotes] = useState("");

  const pending = useMemo(() => rooms.filter(needsCleaning), [rooms]);
  const available = useMemo(
    () => rooms.filter((r) => r.status === "available"),
    [rooms]
  );
  const occupied = useMemo(
    () => rooms.filter((r) => r.status === "occupied"),
    [rooms]
  );

  const submit = () => {
    if (!selected) return;
    const roomId = selected.id;
    const trimmed = notes.trim();
    startTransition(async () => {
      const result = await markRoomCleanAction(roomId, trimmed || undefined);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (selected.status === "available") {
        toast.warning(
          `Hab. ${selected.room_number} marcada (sin check-out previo, se notificó a admin).`
        );
      } else {
        toast.success(`Hab. ${selected.room_number} lista.`);
      }
      setSelected(null);
      setNotes("");
      router.refresh();
    });
  };

  const renderCard = (r: RoomRow) => {
    const needs = needsCleaning(r);
    const isMaint = r.status === "maintenance";
    const isOccupied = r.status === "occupied";
    const border = isOccupied
      ? "border-slate-300"
      : isMaint
        ? "border-red-300"
        : needs
          ? "border-amber-300"
          : "border-emerald-300";
    const headerBg = isOccupied
      ? "bg-slate-100 border-slate-200"
      : isMaint
        ? "bg-red-50 border-red-100"
        : needs
          ? "bg-amber-50 border-amber-100"
          : "bg-emerald-50 border-emerald-100";
    const pill = isOccupied
      ? "bg-slate-500 text-white border-slate-600"
      : isMaint
        ? "bg-red-500 text-white border-red-600"
        : needs
          ? "bg-amber-500 text-white border-amber-600"
          : "bg-emerald-500 text-white border-emerald-600";
    const pillLabel = isOccupied
      ? "Ocupada"
      : isMaint
        ? "Mantenimiento"
        : needs
          ? "Limpieza"
          : "Lista";

    return (
      <div key={r.id} className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${border}`}>
        <div className={`px-5 py-4 border-b flex items-center justify-between ${headerBg}`}>
          <div>
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <BedDouble size={20} className="text-slate-500" />
              Hab. {r.room_number}
            </h3>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mt-0.5">
              {r.room_type}
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border flex items-center gap-1 ${pill}`}
          >
            {isOccupied ? (
              <BedDouble size={12} />
            ) : isMaint ? (
              <Wrench size={12} />
            ) : needs ? (
              <Sparkles size={12} />
            ) : (
              <CheckCircle2 size={12} />
            )}
            {pillLabel}
          </span>
        </div>

        <div className="p-5 space-y-3">
          {r.last_checkout_client && needs ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">
                Último huésped
              </p>
              <p className="font-semibold text-slate-800 truncate">
                {r.last_checkout_client}
              </p>
              {r.last_checkout_at && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Check-out: {formatHotelDateTime(r.last_checkout_at, hotelTimezone)}
                </p>
              )}
            </div>
          ) : !isOccupied ? (
            <p className="text-sm text-slate-500 italic">
              {needs ? "Sin registro de huésped previo." : "Lista para próximo huésped."}
            </p>
          ) : (
            <p className="text-sm text-slate-500 italic">
              Habitación ocupada por un huésped — no limpiar ahora.
            </p>
          )}

          {!isOccupied && (
            <button
              onClick={() => {
                setSelected(r);
                setNotes("");
              }}
              disabled={isPending}
              className={`w-full py-3 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm ${
                needs
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-slate-500 hover:bg-slate-600"
              }`}
            >
              <Sparkles size={18} />
              {needs ? "Marcar como Lista" : "Marcar limpiada"}
            </button>
          )}
        </div>
      </div>
    );
  };

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
                    Hab. {selected.room_number} · {selected.room_type}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                disabled={isPending}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {selected.status === "available" ? (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-900">
                    <p className="font-bold">Atención: esta habitación ya estaba lista.</p>
                    <p className="mt-1">
                      Si la estás limpiando sin que hubo un check-out, quedará una alerta para el admin.
                      ¿Seguís?
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  Al confirmar, la habitación queda disponible para el próximo huésped y queda
                  registrado que vos la dejaste lista.
                </p>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Notas (opcional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Ej. Falta reponer toallas."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring outline-none resize-none text-sm"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setSelected(null)}
                  disabled={isPending}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Volver
                </button>
                <button
                  onClick={submit}
                  disabled={isPending}
                  className={`px-5 py-2.5 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center gap-2 ${
                    selected.status === "available"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
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
