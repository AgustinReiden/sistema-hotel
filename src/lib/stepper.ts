// Campos de cantidad (noches, pasajeros) y el texto del botón final de los modales.
//
// Con <input type="number"> y `parseInt(...) || 1`, borrar el campo lo volvía a 1 y el
// 1 quedaba adelante de lo que se tipeaba: "3" terminaba en 13 noches. Fue la causa de
// 4 de los 21 cierres de caja con diferencia. Estas funciones son la regla del stepper.

/**
 * Lo que hay escrito en el campo, como número. Vacío, con algo que no sea un entero sin
 * signo o fuera de [min, max]: null. Mientras se escribe, null quiere decir "todavía no
 * cambies el valor".
 */
export function parseStepperDraft(draft: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(draft)) return null;
  const n = Number(draft);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

/** Ajusta al rango: lo que se pasa queda en el límite. */
export function clampStepper(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** "1 noche" / "3 noches". */
export function nochesLabel(n: number): string {
  return n === 1 ? "1 noche" : `${n} noches`;
}

/** "2026-09-26" → "26/09". */
export function dayLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

/**
 * "3 noches · sale el 26/09": lo que repiten los botones finales para que el error se
 * vea antes de confirmar. Sin día de salida (no se conoce el reloj del hotel), solo las
 * noches.
 */
export function nochesYSalida(nights: number, departureKey?: string | null): string {
  const noches = nochesLabel(nights);
  return departureKey ? `${noches} · sale el ${dayLabel(departureKey)}` : noches;
}
