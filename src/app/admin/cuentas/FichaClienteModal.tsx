"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Eye,
  FileText,
  Loader2,
  Printer,
  ScrollText,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { loadClientInvoicesAction, loadCtaCteAccountAction } from "./actions";
import BalanceTag, { money } from "./BalanceTag";
import DateRangeFilter from "../DateRangeFilter";
import DownloadCsvButton from "../DownloadCsvButton";
import PaginationFooter from "../PaginationFooter";
import { usePagination } from "../usePagination";
import { cbteLetra, formatCbteNumero } from "@/lib/arca/amounts";
import { buildCsv, csvField, formatAmountAr, type CsvColumn } from "@/lib/csv";
import { buildBillingPresets, formatKey } from "@/lib/date-range";
import { hotelDateKey } from "@/lib/time";
import type { ClientInvoiceRow, CtaCteAccount, CtaCteMovimiento } from "@/lib/types";

/**
 * Ficha del cliente de cuenta corriente: lo que hay que mirar para decidir si se le
 * sigue fiando, todo en una pantalla. El encabezado (quién es y cuánto debe) queda
 * fijo y las solapas cambian abajo: el saldo es el dato que no se negocia, y si se
 * fuera con el scroll el empleado terminaría leyendo una lista sin saber de quién.
 */

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

/**
 * Las solapas de la ficha.
 *
 * Está pensado para crecer: la próxima es "Pagos" (los pagos a cuenta con su
 * comprobante, hoy mezclados entre los movimientos). Para agregarla alcanza con un
 * item más acá y una rama más en el cuerpo — no hay nada más que tocar.
 */
type Solapa = "movimientos" | "facturas";

const SOLAPAS: { id: Solapa; label: string; Icono: typeof ScrollText }[] = [
  { id: "movimientos", label: "Movimientos", Icono: ScrollText },
  { id: "facturas", label: "Facturas", Icono: FileText },
];

export default function FichaClienteModal({
  account,
  onClose,
}: {
  account: CtaCteAccount;
  onClose: () => void;
}) {
  const [solapa, setSolapa] = useState<Solapa>("movimientos");
  const [loading, setLoading] = useState(true);
  const [movements, setMovements] = useState<CtaCteMovimiento[]>([]);
  const [balance, setBalance] = useState(account.balance);

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden max-h-[92dvh] sm:max-h-[88dvh] flex flex-col">
        {/* Encabezado fijo: quién es y cuánto debe, visible en todas las solapas. */}
        <div className="shrink-0 px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
                account.kind === "company"
                  ? "bg-sky-100 text-sky-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {account.kind === "company" ? <Building2 size={22} /> : <UserRound size={22} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-800 truncate">{account.name}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                <span className="font-bold">
                  {account.kind === "company" ? "Empresa" : "Huésped"}
                </span>
                <span>{account.document_id || "sin DNI/CUIT"}</span>
              </div>
              <p className="text-sm text-slate-500 mt-0.5" data-testid="ficha-balance">
                Saldo: <BalanceTag balance={balance} />
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="shrink-0 px-6 border-b border-slate-200 bg-white flex gap-1 overflow-x-auto">
          {SOLAPAS.map(({ id, label, Icono }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSolapa(id)}
              aria-current={solapa === id ? "page" : undefined}
              className={`px-4 py-3 text-sm font-bold border-b-2 -mb-px flex items-center gap-2 whitespace-nowrap transition-colors ${
                solapa === id
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icono size={16} /> {label}
            </button>
          ))}
        </div>

        {solapa === "movimientos" ? (
          <SolapaMovimientos
            account={account}
            balance={balance}
            movements={movements}
            loading={loading}
          />
        ) : (
          <SolapaFacturas account={account} />
        )}
      </div>
    </div>
  );
}

function SolapaMovimientos({
  account,
  balance,
  movements,
  loading,
}: {
  account: CtaCteAccount;
  balance: number;
  movements: CtaCteMovimiento[];
  loading: boolean;
}) {
  // Filtro DE VISTA sobre los movimientos ya cargados: nunca recalcula el saldo del
  // encabezado, que sigue siendo el de la cuenta completa.
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const todayKey = useMemo(() => hotelDateKey(new Date()), []);
  const presets = useMemo(() => buildBillingPresets(todayKey), [todayKey]);

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
    <>
      {!loading && movements.length > 0 && (
        <div className="shrink-0 px-6 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
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
    </>
  );
}

/** Comprobante de cta cte (el que firma el cliente), en la misma ventana que usa RoomCard. */
function openAccountVoucher(movementId: string) {
  if (typeof window === "undefined") return;
  window.open(
    `/admin/comprobante-cc/${movementId}?autoprint=1`,
    `comprobante-cc-${movementId}`,
    "width=420,height=720"
  );
}

/** Reimpresión de la factura, con la misma firma de ventana que la pantalla de consolidadas. */
function openInvoicePrint(invoiceId: string) {
  if (typeof window === "undefined") return;
  window.open(`/admin/factura/${invoiceId}?autoprint=1`, `factura-${invoiceId}`, "width=420,height=720");
}

const INVOICE_STATUS_LABEL: Record<ClientInvoiceRow["status"], string> = {
  authorized: "Emitida",
  pending: "Pendiente de ARCA",
  processing: "En verificación",
  rejected: "Rechazada",
};

/** El número recién existe cuando ARCA dio el CAE: antes no hay nada que mostrar. */
function invoiceNumero(f: ClientInvoiceRow): string {
  if (f.cbte_nro === null) return "sin número";
  return formatCbteNumero(f.pto_vta, f.cbte_nro);
}

/** Fecha del comprobante; las que no tienen CAE caen a la fecha en que se crearon. */
function invoiceFecha(f: ClientInvoiceRow): string {
  return formatKey(f.cbte_fch ?? hotelDateKey(f.created_at));
}

function SolapaFacturas({ account }: { account: CtaCteAccount }) {
  const [loading, setLoading] = useState(true);
  const [facturas, setFacturas] = useState<ClientInvoiceRow[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadClientInvoicesAction(account.kind, account.id);
      if (!active) return;
      if (result.success) {
        setFacturas(result.data ?? []);
      } else {
        toast.error(result.error);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [account.kind, account.id]);

  const { rows: pagina, setPage, ...paginacion } = usePagination(facturas);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6" data-testid="solapa-facturas">
        <div className="flex items-center justify-center text-slate-500 py-8">
          <Loader2 size={20} className="animate-spin mr-2" /> Cargando facturas…
        </div>
      </div>
    );
  }

  // Vacío explicado, no una tabla en blanco: que no haya facturas es información
  // (puede estar todo sin facturar), y el empleado tiene que saber dónde se emiten.
  if (facturas.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6" data-testid="solapa-facturas">
        <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl">
          <FileText size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-600">
            Todavía no se le emitió ninguna factura a este cliente.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Las estadías cargadas a la cuenta se facturan desde{" "}
            <Link
              href={`/admin/fiscal/consolidada?kind=${account.kind}&id=${account.id}`}
              className="font-bold text-emerald-700 underline hover:text-emerald-800"
            >
              Facturar
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="solapa-facturas">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3">Comprobante</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagina.map((f) => (
              <tr key={f.invoice_id} className={f.anulada_at ? "bg-slate-50/60" : ""}>
                <td className="px-4 py-3">
                  <p
                    className={`font-semibold text-slate-800 ${f.anulada_at ? "line-through" : ""}`}
                  >
                    Factura {cbteLetra(f.cbte_tipo)} {invoiceNumero(f)}
                  </p>
                  {/* El N de estadías es lo que distingue una consolidada de una de
                      check-out sin tener que abrirla. */}
                  {f.kind === "consolidada" && (
                    <p className="text-xs text-slate-500">
                      Consolidada · {f.estadias} estadía{f.estadias === 1 ? "" : "s"}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{invoiceFecha(f)}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">
                  {money(f.imp_total)}
                </td>
                <td className="px-4 py-3">
                  {f.anulada_at ? (
                    <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-bold border bg-red-50 text-red-700 border-red-200">
                      Anulada por nota de crédito
                    </span>
                  ) : (
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold border ${
                        f.status === "authorized"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : f.status === "rejected"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                      }`}
                    >
                      {INVOICE_STATUS_LABEL[f.status]}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/factura/${f.invoice_id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                      title="Ver el comprobante"
                    >
                      <Eye size={14} /> Ver
                    </Link>
                    <button
                      type="button"
                      onClick={() => openInvoicePrint(f.invoice_id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                      title="Reimprimir el comprobante"
                    >
                      <Printer size={14} /> Reimprimir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaginationFooter {...paginacion} noun="facturas" onPageChange={setPage} />
    </div>
  );
}
