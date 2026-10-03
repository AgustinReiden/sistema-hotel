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
 * si quedó vacío o bajo el mínimo, vuelve el último número válido. Lo que se pasa del
 * máximo queda en el límite en el momento de tipearlo, con el aviso "Máximo N.": así el
 * botón final ya lo muestra antes del click. Los límites son los del servidor
 * (validations.ts).
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
  // Lo último que se tipeó se pasaba del máximo y quedó en el límite: se avisa debajo
  // del campo hasta que se vuelva a tocar.
  const [capped, setCapped] = useState(false);
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

  // Al salir del campo (o con Enter) solo se deja de editar: lo válido ya entró al
  // tipearlo y lo que se pasaba del máximo ya quedó en el límite. Vacío o bajo el mínimo,
  // se ve el último válido, que es el que ya tiene el formulario. Salir del campo nunca
  // cambia el valor: el click en el botón final saca el foco antes de confirmar, y tiene
  // que mandar lo que ese botón decía.
  const commit = () => {
    setDraft(null);
  };

  const step = (delta: number) => {
    setDraft(null);
    setCapped(false);
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
            // Se pasa del máximo ("45" en noches): queda en el límite ya, así el campo, el
            // precio y el botón final dicen 30 antes de cualquier click.
            if (next !== "" && Number(next) > max) {
              setDraft(String(max));
              setCapped(true);
              change(max);
              return;
            }
            setCapped(false);
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
            // Recién ajustado al máximo, vacío o bajo el mínimo: primero se ve el número
            // que va a quedar, y recién con otro Enter (o el botón) se confirma el formulario.
            if (capped || parseStepperDraft(draft, min, max) === null) {
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
      {capped && (
        <p aria-live="polite" className="text-xs font-semibold text-amber-700 mt-1">
          {`Máximo ${max}.`}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-slate-500 mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
