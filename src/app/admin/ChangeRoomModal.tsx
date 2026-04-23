"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BedDouble, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  handleChangeRoom,
  handleLoadAvailableRoomsForReservation,
} from "./actions";
import type { Room } from "@/lib/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  reservationId: string;
  clientName: string;
  currentRoomNumber: string;
};

export default function ChangeRoomModal({
  isOpen,
  onClose,
  reservationId,
  clientName,
  currentRoomNumber,
}: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoadingRooms(true);
      setError(null);
      setSelectedRoomId(null);
      return handleLoadAvailableRoomsForReservation(reservationId);
    }).then((result) => {
      if (cancelled || !result) return;
      setLoadingRooms(false);
      if (!result.success) {
        setError(result.error);
        setRooms([]);
        return;
      }
      setRooms(result.data?.rooms ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, reservationId]);

  if (!isOpen) return null;

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  const handleSubmit = async () => {
    if (!selectedRoomId) {
      setError("Seleccioná una habitación destino.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await handleChangeRoom(reservationId, selectedRoomId);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(`Movido a Hab. ${selectedRoom?.room_number}.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
              <BedDouble size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-800 truncate">Cambiar Habitación</h2>
              <p className="text-slate-500 text-sm font-medium truncate">
                {clientName} · actual: Hab. {currentRoomNumber}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loadingRooms ? (
            <div className="flex items-center justify-center py-10 text-slate-500">
              <Loader2 size={20} className="animate-spin mr-2" />
              Buscando habitaciones disponibles...
            </div>
          ) : rooms.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <BedDouble size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="font-medium">Sin habitaciones disponibles</p>
              <p className="text-xs mt-1">
                Todas las habitaciones están ocupadas en el rango de esta reserva.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {rooms.length} habitación{rooms.length === 1 ? "" : "es"} disponible{rooms.length === 1 ? "" : "s"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {rooms.map((r) => (
                  <label
                    key={r.id}
                    className={`border rounded-xl p-3 cursor-pointer transition-colors ${
                      selectedRoomId === r.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="newRoom"
                      value={r.id}
                      checked={selectedRoomId === r.id}
                      onChange={() => setSelectedRoomId(r.id)}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`font-bold text-sm ${selectedRoomId === r.id ? "text-blue-700" : "text-slate-800"}`}>
                          Hab. {r.room_number}
                        </p>
                        <p className="text-xs text-slate-500 uppercase tracking-wide">
                          {r.room_type}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-slate-600">
                        ${Number(r.base_price).toLocaleString("es-AR")}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 truncate">
                      {r.beds_configuration} · {r.capacity} pax
                    </p>
                  </label>
                ))}
              </div>
            </div>
          )}

          {selectedRoom && (
            <div className="mt-5 bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div className="text-sm">
                <p className="font-bold text-slate-800">Mover a Hab. {selectedRoom.room_number}</p>
                <p className="text-xs text-slate-500">
                  El precio total de la reserva no cambia.
                </p>
              </div>
              <ArrowRight size={20} className="text-slate-400" />
            </div>
          )}

          {error && (
            <p className="mt-4 text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">
              {error}
            </p>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedRoomId}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center gap-2"
          >
            {submitting ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
            Mover
          </button>
        </div>
      </div>
    </div>
  );
}
