import { Building2, Search } from "lucide-react";
import { redirect } from "next/navigation";

import AssociatedClientsClientTable from "./AssociatedClientsClientTable";
import { getAssociatedClients } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AssociatedClientsPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function AssociatedClientsPage({
  searchParams,
}: AssociatedClientsPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/forbidden");

  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const clients = await getAssociatedClients(search);
  const activeCount = clients.filter((client) => client.is_active).length;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Building2 size={20} className="text-slate-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Asociados</h1>
              <p className="text-sm text-slate-500">
                Padrón de clientes recurrentes con descuento automático.
              </p>
            </div>
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
              placeholder="Buscar asociado..."
              className="pl-9 pr-4 py-2 bg-slate-100 border-transparent rounded-lg text-sm focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none w-72 transition-all"
            />
          </form>
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">
            Activos: {activeCount}
          </span>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600">
            Total: {clients.length}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <AssociatedClientsClientTable initialClients={clients} searchQuery={search} />
        </div>
      </div>
    </div>
  );
}
