import { FileText } from "lucide-react";

import {
  getFiscalSettings,
  listInvoiceableCheckouts,
  listPendingInvoices,
  listTodayAuthorizedInvoices,
} from "@/lib/data";
import FiscalClient from "./FiscalClient";

export const dynamic = "force-dynamic";

export default async function FiscalPage() {
  const [settings, pending, invoiceable, authorized] = await Promise.all([
    getFiscalSettings().catch(() => null),
    listPendingInvoices().catch(() => []),
    listInvoiceableCheckouts().catch(() => []),
    listTodayAuthorizedInvoices().catch(() => []),
  ]);

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <FileText size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Facturación</h1>
            <p className="text-xs text-slate-400 -mt-0.5">
              {settings?.enabled
                ? settings.environment === "homologacion"
                  ? "Ambiente de PRUEBA (homologación): los comprobantes no tienen valor fiscal."
                  : "Ambiente de PRODUCCIÓN: se emiten facturas reales."
                : "La facturación electrónica no está habilitada (Ajustes → Facturación electrónica)."}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <FiscalClient
            enabled={Boolean(settings?.enabled)}
            pending={pending}
            invoiceable={invoiceable}
            authorized={authorized}
          />
        </div>
      </div>
    </div>
  );
}
