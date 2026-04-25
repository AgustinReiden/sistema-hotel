"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Calendar,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Minus,
    Plus,
    Search,
    Users,
} from "lucide-react";
import {
    addDays,
    addMonths,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isBefore,
    isSameDay,
    isSameMonth,
    startOfMonth,
    startOfWeek,
    subMonths,
} from "date-fns";

type PickerName = "checkin" | "checkout" | "guests";

const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

function parseDate(iso: string): Date {
    return new Date(`${iso}T12:00:00`);
}

function toIsoDate(date: Date): string {
    return format(date, "yyyy-MM-dd");
}

function formatDisplayDate(iso: string): string {
    return parseDate(iso).toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function normalizeGuests(value: string | null): number {
    if (!value) return 2;

    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return 2;
    return Math.min(6, Math.max(1, parsed));
}

type CalendarPopoverProps = {
    selectedDate: string;
    minDate: string;
    visibleMonth: Date;
    onMonthChange: (month: Date) => void;
    onSelect: (date: string) => void;
};

function CalendarPopover({
    selectedDate,
    minDate,
    visibleMonth,
    onMonthChange,
    onSelect,
}: CalendarPopoverProps) {
    const monthStart = startOfMonth(visibleMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    const selected = parseDate(selectedDate);
    const minimum = parseDate(minDate);

    return (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl shadow-slate-950/15">
            <div className="flex items-center justify-between px-1 pb-3">
                <button
                    type="button"
                    onClick={() => onMonthChange(subMonths(visibleMonth, 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    aria-label="Mes anterior"
                >
                    <ChevronLeft size={18} />
                </button>
                <div className="text-sm font-bold capitalize text-slate-800">
                    {visibleMonth.toLocaleDateString("es-AR", {
                        month: "long",
                        year: "numeric",
                    })}
                </div>
                <button
                    type="button"
                    onClick={() => onMonthChange(addMonths(visibleMonth, 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    aria-label="Mes siguiente"
                >
                    <ChevronRight size={18} />
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 pb-1">
                {WEEKDAYS.map((day) => (
                    <div key={day} className="py-1 text-center text-[11px] font-bold text-slate-400">
                        {day}
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
                {days.map((day) => {
                    const disabled = isBefore(day, minimum);
                    const active = isSameDay(day, selected);
                    const outsideMonth = !isSameMonth(day, visibleMonth);

                    return (
                        <button
                            key={day.toISOString()}
                            type="button"
                            disabled={disabled}
                            onClick={() => onSelect(toIsoDate(day))}
                            className={[
                                "flex h-9 items-center justify-center rounded-lg text-sm font-semibold transition-colors",
                                active
                                    ? "bg-brand-600 text-white shadow-sm shadow-brand-600/25"
                                    : "text-slate-700 hover:bg-brand-50 hover:text-brand-700",
                                outsideMonth ? "text-slate-300" : "",
                                disabled ? "cursor-not-allowed opacity-35 hover:bg-transparent hover:text-slate-400" : "",
                            ].join(" ")}
                        >
                            {format(day, "d")}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

type GuestStepperPopoverProps = {
    value: number;
    onChange: (value: number) => void;
};

function GuestStepperPopover({ value, onChange }: GuestStepperPopoverProps) {
    return (
        <div
            className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-2xl shadow-slate-950/15"
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="flex items-center justify-between gap-4">
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Hu&eacute;spedes
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-800">
                        {value} {value === 1 ? "Persona" : "Personas"}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onChange(Math.max(1, value - 1))}
                        disabled={value <= 1}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                        aria-label="Quitar huesped"
                    >
                        <Minus size={16} />
                    </button>
                    <span className="w-6 text-center text-base font-bold text-slate-900">
                        {value}
                    </span>
                    <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onChange(Math.min(6, value + 1))}
                        disabled={value >= 6}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-400"
                        aria-label="Agregar huesped"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function PublicSearchForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const currentQuery = searchParams.toString();
    const today = useMemo(() => new Date(), []);
    const todayIso = useMemo(() => toIsoDate(today), [today]);
    const tomorrowIso = useMemo(() => toIsoDate(addDays(today, 1)), [today]);

    const defaultCheckIn = searchParams.get("checkin") || todayIso;
    const defaultCheckOut = searchParams.get("checkout") || tomorrowIso;
    const defaultGuests = String(normalizeGuests(searchParams.get("guests")));

    const [checkIn, setCheckIn] = useState(defaultCheckIn);
    const [checkOut, setCheckOut] = useState(defaultCheckOut);
    const [guests, setGuests] = useState(defaultGuests);
    const [openPicker, setOpenPicker] = useState<PickerName | null>(null);
    const [visibleMonth, setVisibleMonth] = useState(parseDate(defaultCheckIn));
    const [isPending, startTransition] = useTransition();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);

    const isLoading = isPending || isSubmitting;
    const minCheckoutDate = toIsoDate(addDays(parseDate(checkIn), 1));
    const guestsCount = normalizeGuests(guests);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (!formRef.current?.contains(event.target as Node)) {
                setOpenPicker(null);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpenPicker(null);
        };

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    const togglePicker = (picker: PickerName) => {
        if (openPicker === picker) {
            setOpenPicker(null);
            return;
        }

        if (picker !== "guests") {
            setVisibleMonth(parseDate(picker === "checkin" ? checkIn : checkOut));
        }
        setOpenPicker(picker);
    };

    const handleCheckInChange = (value: string) => {
        setCheckIn(value);
        if (parseDate(value) >= parseDate(checkOut)) {
            setCheckOut(toIsoDate(addDays(parseDate(value), 1)));
        }
        setOpenPicker(null);
    };

    const handleCheckOutChange = (value: string) => {
        setCheckOut(value);
        setOpenPicker(null);
    };

    const handleSearch = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (parseDate(checkIn) >= parseDate(checkOut)) {
            alert("La fecha de salida debe ser posterior a la de llegada.");
            return;
        }

        const params = new URLSearchParams();
        params.set("checkin", checkIn);
        params.set("checkout", checkOut);
        params.set("guests", String(guestsCount));

        const nextQuery = params.toString();
        setOpenPicker(null);

        if (nextQuery === currentQuery) {
            document.getElementById("habitaciones")?.scrollIntoView({ behavior: "smooth" });
            return;
        }

        setIsSubmitting(true);
        startTransition(() => {
            router.push(`/?${nextQuery}#habitaciones`);
        });
    };

    return (
        <form
            ref={formRef}
            onSubmit={handleSearch}
            className="max-w-4xl mx-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/10 p-2 md:p-3 border border-white/80 flex flex-col md:flex-row gap-2"
        >
            {/* Check-in */}
            <div className="flex-1 relative">
                <button
                    type="button"
                    onClick={() => togglePicker("checkin")}
                    aria-expanded={openPicker === "checkin"}
                    className="w-full flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors text-left"
                >
                    <Calendar className="text-brand-500 mr-3 shrink-0" size={20} />
                    <div className="w-full">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block">
                            Llegada
                        </div>
                        <div className="text-slate-800 font-semibold text-sm">
                            {formatDisplayDate(checkIn)}
                        </div>
                    </div>
                </button>
                {openPicker === "checkin" && (
                    <CalendarPopover
                        selectedDate={checkIn}
                        minDate={todayIso}
                        visibleMonth={visibleMonth}
                        onMonthChange={setVisibleMonth}
                        onSelect={handleCheckInChange}
                    />
                )}
            </div>

            {/* Separador vertical */}
            <div className="hidden md:block w-px bg-slate-200 my-3"></div>

            {/* Check-out */}
            <div className="flex-1 relative">
                <button
                    type="button"
                    onClick={() => togglePicker("checkout")}
                    aria-expanded={openPicker === "checkout"}
                    className="w-full flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors text-left"
                >
                    <Calendar className="text-slate-400 group-hover:text-brand-500 transition-colors mr-3 shrink-0" size={20} />
                    <div className="w-full">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block">
                            Salida
                        </div>
                        <div className="text-slate-800 font-semibold text-sm">
                            {formatDisplayDate(checkOut)}
                        </div>
                    </div>
                </button>
                {openPicker === "checkout" && (
                    <CalendarPopover
                        selectedDate={checkOut}
                        minDate={minCheckoutDate}
                        visibleMonth={visibleMonth}
                        onMonthChange={setVisibleMonth}
                        onSelect={handleCheckOutChange}
                    />
                )}
            </div>

            {/* Separador vertical */}
            <div className="hidden md:block w-px bg-slate-200 my-3"></div>

            {/* Huespedes */}
            <div className="flex-1 relative">
                <button
                    type="button"
                    onClick={() => togglePicker("guests")}
                    aria-expanded={openPicker === "guests"}
                    className="w-full flex items-center px-4 py-3 md:py-4 rounded-xl group hover:bg-brand-50/50 transition-colors text-left"
                >
                    <Users className="text-slate-400 group-hover:text-brand-500 transition-colors mr-3 shrink-0" size={20} />
                    <div className="w-full">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-0.5 block">
                            Hu&eacute;spedes
                        </div>
                        <div className="text-slate-800 font-semibold text-sm flex items-center gap-2">
                            {guestsCount} {guestsCount === 1 ? "Persona" : "Personas"}
                            <ChevronDown className="text-slate-400" size={14} />
                        </div>
                    </div>
                </button>
                {openPicker === "guests" && (
                    <GuestStepperPopover
                        value={guestsCount}
                        onChange={(value) => setGuests(String(value))}
                    />
                )}
            </div>

            {/* Boton buscar */}
            <button
                type="submit"
                disabled={isLoading}
                className="bg-brand-600 hover:bg-brand-700 text-white px-6 md:px-8 py-4 rounded-xl font-bold transition-all shadow-lg shadow-brand-600/25 hover:shadow-brand-600/40 flex items-center justify-center gap-2 group cursor-pointer min-w-16 md:min-w-28 disabled:cursor-wait disabled:opacity-85"
            >
                {isLoading ? (
                    <>
                        <Loader2 className="animate-spin" size={18} />
                        <span>Buscando</span>
                    </>
                ) : (
                    <>
                        <Search size={18} />
                        <span className="md:hidden">Buscar</span>
                    </>
                )}
            </button>
        </form>
    );
}
