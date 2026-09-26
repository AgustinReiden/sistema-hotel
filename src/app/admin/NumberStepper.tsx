"use client";

import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { clampStepper, parseStepperDraft } from "@/lib/stepper";

type NumberStepperProps = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  hint?: string;
};

const stepButtonClass =
  "h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white transition-colors";

/**
 * [−] campo [+] para noches y pasajeros.
 *
 * El campo es de texto y no type=number: con el de número, borrar lo volvía a 1 y lo
 * que se tipeaba quedaba detrás del 1 ("3" daba 13). Acá se puede dejar vacío mientras
 * se escribe, al tomar el foco se selecciona todo (tipear 3 sobre el 1 da 3) y al salir,
 * si quedó vacío, vuelve el último número válido. Lo que se pasa del rango queda en el
 * límite. Los límites son los del servidor (validations.ts).
 */
export default function NumberStepper({
  id,
  label,
  value,
  onChange,
  min = 1,
  max,
  hint,
}: NumberStepperProps) {
  // Lo escrito mientras se edita el campo; null cuando muestra el valor.
  const [draft, setDraft] = useState<string | null>(null);
  // El click (o el toque) que da el foco termina en un mouseup que en algunos navegadores
  // saca la selección y deja el cursor al final (otra vez "1" + "3" = 13). En ese mouseup
  // se vuelve a seleccionar todo y se cancela lo que haría el navegador.
  const keepSelection = useRef(false);
  const maxDigits = String(max).length;
  const hintId = hint ? `${id}-hint` : undefined;

  const change = (next: number) => {
    const clamped = clampStepper(next, min, max);
    if (clamped !== value) onChange(clamped);
  };

  // Al salir del campo (o con Enter): lo escrito entra ajustado al rango; vacío, queda
  // el último válido, que es el que ya tiene el formulario.
  const commit = () => {
    if (draft !== null && /^\d+$/.test(draft)) change(Number(draft));
    setDraft(null);
  };

  const step = (delta: number) => {
    setDraft(null);
    change(value + delta);
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <div className="flex w-full max-w-[14rem] items-center gap-2">
        <button
          type="button"
          aria-label={`${label}: restar 1`}
          onClick={() => step(-1)}
          disabled={value <= min}
          className={stepButtonClass}
        >
          <Minus size={18} />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={maxDigits}
          value={draft ?? String(value)}
          aria-describedby={hintId}
          onFocus={(e) => {
            keepSelection.current = true;
            e.currentTarget.select();
          }}
          onMouseUp={(e) => {
            if (!keepSelection.current) return;
            keepSelection.current = false;
            e.preventDefault();
            e.currentTarget.select();
          }}
          onChange={(e) => {
            const raw = e.target.value;
            // Las letras no entran: el campo queda como estaba.
            if (/\D/.test(raw)) return;
            const next = raw.slice(0, maxDigits);
            setDraft(next);
            const parsed = parseStepperDraft(next, min, max);
            if (parsed !== null && parsed !== value) onChange(parsed);
          }}
          onBlur={() => {
            keepSelection.current = false;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || draft === null) return;
            // Vacío o fuera de rango: primero se ve el número que va a quedar, y recién
            // con otro Enter (o el botón) se confirma el formulario.
            if (parseStepperDraft(draft, min, max) === null) {
              e.preventDefault();
              commit();
            }
          }}
          className="h-11 w-full min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-lg font-semibold text-slate-800 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          aria-label={`${label}: sumar 1`}
          onClick={() => step(1)}
          disabled={value >= max}
          className={stepButtonClass}
        >
          <Plus size={18} />
        </button>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-slate-500 mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
