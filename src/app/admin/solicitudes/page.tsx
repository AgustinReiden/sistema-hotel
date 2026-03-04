import { ClipboardList } from "lucide-react";
import { getSolicitudesData } from "@/lib/data";
import SolicitudesClient from "./SolicitudesClient";

export const dynamic = "force-dynamic";

export default async function SolicitudesPage() {
  const solicitudes = await getSolicitudesData();

  const pendingCount = solicitudes.filter((s) => s.status === "pending").length;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-100 rounded-lg">
            <ClipboardList size={20} className="text-slate-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">
            Solicitudes de Reserva
          </h1>
          {pendingCount > 0 && (
            <span className="ml-2 px-2.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
              {pendingCount} pendiente{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <SolicitudesClient solicitudes={solicitudes} />
      </div>
    </div>
  );
}
