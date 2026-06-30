import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";

import { getCtaCteAccounts, getCurrentUserRole } from "@/lib/data";
import CuentasClient from "./CuentasClient";

export const dynamic = "force-dynamic";

export default async function CuentasPage() {
  const role = await getCurrentUserRole();
  if (role !== "admin") {
    redirect("/forbidden");
  }

  const accounts = await getCtaCteAccounts();
  const deudores = accounts.filter((a) => a.balance > 0);
  const totalDeuda = deudores.reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Wallet size={20} className="text-slate-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Cuenta Corriente</h1>
              <p className="text-sm text-slate-500">
                Clientes habilitados a fiar: saldos y registro de pagos a cuenta.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
          <span className="px-3 py-1 rounded-full bg-red-100 text-red-700">
            Deudores: {deudores.length}
          </span>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600">
            Deuda total: ${totalDeuda.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
          </span>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600">
            Habilitados: {accounts.length}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <CuentasClient accounts={accounts} />
        </div>
      </div>
    </div>
  );
}
