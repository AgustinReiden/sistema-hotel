import { redirect } from "next/navigation";
import { Search, Users } from "lucide-react";
import {
  getCurrentUserRole,
  getGuestDirectory,
  getHotelSettings,
  getReservationHistory,
  getUpcomingGuests,
} from "@/lib/data";
import GuestsClientTable from "./GuestsClientTable";
import GuestDirectoryTable from "./GuestDirectoryTable";
import UpcomingGuestsTable from "./UpcomingGuestsTable";

export const dynamic = "force-dynamic";

type GuestsView = "directorio" | "historial" | "por_llegar";

type GuestsPageProps = {
  searchParams: Promise<{
    q?: string;
    view?: string;
    page?: string;
    cancelled?: string;
  }>;
};

const VIEWS: { label: string; value: GuestsView }[] = [
  { label: "Directorio", value: "directorio" },
  { label: "Historial", value: "historial" },
  { label: "Por llegar", value: "por_llegar" },
];

function parseView(value: string | undefined): GuestsView {
  if (value === "historial" || value === "por_llegar") return value;
  return "directorio";
}

export default async function GuestsPage({ searchParams }: GuestsPageProps) {
  const role = await getCurrentUserRole();
  if (role !== "admin") {
    redirect("/forbidden");
  }

  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const view = parseView(params.view);
  const includeCancelled = params.cancelled === "1";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const hotelSettings = await getHotelSettings().catch(() => null);
  const timezone = hotelSettings?.timezone || "America/Argentina/Tucuman";

  const directory = view === "directorio" ? await getGuestDirectory(search) : [];
  const upcoming = view === "por_llegar" ? await getUpcomingGuests(search) : [];
  const history =
    view === "historial"
      ? await getReservationHistory({ page, search, includeCancelled })
      : null;

  const buildHref = (
    overrides: Partial<{ view: GuestsView; cancelled: string; page: number }>
  ) => {
    const parts: string[] = [];
    const nextView = overrides.view ?? view;
    if (nextView) parts.push(`view=${nextView}`);
    if (search) parts.push(`q=${encodeURIComponent(search)}`);
    const nextCancelled =
      overrides.cancelled !== undefined ? overrides.cancelled : includeCancelled ? "1" : "";
    if (nextCancelled) parts.push(`cancelled=${nextCancelled}`);
    if (overrides.page && overrides.page > 1) parts.push(`page=${overrides.page}`);
    return parts.length > 0 ? `/admin/guests?${parts.join("&")}` : "/admin/guests";
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Users size={20} className="text-slate-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">Huéspedes</h1>
          </div>

          <form method="get" className="relative">
            <input type="hidden" name="view" value={view} />
            {includeCancelled && <input type="hidden" name="cancelled" value="1" />}
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <input
              name="q"
              type="text"
              defaultValue={search}
              placeholder="Buscar por nombre o DNI..."
              className="pl-9 pr-4 py-2 bg-slate-100 border-transparent rounded-lg text-sm focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none w-64 transition-all"
            />
          </form>
        </div>

        {/* Pestañas: Directorio / Historial / Por llegar */}
        <div className="flex gap-2 flex-wrap items-center">
          {VIEWS.map((v) => {
            const isActive = view === v.value;
            return (
              <a
                key={v.value}
                href={buildHref({ view: v.value })}
                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white border-brand-600"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                }`}
              >
                {v.label}
              </a>
            );
          })}

          {view === "historial" && (
            <>
              <span className="mx-2 text-slate-300">|</span>
              <a
                href={buildHref({ cancelled: includeCancelled ? "" : "1" })}
                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors flex items-center gap-1.5 ${
                  includeCancelled
                    ? "bg-red-100 text-red-700 border-red-200"
                    : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                }`}
              >
                <span
                  className={`inline-block w-3 h-3 rounded border ${includeCancelled ? "bg-red-500 border-red-500" : "bg-white border-slate-300"}`}
                />
                Ver cancelados
              </a>
            </>
          )}
        </div>

        <p className="text-xs text-slate-500 mt-2">
          {view === "directorio" && "Personas que se hospedaron, sin repetir (agrupadas por DNI)."}
          {view === "historial" && "Reservas de los últimos 60 días, 15 por página."}
          {view === "por_llegar" && "Todas las reservas próximas, sin límite de tiempo."}
        </p>
      </header>

      <div className="flex-1 overflow-auto p-8">
        {view === "directorio" && (
          <GuestDirectoryTable guests={directory} searchQuery={search} timezone={timezone} />
        )}

        {view === "por_llegar" && (
          <UpcomingGuestsTable guests={upcoming} searchQuery={search} timezone={timezone} />
        )}

        {view === "historial" && history && (
          <>
            <GuestsClientTable
              initialGuests={history.rows}
              searchQuery={search}
              timezone={timezone}
            />
            <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
              <span>
                {history.total} reserva{history.total === 1 ? "" : "s"} · Página {history.page} de{" "}
                {history.totalPages}
              </span>
              <div className="flex gap-2">
                <a
                  href={buildHref({ page: history.page - 1 })}
                  aria-disabled={history.page <= 1}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                    history.page <= 1
                      ? "pointer-events-none opacity-40 border-slate-200 text-slate-400"
                      : "bg-white border-slate-200 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  Anterior
                </a>
                <a
                  href={buildHref({ page: history.page + 1 })}
                  aria-disabled={history.page >= history.totalPages}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                    history.page >= history.totalPages
                      ? "pointer-events-none opacity-40 border-slate-200 text-slate-400"
                      : "bg-white border-slate-200 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  Siguiente
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
