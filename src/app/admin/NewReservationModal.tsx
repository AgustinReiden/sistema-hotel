"use client";

import { useState } from "react";
import { X, Calendar as CalendarIcon, Clock as ClockIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Room } from "@/lib/types";

type NewReservationModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: {
        roomId: number;
        clientName: string;
        checkIn: string;
        checkOut: string;
    }) => Promise<{ success: boolean, error?: string }>;
    rooms: Room[];
};

export default function NewReservationModal({ isOpen, onClose, onSubmit, rooms }: NewReservationModalProps) {
    const defaultCheckIn = new Date();
    defaultCheckIn.setHours(14, 0, 0, 0);

    const defaultCheckOut = new Date();
    defaultCheckOut.setDate(defaultCheckOut.getDate() + 1);
    defaultCheckOut.setHours(10, 0, 0, 0);

    const [clientName, setClientName] = useState("");
    const [roomId, setRoomId] = useState<number | "">("");
    const [checkIn, setCheckIn] = useState(format(defaultCheckIn, "yyyy-MM-dd'T'HH:mm"));
    const [checkOut, setCheckOut] = useState(format(defaultCheckOut, "yyyy-MM-dd'T'HH:mm"));
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientName.trim() || roomId === "" || !checkIn || !checkOut) return;

        if (new Date(checkOut) <= new Date(checkIn)) {
            toast.error("La fecha de salida debe ser posterior a la fecha de entrada.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onSubmit({
                roomId: Number(roomId),
                clientName,
                checkIn: new Date(checkIn).toISOString(),
                checkOut: new Date(checkOut).toISOString()
            });

            if (result.success) {
                toast.success("Reserva creada correctamente.");
                setClientName("");
                setRoomId("");
                setCheckIn(format(defaultCheckIn, "yyyy-MM-dd'T'HH:mm"));
                setCheckOut(format(defaultCheckOut, "yyyy-MM-dd'T'HH:mm"));
                onClose();
            } else {
                toast.error(result.error || "Error al crear reserva");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left">
                <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
                    <h2 className="text-xl font-bold text-slate-800">Nueva Reserva</h2>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label htmlFor="clientName" className="block text-sm font-semibold text-slate-700 mb-1.5">Nombre del Huésped</label>
                        <input
                            id="clientName"
                            type="text"
                            required
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                            placeholder="Ej. María López"
                        />
                    </div>

                    <div>
                        <label htmlFor="roomId" className="block text-sm font-semibold text-slate-700 mb-1.5">Habitación</label>
                        <select
                            id="roomId"
                            required
                            value={roomId}
                            onChange={(e) => setRoomId(Number(e.target.value))}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        >
                            <option value="">Seleccione una habitación</option>
                            {rooms.map(room => (
                                <option key={room.id} value={room.id}>
                                    Hab. {room.room_number} - {room.room_type} ({room.status === 'available' ? 'Disponible' : 'Ocupada/Aseo'})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="checkIn" className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center">
                                <CalendarIcon size={14} className="mr-1" /> Entrada
                            </label>
                            <input
                                id="checkIn"
                                type="datetime-local"
                                required
                                value={checkIn}
                                onChange={(e) => setCheckIn(e.target.value)}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
                            />
                        </div>
                        <div>
                            <label htmlFor="checkOut" className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center">
                                <ClockIcon size={14} className="mr-1" /> Salida Target
                            </label>
                            <input
                                id="checkOut"
                                type="datetime-local"
                                required
                                value={checkOut}
                                onChange={(e) => setCheckOut(e.target.value)}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
                            />
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !clientName.trim() || roomId === ""}
                            className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors shadow-md shadow-emerald-600/20"
                        >
                            {isSubmitting ? "Creando..." : "Crear Reserva"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
