import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import {
  countBillingPending,
  getCtaCteAccounts,
  getCurrentUserRole,
  listBillingControl,
} from "@/lib/data";
import { isBillingCobroFilter } from "@/lib/billing";
import { hotelDateKey } from "@/lib/time";
import type { CtaCteClientKind } from "@/lib/types";
import ControlClient from "./ControlClient";

/**
 * Ventana del contador "en todo el historial". No es `allowAll`: la RPC
 * `rpc_list_billing_control` exige rango (22023 con NULL), así que se usa una
 * ventana larga en días. Diez años cubre todo lo que este hotel puede tener
 * cargado y evita una migración para algo que ya se resuelve con un parámetro.
 */
const DIAS_HISTORICO = 3650;

export const dynamic = "force-dynamic";

/**
 * Primer y último día del mes en curso EN LA ZONA DEL HOTEL, en formato YYYY-MM-DD.
 *
 * Antes se resolvía con getUTCMonth(): entre las 21hs y la medianoche de Tucumán
 * del último día del mes ya es el día 1 en UTC, así que el listado abría por
 * defecto en el mes equivocado y el empleado veía vacío lo que recién había
 * cerrado. hotelDateKey resuelve el día contra la zona del hotel.
 */
function currentMonthRange(): { from: string; to: string } {
  const [y, m] = hotelDateKey(new Date()).split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Día 0 del mes siguiente = último día de este mes. Se calcula en UTC a
  // propósito: acá `y`/`m` ya son el mes del hotel, es pura aritmética de calendario.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
}

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
  const defaults = currentMonthRange();
  const from = desde && DATE_RE.test(desde) ? desde : defaults.from;
  const to = hasta && DATE_RE.test(hasta) ? hasta : defaults.to;

  // `cliente` viaja como "company:<uuid>" | "guest:<uuid>".
  const [rawKind, rawId] = (cliente ?? "").split(":");
  const clientKind: CtaCteClientKind | undefined =
    rawKind === "company" || rawKind === "guest" ? rawKind : undefined;
  const clientId = clientKind && rawId ? rawId : undefined;

  // Un filtro inventado en la URL no puede esconder filas: `matchesCobro` deja
  // pasar todo ante un valor desconocido, y acá además no se refleja en el select.
  const cobroFilter = cobro && isBillingCobroFilter(cobro) ? cobro : "";

  const [rows, accounts, historico] = await Promise.all([
    listBillingControl(from, to, clientKind, clientId).catch(() => []),
    getCtaCteAccounts().catch(() => []),
    // Cuánto falta facturar EN TODO EL HISTORIAL, no sólo en el rango que se ve.
    // Sin esto, una estadía de hace cuatro meses no aparece en ninguna pantalla:
    // el listado abre en el mes en curso y el badge del menú mira 60 días.
    countBillingPending(DIAS_HISTORICO).catch(() => null),
  ]);

  const totalHistorico = historico
    ? historico.falta + historico.pendiente_consolidada
    : 0;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <ClipboardCheck size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Control de facturación</h1>
            <p className="text-sm text-slate-500">
              Qué está facturado y qué no, estadía por estadía. Sin límite de días.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <ControlClient
            rows={rows}
            accounts={accounts}
            from={from}
            to={to}
            cliente={cliente ?? ""}
            estado={estado ?? ""}
            cobro={cobroFilter}
            rastro={rastro === "1"}
            totalHistorico={totalHistorico}
            todayKey={todayKey}
          />
        </div>
      </div>
    </div>
  );
}
