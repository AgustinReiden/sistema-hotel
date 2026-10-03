"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BedDouble, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  authorizeOldTariffAction,
  rejectOldTariffAction,
  resolveAdminAlertAction,
} from "./mantenimiento/actions";
import { alertActionKind, alertKindLabel } from "@/lib/admin-alerts";
import { formatHotelDateTime } from "@/lib/time";
import type { ActionResult, AdminAlert } from "@/lib/types";

type Props = {
  alerts: AdminAlert[];
  hotelTimezone: string;
  /** El aviso ya se resolvió: la campana lo saca de la lista y baja el número. */
  onResolved?: (alertId: number) => void;
  /** Se tocó un link que lleva a otra pantalla: la campana se cierra. */
  onNavigate?: () => void;
};

const BTN_OK =
  "px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1";
const BTN_SECONDARY =
  "px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-bold rounded-lg flex items-center justify-center gap-1";

// La lista de avisos del admin, con lo que se puede hacer con cada uno según su kind
// (alertActionKind). Era el panel de arriba de Limpiezas (AlertsPanel); ahora vive en la
// campana del marco, así el dueño los ve y los resuelve desde cualquier pantalla.
export default function AdminAlertsList({ alerts, hotelTimezone, onResolved, onNavigate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  // Aviso de pieza ocupada con el cuadro de la nota abierto, y lo escrito.
  const [closingId, setClosingId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const run = (id: number, action: () => Promise<ActionResult>, successMsg: string) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo completar la acción.");
        return;
      }
      toast.success(successMsg);
      if (closingId === id) {
        setClosingId(null);
        setNote("");
      }
      onResolved?.(id);
      router.refresh();
    });
  };

  if (alerts.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm font-medium text-slate-500">
        No hay avisos sin revisar.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {alerts.map((a) => {
        const actionKind = alertActionKind(a.kind);
        const busy = isPending && busyId === a.id;
        const closing = closingId === a.id;
        const trimmedNote = note.trim();
        return (
          <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
              {alertKindLabel(a.kind)}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-slate-800">{a.message}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatHotelDateTime(a.created_at, hotelTimezone)}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {actionKind === "tarifa" && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      run(a.id, () => authorizeOldTariffAction(a.id), "Se mantuvo la tarifa anterior.")
                    }
                    disabled={busy}
                    className={BTN_OK}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Autorizar tarifa anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => run(a.id, () => rejectOldTariffAction(a.id), "Se dejó la tarifa nueva.")}
                    disabled={busy}
                    className={BTN_SECONDARY}
                  >
                    <X size={14} />
                    Rechazar
                  </button>
                </>
              )}

              {actionKind === "ocupada" && !closing && (
                <>
                  {/* Cargar la estadía se hace en Hoy, con el aviso de pieza usada
                      (OccupiedRoomAlertBanner), que cierra este aviso al cargarla. */}
                  <Link href="/admin" onClick={onNavigate} className={BTN_OK}>
                    <BedDouble size={14} />
                    Regularizar en Hoy
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setClosingId(a.id);
                      setNote("");
                    }}
                    disabled={busy}
                    className={BTN_SECONDARY}
                  >
                    <X size={14} />
                    Cerrar sin cargar
                  </button>
                </>
              )}

              {actionKind === "leida" && (
                <button
                  type="button"
                  onClick={() => run(a.id, () => resolveAdminAlertAction(a.id), "Aviso marcado como leído.")}
                  disabled={busy}
                  className={BTN_OK}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Marcar leída
                </button>
              )}
            </div>

            {actionKind === "ocupada" && closing && (
              // La base no deja cerrarlo sin explicar por qué (mig 105): sin nota, el botón
              // no se habilita.
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-semibold text-slate-700" htmlFor={`nota-aviso-${a.id}`}>
                  Por qué se cierra sin cargar la estadía
                </label>
                <textarea
                  id={`nota-aviso-${a.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Ej.: la mucama se equivocó de habitación"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!trimmedNote) return;
                      run(a.id, () => resolveAdminAlertAction(a.id, trimmedNote), "Aviso cerrado.");
                    }}
                    disabled={busy || !trimmedNote}
                    className={BTN_OK}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Confirmar cierre
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClosingId(null);
                      setNote("");
                    }}
                    disabled={busy}
                    className={BTN_SECONDARY}
                  >
                    Volver
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
