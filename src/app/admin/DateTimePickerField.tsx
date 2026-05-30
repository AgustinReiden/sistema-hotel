"use client";

import { useState, type ReactNode } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { Check, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";

type DateTimePickerFieldProps = {
  id: string;
  label: string;
  /** Valor en formato datetime-local: "yyyy-MM-dd'T'HH:mm". */
  value: string;
  onChange: (value: string) => void;
  icon?: ReactNode;
};

const WEEK_DAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

function parseValue(value: string): { date: Date; time: string } {
  if (value && value.includes("T")) {
    const [datePart, timePart] = value.split("T");
    const parsed = parse(datePart, "yyyy-MM-dd", new Date());
    if (!Number.isNaN(parsed.getTime())) {
      return { date: parsed, time: (timePart || "00:00").slice(0, 5) };
    }
  }
  const now = new Date();
  return { date: now, time: format(now, "HH:mm") };
}

function formatDisplay(value: string): string {
  if (!value) return "Sin definir";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin definir";
  return format(date, "EEE dd MMM yyyy · HH:mm", { locale: es });
}

export default function DateTimePickerField({
  id,
  label,
  value,
  onChange,
  icon,
}: DateTimePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const initial = parseValue(value);
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(initial.date));
  const [draftDate, setDraftDate] = useState<Date>(initial.date);
  const [draftTime, setDraftTime] = useState<string>(initial.time);

  const openPicker = () => {
    const parsed = parseValue(value);
    setDraftDate(parsed.date);
    setDraftTime(parsed.time);
    setViewMonth(startOfMonth(parsed.date));
    setOpen(true);
  };

  const accept = () => {
    const datePart = format(draftDate, "yyyy-MM-dd");
    const timePart = (draftTime || "00:00").slice(0, 5);
    onChange(`${datePart}T${timePart}`);
    setOpen(false);
  };

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center">
        {icon}
        {label}
      </label>
      <button
        id={id}
        type="button"
        onClick={openPicker}
        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm text-left text-slate-800 font-medium hover:bg-slate-100"
      >
        {formatDisplay(value)}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white shadow-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
              aria-label="Mes anterior"
            >
              <ChevronLeft size={18} />
            </button>
            <p className="text-sm font-bold text-slate-800 capitalize">
              {format(viewMonth, "MMMM yyyy", { locale: es })}
            </p>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
              aria-label="Mes siguiente"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK_DAYS.map((day) => (
              <span key={day} className="text-[11px] font-bold uppercase text-slate-400 py-1">
                {day}
              </span>
            ))}
            {days.map((day) => {
              const isSelected = isSameDay(day, draftDate);
              const inMonth = isSameMonth(day, viewMonth);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setDraftDate(day)}
                  className={`h-9 rounded-lg text-sm font-medium transition-colors ${
                    isSelected
                      ? "bg-emerald-600 text-white font-bold"
                      : inMonth
                        ? "text-slate-700 hover:bg-emerald-50"
                        : "text-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
            <Clock size={16} className="text-slate-400" />
            <label htmlFor={`${id}-time`} className="text-sm font-semibold text-slate-700">
              Hora
            </label>
            <input
              id={`${id}-time`}
              type="time"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              className="ml-auto px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm font-medium"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg hover:bg-slate-50 transition-colors text-sm flex items-center justify-center gap-1.5"
            >
              <X size={15} />
              Cancelar
            </button>
            <button
              type="button"
              onClick={accept}
              className="flex-1 px-3 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors text-sm flex items-center justify-center gap-1.5"
            >
              <Check size={15} />
              Aceptar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
