"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, DollarSign, FileText, Loader2, Printer, ScrollText, Search, UserRound, Wallet, X } from "lucide-react";
import { toast } from "sonner";

import { loadCtaCteAccountAction, registerAccountPaymentAction } from "./actions";
import DateRangeFilter from "../DateRangeFilter";
import DownloadCsvButton from "../DownloadCsvButton";
import PaginationFooter from "../PaginationFooter";
import { usePagination } from "../usePagination";
import { buildCsv, csvField, formatAmountAr, type CsvColumn } from "@/lib/csv";
import { buildBillingPresets, formatKey } from "@/lib/date-range";
import { hotelDateKey } from "@/lib/time";
import type { CtaCteAccount, CtaCteMovimiento } from "@/lib/types";

function money(n: number) {
  return `$${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
}

// Listado de saldos (lo que está filtrado por el buscador): es el listado de deudores.
const ACCOUNTS_CSV_COLUMNS: CsvColumn<CtaCteAccount>[] = [
  { header: "Cliente", type: "texto", value: (a) => a.name },
  { header: "Tipo", type: "plano", value: (a) => (a.kind === "company" ? "Empresa" : "Huésped") },
  { header: "DNI/CUIT", type: "documento", value: (a) => a.document_id ?? "" },
  { header: "Saldo", type: "monto", value: (a) => a.balance },
];

/** Comprobante de cta cte (el que firma el cliente), en la misma ventana que usa RoomCard. */
function openAccountVoucher(movementId: string) {
  if (typeof window === "undefined") return;
  window.open(
    `/admin/comprobante-cc/${movementId}?autoprint=1`,
    `comprobante-cc-${movementId}`,
    "width=420,height=720"
  );
}

function BalanceTag({ balance }: { balance: number }) {
  if (balance > 0) {
    return <span className="font-bold text-red-600">{money(balance)} debe</span>;
  }
  if (balance < 0) {
    return <span className="font-bold text-emerald-600">{money(balance)} a favor</span>;
  }
  return <span className="font-semibold text-slate-400">$0,00</span>;
}

export default function CuentasClient({ accounts }: { accounts: CtaCteAccount[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [payTarget, setPayTarget] = useState<CtaCteAccount | null>(null);
  const [movTarget, setMovTarget] = useState<CtaCteAccount | null>(null);

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
                      onClick={() => setMovTarget(a)}
                      className="inline-flex items-center justify-center p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Ver movimientos"
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

      {movTarget && (
        <MovementsModal
          key={`${movTarget.kind}-${movTarget.id}`}
          account={movTarget}
          onClose={() => setMovTarget(null)}
        />
      )}
    </>
  );
}

const METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "bank_transfer", label: "Transferencia" },
  { value: "mercado_pago", label: "Mercado Pago" },
  { value: "other", label: "Otro" },
];

function RegisterPaymentModal({
  account,
  onClose,
  onSaved,
}: {
  account: CtaCteAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(account.balance > 0 ? account.balance.toString() : "");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("El monto debe ser mayor a 0.");
      return;
    }
    setSaving(true);
    const result = await registerAccountPaymentAction({
      kind: account.kind,
      clientId: account.id,
      amount: parsed,
      method,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (result.success) {
      toast.success("Pago a cuenta registrado.");
      onSaved();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Wallet size={18} className="text-emerald-600" />
            Registrar pago a cuenta
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">{account.name}</p>
            <p className="text-slate-500">
              Saldo actual: <BalanceTag balance={account.balance} />
            </p>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Monto</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-lg font-bold"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Método (informativo)</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              No impacta el arqueo de caja; queda como registro de la cuenta corriente.
            </p>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Notas</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              placeholder="Opcional. Ej. comprobante N° / transferencia"
            />
          </div>
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
              Registrar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** "" (sin límite) o una clave YYYY-MM-DD, para comparar contra hotelDateKey(m.created_at). */
function inRange(dateKey: string, from: string, to: string): boolean {
  return (!from || dateKey >= from) && (!to || dateKey <= to);
}

function periodLabel(from: string, to: string): string {
  if (!from && !to) return "Todo el historial";
  return `${from ? formatKey(from) : "…"} a ${to ? formatKey(to) : "…"}`;
}

/**
 * CSV de movimientos del período filtrado (resumen que se le manda al cliente). La
 * primera línea NO es una fila de la tabla: deja asentado el período Y el saldo real
 * de la cuenta completa, para que nadie confunda la suma del período con la deuda
 * total si el archivo queda cortado por el filtro.
 */
function buildMovementsCsv(
  movements: CtaCteMovimiento[],
  accountName: string,
  balance: number,
  from: string,
  to: string
): string {
  const columns: CsvColumn<CtaCteMovimiento>[] = [
    { header: "Fecha", type: "fecha", value: (m) => hotelDateKey(m.created_at) },
    { header: "Tipo", type: "plano", value: (m) => (m.tipo === "cargo" ? "Cargo" : "Pago") },
    { header: "Concepto", type: "texto", value: (m) => (m.tipo === "cargo" ? "Estadía" : m.payment_method ?? "") },
    { header: "Monto", type: "monto", value: (m) => (m.tipo === "cargo" ? m.amount : -m.amount) },
    { header: "Notas", type: "texto", value: (m) => m.notes ?? "" },
  ];
  const metaLine = csvField(
    `Cuenta: ${accountName} · Período: ${periodLabel(from, to)} · Saldo total de la cuenta: $${formatAmountAr(balance)}`
  );
  const table = buildCsv(columns, movements).replace(/^﻿/, "");
  return "﻿" + metaLine + "\r\n\r\n" + table;
}

function MovementsModal({ account, onClose }: { account: CtaCteAccount; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [movements, setMovements] = useState<CtaCteMovimiento[]>([]);
  const [balance, setBalance] = useState(account.balance);
  // Filtro DE VISTA sobre los movimientos ya cargados: nunca recalcula el saldo de
  // arriba, que sigue siendo el de la cuenta completa (ver BalanceTag más abajo).
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const todayKey = useMemo(() => hotelDateKey(new Date()), []);
  const presets = useMemo(() => buildBillingPresets(todayKey), [todayKey]);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadCtaCteAccountAction(account.kind, account.id);
      if (!active) return;
      if (result.success && result.data) {
        setMovements(result.data.movements);
        setBalance(result.data.balance);
      } else if (!result.success) {
        toast.error(result.error);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [account.kind, account.id]);

  const filteredMovements = useMemo(
    () => movements.filter((m) => inRange(hotelDateKey(m.created_at), rangeFrom, rangeTo)),
    [movements, rangeFrom, rangeTo]
  );

  const periodStats = useMemo(() => {
    let cargos = 0;
    let pagos = 0;
    for (const m of filteredMovements) {
      if (m.tipo === "cargo") cargos += m.amount;
      else pagos += m.amount;
    }
    return { count: filteredMovements.length, cargos, pagos };
  }, [filteredMovements]);

  // Las estadisticas del periodo y el CSV siguen sobre `filteredMovements` completo.
  const {
    rows: movimientosPagina,
    setPage: setMovementsPage,
    ...paginacionMovimientos
  } = usePagination(filteredMovements, `${rangeFrom}|${rangeTo}`);

  const hasExcluded =
    (rangeFrom !== "" || rangeTo !== "") && filteredMovements.length < movements.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[92dvh] sm:max-h-[88dvh] flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{account.name}</h2>
            <p className="text-sm text-slate-500" data-testid="mov-modal-balance">
              Saldo: <BalanceTag balance={balance} />
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
            <X size={20} />
          </button>
        </div>
        {!loading && movements.length > 0 && (
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <DateRangeFilter
                from={rangeFrom}
                to={rangeTo}
                presets={presets}
                allowAll
                onChange={(f, t) => {
                  setRangeFrom(f);
                  setRangeTo(t);
                }}
              />
              <DownloadCsvButton
                filename={`movimientos_${account.name.replace(/\s+/g, "_")}_${rangeFrom || "inicio"}_a_${rangeTo || todayKey}.csv`}
                build={() => buildMovementsCsv(filteredMovements, account.name, balance, rangeFrom, rangeTo)}
                label="Exportar CSV"
                className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 shrink-0"
              />
            </div>
            {/* Deliberadamente SIN la palabra "saldo": es la suma del período, no la
                deuda real de la cuenta (esa sigue arriba, en BalanceTag). */}
            <p className="text-xs font-semibold text-slate-500">
              En el período: {periodStats.count} movimiento{periodStats.count === 1 ? "" : "s"} · cargos{" "}
              {money(periodStats.cargos)} · pagos {money(periodStats.pagos)}
            </p>
            {hasExcluded && (
              <p className="text-xs font-semibold text-amber-600">
                Hay movimientos fuera del período elegido.
              </p>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center text-slate-500 py-8">
              <Loader2 size={20} className="animate-spin mr-2" /> Cargando…
            </div>
          ) : movements.length === 0 ? (
            <p className="text-center text-slate-500 py-8">Sin movimientos.</p>
          ) : filteredMovements.length === 0 ? (
            <p className="text-center text-slate-500 py-8">Sin movimientos en este período.</p>
          ) : (
            <div className="space-y-2">
              {movimientosPagina.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {m.tipo === "cargo" ? "Cargo (estadía)" : "Pago a cuenta"}
                      {m.payment_method ? ` · ${m.payment_method}` : ""}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(m.created_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                      {m.notes ? ` · ${m.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-bold ${m.tipo === "cargo" ? "text-red-600" : "text-emerald-600"}`}
                    >
                      {m.tipo === "cargo" ? "+" : "−"}
                      {money(m.amount)}
                    </span>
                    {/* El comprobante que firma el cliente ya existía, pero sólo se
                        abría solo al cerrar el check-out: sin esto no había forma de
                        reimprimirlo después. */}
                    {m.tipo === "cargo" && m.reservation_id && (
                      <button
                        type="button"
                        onClick={() => openAccountVoucher(m.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Reimprimir el comprobante de cuenta corriente"
                      >
                        <Printer size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <PaginationFooter
                {...paginacionMovimientos}
                noun="movimientos"
                onPageChange={setMovementsPage}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
