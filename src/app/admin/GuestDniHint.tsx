"use client";

import { AlertTriangle } from "lucide-react";

// Aviso anti-duplicados: si ya hay un huésped con el DNI tipeado, ofrece reutilizar sus datos
// para no generar variantes ("Jose Boeris" vs "JOSÉ BOERIS"). El padre resuelve qué cargar.
export default function GuestDniHint({
  name,
  onUse,
}: {
  name: string | null;
  onUse: () => void;
}) {
  if (!name) return null;
  return (
    <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 min-w-0">
        <AlertTriangle size={14} className="shrink-0" />
        <span className="truncate">
          Ya existe un huésped con este DNI: <strong>{name}</strong>
        </span>
      </span>
      <button
        type="button"
        onClick={onUse}
        className="shrink-0 px-2 py-1 rounded-md bg-amber-600 text-white font-bold hover:bg-amber-700 transition-colors"
      >
        Usar estos datos
      </button>
    </div>
  );
}
