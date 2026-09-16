import { ClipboardList } from "lucide-react";
import { getSolicitudesData } from "@/lib/data";
import SolicitudesClient from "./SolicitudesClient";
import { PageHeader } from "../PageShell";

export const dynamic = "force-dynamic";

export default async function SolicitudesPage() {
  const solicitudes = await getSolicitudesData();

  const pendingCount = solicitudes.filter((s) => s.status === "pending").length;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <PageHeader
        icon={<ClipboardList size={20} className="text-slate-600" />}
        title="Solicitudes de Reserva"
        badge={
          pendingCount > 0 ? (
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
              {pendingCount} pendiente{pendingCount > 1 ? "s" : ""}
            </span>
          ) : null
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-8">
        <SolicitudesClient solicitudes={solicitudes} />
      </div>
    </div>
  );
}
