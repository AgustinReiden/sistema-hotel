"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, DollarSign, FileText, ScrollText, Search, UserRound } from "lucide-react";

import BalanceTag from "./BalanceTag";
import FichaClienteModal from "./FichaClienteModal";
import RegisterPaymentModal from "./RegisterPaymentModal";
import DownloadCsvButton from "../DownloadCsvButton";
import PaginationFooter from "../PaginationFooter";
import { usePagination } from "../usePagination";
import { buildCsv, type CsvColumn } from "@/lib/csv";
import { hotelDateKey } from "@/lib/time";
import type { CtaCteAccount } from "@/lib/types";

// Listado de saldos (lo que está filtrado por el buscador): es el listado de deudores.
const ACCOUNTS_CSV_COLUMNS: CsvColumn<CtaCteAccount>[] = [
  { header: "Cliente", type: "texto", value: (a) => a.name },
  { header: "Tipo", type: "plano", value: (a) => (a.kind === "company" ? "Empresa" : "Huésped") },
  { header: "DNI/CUIT", type: "documento", value: (a) => a.document_id ?? "" },
  { header: "Saldo", type: "monto", value: (a) => a.balance },
];

export default function CuentasClient({ accounts }: { accounts: CtaCteAccount[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [payTarget, setPayTarget] = useState<CtaCteAccount | null>(null);
  const [fichaTarget, setFichaTarget] = useState<CtaCteAccount | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.document_id ?? "").toLowerCase().includes(q)
    );
  }, [accounts, query]);

  // El CSV y los totales del header siguen leyendo `filtered` entero; esto decide
  // nada mas que filas se pintan.
  const { rows: pagina, setPage, ...paginacion } = usePagination(filtered, query);

  return (
    <>
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o DNI/CUIT…"
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <DownloadCsvButton
          filename={`cuentas_corrientes_${hotelDateKey(new Date())}.csv`}
          build={() => buildCsv(ACCOUNTS_CSV_COLUMNS, filtered)}
          label="Exportar CSV"
          className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              <th className="px-6 py-4">Cliente</th>
              <th className="px-6 py-4">Tipo</th>
              <th className="px-6 py-4">DNI/CUIT</th>
              <th className="px-6 py-4">Saldo</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagina.map((a) => (
              <tr key={`${a.kind}-${a.id}`} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-900">{a.name}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
                    {a.kind === "company" ? (
                      <>
                        <Building2 size={14} className="text-sky-600" /> Empresa
                      </>
                    ) : (
                      <>
                        <UserRound size={14} className="text-emerald-600" /> Huésped
                      </>
                    )}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">{a.document_id || "—"}</td>
                <td className="px-6 py-4 text-sm">
                  <BalanceTag balance={a.balance} />
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setFichaTarget(a)}
                      className="inline-flex items-center justify-center p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Ver ficha del cliente"
                    >
                      <ScrollText size={18} />
                    </button>
                    <Link
                      href={`/admin/fiscal/consolidada?kind=${a.kind}&id=${a.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                      title="Emitir factura consolidada de las estadías sin facturar"
                    >
                      <FileText size={16} /> Facturar
                    </Link>
                    <button
                      onClick={() => setPayTarget(a)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                      title="Registrar pago a cuenta"
                    >
                      <DollarSign size={16} /> Pago
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaginationFooter {...paginacion} noun="cuentas" onPageChange={setPage} />

      {filtered.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          {query ? "No hay cuentas que coincidan." : "No hay clientes con cuenta corriente habilitada."}
        </div>
      )}

      {payTarget && (
        <RegisterPaymentModal
          account={payTarget}
          onClose={() => setPayTarget(null)}
          onSaved={() => {
            setPayTarget(null);
            router.refresh();
          }}
        />
      )}

      {fichaTarget && (
        <FichaClienteModal
          key={`${fichaTarget.kind}-${fichaTarget.id}`}
          account={fichaTarget}
          onClose={() => setFichaTarget(null)}
        />
      )}
    </>
  );
}
