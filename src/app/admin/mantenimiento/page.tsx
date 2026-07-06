import Link from "next/link";
import {
  BedDouble,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Lock,
  Sparkles,
  Wrench,
} from "lucide-react";

import {
  getActiveRoomsBrief,
  getCleaningLog,
  getHotelSettings,
  listAdminAlerts,
} from "@/lib/data";
import { localToISO } from "@/lib/format";
import { formatHotelDateTime } from "@/lib/time";
import type { CleaningCategory, CleaningLogSummary } from "@/lib/types";
import AlertsPanel from "./AlertsPanel";
import CleaningLogFilters from "./CleaningLogFilters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

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

// "YYYY-MM-DD" + 1 día (para usar como límite superior exclusivo del rango).
function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function summaryCards(summary: CleaningLogSummary) {
  return [
    {
      key: "checkin_daily",
      label: "Con check-in",
      count: summary.checkin_daily,
      icon: <Sparkles size={16} />,
      color: "bg-sky-50 border-sky-200 text-sky-700",
    },
    {
      key: "checkout",
      label: "Por check-out",
      count: summary.checkout,
      icon: <Lock size={16} />,
      color: "bg-amber-50 border-amber-200 text-amber-700",
    },
    {
      key: "empty_maintenance",
      label: "Mant. vacías",
      count: summary.empty_maintenance,
      icon: <BedDouble size={16} />,
      color: "bg-slate-50 border-slate-200 text-slate-700",
    },
    {
      key: "occupied_anomaly",
      label: "Ocupada sin reserva",
      count: summary.occupied_anomaly,
      icon: <Wrench size={16} />,
      color: "bg-orange-50 border-orange-200 text-orange-700",
    },
    {
      key: "no_key",
      label: "Sin llave",
      count: summary.no_key,
      icon: <KeyRound size={16} />,
      color: "bg-slate-50 border-slate-200 text-slate-600",
    },
  ];
}

const ALLOWED_CATEGORIES = new Set([
  "checkin_daily",
  "checkout",
  "empty_maintenance",
  "occupied_anomaly",
  "no_key",
]);

type PageProps = {
  searchParams: Promise<{
    from?: string;
    to?: string;
    page?: string;
    category?: string;
    room?: string;
  }>;
};

export default async function MantenimientoAdminPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const hotelSettings = await getHotelSettings().catch(() => null);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";

  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const category = sp.category && ALLOWED_CATEGORIES.has(sp.category) ? sp.category : "";
  const room = sp.room ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const fromIso = from ? localToISO(from, "00:00", tz) : undefined;
  const toIso = to ? localToISO(addOneDay(to), "00:00", tz) : undefined;
  const roomIdParsed = room ? Number(room) : NaN;
  const roomId = Number.isInteger(roomIdParsed) ? roomIdParsed : undefined;

  const [logResult, alerts, rooms] = await Promise.all([
    getCleaningLog({
      fromIso,
      toIso,
      roomId,
      category: (category || undefined) as CleaningCategory | "no_key" | undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    listAdminAlerts(true),
    getActiveRoomsBrief(),
  ]);

  const { rows, total, summary } = logResult;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cards = summaryCards(summary);
  const firstIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastIndex = Math.min(page * PAGE_SIZE, total);

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (category) params.set("category", category);
    if (room) params.set("room", room);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/mantenimiento?${qs}` : "/admin/mantenimiento";
  };

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
            {cards.map((card) => (
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
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Histórico de limpiezas</h2>
                  <p className="text-xs text-slate-500">
                    {total === 0
                      ? "No hay limpiezas en el rango seleccionado."
                      : `Mostrando ${firstIndex}–${lastIndex} de ${total}. Las de "ocupada sin reserva" (naranja) requieren revisión.`}
                  </p>
                </div>
              </div>
              <CleaningLogFilters
                from={from}
                to={to}
                category={category}
                room={room}
                rooms={rooms}
              />
            </div>

            {rows.length === 0 ? (
              <div className="p-10 text-center text-slate-500 font-medium text-sm">
                No hay limpiezas para mostrar.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Fecha/Hora</th>
                      <th className="text-left px-4 py-3 font-semibold">Habitación</th>
                      <th className="text-left px-4 py-3 font-semibold">Categoría</th>
                      <th className="text-left px-4 py-3 font-semibold">Resultado</th>
                      <th className="text-left px-4 py-3 font-semibold">Limpió</th>
                      <th className="text-left px-4 py-3 font-semibold">Notas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((entry) => {
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

            {total > 0 && (
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Página {page} de {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 ? (
                    <Link
                      href={buildHref(page - 1)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-100 transition-colors flex items-center gap-1"
                    >
                      <ChevronLeft size={15} />
                      Anterior
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 rounded-lg border border-slate-100 bg-slate-100 text-slate-400 text-sm font-bold flex items-center gap-1 cursor-not-allowed">
                      <ChevronLeft size={15} />
                      Anterior
                    </span>
                  )}
                  {page < totalPages ? (
                    <Link
                      href={buildHref(page + 1)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-100 transition-colors flex items-center gap-1"
                    >
                      Siguiente
                      <ChevronRight size={15} />
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 rounded-lg border border-slate-100 bg-slate-100 text-slate-400 text-sm font-bold flex items-center gap-1 cursor-not-allowed">
                      Siguiente
                      <ChevronRight size={15} />
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
