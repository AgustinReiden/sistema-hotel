// Qué le falta a un formulario para poder enviarse.
//
// El botón principal de los modales ya no queda gris sin explicar: al tocarlo con datos
// faltantes, el formulario dice qué falta y lleva el cursor al primer campo. Estas
// funciones son la regla; el recuadro y el foco viven en MissingFieldsNotice.

export type FieldCheck = {
  /** Id del elemento del formulario al que lleva el cursor (input, select o botón). */
  id: string;
  /** Cómo se llama el campo en el aviso: "Nombre", "DNI". */
  label: string;
  ok: boolean;
  /**
   * Frase entera para los pendientes que no se arreglan completando un campo (por
   * ejemplo, un precio que carga el administrador). Va aparte de la lista de campos.
   */
  message?: string;
};

/** Los controles que todavía no están bien, en el orden en que se declararon. */
export function pendingFields(checks: FieldCheck[]): FieldCheck[] {
  return checks.filter((check) => !check.ok);
}

/**
 * "Falta completar: Nombre, DNI". Los pendientes con frase propia se agregan después,
 * cada uno como una oración. Sin pendientes devuelve "".
 */
export function missingMessage(pending: FieldCheck[]): string {
  const labels = pending.filter((check) => !check.message).map((check) => check.label);
  const parts: string[] = [];
  if (labels.length > 0) parts.push(`Falta completar: ${labels.join(", ")}`);
  for (const check of pending) {
    if (check.message) parts.push(check.message);
  }
  return parts
    .map((part, index) => (index === parts.length - 1 || /[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

/**
 * Pasa el borde y el aro de foco de un campo al rojo. Las clases de los inputs traen
 * `border-slate-200` y el aro esmeralda: se reemplazan para no pelear con el orden del CSS.
 */
export function invalidClass(base: string, invalid: boolean): string {
  if (!invalid) return base;
  return base
    .replace("border-slate-200", "border-red-500")
    .replace("border-emerald-200", "border-red-500")
    .replace("focus:ring-emerald-500", "focus:ring-red-500")
    .replace("focus:border-emerald-500", "focus:border-red-500");
}
