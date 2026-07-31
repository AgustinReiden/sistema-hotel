import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { getCtaCteAccounts, getCurrentUserRole, listBillingControl } from "@/lib/data";
import type { CtaCteClientKind } from "@/lib/types";
import ControlClient from "./ControlClient";

export const dynamic = "force-dynamic";

/** Primer y último día del mes en curso, en formato YYYY-MM-DD. */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ControlFacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; cliente?: string; estado?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (role !== "admin") {
    redirect("/forbidden");
  }

  const { desde, hasta, cliente, estado } = await searchParams;
  const defaults = currentMonthRange();
  const from = desde && DATE_RE.test(desde) ? desde : defaults.from;
  const to = hasta && DATE_RE.test(hasta) ? hasta : defaults.to;

  // `cliente` viaja como "company:<uuid>" | "guest:<uuid>".
  const [rawKind, rawId] = (cliente ?? "").split(":");
  const clientKind: CtaCteClientKind | undefined =
    rawKind === "company" || rawKind === "guest" ? rawKind : undefined;
  const clientId = clientKind && rawId ? rawId : undefined;

  const [rows, accounts] = await Promise.all([
    listBillingControl(from, to, clientKind, clientId).catch(() => []),
    getCtaCteAccounts().catch(() => []),
  ]);

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

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto">
          <ControlClient
            rows={rows}
            accounts={accounts}
            from={from}
            to={to}
            cliente={cliente ?? ""}
            estado={estado ?? ""}
          />
        </div>
      </div>
    </div>
  );
}
