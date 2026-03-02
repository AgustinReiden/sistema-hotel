import { Search, Users } from "lucide-react";
import { getGuestsData } from "@/lib/data";
import GuestsClientTable from "./GuestsClientTable";

export const dynamic = "force-dynamic";

type GuestsPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function GuestsPage({ searchParams }: GuestsPageProps) {
  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const guests = await getGuestsData(search);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Users size={20} className="text-slate-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Directorio de Huespedes</h1>
        </div>

        <form method="get" className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={16}
          />
          <input
            name="q"
            type="text"
            defaultValue={search}
            placeholder="Buscar huesped..."
            className="pl-9 pr-4 py-2 bg-slate-100 border-transparent rounded-lg text-sm focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none w-64 transition-all"
          />
        </form>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <GuestsClientTable initialGuests={guests} searchQuery={search} />
      </div>
    </div>
  );
}
