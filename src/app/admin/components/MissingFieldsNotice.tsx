import { AlertTriangle } from "lucide-react";

import { missingMessage, type FieldCheck } from "@/lib/form-checks";

/**
 * Lleva el cursor al primer campo pendiente que se pueda tocar. Se salta los que no
 * están en pantalla (el aviso de un precio, por ejemplo) y los deshabilitados, que no
 * aceptan el foco. Devuelve el id al que fue, o null si no había a dónde ir.
 */
export function focusFirst(pending: FieldCheck[]): string | null {
  for (const check of pending) {
    const element = document.getElementById(check.id);
    if (!element) continue;
    if ((element as HTMLInputElement).disabled) continue;
    element.focus();
    return check.id;
  }
  return null;
}

/**
 * Recuadro rojo que dice qué falta, arriba del botón principal. No es un toast: queda
 * en el formulario hasta que no falte nada. Sin pendientes no dibuja nada.
 */
export default function MissingFieldsNotice({ pending }: { pending: FieldCheck[] }) {
  if (pending.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
      <p>{missingMessage(pending)}</p>
    </div>
  );
}
