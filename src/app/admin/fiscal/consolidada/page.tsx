import { redirect } from "next/navigation";
import { Layers } from "lucide-react";

import {
  getCtaCteAccounts,
  getCtaCteBillingProfiles,
  getCurrentUserRole,
  getFiscalSettings,
} from "@/lib/data";
import type { CtaCteClientKind } from "@/lib/types";
import ConsolidadaClient from "./ConsolidadaClient";

export const dynamic = "force-dynamic";

export default async function ConsolidadaPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; id?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (role !== "admin") {
    redirect("/forbidden");
  }

  const { kind, id } = await searchParams;
  const [accounts, billingProfiles, settings] = await Promise.all([
    getCtaCteAccounts(),
    getCtaCteBillingProfiles(),
    getFiscalSettings().catch(() => null),
  ]);

  const preselectKind: CtaCteClientKind | null =
    kind === "company" || kind === "guest" ? kind : null;
  const preselectId = id && preselectKind ? id : null;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Layers size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Factura consolidada</h1>
            <p className="text-sm text-slate-500">
              Juntá varias estadías de un cliente de cuenta corriente en un solo comprobante fiscal.
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          {settings?.enabled
            ? settings.environment === "homologacion"
              ? "Ambiente de PRUEBA (homologación): los comprobantes no tienen valor fiscal."
              : "Ambiente de PRODUCCIÓN: se emiten facturas reales."
            : "La facturación electrónica no está habilitada (Ajustes → Facturación electrónica)."}
        </p>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-5xl mx-auto">
          <ConsolidadaClient
            enabled={Boolean(settings?.enabled)}
            accounts={accounts}
            billingProfiles={billingProfiles}
            preselectKind={preselectKind}
            preselectId={preselectId}
          />
        </div>
      </div>
    </div>
  );
}
