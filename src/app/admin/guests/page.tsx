import { Search, Users } from "lucide-react";
import { getGuestsData } from "@/lib/data";
import GuestsClientTable from "./GuestsClientTable";

export const dynamic = "force-dynamic";

type GuestsPageProps = {
  searchParams: Promise<{ q?: string; status?: string }>;
};

const STATUS_FILTERS = [
  { label: "Todos", value: "" },
  { label: "Hospedados", value: "checked_in" },
  { label: "Por Llegar", value: "confirmed" },
  { label: "Finalizados", value: "checked_out" },
  { label: "Cancelados", value: "cancelled" },
];

export default async function GuestsPage({ searchParams }: GuestsPageProps) {
  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const statusFilter = params.status ?? "";
  const guests = await getGuestsData(search, statusFilter);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Users size={20} className="text-slate-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">Directorio de Huéspedes</h1>
          </div>

          <form method="get" className="relative">
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <input
              name="q"
              type="text"
              defaultValue={search}
              placeholder="Buscar huésped..."
              className="pl-9 pr-4 py-2 bg-slate-100 border-transparent rounded-lg text-sm focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none w-64 transition-all"
            />
          </form>
        </div>

        {/* Status filter pills */}
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.value;
            const href = f.value
              ? `/admin/guests?status=${f.value}${search ? `&q=${search}` : ""}`
              : `/admin/guests${search ? `?q=${search}` : ""}`;
            return (
              <a
                key={f.value}
                href={href}
                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${isActive
                    ? "bg-brand-600 text-white border-brand-600"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  }`}
              >
                {f.label}
              </a>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <GuestsClientTable initialGuests={guests} searchQuery={search} />
      </div>
    </div>
  );
}
