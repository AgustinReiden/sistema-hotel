"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

const SHIFT_WARNING_MS = 8 * 60 * 60 * 1000;

function formatElapsed(openedAtMs: number, now: number) {
  const totalMinutes = Math.max(0, Math.floor((now - openedAtMs) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export default function OpenShiftAgeAlert({ openedAt }: { openedAt: string | null }) {
  const openedAtMs = useMemo(() => {
    if (!openedAt) return null;
    const value = new Date(openedAt).getTime();
    return Number.isNaN(value) ? null : value;
  }, [openedAt]);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (openedAtMs === null) return;

    const update = () => setNow(Date.now());
    update();

    const thresholdAt = openedAtMs + SHIFT_WARNING_MS;
    const delay = Math.max(0, thresholdAt - Date.now());
    const timeout = window.setTimeout(update, delay);
    const interval = window.setInterval(update, 60000);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [openedAtMs]);

  if (openedAtMs === null || now === null || now - openedAtMs < SHIFT_WARNING_MS) {
    return null;
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-amber-900">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-9 h-9 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-sm font-bold flex items-center gap-2">
              <Clock size={15} />
              Turno de caja abierto hace {formatElapsed(openedAtMs, now)}
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Ya supero las 8 horas. Cierra el turno para rendirlo y abrir uno nuevo.
            </p>
          </div>
        </div>
        <Link
          href="/admin/caja"
          className="shrink-0 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors text-center"
        >
          Ir a Caja
        </Link>
      </div>
    </div>
  );
}
