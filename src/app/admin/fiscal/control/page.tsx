import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { getCtaCteAccounts, getCurrentUserRole, listBillingControl } from "@/lib/data";
import { isBillingCobroFilter } from "@/lib/billing";
import { BILLING_EPOCH } from "@/lib/date-range";
import { hotelDateKey } from "@/lib/time";
import type { CtaCteClientKind } from "@/lib/types";
import ControlClient from "./ControlClient";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ControlFacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string;
    hasta?: string;
    cliente?: string;
    estado?: string;
    cobro?: string;
    rastro?: string;
  }>;
}) {
  const role = await getCurrentUserRole();
  if (role !== "admin") {
    redirect("/forbidden");
  }

  const { desde, hasta, cliente, estado, cobro, rastro } = await searchParams;
  // El "hoy" del hotel se resuelve en el server y viaja como prop: si lo calculara
  // el navegador, los presets dependerían de la zona de la máquina del empleado.
  const todayKey = hotelDateKey(new Date());

  // Esta pantalla abre sobre TODO el historial, no sobre el mes en curso. "Qué falta
  // facturar" no tiene mes: una estadía sin facturar de hace cuatro meses es justo la
  // que hay que ver, y abrir en el mes la escondía (eran 222 de 286 invisibles). El
  // parche era un segundo contador que te decía el número que no podías ver; abriendo
  // así, ese contador sobra. Ver docs/solapamiento-cuentas-facturacion.md.
  const from = desde && DATE_RE.test(desde) ? desde : BILLING_EPOCH;
  const to = hasta && DATE_RE.test(hasta) ? hasta : todayKey;

  // `cliente` viaja como "company:<uuid>" | "guest:<uuid>".
  const [rawKind, rawId] = (cliente ?? "").split(":");
  const clientKind: CtaCteClientKind | undefined =
    rawKind === "company" || rawKind === "guest" ? rawKind : undefined;
  const clientId = clientKind && rawId ? rawId : undefined;

  // Un filtro inventado en la URL no puede esconder filas: `matchesCobro` deja
  // pasar todo ante un valor desconocido, y acá además no se refleja en el select.
  const cobroFilter = cobro && isBillingCobroFilter(cobro) ? cobro : "";

  // Sin parámetro, la pantalla abre en lo que falta facturar: es la pregunta que
  // vino a contestar. "todas" es el valor explícito para no filtrar, porque con el
  // default nuevo la cadena vacía ya no puede significarlo.
  const estadoFiltro = estado ?? "pendiente";

  const [rows, accounts] = await Promise.all([
    listBillingControl(from, to, clientKind, clientId).catch(() => []),
    getCtaCteAccounts().catch(() => []),
  ]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-4 md:px-6 py-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <ClipboardCheck size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Control de facturación</h1>
            <p className="text-sm text-slate-500">
              Todo lo que falta facturar, estadía por estadía y sin límite de fecha.
            </p>
          </div>
        </div>
      </header>

      {/* Sin max-w-6xl: son diez columnas y en un monitor de recepción la caja de
          1152px las mandaba a scroll horizontal aunque sobrara pantalla. */}
      <div className="flex-1 overflow-auto p-3 md:p-5">
        <div className="max-w-[1600px] mx-auto">
          <ControlClient
            rows={rows}
            accounts={accounts}
            from={from}
            to={to}
            cliente={cliente ?? ""}
            estado={estadoFiltro}
            cobro={cobroFilter}
            rastro={rastro === "1"}
            todayKey={todayKey}
          />
        </div>
      </div>
    </div>
  );
}
