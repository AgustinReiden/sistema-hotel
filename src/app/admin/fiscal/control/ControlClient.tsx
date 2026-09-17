"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Eye, FileText, Layers, Loader2, Printer, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import InvoicePromptModal, { type InvoicePromptData } from "../../InvoicePromptModal";
import ClientFilter from "./ClientFilter";
import DateRangeFilter from "../../DateRangeFilter";
import DownloadCsvButton from "../../DownloadCsvButton";
import StickyActionBar from "../../StickyActionBar";
import {
  markInvoicedExternallyBulkAction,
  unmarkInvoicedExternallyBulkAction,
  type BulkActionResult,
} from "./actions";
import {
  BILLING_CIERRE_LABEL,
  BILLING_ESTADO_MATIZ,
  BILLING_GRUPO_LABEL,
  billingComprobante,
  billingGrupo,
  bulkBillingAction,
} from "@/lib/billing";
import { billingControlCsvFilename, buildBillingControlCsv } from "@/lib/csv";
import { buildBillingPresets } from "@/lib/date-range";
import type { BillingControlEstado, BillingControlRow, CtaCteAccount } from "@/lib/types";
import type { BillingGrupo } from "@/lib/billing";

type Props = {
  rows: BillingControlRow[];
  accounts: CtaCteAccount[];
  from: string;
  to: string;
  cliente: string;
  estado: string;
  /** "Hoy" en la zona del hotel, resuelto en el server (ver page.tsx). */
  todayKey: string;
};

function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

/** Cómo se describe una estadía cuando hay que enumerarlas (confirmación y errores). */
function describeRow(r: BillingControlRow) {
  return `Hab. ${r.room_number} · ${shortDate(r.fch_desde)} → ${shortDate(r.fch_hasta)}`;
}

/** El color es de la pantalla; el texto se comparte con el CSV (ver lib/billing.ts). */
const ESTADO_CLASS: Record<BillingControlEstado, string> = {
  facturado: "bg-emerald-100 text-emerald-700",
  facturado_consolidado: "bg-teal-100 text-teal-700",
  facturado_externo: "bg-indigo-100 text-indigo-700",
  en_proceso: "bg-amber-100 text-amber-700",
  pendiente_consolidada: "bg-sky-100 text-sky-700",
  no_corresponde: "bg-slate-100 text-slate-500",
  falta: "bg-rose-100 text-rose-700",
};

const GRUPOS: BillingGrupo[] = ["pendiente", "facturado"];

/**
 * Texto del chip de estado. El grupo es lo que se lee de un vistazo; el estado
 * fino baja a la etiqueta de al lado (ver BILLING_ESTADO_MATIZ). La excepción es
 * `no_corresponde`: cae del lado "facturado" para el filtro, pero decirle
 * "Facturado" sería falso, así que lleva su propio texto.
 */
function chipEstado(estado: BillingControlEstado): string {
  if (estado === "no_corresponde") return "No corresponde";
  return billingGrupo(estado) === "pendiente" ? "Pendiente" : "Facturado";
}

/**
 * Reimpresión: abre el comprobante en una ventana chica que se imprime sola y se
 * cierra (?autoprint=1). Mismo camino que usa /admin/fiscal, así el papel sale
 * igual desde las dos pantallas.
 */
function openInvoicePrint(invoiceId: string) {
  window.open(`/admin/factura/${invoiceId}?autoprint=1`, `factura-${invoiceId}`, "width=420,height=720");
}

const inputClass =
  "px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm";

export default function ControlClient({
  rows,
  accounts,
  from,
  to,
  cliente,
  estado,
  todayKey,
}: Props) {
  const router = useRouter();
  const [invoicePrompt, setInvoicePrompt] = useState<InvoicePromptData | null>(null);
  // Marca "ya se facturó afuera": siempre con confirmación, porque afirma un hecho
  // fiscal que el sistema no puede verificar contra ARCA. Es una lista y no una fila
  // suelta porque el mismo modal sirve para el lote; una sola fila viaja como [fila].
  const [externalTargets, setExternalTargets] = useState<BillingControlRow[] | null>(null);
  const [externalRef, setExternalRef] = useState("");
  const [externalFecha, setExternalFecha] = useState("");
  const [externalNotes, setExternalNotes] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Ancla del shift+click: índice dentro de `visible` de la última fila clickeada.
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);

  const busy = busyId !== null || bulkBusy;

  const counts = useMemo(() => {
    const map: Record<BillingGrupo, number> = { pendiente: 0, facturado: 0 };
    for (const r of rows) map[billingGrupo(r.estado)] += 1;
    return map;
  }, [rows]);

  // `estado` en la URL ya no es un estado fino sino un grupo ("pendiente" |
  // "facturado"). Un valor viejo o inventado no filtra nada: se muestra todo, que
  // es el default seguro — nunca esconder filas por un parámetro que no se entiende.
  const grupoFiltrado: BillingGrupo | null =
    estado === "pendiente" || estado === "facturado" ? estado : null;

  const visible = useMemo(
    () => (grupoFiltrado ? rows.filter((r) => billingGrupo(r.estado) === grupoFiltrado) : rows),
    [rows, grupoFiltrado]
  );

  /**
   * La selección efectiva se deriva SIEMPRE intersecando con lo que está en
   * pantalla. Así una fila que salió del filtro no puede quedar seleccionada de
   * forma invisible: sobre un hecho fiscal irreversible, el empleado tiene que
   * estar viendo exactamente aquello sobre lo que actúa.
   */
  const selectedRows = useMemo(
    () => visible.filter((r) => selectedIds.has(r.reservation_id)),
    [visible, selectedIds]
  );

  const clearSelection = () => {
    setSelectedIds(new Set());
    setAnchorIndex(null);
  };

  /**
   * ÚNICO camino de toggle de una fila. Lo dispara el onClick del <tr>, así que
   * vale tanto el click sobre el checkbox como sobre cualquier parte de la fila,
   * y también el Espacio del teclado (el navegador sintetiza un click que burbujea).
   */
  const toggleRow = (index: number, shiftKey: boolean) => {
    const row = visible[index];
    if (!row) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchorIndex !== null && anchorIndex < visible.length) {
        // Shift+click EXTIENDE: agrega el rango, nunca deselecciona. Sobre una
        // acción irreversible, el gesto ambiguo siempre tiene que sumar de menos.
        const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        for (let i = lo; i <= hi; i++) next.add(visible[i].reservation_id);
        return next;
      }
      if (next.has(row.reservation_id)) next.delete(row.reservation_id);
      else next.add(row.reservation_id);
      return next;
    });
    setAnchorIndex(index);
  };

  const handleRowClick = (index: number, event: React.MouseEvent) => {
    // Sin esto, el shift+click deja al navegador pintando texto de punta a punta.
    if (event.shiftKey) window.getSelection()?.removeAllRanges();
    toggleRow(index, event.shiftKey);
  };

  const allSelected = visible.length > 0 && selectedRows.length === visible.length;
  const someSelected = selectedRows.length > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) clearSelection();
    else setSelectedIds(new Set(visible.map((r) => r.reservation_id)));
  };

  const openExternalModal = (targets: BillingControlRow[]) => {
    if (targets.length === 0) return;
    setExternalTargets(targets);
    setExternalRef("");
    // Una sola estadía: la fecha de salida es el default razonable. En lote las
    // fechas difieren entre sí, así que no se inventa ninguna (el campo es opcional).
    setExternalFecha(targets.length === 1 ? targets[0].fch_hasta : "");
    setExternalNotes("");
  };

  /**
   * Reporta el resultado de un lote y devuelve si algo entró. Nunca un "listo" a
   * secas cuando algo falló: el empleado tiene que enterarse de qué estadías
   * siguen pendientes, y con qué nombre buscarlas.
   */
  const reportBulk = (
    result: BulkActionResult,
    targets: BillingControlRow[],
    exito: string
  ): boolean => {
    const total = targets.length;

    if (result.failed.length === 0) {
      toast.success(total === 1 ? exito : `${exito} (${total} estadías).`);
      return true;
    }

    const byId = new Map(targets.map((r) => [r.reservation_id, r]));
    const detalle = result.failed
      .map((f) => {
        const row = byId.get(f.id);
        return `${row ? describeRow(row) : f.id}: ${f.error}`;
      })
      .join(" · ");

    toast.error(
      `Se registraron ${result.ok.length} de ${total}. Fallaron ${result.failed.length}: ${detalle}`,
      { duration: 12000 }
    );
    return result.ok.length > 0;
  };

  const confirmExternal = async () => {
    const targets = externalTargets;
    if (!targets || targets.length === 0) return;
    if (!externalRef.trim()) {
      toast.error("Indicá con qué comprobante se facturó.");
      return;
    }

    setBulkBusy(true);
    const result = await markInvoicedExternallyBulkAction(
      targets.map((r) => r.reservation_id),
      externalRef.trim(),
      externalFecha || undefined,
      externalNotes.trim() || undefined
    );
    setBulkBusy(false);

    // Si no entró ninguna, el modal queda abierto con los datos cargados para
    // reintentar: perder lo tipeado sería castigar al empleado por un error ajeno.
    if (!reportBulk(result, targets, "Registrado como facturado por fuera del sistema.")) return;

    setExternalTargets(null);
    clearSelection();
    router.refresh();
  };

  const undoExternal = async (targets: BillingControlRow[]) => {
    if (targets.length === 0) return;
    if (targets.length === 1) setBusyId(targets[0].reservation_id);
    else setBulkBusy(true);

    const result = await unmarkInvoicedExternallyBulkAction(targets.map((r) => r.reservation_id));
    setBusyId(null);
    setBulkBusy(false);

    if (!reportBulk(result, targets, "Marca deshecha: vuelve a figurar como pendiente.")) return;

    clearSelection();
    router.refresh();
  };

  const applyFilters = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ desde: from, hasta: to, cliente, estado, ...patch });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    router.push(`/admin/fiscal/control?${params.toString()}`);
  };

  // "Facturar ahora" para una estadía suelta: mismo modal A/B del check-out.
  const openEmitModal = (r: BillingControlRow) => {
    setInvoicePrompt({
      reservationId: r.reservation_id,
      clientName: r.client_name,
      total: r.total_price,
      aPrefill: { razonSocial: r.cliente, cuit: "", condicionIva: "", domicilio: "" },
      suggestA: r.client_kind === "company",
    });
  };

  const accionLote = bulkBillingAction(selectedRows);
  const n = selectedRows.length;

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
        <DateRangeFilter
          from={from}
          to={to}
          presets={buildBillingPresets(todayKey)}
          onChange={(desde, hasta) => applyFilters({ desde, hasta })}
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-[260px]">
            <ClientFilter
              accounts={accounts}
              value={cliente}
              onChange={(v) => applyFilters({ cliente: v })}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="control-estado">
              Estado
            </label>
            <select
              id="control-estado"
              value={grupoFiltrado ?? ""}
              onChange={(e) => applyFilters({ estado: e.target.value })}
              className={inputClass}
            >
              <option value="">Todos</option>
              {GRUPOS.map((g) => (
                <option key={g} value={g}>
                  {BILLING_GRUPO_LABEL[g]}
                </option>
              ))}
            </select>
          </div>

          {/* Baja EXACTAMENTE lo que está en pantalla, armado en memoria sobre las
              mismas filas: el archivo no puede decir algo distinto del listado. */}
          <DownloadCsvButton
            filename={billingControlCsvFilename(from, to)}
            build={() => buildBillingControlCsv(visible)}
            label="Exportar a Excel"
            className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          />

          <Link
            href="/admin/fiscal/consolidada"
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors"
          >
            <Layers size={16} /> Factura consolidada
          </Link>
        </div>
      </section>

      {/* Contadores: los mismos dos grupos del filtro, y clickeables. */}
      <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
        {GRUPOS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => applyFilters({ estado: grupoFiltrado === g ? "" : g })}
            className={`px-3 py-1 rounded-full transition-opacity ${
              g === "pendiente" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
            } ${grupoFiltrado && grupoFiltrado !== g ? "opacity-40" : ""}`}
          >
            {BILLING_GRUPO_LABEL[g]}: {counts[g]}
          </button>
        ))}
        <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600">
          Total: {rows.length}
        </span>
      </div>

      {/* Tabla */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th
                  className="px-3 py-2.5 w-10"
                  onClick={() => {
                    if (visible.length > 0) toggleAll();
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todo lo que se ve"
                    checked={allSelected}
                    // Controlado por el onClick del <th>: un solo camino de toggle.
                    onChange={() => {}}
                    disabled={visible.length === 0}
                    ref={(el) => {
                      // `indeterminate` no existe como atributo JSX: sólo por DOM.
                      if (el) el.indeterminate = someSelected;
                    }}
                    className="h-4 w-4 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed"
                  />
                </th>
                <th className="px-3 py-2.5">Salida</th>
                <th className="px-2 py-2.5">Hab.</th>
                <th className="px-3 py-2.5">Cliente</th>
                {/* La forma de cierre es contexto, no decisión: es lo primero que
                    se guarda cuando la pantalla no da para las diez columnas. */}
                <th className="px-3 py-2.5 hidden xl:table-cell">Cierre</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5 text-right">Cargo cta. cte.</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5 hidden xl:table-cell">Comprobante</th>
                <th className="px-3 py-2.5 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">
                    No hay check-outs en este rango con los filtros elegidos.
                  </td>
                </tr>
              ) : (
                visible.map((r, index) => {
                  const selected = selectedIds.has(r.reservation_id);
                  const comprobante = billingComprobante(r);
                  return (
                    <tr
                      key={r.reservation_id}
                      onClick={(e) => handleRowClick(index, e)}
                      className={`cursor-pointer transition-colors ${
                        selected ? "bg-indigo-50 hover:bg-indigo-100" : "hover:bg-slate-50/60"
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${describeRow(r)}`}
                          checked={selected}
                          // El toggle lo hace el onClick del <tr>: el click del
                          // checkbox burbujea, y el Espacio sintetiza un click.
                          onChange={() => {}}
                          className="h-4 w-4 cursor-pointer accent-indigo-600"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">
                        {shortDate(r.fch_hasta)}
                      </td>
                      <td className="px-2 py-2.5 text-sm font-bold text-slate-800">{r.room_number}</td>
                      <td className="px-3 py-2.5 text-sm text-slate-700 max-w-[200px] truncate" title={r.cliente}>
                        {r.cliente}
                        {/* Con la columna Cierre escondida, el dato sigue a la vista acá. */}
                        <span className="block xl:hidden text-[11px] font-bold text-slate-400">
                          {BILLING_CIERRE_LABEL[r.cierre]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold text-slate-500 whitespace-nowrap hidden xl:table-cell">
                        {BILLING_CIERRE_LABEL[r.cierre]}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-700 text-right whitespace-nowrap">
                        ${money(r.total_price)}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-700 text-right whitespace-nowrap">
                        {r.cargo_cc === null ? "—" : `$${money(r.cargo_cc)}`}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            ESTADO_CLASS[r.estado]
                          }`}
                        >
                          {chipEstado(r.estado)}
                        </span>
                        {/* El estado fino no desaparece: baja a esta etiqueta, que
                            es la que dice "por fuera", "consolidada" o "en ARCA". */}
                        {BILLING_ESTADO_MATIZ[r.estado] && (
                          <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
                            {BILLING_ESTADO_MATIZ[r.estado]}
                          </span>
                        )}
                        {/* Mismo criterio que con el cierre: la columna se esconde
                            en pantallas chicas, pero el número no se pierde. */}
                        {comprobante && (
                          <span className="block xl:hidden text-[11px] font-mono text-slate-400">
                            {comprobante}
                          </span>
                        )}
                        {/* Cobrada por medio bancario: facturarla no es opcional. */}
                        {r.bancario && (
                          <span
                            className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-violet-100 text-violet-700"
                            title="Se cobró por tarjeta, transferencia o Mercado Pago"
                          >
                            Bancaria
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono text-slate-500 whitespace-nowrap hidden xl:table-cell">
                        {comprobante ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {/* Los botones de fila NO seleccionan: facturar y seleccionar
                            son gestos distintos y no se pueden confundir. */}
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.estado === "falta" && (
                            <button
                              type="button"
                              onClick={() => openEmitModal(r)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                            >
                              <FileText size={14} /> Facturar
                            </button>
                          )}
                          {r.estado === "pendiente_consolidada" && r.client_kind && r.client_id && (
                            <Link
                              href={`/admin/fiscal/consolidada?kind=${r.client_kind}&id=${r.client_id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                            >
                              <Layers size={14} /> Consolidar
                            </Link>
                          )}
                          {/* Se facturó desde ARCA o desde otro sistema: sólo se registra. */}
                          {(r.estado === "falta" || r.estado === "pendiente_consolidada") && (
                            <button
                              type="button"
                              onClick={() => openExternalModal([r])}
                              disabled={busy}
                              title="Registrar que ya se facturó fuera del sistema"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-60 rounded-lg transition-colors"
                            >
                              <ExternalLink size={14} /> Ya facturado
                            </button>
                          )}
                          {r.estado === "facturado_externo" && (
                            <button
                              type="button"
                              onClick={() => void undoExternal([r])}
                              disabled={busy}
                              title="Deshacer la marca: vuelve a figurar como pendiente"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors"
                            >
                              {busyId === r.reservation_id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Undo2 size={14} />
                              )}
                              Deshacer
                            </button>
                          )}
                          {(r.estado === "facturado" || r.estado === "facturado_consolidado") &&
                            r.invoice_id && (
                              <>
                                <a
                                  href={`/admin/factura/${r.invoice_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Ver el comprobante (desde ahí se imprime o se guarda en PDF)"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                                >
                                  <Eye size={14} /> Ver
                                </a>
                                {/* Atajo: manda a la comandera sin pasar por la
                                    pantalla del comprobante. */}
                                <button
                                  type="button"
                                  onClick={() => openInvoicePrint(r.invoice_id as string)}
                                  title="Reimprimir en la comandera"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                                >
                                  <Printer size={14} /> Reimprimir
                                </button>
                              </>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Acciones en lote. Aparece sólo con selección, y nunca ofrece una acción
          que no aplique a TODAS las filas elegidas. */}
      <StickyActionBar visible={n > 0}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-slate-700">
            {n} {n === 1 ? "estadía seleccionada" : "estadías seleccionadas"}
          </span>

          {accionLote === "mezclado" && (
            <span className="text-sm text-amber-700">
              Seleccionaste filas en estados distintos. Elegí filas del mismo estado.
            </span>
          )}
          {accionLote === "sin_accion" && (
            <span className="text-sm text-amber-700">
              Estas filas no admiten acciones en lote.
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {accionLote !== "deshacer" && (
              <button
                type="button"
                onClick={() => openExternalModal(selectedRows)}
                disabled={accionLote !== "marcar" || busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
              >
                <ExternalLink size={16} /> Marcar {n} como ya facturadas afuera
              </button>
            )}
            {accionLote !== "marcar" && (
              <button
                type="button"
                onClick={() => void undoExternal(selectedRows)}
                disabled={accionLote !== "deshacer" || busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
              >
                {bulkBusy ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
                Deshacer la marca de {n}
              </button>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
            >
              Limpiar selección
            </button>
          </div>
        </div>
      </StickyActionBar>

      <InvoicePromptModal
        key={invoicePrompt?.reservationId ?? "none"}
        data={invoicePrompt}
        startAtTipo
        onClose={() => {
          setInvoicePrompt(null);
          router.refresh();
        }}
      />

      {/* Confirmación de facturación externa. No emite nada: registra un hecho que
          el sistema no puede verificar contra ARCA, así que pide constancia. */}
      {externalTargets && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <ExternalLink size={17} className="text-indigo-600" />
                {externalTargets.length === 1
                  ? "Ya facturado por fuera"
                  : `Ya facturadas por fuera: ${externalTargets.length} estadías`}
              </h3>
              <button
                type="button"
                onClick={() => setExternalTargets(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Se listan una por una: el empleado tiene que poder leer sobre qué
                  estadías está afirmando el hecho antes de confirmarlo. */}
              <ul className="text-sm text-slate-600 space-y-1 max-h-40 overflow-y-auto">
                {externalTargets.map((t) => (
                  <li key={t.reservation_id}>
                    {describeRow(t)} · {t.cliente} · ${money(t.cargo_cc ?? t.total_price)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Esto <strong>no emite ningún comprobante</strong>. Sólo deja registrado que esta
                estadía ya se facturó desde ARCA o desde otro sistema, para que deje de figurar como
                pendiente. Queda asentado quién lo marcó.
              </p>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="ext-ref">
                  Comprobante <span className="text-rose-600">*</span>
                </label>
                <input
                  id="ext-ref"
                  type="text"
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                  placeholder="Ej. FC A 0008-00000123"
                  autoFocus
                  className={`${inputClass} w-full`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="ext-fecha">
                  Fecha del comprobante
                </label>
                <input
                  id="ext-fecha"
                  type="date"
                  value={externalFecha}
                  onChange={(e) => setExternalFecha(e.target.value)}
                  className={`${inputClass} w-full`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="ext-notas">
                  Nota (opcional)
                </label>
                <input
                  id="ext-notas"
                  type="text"
                  value={externalNotes}
                  onChange={(e) => setExternalNotes(e.target.value)}
                  placeholder="Ej. la emitió Pablo desde el portal"
                  className={`${inputClass} w-full`}
                />
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 flex gap-3">
              <button
                type="button"
                onClick={() => setExternalTargets(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmExternal()}
                disabled={busy || !externalRef.trim()}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
