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

    return (
        <div className="max-w-4xl mx-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/10 p-2 md:p-3 border border-white/80 flex flex-col md:flex-row gap-2">
            {/* Check-in */}
            <div className="flex-1 flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors cursor-pointer relative">
                <Calendar className="text-brand-500 mr-3 shrink-0" size={20} />
                <div className="text-left w-full">
                    <label htmlFor="checkIn" className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block cursor-pointer">
                        Llegada
                    </label>
                    <input
                        id="checkIn"
                        type="date"
                        value={checkIn}
                        onChange={(e) => handleCheckInChange(e.target.value)}
                        className="w-full bg-transparent text-slate-800 font-semibold text-sm outline-none cursor-pointer relative z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                        max="9999-12-31"
                        min={format(new Date(), "yyyy-MM-dd")}
                    />
                </div>
            </div>

            {/* Separador vertical */}
            <div className="hidden md:block w-px bg-slate-200 my-3"></div>

            {/* Check-out */}
            <div className="flex-1 flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors cursor-pointer relative">
                <Calendar className="text-slate-400 group-hover:text-brand-500 transition-colors mr-3 shrink-0" size={20} />
                <div className="text-left w-full">
                    <label htmlFor="checkOut" className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block cursor-pointer">
                        Salida
                    </label>
                    <input
                        id="checkOut"
                        type="date"
                        value={checkOut}
                        max="9999-12-31"
                        onChange={(e) => setCheckOut(e.target.value)}
                        className="w-full bg-transparent text-slate-800 font-semibold text-sm outline-none cursor-pointer relative z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                        min={format(addDays(new Date(checkIn), 1), "yyyy-MM-dd")}
                    />
                </div>
            </div>

            {/* Separador vertical */}
            <div className="hidden md:block w-px bg-slate-200 my-3"></div>

            {/* Huespedes */}
            <div className="flex-1 flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors cursor-pointer relative">
                <Users className="text-slate-400 group-hover:text-brand-500 transition-colors mr-3 shrink-0" size={20} />
                <div className="text-left w-full relative">
                    <label htmlFor="guests" className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block cursor-pointer">
                        Hu&eacute;spedes
                    </label>
                    <div className="relative">
                        <select
                            id="guests"
                            value={guests}
                            onChange={(e) => setGuests(e.target.value)}
                            className="w-full bg-transparent text-slate-800 font-semibold text-sm outline-none cursor-pointer appearance-none pr-8 relative z-10"
                        >
                            <option value="1">1 Persona</option>
                            <option value="2">2 Personas</option>
                            <option value="3">3 Personas</option>
                            <option value="4">4 Personas</option>
                            <option value="5">5 Personas</option>
                            <option value="6">6 Personas</option>
                        </select>
                        <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-0" size={14} />
                    </div>
                </div>
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
