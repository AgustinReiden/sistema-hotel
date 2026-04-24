"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Users, Search, ChevronDown } from "lucide-react";
import { format, addDays } from "date-fns";

export default function PublicSearchForm() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const defaultCheckIn =
        searchParams.get("checkin") || format(new Date(), "yyyy-MM-dd");
    const defaultCheckOut =
        searchParams.get("checkout") || format(addDays(new Date(), 1), "yyyy-MM-dd");

    const [checkIn, setCheckIn] = useState(defaultCheckIn);
    const [checkOut, setCheckOut] = useState(defaultCheckOut);
    const [guests, setGuests] = useState("2");

    const handleCheckInChange = (value: string) => {
        setCheckIn(value);
        if (new Date(value) >= new Date(checkOut)) {
            setCheckOut(format(addDays(new Date(value), 1), "yyyy-MM-dd"));
        }
    };

    const handleSearch = () => {
        if (new Date(checkIn) >= new Date(checkOut)) {
            alert("La fecha de salida debe ser posterior a la de llegada.");
            return;
        }

        const params = new URLSearchParams();
        params.set("checkin", checkIn);
        params.set("checkout", checkOut);
        params.set("guests", guests);

        router.push(`/?${params.toString()}#habitaciones`);
    };

    const formatDisplayDate = (iso: string) =>
        new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });

    return (
        <div className="max-w-4xl mx-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/10 p-2 md:p-3 border border-white/80 flex flex-col md:flex-row gap-2">
            {/* Check-in */}
            <div className="flex-1 flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors relative">
                <Calendar className="text-brand-500 mr-3 shrink-0 pointer-events-none" size={20} />
                <div className="text-left w-full pointer-events-none">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block">
                        Llegada
                    </div>
                    <div className="text-slate-800 font-semibold text-sm">
                        {formatDisplayDate(checkIn)}
                    </div>
                </div>
                <input
                    aria-label="Fecha de llegada"
                    type="date"
                    value={checkIn}
                    onChange={(e) => handleCheckInChange(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    max="9999-12-31"
                    min={format(new Date(), "yyyy-MM-dd")}
                />
            </div>

            {/* Separador vertical */}
            <div className="hidden md:block w-px bg-slate-200 my-3"></div>

            {/* Check-out */}
            <div className="flex-1 flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors relative">
                <Calendar className="text-slate-400 group-hover:text-brand-500 transition-colors mr-3 shrink-0 pointer-events-none" size={20} />
                <div className="text-left w-full pointer-events-none">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block">
                        Salida
                    </div>
                    <div className="text-slate-800 font-semibold text-sm">
                        {formatDisplayDate(checkOut)}
                    </div>
                </div>
                <input
                    aria-label="Fecha de salida"
                    type="date"
                    value={checkOut}
                    max="9999-12-31"
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    min={format(addDays(new Date(checkIn), 1), "yyyy-MM-dd")}
                />
            </div>

            {/* Separador vertical */}
            <div className="hidden md:block w-px bg-slate-200 my-3"></div>

            {/* Huespedes */}
            <div className="flex-1 flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors relative">
                <Users className="text-slate-400 group-hover:text-brand-500 transition-colors mr-3 shrink-0 pointer-events-none" size={20} />
                <div className="text-left w-full pointer-events-none">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block">
                        Hu&eacute;spedes
                    </div>
                    <div className="text-slate-800 font-semibold text-sm flex items-center gap-2">
                        {guests} {Number(guests) === 1 ? "Persona" : "Personas"}
                        <ChevronDown className="text-slate-400" size={14} />
                    </div>
                </div>
                <select
                    aria-label="Cantidad de huespedes"
                    value={guests}
                    onChange={(e) => setGuests(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                >
                    <option value="1">1 Persona</option>
                    <option value="2">2 Personas</option>
                    <option value="3">3 Personas</option>
                    <option value="4">4 Personas</option>
                    <option value="5">5 Personas</option>
                    <option value="6">6 Personas</option>
                </select>
            </div>

            {/* Boton buscar */}
            <button
                onClick={handleSearch}
                className="bg-brand-600 hover:bg-brand-700 text-white px-6 md:px-8 py-4 rounded-xl font-bold transition-all shadow-lg shadow-brand-600/25 hover:shadow-brand-600/40 flex items-center justify-center gap-2 group cursor-pointer"
            >
                <Search size={18} />
                <span className="md:hidden">Buscar</span>
            </button>
        </div>
    );
}
