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
    // El foco ya llevó la pantalla hasta el campo. El aviso se trae a la vista solo si
    // entra junto con el campo: si está más lejos que el alto de la pantalla, se deja el
    // campo a la vista (con su borde rojo) en vez de esconderlo. Va en el cuadro
    // siguiente porque el aviso recién se dibuja después de este foco, y sin scroll
    // suave, que en el celular compite con el teclado.
    requestAnimationFrame(() => {
      const notice = document.querySelector("[data-missing-notice]");
      if (!notice) return;
      const span =
        notice.getBoundingClientRect().bottom - element.getBoundingClientRect().top;
      if (span > window.innerHeight) return;
      notice.scrollIntoView?.({ block: "nearest" });
    });
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
      data-missing-notice
      className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
      <p>{missingMessage(pending)}</p>
    </div>
  );
}
