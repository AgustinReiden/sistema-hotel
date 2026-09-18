"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Eye,
  FileText,
  Loader2,
  Printer,
  RotateCcw,
  ScrollText,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  loadCcAccountStaysAction,
  loadClientInvoicesAction,
  loadClientPaymentsAction,
  loadCtaCteAccountAction,
  revertPaymentImputacionAction,
} from "./actions";
import BalanceTag, { money } from "./BalanceTag";
import DateRangeFilter from "../DateRangeFilter";
import DownloadCsvButton from "../DownloadCsvButton";
import EstadoPagoTag from "../EstadoPagoTag";
import PaginationFooter from "../PaginationFooter";
import { usePagination } from "../usePagination";
import { cbteLetra, formatCbteNumero } from "@/lib/arca/amounts";
import { estadoPagoDeEstadia } from "@/lib/billing";
import { buildCsv, csvField, formatAmountAr, type CsvColumn } from "@/lib/csv";
import { buildBillingPresets, formatKey } from "@/lib/date-range";
import { formatAmount, formatShiftCode } from "@/lib/format";
import { hotelDateKey } from "@/lib/time";
import type {
  CcAccountStayRow,
  CcClientPaymentRow,
  CcPagoImputacion,
  CcStayEstado,
  ClientInvoiceRow,
  CtaCteAccount,
  CtaCteMovimiento,
} from "@/lib/types";

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
 * Las solapas de la ficha. Cada una contesta una pregunta distinta sobre el mismo
 * cliente: qué se movió, qué se le facturó y qué pagó.
 */
type Solapa = "movimientos" | "facturas" | "pagos";

const SOLAPAS: { id: Solapa; label: string; Icono: typeof ScrollText }[] = [
  { id: "movimientos", label: "Movimientos", Icono: ScrollText },
  { id: "facturas", label: "Facturas", Icono: FileText },
  { id: "pagos", label: "Pagos", Icono: Wallet },
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

        {solapa === "movimientos" && (
          <SolapaMovimientos
            account={account}
            balance={balance}
            movements={movements}
            loading={loading}
          />
        )}
        {solapa === "facturas" && <SolapaFacturas account={account} />}
        {solapa === "pagos" && <SolapaPagos account={account} />}
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

  // Estado fiscal y de cobro de cada estadía, indexado por el movimiento que la
  // cargó. Es una lectura APARTE de los movimientos y puede llegar después: sin
  // ella la lista se ve igual, sólo sin las pastillas. Que el saldo tarde por un
  // dato decorativo sería peor que mostrarlo en dos tiempos.
  const [estadias, setEstadias] = useState<Record<string, CcAccountStayRow>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadCcAccountStaysAction(account.kind, account.id);
      if (!active || !result.success) return;
      setEstadias(
        Object.fromEntries((result.data ?? []).map((r) => [r.movimiento_id, r]))
      );
    })();
    return () => {
      active = false;
    };
  }, [account.kind, account.id]);
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
                  {/* DOS pastillas y no una: facturada y cobrada son preguntas
                      distintas. La factura sale en el momento y la transferencia
                      llega a los treinta días, así que "facturada" nunca alcanzó
                      para saber qué reserva quedó sin cobrar. */}
                  {estadias[m.id] && <PastillasEstadia estadia={estadias[m.id]} />}
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

/**
 * Estado FISCAL de una estadía. Es la pregunta vieja —¿salió el comprobante?— y
 * sigue estando: lo que cambia es que ahora tiene al lado la otra, la de si se
 * cobró. El color repite el del control de facturación.
 */
const ESTADO_FISCAL: Record<CcStayEstado, { label: string; clase: string }> = {
  pendiente: { label: "Sin facturar", clase: "bg-rose-100 text-rose-700" },
  en_proceso: { label: "Factura en proceso", clase: "bg-amber-100 text-amber-700" },
  facturado: { label: "Facturada", clase: "bg-emerald-100 text-emerald-700" },
  facturado_consolidado: { label: "En consolidada", clase: "bg-teal-100 text-teal-700" },
  facturado_externo: { label: "Facturada afuera", clase: "bg-indigo-100 text-indigo-700" },
};

function PastillasEstadia({ estadia }: { estadia: CcAccountStayRow }) {
  const fiscal = ESTADO_FISCAL[estadia.estado];
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5" data-testid="pastillas-estadia">
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${fiscal.clase}`}
      >
        {fiscal.label}
      </span>
      <EstadoPagoTag
        estado={estadoPagoDeEstadia(estadia)}
        impTotal={estadia.imp_total}
        imputado={estadia.imputado}
      />
    </div>
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

/**
 * Recibo de cobranza de un pago a cuenta, con auto-impresión. Misma firma de ventana
 * que `openAccountVoucher`: los dos papeles salen por la misma comandera y con el
 * mismo ancho, así que abrirlos distinto sólo haría que uno saliera mal.
 */
function openPaymentReceipt(movementId: string) {
  if (typeof window === "undefined") return;
  window.open(
    `/admin/recibo-cc/${movementId}?autoprint=1`,
    `recibo-cc-${movementId}`,
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

/** Método del pago. El texto es libre en la base, así que lo desconocido se imprime tal cual. */
const METODO_LABEL: Record<string, string> = {
  cash: "Efectivo",
  bank_transfer: "Transferencia",
  mercado_pago: "Mercado Pago",
  credit_card: "Tarjeta de crédito",
  debit_card: "Tarjeta de débito",
  cheque: "Cheque",
  other: "Otro",
};

function metodoLabel(method: string | null): string {
  if (!method) return "Sin método";
  return METODO_LABEL[method] ?? method;
}

/**
 * Solapa "Pagos": los cobros del cliente con todo lo que la migración 109 puso en la
 * base y hasta ahora no se veía en ningún lado.
 *
 * Los pagos también están en Movimientos, pero ahí son una línea con un importe: no
 * dicen cuánto se retuvo, cuánto entró de verdad ni qué facturas quedaron pagas. Eso
 * es justo lo que pregunta la empresa que transfirió y lo que el contador necesita
 * para conciliar, y por eso tiene solapa propia en vez de una columna más.
 */
function SolapaPagos({ account }: { account: CtaCteAccount }) {
  const [loading, setLoading] = useState(true);
  const [pagos, setPagos] = useState<CcClientPaymentRow[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadClientPaymentsAction(account.kind, account.id);
      if (!active) return;
      if (result.success) {
        setPagos(result.data ?? []);
      } else {
        toast.error(result.error);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [account.kind, account.id]);

  /**
   * Relectura después de desimputar. Sin esto la fila seguiría viéndose viva y el
   * "quedaron a cuenta" mostraría el número viejo: el admin creería que la plata
   * sigue aplicada a una factura de la que ya la sacó.
   */
  const recargar = useCallback(async () => {
    const result = await loadClientPaymentsAction(account.kind, account.id);
    if (result.success) {
      setPagos(result.data ?? []);
    } else {
      toast.error(result.error);
    }
  }, [account.kind, account.id]);

  const { rows: pagina, setPage, ...paginacion } = usePagination(pagos);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6" data-testid="solapa-pagos">
        <div className="flex items-center justify-center text-slate-500 py-8">
          <Loader2 size={20} className="animate-spin mr-2" /> Cargando pagos…
        </div>
      </div>
    );
  }

  // Vacío explicado: que no haya pagos es información (puede deber todo), y el
  // empleado tiene que saber dónde se cargan.
  if (pagos.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6" data-testid="solapa-pagos">
        <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl">
          <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-600">
            Este cliente todavía no registró ningún pago a cuenta.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Los cobros se cargan con el botón <span className="font-bold">Pago</span> del
            listado de cuentas corrientes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="solapa-pagos">
      <div className="p-4 sm:p-6 space-y-3">
        {pagina.map((pago) => (
          <FilaPago key={pago.movimiento_id} pago={pago} onCambio={recargar} />
        ))}
      </div>
      <PaginationFooter {...paginacion} noun="pagos" onPageChange={setPage} />
    </div>
  );
}

function FilaPago({
  pago,
  onCambio,
}: {
  pago: CcClientPaymentRow;
  onCambio: () => Promise<void>;
}) {
  const retenciones = pago.retencion_ganancias + pago.retencion_iibb;
  // Qué imputación está esperando confirmación, y el motivo que se está tipeando. Una
  // sola a la vez a propósito: desimputar mueve plata, no es una casilla que se tilda
  // al pasar.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function desimputar(imp: CcPagoImputacion) {
    setGuardando(true);
    const result = await revertPaymentImputacionAction({
      imputacionId: imp.imputacion_id,
      motivo,
    });
    setGuardando(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    // Se dice cuánto quedó libre y no un "listo" pelado: lo que el admin necesita
    // saber ahora es con cuánta plata cuenta para la factura de reemplazo.
    toast.success(
      `Se desimputó ${formatAmount(result.data?.liberado ?? 0)}. Quedan ${formatAmount(
        result.data?.sinImputar ?? 0
      )} a cuenta.`
    );
    setConfirmando(null);
    setMotivo("");
    await onCambio();
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid="fila-pago">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">
            {new Date(pago.created_at).toLocaleDateString("es-AR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}{" "}
            · {metodoLabel(pago.payment_method)}
          </p>
          <p className="text-xs text-slate-500">
            Recibo N°{" "}
            {pago.recibo_cc_numero !== null ? (
              <span className="font-mono">{formatShiftCode(pago.recibo_cc_numero)}</span>
            ) : (
              "sin número"
            )}
            {pago.notes ? ` · ${pago.notes}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            {/* El importe grande es lo que CANCELA de deuda; el neto va abajo. El
                número con el que se concilia la cuenta corriente es éste. */}
            <p className="text-lg font-bold text-emerald-700">{formatAmount(pago.amount)}</p>
            <p className="text-[11px] text-slate-500">cancela de deuda</p>
          </div>
          <button
            type="button"
            onClick={() => openPaymentReceipt(pago.movimiento_id)}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="Reimprimir el recibo de cobranza"
            aria-label="Reimprimir el recibo de cobranza"
          >
            <Printer size={16} />
          </button>
        </div>
      </div>

      {/* Las retenciones, desglosadas. Sólo si las hubo: la enorme mayoría de los
          cobros no retiene nada y cuatro renglones en cero serían ruido. */}
      {retenciones > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs space-y-1">
          {pago.retencion_ganancias > 0 && (
            <p className="flex justify-between gap-3 text-slate-600">
              <span>Retención Ganancias</span>
              <span className="font-semibold">−{formatAmount(pago.retencion_ganancias)}</span>
            </p>
          )}
          {pago.retencion_iibb > 0 && (
            <p className="flex justify-between gap-3 text-slate-600">
              <span>Retención Ingresos Brutos</span>
              <span className="font-semibold">−{formatAmount(pago.retencion_iibb)}</span>
            </p>
          )}
          {pago.retencion_certificado && (
            <p className="flex justify-between gap-3 text-slate-500">
              <span>Certificado</span>
              <span className="font-mono">{pago.retencion_certificado}</span>
            </p>
          )}
          <p className="flex justify-between gap-3 text-slate-800 font-bold pt-1 border-t border-slate-200">
            <span>Neto recibido</span>
            <span>{formatAmount(pago.neto_recibido)}</span>
          </p>
        </div>
      )}

      <div className="mt-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Imputado a</p>
        {pago.imputaciones.length === 0 ? (
          // Un pago sin imputar no es un error: el cliente adelantó plata y la factura
          // sale después. Decirlo evita que alguien lo "arregle" imputándolo a
          // cualquier cosa.
          <p className="text-xs text-slate-500 mt-0.5">A cuenta, sin factura asignada.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {pago.imputaciones.map((imp) => (
              <li
                key={imp.imputacion_id}
                className="flex flex-wrap justify-between gap-2 text-xs text-slate-600"
              >
                <span>
                  {/* Una imputación revertida (mig 111) se muestra tachada y no se
                      esconde —un recibo reimpreso dice lo mismo que el día que
                      salió—, pero su importe ya NO cancela esta factura: esa plata
                      volvió a quedar disponible en el pago. */}
                  <span className={imp.revertida ? "line-through text-slate-400" : ""}>
                    Factura {cbteLetra(imp.cbte_tipo)}{" "}
                    {imp.cbte_nro !== null ? formatCbteNumero(imp.pto_vta, imp.cbte_nro) : "s/nro"}
                    {imp.cbte_fch ? ` · ${formatKey(imp.cbte_fch)}` : ""}
                  </span>
                  {/* La factura se anuló DESPUÉS del cobro: se informa, no se
                      esconde. El recibo impreso sigue diciendo lo mismo. */}
                  {imp.anulada && (
                    <span className="ml-1.5 text-[11px] font-bold text-red-600">(anulada)</span>
                  )}
                  {imp.revertida && (
                    <span className="ml-1.5 text-[11px] font-bold text-slate-500">
                      desimputada{imp.revertida_motivo ? `: ${imp.revertida_motivo}` : ""}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      imp.revertida
                        ? "font-semibold text-slate-400 line-through"
                        : "font-semibold text-slate-800"
                    }
                  >
                    {formatAmount(imp.imputado)}
                  </span>
                  {/* Sólo en las vivas: la RPC rechaza la segunda vuelta con P0040,
                      así que ofrecer el botón sería ofrecer un error. */}
                  {!imp.revertida && confirmando !== imp.imputacion_id && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmando(imp.imputacion_id);
                        setMotivo("");
                      }}
                      className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded transition-colors"
                      title="Desimputar: esta plata deja de cancelar esta factura y vuelve a quedar a cuenta"
                      aria-label="Desimputar"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </span>
                {confirmando === imp.imputacion_id && (
                  <div className="w-full mt-1 p-3 rounded-lg border border-amber-200 bg-amber-50">
                    <p className="text-xs font-semibold text-amber-900">
                      Se van a soltar {formatAmount(imp.imputado)}: esta factura deja de
                      estar cobrada por este pago y ese importe vuelve a quedar a cuenta.
                    </p>
                    <input
                      type="text"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Por qué se desimputa (obligatorio)"
                      className="mt-2 w-full px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={guardando || motivo.trim() === ""}
                        onClick={() => desimputar(imp)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        {guardando && <Loader2 size={14} className="animate-spin" />}
                        Confirmar
                      </button>
                      <button
                        type="button"
                        disabled={guardando}
                        onClick={() => {
                          setConfirmando(null);
                          setMotivo("");
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-300 hover:bg-white rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {pago.sin_imputar > 0 && pago.imputaciones.length > 0 && (
          <p className="text-xs font-semibold text-amber-600 mt-1">
            {formatAmount(pago.sin_imputar)} quedaron a cuenta, sin factura.
          </p>
        )}
      </div>
    </div>
  );
}
