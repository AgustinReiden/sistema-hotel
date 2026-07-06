import { BedDouble, CheckCircle2, KeyRound, Lock, Sparkles, Wrench } from "lucide-react";

import {
  getHotelSettings,
  getRoomCleaningLog,
  listAdminAlerts,
} from "@/lib/data";
import { formatHotelDateTime } from "@/lib/time";
import type { CleaningCategory, RoomCleaningLogEntry } from "@/lib/types";
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

function categoryLabel(
  category: CleaningCategory | null
): { label: string; color: string } {
  switch (category) {
    case "checkout":
      return { label: "Por check-out", color: "bg-amber-100 text-amber-800 border-amber-300" };
    case "checkin_daily":
      return { label: "Con check-in (diaria)", color: "bg-sky-100 text-sky-800 border-sky-300" };
    case "empty_maintenance":
      return { label: "Mantenimiento (vacía)", color: "bg-slate-100 text-slate-700 border-slate-200" };
    case "occupied_anomaly":
      return { label: "Ocupada sin reserva", color: "bg-orange-100 text-orange-800 border-orange-300" };
    default:
      return { label: "—", color: "bg-slate-100 text-slate-500 border-slate-200" };
  }
}

type SummaryCard = {
  key: CleaningCategory | "no_key";
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
};

function buildSummary(log: RoomCleaningLogEntry[]): SummaryCard[] {
  const counts: Record<string, number> = {
    checkin_daily: 0,
    checkout: 0,
    empty_maintenance: 0,
    occupied_anomaly: 0,
    no_key: 0,
  };
  for (const entry of log) {
    if (entry.outcome === "not_cleaned_no_key") {
      counts.no_key += 1;
      continue;
    }
    if (entry.cleaning_category) counts[entry.cleaning_category] += 1;
  }
  return [
    {
      key: "checkin_daily",
      label: "Con check-in",
      count: counts.checkin_daily,
      icon: <Sparkles size={16} />,
      color: "bg-sky-50 border-sky-200 text-sky-700",
    },
    {
      key: "checkout",
      label: "Por check-out",
      count: counts.checkout,
      icon: <Lock size={16} />,
      color: "bg-amber-50 border-amber-200 text-amber-700",
    },
    {
      key: "empty_maintenance",
      label: "Mant. vacías",
      count: counts.empty_maintenance,
      icon: <BedDouble size={16} />,
      color: "bg-slate-50 border-slate-200 text-slate-700",
    },
    {
      key: "occupied_anomaly",
      label: "Ocupada sin reserva",
      count: counts.occupied_anomaly,
      icon: <Wrench size={16} />,
      color: "bg-orange-50 border-orange-200 text-orange-700",
    },
    {
      key: "no_key",
      label: "Sin llave",
      count: counts.no_key,
      icon: <KeyRound size={16} />,
      color: "bg-slate-50 border-slate-200 text-slate-600",
    },
  ];
}

export default async function MantenimientoAdminPage() {
  const [log, alerts, hotelSettings] = await Promise.all([
    getRoomCleaningLog(100),
    listAdminAlerts(true),
    getHotelSettings().catch(() => null),
  ]);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
  const summary = buildSummary(log);

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

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {summary.map((card) => (
              <div
                key={card.key}
                className={`rounded-2xl border p-4 flex flex-col gap-1 ${card.color}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
                  {card.icon}
                  {card.label}
                </div>
                <p className="text-2xl font-bold text-slate-900">{card.count}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Histórico de limpiezas</h2>
                <p className="text-xs text-slate-500">
                  Últimas {log.length} registradas. Las marcadas en naranja son limpiezas de una
                  ocupada sin reserva que lo justifique (requieren revisión).
                </p>
              </div>
            </div>

            {log.length === 0 ? (
              <div className="p-10 text-center text-slate-500 font-medium text-sm">
                Todavía no hay limpiezas registradas.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Fecha/Hora</th>
                      <th className="text-left px-4 py-3 font-semibold">Habitación</th>
                      <th className="text-left px-4 py-3 font-semibold">Estado anterior</th>
                      <th className="text-left px-4 py-3 font-semibold">Categoría</th>
                      <th className="text-left px-4 py-3 font-semibold">Resultado</th>
                      <th className="text-left px-4 py-3 font-semibold">Limpió</th>
                      <th className="text-left px-4 py-3 font-semibold">Notas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {log.map((entry) => {
                      const prev = statusLabel(entry.previous_status);
                      const cat = categoryLabel(entry.cleaning_category);
                      const isAnomaly = entry.cleaning_category === "occupied_anomaly";
                      const noKey = entry.outcome === "not_cleaned_no_key";
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
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border ${cat.color}`}
                            >
                              {cat.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {noKey ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border bg-slate-100 text-slate-600 border-slate-300">
                                <KeyRound size={11} />
                                Sin llave
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                                <CheckCircle2 size={11} />
                                Limpiada
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{entry.cleaner_name ?? "-"}</td>
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
