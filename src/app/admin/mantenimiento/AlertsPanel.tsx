"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  authorizeOldTariffAction,
  rejectOldTariffAction,
  resolveAdminAlertAction,
} from "./actions";
import { formatHotelDateTime } from "@/lib/time";
import type { AdminAlert } from "@/lib/types";

type Props = {
  alerts: AdminAlert[];
  hotelTimezone: string;
};

const TARIFF_KIND = "room_change_keep_old_tariff_request";

export default function AlertsPanel({ alerts, hotelTimezone }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);

  const run = (
    id: number,
    action: () => Promise<{ success: boolean; error?: string }>,
    successMsg: string
  ) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      if (!result.success) {
        toast.error(result.error ?? "No se pudo completar la acción.");
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  };

  if (alerts.length === 0) return null;

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 mb-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
          <AlertTriangle size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-amber-900">
            {alerts.length} alerta{alerts.length === 1 ? "" : "s"} sin revisar
          </h2>
          <p className="text-sm text-amber-700">
            Incidencias que requieren tu atención.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {alerts.map((a) => {
          const isTariff = a.kind === TARIFF_KIND;
          const busy = isPending && busyId === a.id;
          return (
            <li
              key={a.id}
              className="bg-white border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{a.message}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatHotelDateTime(a.created_at, hotelTimezone)}
                </p>
              </div>

              {isTariff ? (
                <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() =>
                      run(
                        a.id,
                        () => authorizeOldTariffAction(a.id),
                        "Se mantuvo la tarifa anterior."
                      )
                    }
                    disabled={busy}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1"
                  >
                    {busy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    Autorizar tarifa anterior
                  </button>
                  <button
                    onClick={() =>
                      run(
                        a.id,
                        () => rejectOldTariffAction(a.id),
                        "Se dejó la tarifa nueva."
                      )
                    }
                    disabled={busy}
                    className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-bold rounded-lg flex items-center justify-center gap-1"
                  >
                    <X size={14} />
                    Rechazar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() =>
                    run(
                      a.id,
                      () => resolveAdminAlertAction(a.id),
                      "Alerta marcada como leída."
                    )
                  }
                  disabled={busy}
                  className="shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg flex items-center gap-1"
                >
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Marcar leída
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
