"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
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

type RoomToClean = Room & {
  last_checkout_client: string | null;
  last_checkout_at: string | null;
};

type Props = {
  rooms: RoomToClean[];
  hotelTimezone: string;
};

export default function MaintenanceDashboard({ rooms, hotelTimezone }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<RoomToClean | null>(null);
  const [notes, setNotes] = useState("");

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
      toast.success(`Hab. ${selected.room_number} lista.`);
      setSelected(null);
      setNotes("");
      router.refresh();
    });
  };

  return (
    <div className="p-6 pb-20 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Tu tablero</h1>
        <p className="text-slate-500">
          {rooms.length === 0
            ? "Todas las habitaciones estan en orden."
            : `${rooms.length} habitacion${rooms.length === 1 ? "" : "es"} necesita${rooms.length === 1 ? "" : "n"} tu atencion.`}
        </p>
      </div>

      {rooms.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
          <div className="inline-flex w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center mb-4">
            <CheckCircle2 size={36} />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            Todo al día
          </h2>
          <p className="text-slate-500 max-w-md mx-auto">
            No hay habitaciones pendientes de limpieza o mantenimiento. Cuando
            una quede en cleaning o maintenance va a aparecer acá.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((r) => {
            const isMaint = r.status === "maintenance";
            return (
              <div
                key={r.id}
                className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${
                  isMaint ? "border-red-200" : "border-amber-200"
                }`}
              >
                <div
                  className={`px-5 py-4 border-b flex items-center justify-between ${
                    isMaint
                      ? "bg-red-50 border-red-100"
                      : "bg-amber-50 border-amber-100"
                  }`}
                >
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
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border flex items-center gap-1 ${
                      isMaint
                        ? "bg-red-500 text-white border-red-600"
                        : "bg-amber-500 text-white border-amber-600"
                    }`}
                  >
                    {isMaint ? <Wrench size={12} /> : <Sparkles size={12} />}
                    {isMaint ? "Mantenimiento" : "Limpieza"}
                  </span>
                </div>

                <div className="p-5 space-y-3">
                  {r.last_checkout_client ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">
                        Último huésped
                      </p>
                      <p className="font-semibold text-slate-800 truncate">
                        {r.last_checkout_client}
                      </p>
                      {r.last_checkout_at && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Se retiró {formatHotelDateTime(r.last_checkout_at, hotelTimezone)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">
                      Sin registro de check-out previo.
                    </p>
                  )}

                  <button
                    onClick={() => {
                      setSelected(r);
                      setNotes("");
                    }}
                    disabled={isPending}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Sparkles size={18} />
                    Marcar como Lista
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
                  <h2 className="text-xl font-bold text-slate-800">
                    Marcar lista
                  </h2>
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
              <p className="text-sm text-slate-600">
                Al confirmar, la habitación queda disponible y queda registrado
                que vos la dejaste lista.
              </p>
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
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
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
