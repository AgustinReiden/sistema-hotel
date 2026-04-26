import { CheckCircle2, Sparkles, Wrench } from "lucide-react";

import {
  getHotelSettings,
  getRoomCleaningLog,
  listAdminAlerts,
} from "@/lib/data";
import { formatHotelDateTime } from "@/lib/time";
import type { CleaningType } from "@/lib/types";
import AlertsPanel from "./AlertsPanel";

export const dynamic = "force-dynamic";

function statusLabel(raw: string): { label: string; color: string; icon: React.ReactNode } {
  switch (raw) {
    case "cleaning":
      return {
        label: "Limpieza",
        color: "bg-amber-100 text-amber-700 border-amber-200",
        icon: <Sparkles size={12} />,
      };
    case "maintenance":
      return {
        label: "Mantenimiento",
        color: "bg-red-100 text-red-700 border-red-200",
        icon: <Wrench size={12} />,
      };
    case "available":
      return {
        label: "Disponible",
        color: "bg-emerald-100 text-emerald-700 border-emerald-200",
        icon: <CheckCircle2 size={12} />,
      };
    case "occupied":
      return {
        label: "Ocupada",
        color: "bg-slate-100 text-slate-700 border-slate-200",
        icon: <CheckCircle2 size={12} />,
      };
    default:
      return {
        label: raw,
        color: "bg-slate-100 text-slate-700 border-slate-200",
        icon: <CheckCircle2 size={12} />,
      };
  }
}

function cleaningTypeLabel(type: CleaningType | null): { label: string; color: string } {
  switch (type) {
    case "habitacion_ocupada":
      return {
        label: "Habitacion estaba ocupada",
        color: "bg-orange-100 text-orange-800 border-orange-300",
      };
    case "limpieza_mantenimiento":
      return {
        label: "Limpieza de mantenimiento",
        color: "bg-slate-100 text-slate-700 border-slate-200",
      };
    case "limpia_ocupada":
      return { label: "Limpia Ocupada", color: "bg-orange-100 text-orange-800 border-orange-300" };
    case "limpia_vacia":
      return { label: "Limpia Vacia", color: "bg-orange-100 text-orange-800 border-orange-300" };
    case "limpia_repaso":
      return { label: "Limpia Repaso", color: "bg-slate-100 text-slate-700 border-slate-200" };
    default:
      return { label: "Esperada", color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  }
}

export default async function MantenimientoAdminPage() {
  const [log, alerts, hotelSettings] = await Promise.all([
    getRoomCleaningLog(100),
    listAdminAlerts(true),
    getHotelSettings().catch(() => null),
  ]);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Sparkles size={20} className="text-slate-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Mantenimiento</h1>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <AlertsPanel alerts={alerts} hotelTimezone={tz} />

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Historico de limpiezas</h2>
                <p className="text-xs text-slate-500">
                  Ultimas {log.length} limpiezas registradas. Las marcadas en naranja son
                  limpiezas no esperadas que pueden requerir revision.
                </p>
              </div>
            </div>

            {log.length === 0 ? (
              <div className="p-10 text-center text-slate-500 font-medium text-sm">
                Todavia no hay limpiezas registradas.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Fecha/Hora</th>
                      <th className="text-left px-4 py-3 font-semibold">Habitacion</th>
                      <th className="text-left px-4 py-3 font-semibold">Estado anterior</th>
                      <th className="text-left px-4 py-3 font-semibold">Tipo</th>
                      <th className="text-left px-4 py-3 font-semibold">Limpio</th>
                      <th className="text-left px-4 py-3 font-semibold">Notas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {log.map((entry) => {
                      const prev = statusLabel(entry.previous_status);
                      const type = cleaningTypeLabel(entry.cleaning_type);
                      const isAnomaly =
                        entry.cleaning_type === "habitacion_ocupada" &&
                        entry.has_admin_alert;
                      return (
                        <tr
                          key={entry.id}
                          className={`hover:bg-slate-50 ${isAnomaly ? "bg-orange-50/50" : ""}`}
                        >
                          <td className="px-4 py-3 text-slate-700">
                            {formatHotelDateTime(entry.cleaned_at, tz)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            Hab. {entry.room_number}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border ${prev.color}`}
                            >
                              {prev.icon}
                              {prev.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border ${type.color}`}
                            >
                              {type.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {entry.cleaner_name ?? "-"}
                          </td>
                          <td className="px-4 py-3 text-slate-600 text-xs max-w-xs truncate">
                            {entry.notes ?? ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
