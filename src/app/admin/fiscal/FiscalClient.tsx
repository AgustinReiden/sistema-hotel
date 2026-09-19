"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardCheck,
  FileMinus,
  FileText,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  discardInvoiceAction,
  emitCreditNoteAction,
  fixInvoiceDniAndRetryAction,
  retryInvoiceAction,
} from "./actions";
import InvoicePromptModal, { type InvoicePromptData } from "../InvoicePromptModal";
import DateRangeFilter from "../DateRangeFilter";
import DownloadCsvButton from "../DownloadCsvButton";
import PaginationFooter from "../PaginationFooter";
import { usePagination } from "../usePagination";
import { cbteLetra, cbteNombre, formatCbteNumero, isNotaCredito, isValidCuit } from "@/lib/arca/amounts";
import { AUTHORIZED_INVOICES_LIMIT } from "@/lib/billing";
import { buildCsv, type CsvColumn } from "@/lib/csv";
import { buildBillingPresets } from "@/lib/date-range";
import { formatHotelShortDateTime } from "@/lib/time";
import { FISCAL_VIEWS, type FiscalView } from "./views";
import type {
  AuthorizedInvoiceRow,
  EmitInvoiceOutcome,
  InvoiceableCheckoutRow,
  PendingInvoiceRow,
} from "@/lib/types";

type Props = {
  enabled: boolean;
  pending: PendingInvoiceRow[];
  invoiceable: InvoiceableCheckoutRow[];
  authorized: AuthorizedInvoiceRow[];
  from: string;
  to: string;
  today: string;
  /**
   * Los check-outs sin facturar son del administrador. El recepcionista acá sólo
   * ve —y reintenta— las facturas que no salieron por ARCA o por la red, y sólo
   * mientras su turno esté abierto (el gate real vive en las RPC del listado).
   * Decisión de Agustín, 18/09/2026.
   */
  isAdmin: boolean;
  /** Solapa activa. Viaja en la URL como ?view=; la resuelve el servidor. */
  view: FiscalView;
  /** Filtro de tipo de comprobante de "Emitidas" ("" = todos). Viaja como ?tipo=. */
  tipo: string;
  /** Búsqueda de "Emitidas" (CUIT/DNI, número o nombre). Viaja como ?q=. */
  q: string;
};

function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Los cuatro comprobantes que emite el sistema. El nombre y la letra de cada uno
// salen de cbteNombre/cbteLetra (src/lib/arca/amounts.ts): no se repite ese mapeo acá.
const CBTE_TIPO_FILTROS = [1, 6, 3, 8];

/** Sin tildes ni mayúsculas: nadie busca "López" con tilde cuando está apurado. */
function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Un comprobante matchea si el texto buscado aparece en el CUIT/DNI (comparando
 * sólo dígitos, así "30712345678" encuentra a "30-71234567-8"), en el número de
 * comprobante, o en el nombre del receptor (sin tildes ni mayúsculas).
 */
function matchesBusqueda(row: AuthorizedInvoiceRow, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos && (row.doc_nro ?? "").replace(/\D/g, "").includes(digitos)) return true;
  if (digitos && String(row.cbte_nro).includes(digitos)) return true;
  return normalizarTexto(row.receptor_nombre ?? "").includes(normalizarTexto(q));
}

// Libro de IVA ventas del período: una fila por comprobante autorizado, tal como
// se ve en "Emitidas recientes".
const AUTHORIZED_CSV_COLUMNS: CsvColumn<AuthorizedInvoiceRow>[] = [
  { header: "Fecha", type: "fecha", value: (r) => r.cbte_fch ?? "" },
  { header: "Tipo", type: "plano", value: (r) => cbteNombre(r.cbte_tipo) },
  { header: "Letra", type: "plano", value: (r) => cbteLetra(r.cbte_tipo) },
  { header: "Punto de venta", type: "plano", value: (r) => r.pto_vta },
  { header: "Número", type: "plano", value: (r) => r.cbte_nro },
  { header: "Receptor", type: "texto", value: (r) => r.receptor_nombre ?? "" },
  { header: "CUIT/DNI", type: "documento", value: (r) => r.doc_nro ?? "" },
  { header: "Neto", type: "monto", value: (r) => r.imp_neto },
  { header: "IVA", type: "monto", value: (r) => r.imp_iva },
  { header: "Total", type: "monto", value: (r) => r.imp_total },
  { header: "Anulada", type: "plano", value: (r) => (r.anulada_at !== null ? "Sí" : "No") },
];

function openInvoicePrint(invoiceId: string, autoprint = true) {
  window.open(
    `/admin/factura/${invoiceId}${autoprint ? "?autoprint=1" : ""}`,
    `factura-${invoiceId}`,
    "width=420,height=720"
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente de ARCA",
  processing: "En verificación",
  rejected: "Rechazada",
};

export default function FiscalClient({
  enabled,
  pending,
  invoiceable,
  authorized,
  from,
  to,
  today,
  isAdmin,
  view,
  tipo,
  q,
}: Props) {
  const router = useRouter();
  const presets = buildBillingPresets(today);

  // La búsqueda de texto es la única que NO navega: escribir letra por letra no
  // puede disparar una vuelta al servidor por cada tecla (page.tsx es
  // force-dynamic). Se filtra en memoria y se refleja en la URL con
  // history.replaceState (ver actualizarQ), sin pasar por el router. `tipo` sí
  // navega: es un cambio discreto, igual que el rango de fechas o la solapa.
  const [qFiltro, setQFiltro] = useState(q);

  // Una paginacion por solapa: son tres listados distintos, cada uno con la suya.
  // El CSV de "Emitidas" sigue leyendo lo filtrado entero, no la pagina.
  //
  // `view` va en el resetKey: cambiar de solapa no desmonta este componente (es la
  // misma ruta con otro querystring), asi que sin eso la solapa nueva se abriria en la
  // pagina 7 de la anterior, muchas veces vacia.
  const pendingPage = usePagination(pending, view);
  const invoiceablePage = usePagination(invoiceable, view);

  // El tipo y la búsqueda se aplican en el cliente, sobre las filas que ya trajo
  // listAuthorizedInvoices para el rango elegido: no hay una consulta nueva por
  // cada letra tipeada ni por cada tipo elegido.
  const authorizedFiltered = useMemo(() => {
    const tipoNum = tipo ? Number(tipo) : null;
    return authorized.filter(
      (a) => (tipoNum === null || a.cbte_tipo === tipoNum) && matchesBusqueda(a, qFiltro)
    );
  }, [authorized, tipo, qFiltro]);

  const authorizedPage = usePagination(authorizedFiltered, `${view}|${from}|${to}|${tipo}|${qFiltro}`);

  // El listado llego al tope: puede haber comprobantes del periodo que no estan ni
  // en la pantalla ni en el CSV. Se avisa, porque ese CSV es el libro de IVA ventas.
  // Es sobre lo que trajo el servidor, no sobre lo filtrado: el tope es del período,
  // no del filtro.
  const authorizedTruncado = authorized.length >= AUTHORIZED_INVOICES_LIMIT;

  // El rango, el tipo y la búsqueda son de la solapa "Emitidas", pero se navega con
  // los cuatro: sin `view` la vuelta caeria en la solapa por defecto, y perder el
  // tipo o la búsqueda al cambiar de fecha haría parecer que el filtro se rompió.
  const applyRange = (desde: string, hasta: string) => {
    const params = new URLSearchParams({ view, desde, hasta });
    if (tipo) params.set("tipo", tipo);
    if (qFiltro) params.set("q", qFiltro);
    router.push(`/admin/fiscal?${params.toString()}`);
  };

  const applyTipo = (nextTipo: string) => {
    const params = new URLSearchParams({ view });
    if (from) params.set("desde", from);
    if (to) params.set("hasta", to);
    if (nextTipo) params.set("tipo", nextTipo);
    if (qFiltro) params.set("q", qFiltro);
    router.push(`/admin/fiscal?${params.toString()}`);
  };

  // Sólo actualiza la URL visible (para que se pueda copiar el link con el filtro
  // puesto); no navega, así que no dispara ni una consulta ni un remount.
  const actualizarQ = (nextQ: string) => {
    setQFiltro(nextQ);
    const params = new URLSearchParams({ view });
    if (from) params.set("desde", from);
    if (to) params.set("hasta", to);
    if (tipo) params.set("tipo", tipo);
    if (nextQ) params.set("q", nextQ);
    window.history.replaceState(null, "", `/admin/fiscal?${params.toString()}`);
  };

  // El periodo, el tipo y la búsqueda eligidos sobreviven al cambio de solapa.
  const buildHref = (nextView: FiscalView) => {
    const params = new URLSearchParams({ view: nextView });
    if (from) params.set("desde", from);
    if (to) params.set("hasta", to);
    if (tipo) params.set("tipo", tipo);
    if (qFiltro) params.set("q", qFiltro);
    return `/admin/fiscal?${params.toString()}`;
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  // Mini-form de "Corregir DNI" abierto para una factura puntual.
  const [dniEditId, setDniEditId] = useState<string | null>(null);
  const [dniValue, setDniValue] = useState("");
  // Modal A/B para emitir un check-out sin facturar (empresa o consumidor final).
  const [invoicePrompt, setInvoicePrompt] = useState<InvoicePromptData | null>(null);
  // Comprobante que se va a anular con nota de crédito (confirmación previa).
  const [ncTarget, setNcTarget] = useState<AuthorizedInvoiceRow | null>(null);

  const handleOutcome = (outcome: EmitInvoiceOutcome) => {
    if (outcome.status === "authorized") {
      toast.success(outcome.userMessage);
      if (outcome.invoiceId) openInvoicePrint(outcome.invoiceId);
    } else if (outcome.status === "rejected") {
      toast.error(outcome.userMessage, { duration: 9000 });
    } else {
      toast.warning(outcome.userMessage, { duration: 9000 });
    }
    router.refresh();
  };

  const retry = async (invoiceId: string) => {
    setBusyId(invoiceId);
    const result = await retryInvoiceAction(invoiceId);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    handleOutcome(result.data!);
  };

  // Nota de crédito: anula el comprobante y libera la estadía para re-facturar.
  const emitCreditNote = async (target: AuthorizedInvoiceRow) => {
    setBusyId(target.invoice_id);
    const result = await emitCreditNoteAction(target.invoice_id);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error, { duration: 9000 });
      return;
    }
    setNcTarget(null);
    handleOutcome(result.data!);
  };

  // Abre el modal A/B para un check-out sin facturar. El CUIT (si la reserva es de
  // empresa) llega en client_dni; la condición IVA la elige el que factura.
  const openEmitModal = (c: InvoiceableCheckoutRow) => {
    const dniDigits = (c.client_dni ?? "").replace(/\D/g, "");
    const isCuit = isValidCuit(dniDigits);
    setInvoicePrompt({
      reservationId: c.reservation_id,
      clientName: c.client_name,
      clientDni: c.client_dni,
      total: c.total_price,
      aPrefill: {
        razonSocial: c.client_name ?? "",
        cuit: isCuit ? dniDigits : "",
        condicionIva: "",
        domicilio: "",
      },
      suggestA: isCuit,
    });
  };

  const fixDni = async (invoiceId: string, reservationId: string) => {
    const digits = dniValue.replace(/\D/g, "");
    if (digits.length !== 7 && digits.length !== 8) {
      toast.error("El DNI tiene que tener 7 u 8 dígitos.");
      return;
    }
    setBusyId(invoiceId);
    const result = await fixInvoiceDniAndRetryAction(invoiceId, reservationId, digits);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setDniEditId(null);
    setDniValue("");
    handleOutcome(result.data!);
  };

  const discard = async (invoiceId: string) => {
    if (!confirm("¿Descartar esta factura? La reserva vuelve a quedar disponible para facturar más tarde.")) {
      return;
    }
    setBusyId(invoiceId);
    const result = await discardInvoiceAction(invoiceId);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Factura descartada. La reserva volvió a quedar facturable.");
    router.refresh();
  };

  if (!enabled) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500">
        <FileText size={32} className="mx-auto mb-3 text-slate-300" />
        <p className="font-semibold">La facturación electrónica no está habilitada.</p>
        <p className="text-sm mt-1">
          Un administrador puede configurarla en Ajustes → Facturación electrónica (ARCA).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Solapas. El recepcionista ve una sola lista: una sola solapa no es una solapa,
          asi que no se le pinta la barra (ver el gate `isAdmin` en Props). */}
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {FISCAL_VIEWS.map((v) => {
            const isActive = view === v.value;
            return (
              <a
                key={v.value}
                href={buildHref(v.value)}
                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                  isActive
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                }`}
              >
                {v.label}
              </a>
            );
          })}
        </div>
      )}

      {/* Pendientes / con error */}
      {view === "pendientes" && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-base font-bold text-slate-800">Pendientes y con error</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Facturas que no llegaron a emitirse (ARCA caído, DNI inválido, etc.). Reintentá cuando
              esté resuelto.
            </p>
          </div>
          <div className="p-5">
            {pending.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-2">Sin facturas pendientes 🎉</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pendingPage.rows.map((p) => {
                  const canEdit = p.status === "rejected" || p.status === "pending";
                  // Una consolidada no cuelga de una reserva: no hay DNI que corregir.
                  // El const local mantiene el narrowing dentro de los callbacks.
                  const reservationId = p.reservation_id;
                  const canFixDni = canEdit && reservationId !== null;
                  const isConsolidada = reservationId === null;
                  const editing = dniEditId === p.invoice_id;
                  return (
                    <li key={p.invoice_id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate">
                            {isConsolidada ? "Consolidada" : `Hab. ${p.room_number}`} —{" "}
                            {p.receptor_nombre ?? "Sin nombre"} — ${money(p.imp_total)}
                          </p>
                          <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                            {STATUS_LABEL[p.status] ?? p.status}
                            {p.attempt_count > 0 && ` · ${p.attempt_count} intento${p.attempt_count === 1 ? "" : "s"}`}
                            {p.last_error && ` · ${p.last_error}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {canFixDni && (
                            <button
                              type="button"
                              onClick={() => {
                                setDniEditId(editing ? null : p.invoice_id);
                                setDniValue("");
                              }}
                              disabled={busyId !== null}
                              className="px-3 py-2 border border-slate-300 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors flex items-center gap-1.5"
                            >
                              <Pencil size={13} />
                              Corregir DNI
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => retry(p.invoice_id)}
                            disabled={busyId !== null}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                          >
                            {busyId === p.invoice_id && !editing ? (
                              <Loader2 className="animate-spin" size={14} />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                            Reintentar
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => discard(p.invoice_id)}
                              disabled={busyId !== null}
                              title="Descartar la factura"
                              className="p-2 border border-slate-200 text-slate-400 rounded-lg hover:border-rose-300 hover:text-rose-600 disabled:opacity-60 transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                      {editing && reservationId !== null && (
                        <div className="mt-3 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={dniValue}
                            onChange={(e) => setDniValue(e.target.value.replace(/\D/g, "").slice(0, 8))}
                            placeholder="DNI del huésped (7 u 8 dígitos)"
                            autoFocus
                            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm font-medium"
                          />
                          <button
                            type="button"
                            onClick={() => fixDni(p.invoice_id, reservationId)}
                            disabled={busyId !== null}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                          >
                            {busyId === p.invoice_id ? <Loader2 className="animate-spin" size={14} /> : null}
                            Corregir y reintentar
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <PaginationFooter
              page={pendingPage.page}
              totalPages={pendingPage.totalPages}
              total={pendingPage.total}
              firstIndex={pendingPage.firstIndex}
              lastIndex={pendingPage.lastIndex}
              noun="pendientes"
              onPageChange={pendingPage.setPage}
            />
          </div>
        </section>
      )}

      {/* Decirlo en vez de dejar un hueco: el que no lo ve tiene que saber que existe
          y a quién pedírselo, no quedarse buscando una lista que no está. */}
      {!isAdmin && (
        <p className="text-xs text-slate-400 bg-white border border-slate-200 rounded-2xl p-4">
          Las estadías que quedaron sin facturar las ve el administrador. Vos facturás en
          el check-out; si ARCA o la red fallan, la factura te queda acá arriba para
          reintentarla mientras tu turno esté abierto.
        </p>
      )}

      {/* Check-outs sin facturar. Sólo el administrador: el recepcionista factura en
          el check-out, y si algo falla lo reintenta arriba. Ver el comentario de
          `isAdmin` en Props. */}
      {isAdmin && view === "sin_facturar" && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Este bloque NO es la lista de todo lo que falta facturar: la RPC lo
              recorta a los últimos 10 días y además sólo trae clientes que facturan
              por check-out. Decirlo importa — leído como la lista completa, hace
              creer que no quedó nada. La lista entera vive en el control de
              facturación, a un link de acá.
              Ver docs/solapamiento-cuentas-facturacion.md. */}
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-800">Check-outs sin facturar</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Las salidas de los <strong>últimos 10 días</strong> que nadie facturó.
                  Emitirlas desde acá es cosa del administrador: revisá bien a nombre de
                  quién sale antes de confirmar.
                </p>
              </div>
              <Link
                href="/admin/fiscal/control?estado=pendiente"
                className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
              >
                <ClipboardCheck size={14} /> Ver todo lo que falta facturar
              </Link>
            </div>
          </div>
          <div className="p-5">
            {invoiceable.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-2">
                No hay check-outs sin facturar en los últimos 10 días.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {invoiceablePage.rows.map((c) => (
                  <li key={c.reservation_id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">
                        Hab. {c.room_number} — {c.client_name} — ${money(c.total_price)}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Check-out: {formatHotelShortDateTime(c.actual_check_out)}
                        {c.client_dni ? ` · DNI ${c.client_dni}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEmitModal(c)}
                      disabled={busyId !== null}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2 shrink-0"
                    >
                      <FileText size={14} />
                      Emitir factura
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <PaginationFooter
              page={invoiceablePage.page}
              totalPages={invoiceablePage.totalPages}
              total={invoiceablePage.total}
              firstIndex={invoiceablePage.firstIndex}
              lastIndex={invoiceablePage.lastIndex}
              noun="estadías"
              onPageChange={invoiceablePage.setPage}
            />
          </div>
        </section>
      )}

      {/* Emitidas recientes */}
      {view === "emitidas" && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">Emitidas</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Reimprimí la representación con QR. Si una factura salió mal, anulala con nota de
                  crédito y volvé a emitirla. Es el libro de IVA ventas del período elegido.
                </p>
              </div>
              {/* Baja TODO lo filtrado (tipo + búsqueda + rango), no la página que se
                  está viendo: es el libro de IVA ventas, y un recorte silencioso ahí
                  es el peor modo de falla de esta pantalla. */}
              <DownloadCsvButton
                filename={`facturas_${from}_a_${to}.csv`}
                build={() => buildCsv(AUTHORIZED_CSV_COLUMNS, authorizedFiltered)}
                label="Exportar a Excel (todo lo filtrado)"
              />
            </div>
            {authorizedTruncado && (
              <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Este período tiene más de {AUTHORIZED_INVOICES_LIMIT} comprobantes y se está mostrando
                sólo esa cantidad. El CSV baja lo mismo que ves, así que para el libro de IVA ventas
                partí el período en rangos más cortos.
              </p>
            )}
            <DateRangeFilter from={from} to={to} presets={presets} onChange={applyRange} />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="fiscal-tipo">
                  Tipo de comprobante
                </label>
                <select
                  id="fiscal-tipo"
                  value={tipo}
                  onChange={(e) => applyTipo(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
                >
                  <option value="">Todos los tipos</option>
                  {CBTE_TIPO_FILTROS.map((t) => (
                    <option key={t} value={String(t)}>
                      {cbteNombre(t)} {cbteLetra(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relative flex-1 min-w-[240px]">
                <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="fiscal-q">
                  Buscar
                </label>
                <Search
                  size={15}
                  className="absolute left-3 top-[calc(50%+9px)] -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  id="fiscal-q"
                  type="text"
                  value={qFiltro}
                  onChange={(e) => actualizarQ(e.target.value)}
                  placeholder="CUIT/DNI, número de comprobante o nombre…"
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
                />
              </div>
            </div>
          </div>
          <div className="p-5">
            {authorized.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-2">Todavía no hay facturas emitidas.</p>
            ) : authorizedFiltered.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-2">
                Ningún comprobante coincide con el filtro.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {authorizedPage.rows.map((a) => {
                  const esNc = isNotaCredito(a.cbte_tipo);
                  const anulada = a.anulada_at !== null;
                  return (
                    <li key={a.invoice_id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800 truncate">
                          {cbteNombre(a.cbte_tipo)} {cbteLetra(a.cbte_tipo)}{" "}
                          {formatCbteNumero(a.pto_vta, a.cbte_nro)} —{" "}
                          {a.receptor_nombre ?? "Sin nombre"} — ${money(a.imp_total)}
                        </p>
                        {anulada && (
                          <p className="text-[11px] font-bold text-rose-600 mt-0.5">
                            ANULADA por nota de crédito
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!esNc && !anulada && (
                          <button
                            type="button"
                            onClick={() => setNcTarget(a)}
                            disabled={busyId !== null}
                            className="px-3 py-2 border border-rose-200 text-rose-700 text-sm font-bold rounded-lg hover:bg-rose-50 disabled:opacity-60 transition-colors flex items-center gap-1.5"
                            title="Anular con nota de crédito"
                          >
                            <FileMinus size={14} />
                            Nota de crédito
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openInvoicePrint(a.invoice_id)}
                          className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
                        >
                          <Printer size={14} />
                          Reimprimir
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <PaginationFooter
              page={authorizedPage.page}
              totalPages={authorizedPage.totalPages}
              total={authorizedPage.total}
              firstIndex={authorizedPage.firstIndex}
              lastIndex={authorizedPage.lastIndex}
              noun="comprobantes"
              onPageChange={authorizedPage.setPage}
            />
          </div>
        </section>
      )}

      {/* Confirmación de nota de crédito: es irreversible y genera un 3er papel. */}
      {ncTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full p-6 overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]">
            <div className="flex items-center gap-2 mb-3">
              <FileMinus size={20} className="text-rose-600" />
              <h3 className="text-lg font-black text-slate-800">Anular con nota de crédito</h3>
            </div>
            <p className="text-sm text-slate-600">
              Se va a emitir una <strong>nota de crédito {cbteLetra(ncTarget.cbte_tipo)}</strong> que
              anula la {cbteNombre(ncTarget.cbte_tipo).toLowerCase()}{" "}
              <strong>
                {cbteLetra(ncTarget.cbte_tipo)} {formatCbteNumero(ncTarget.pto_vta, ncTarget.cbte_nro)}
              </strong>{" "}
              de ${money(ncTarget.imp_total)}.
            </p>
            <ul className="text-xs text-slate-500 mt-3 space-y-1 list-disc pl-4">
              <li>La factura original NO se borra: AFIP conserva las dos.</li>
              <li>Después vas a poder volver a emitir la factura correcta.</li>
              <li>Es sólo fiscal: no devuelve plata ni toca la caja.</li>
            </ul>
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => setNcTarget(null)}
                disabled={busyId !== null}
                className="flex-1 py-3 border-2 border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => emitCreditNote(ncTarget)}
                disabled={busyId !== null}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {busyId === ncTarget.invoice_id ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <FileMinus size={16} />
                )}
                Emitir nota de crédito
              </button>
            </div>
          </div>
        </div>
      )}

      <InvoicePromptModal
        key={invoicePrompt?.reservationId ?? "none"}
        data={invoicePrompt}
        startAtTipo
        onClose={() => {
          setInvoicePrompt(null);
          router.refresh();
        }}
      />
    </div>
  );
}
