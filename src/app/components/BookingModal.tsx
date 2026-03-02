"use client";

import { useState } from "react";
import Image from "next/image";
import { X, Loader2, CheckCircle2, BedDouble, Users, MapPin, CalendarDays, ShieldCheck } from "lucide-react";
import { handlePublicBooking } from "../actions";
import { Room } from "@/lib/types";
import { differenceInDays } from "date-fns";

interface BookingModalProps {
    isOpen: boolean;
    onClose: () => void;
    room: Room;
    checkIn: string;
    checkOut: string;
    imageSrc: string;
}

export default function BookingModal({
    isOpen,
    onClose,
    room,
    checkIn,
    checkOut,
    imageSrc,
}: BookingModalProps) {
    const [clientName, setClientName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    if (!isOpen) return null;

    const nights = Math.max(1, differenceInDays(new Date(checkOut), new Date(checkIn)));
    const totalAmount = nights * room.base_price;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientName.trim()) {
            setError("Por favor ingresa tu nombre completo.");
            return;
        }

        setLoading(true);
        setError(null);

        // Consider checkin at 14:00 and checkout at 10:00 UTC
        const checkInDateTime = `${checkIn}T14:00:00Z`;
        const checkOutDateTime = `${checkOut}T10:00:00Z`;

        const result = await handlePublicBooking(
            room.id,
            clientName,
            checkInDateTime,
            checkOutDateTime
        );

        setLoading(false);

        if (result.success) {
            setSuccess(true);
        } else {
            setError(result.error || "Ocurrió un error inesperado al procesar tu reserva. Es posible que ya no esté disponible.");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-none md:rounded-3xl shadow-2xl w-full h-full md:h-auto md:max-h-[90vh] md:max-w-5xl overflow-y-auto md:overflow-hidden relative flex flex-col md:flex-row">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-20 w-10 h-10 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full flex items-center justify-center text-slate-800 md:text-slate-500 md:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm"
                >
                    <X size={20} />
                </button>

                {success ? (
                    <div className="p-12 md:p-20 text-center w-full flex flex-col items-center justify-center animate-in zoom-in-95 duration-500">
                        <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-6 shadow-inner border border-green-100">
                            <CheckCircle2 size={48} />
                        </div>
                        <h3 className="text-4xl font-serif text-slate-900 mb-4">¡Reserva Exitosa!</h3>
                        <p className="text-slate-600 text-lg mb-2">
                            Tu reserva para la <strong>{room.room_type}</strong> ha sido confirmada en estado <span className="text-amber-500 font-bold">Pendiente</span>.
                        </p>
                        <p className="text-slate-500 mb-10 font-light max-w-md">
                            Te esperamos el <strong className="font-semibold text-slate-800">{new Date(`${checkIn}T14:00:00Z`).toLocaleDateString()}</strong> en nuestra recepción. El pago se coordinará al momento del check-in.
                        </p>
                        <button
                            onClick={() => {
                                onClose();
                                setSuccess(false);
                                setClientName("");
                                window.location.reload();
                            }}
                            className="px-10 py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl tracking-wide uppercase text-sm transition-all shadow-xl shadow-slate-900/20 cursor-pointer"
                        >
                            Volver al Inicio
                        </button>
                    </div>
                ) : (
                    <>
                        {/* LEFT COLUMN: Summary (Image & Info) */}
                        <div className="w-full md:w-5/12 bg-slate-50 relative flex flex-col">
                            <div className="relative h-64 md:h-72 w-full shrink-0">
                                {imageSrc.startsWith('/') && !imageSrc.includes('fallback') ? (
                                    <div className="absolute inset-0 bg-slate-200 flex items-center justify-center">
                                        <span className="text-slate-400 font-bold uppercase tracking-widest">{room.room_type}</span>
                                    </div>
                                ) : (
                                    <Image
                                        src={imageSrc}
                                        alt={`Habitación ${room.room_number}`}
                                        fill
                                        className="object-cover"
                                    />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent"></div>
                                <div className="absolute bottom-6 left-6 right-6 text-white">
                                    <h2 className="text-3xl font-serif mb-1 capitalize">{room.room_type}</h2>
                                    <p className="text-sm font-light text-slate-200 line-clamp-2">
                                        {room.description || "Su espacio de descanso garantizado con los más altos estándares."}
                                    </p>
                                </div>
                            </div>

                            <div className="p-8 flex-1 flex flex-col gap-6">
                                <div className="flex gap-4 items-start pb-6 border-b border-slate-200">
                                    <CalendarDays className="text-brand-500 shrink-0 mt-1" size={24} />
                                    <div>
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Fechas Seleccionadas</div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <div className="text-xs text-slate-500">Check-in</div>
                                                <div className="font-semibold text-slate-800">{new Date(`${checkIn}T14:00:00Z`).toLocaleDateString()}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-slate-500">Check-out</div>
                                                <div className="font-semibold text-slate-800">{new Date(`${checkOut}T10:00:00Z`).toLocaleDateString()}</div>
                                            </div>
                                        </div>
                                        <div className="mt-3 inline-flex items-center px-2.5 py-1 rounded bg-slate-100 text-xs font-medium text-slate-600">
                                            Total: {nights} noche{nights > 1 ? 's' : ''}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-4 items-start pb-6 border-b border-slate-200">
                                    <BedDouble className="text-slate-400 shrink-0 mt-1" size={24} />
                                    <div>
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Detalles</div>
                                        <div className="text-sm font-medium text-slate-800 mb-1">Camas: {room.beds_configuration}</div>
                                        <div className="text-sm text-slate-600 flex items-center gap-1.5">
                                            <Users size={14} /> Hasta {room.capacity_adults + room.capacity_children} personas
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-auto bg-slate-900 text-white rounded-2xl p-6 shadow-inner">
                                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Resumen Financiero</div>
                                    <div className="flex justify-between items-end mb-4">
                                        <span className="text-slate-300">${room.base_price.toLocaleString()} x {nights} {nights > 1 ? 'noches' : 'noche'}</span>
                                    </div>
                                    <div className="flex justify-between items-end pt-4 border-t border-slate-700">
                                        <span className="font-light text-slate-300">Total</span>
                                        <span className="text-3xl font-bold">${totalAmount.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Form */}
                        <div className="w-full md:w-7/12 p-8 md:p-12 flex flex-col justify-center bg-white">
                            <div className="max-w-md mx-auto w-full">
                                <h3 className="text-xs font-bold text-brand-500 uppercase tracking-widest mb-3">Paso Final</h3>
                                <h2 className="text-4xl font-serif text-slate-900 mb-8 leading-tight">Completa tus datos para confirmar</h2>

                                <form onSubmit={handleSubmit} className="space-y-6">
                                    <div className="space-y-2">
                                        <label htmlFor="clientName" className="block text-sm font-bold tracking-wide uppercase text-slate-600">
                                            Nombre Completo del Titular
                                        </label>
                                        <input
                                            id="clientName"
                                            type="text"
                                            value={clientName}
                                            onChange={(e) => setClientName(e.target.value)}
                                            className="w-full px-5 py-4 bg-slate-50 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none font-medium text-slate-800"
                                            placeholder="Ingresa tu nombre y apellido"
                                            required
                                        />
                                    </div>

                                    {error && (
                                        <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 font-medium">
                                            {error}
                                        </div>
                                    )}

                                    <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                                        <ShieldCheck className="text-brand-600 shrink-0" size={24} />
                                        <p className="text-xs text-slate-500 leading-relaxed font-light">
                                            Al confirmar, estás generando una pre-reserva de la habitación. El pago total se abonará en mostrador o mediante los métodos de pago proporcionados luego por el staff.
                                        </p>
                                    </div>

                                    <div className="pt-4">
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full py-5 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white font-bold tracking-wider uppercase rounded-xl transition-all shadow-xl shadow-brand-500/30 flex items-center justify-center disabled:opacity-70 disabled:active:scale-100 cursor-pointer"
                                        >
                                            {loading ? <Loader2 className="animate-spin" size={24} /> : "Confirmar Reserva"}
                                        </button>
                                        <p className="text-center text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-4">
                                            Proceso 100% Seguro
                                        </p>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
