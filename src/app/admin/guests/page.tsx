import { redirect } from "next/navigation";
import { Search, Users } from "lucide-react";
import {
  getCurrentUserRole,
  getGuestDirectory,
  getHotelSettings,
  getReservationHistory,
  getUpcomingGuests,
} from "@/lib/data";
import { PAGE_SIZE, paginate, parsePageParam } from "@/lib/pagination";
import { hotelDateKey } from "@/lib/time";
import HistoryRangeFilter from "./HistoryRangeFilter";
import PaginationFooter from "../PaginationFooter";
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
    desde?: string;
    hasta?: string;
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
  const page = parsePageParam(params.page);

  const hotelSettings = await getHotelSettings().catch(() => null);
  const timezone = hotelSettings?.timezone || "America/Argentina/Tucuman";

  // Rango explícito de la pestaña Historial. Sin él se ven los últimos 60 días.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const desde = params.desde && DATE_RE.test(params.desde) ? params.desde : "";
  const hasta = params.hasta && DATE_RE.test(params.hasta) ? params.hasta : "";
  const todayKey = hotelDateKey(new Date());

  const directory = view === "directorio" ? await getGuestDirectory(search) : [];
  // "Por llegar" se corta acá y no en la consulta: son 36 filas y el orden por
  // fecha de entrada tiene que salir de la base, no de un slice a medias.
  const upcomingAll = view === "por_llegar" ? await getUpcomingGuests(search) : [];
  const upcoming = paginate(upcomingAll, page);
  const history =
    view === "historial"
      ? await getReservationHistory({
          page,
          pageSize: PAGE_SIZE,
          search,
          includeCancelled,
          from: desde || undefined,
          to: hasta || undefined,
        })
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
    // El período elegido sobrevive al cambio de página y al de pestaña.
    if (desde) parts.push(`desde=${desde}`);
    if (hasta) parts.push(`hasta=${hasta}`);
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
          {view === "directorio" &&
            "Padrón de huéspedes (sin repetir, agrupados por DNI). El descuento se aplica al elegirlos en una reserva."}
          {view === "historial" &&
            (desde || hasta
              ? `Reservas del período elegido, ${PAGE_SIZE} por página.`
              : `Reservas que ya ocurrieron, últimos 60 días, ${PAGE_SIZE} por página.`)}
          {view === "por_llegar" && "Todas las reservas próximas, sin límite de tiempo."}
        </p>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-8">
        {view === "directorio" && (
          <GuestDirectoryTable guests={directory} searchQuery={search} timezone={timezone} />
        )}

        {view === "por_llegar" && (
          <UpcomingGuestsTable
            guests={upcoming.rows}
            searchQuery={search}
            timezone={timezone}
            footer={
              <PaginationFooter
                page={upcoming.page}
                totalPages={upcoming.totalPages}
                total={upcoming.total}
                firstIndex={upcoming.firstIndex}
                lastIndex={upcoming.lastIndex}
                noun="reservas"
                hrefFor={(p) => buildHref({ page: p })}
              />
            }
          />
        )}

        {view === "historial" && history && (
          <>
            <HistoryRangeFilter
              from={desde}
              to={hasta}
              todayKey={todayKey}
              search={search}
              includeCancelled={includeCancelled}
            />
            <GuestsClientTable
              initialGuests={history.rows}
              searchQuery={search}
              timezone={timezone}
              footer={
                <PaginationFooter
                  page={history.page}
                  totalPages={history.totalPages}
                  total={history.total}
                  firstIndex={history.total === 0 ? 0 : (history.page - 1) * history.pageSize + 1}
                  lastIndex={Math.min(history.page * history.pageSize, history.total)}
                  noun="reservas"
                  hrefFor={(p) => buildHref({ page: p })}
                />
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
