import { redirect } from "next/navigation";
import { Percent } from "lucide-react";

import { getCurrentUserRole, getDiscountedClients, getAssociatedClients } from "@/lib/data";
import DiscountsManager from "./DiscountsManager";

export const dynamic = "force-dynamic";

export default async function DiscountsPage() {
  const role = await getCurrentUserRole();
  if (role !== "admin") {
    redirect("/forbidden");
  }

  const [discounted, companies] = await Promise.all([
    getDiscountedClients(),
    getAssociatedClients(),
  ]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Percent size={20} className="text-slate-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Descuentos</h1>
            <p className="text-sm text-slate-500">
              Asigná un % a un huésped o a una empresa. Se aplica solo al elegirlos en la reserva.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <DiscountsManager initialDiscounted={discounted} companies={companies} />
      </div>
    </div>
  );
}
