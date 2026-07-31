"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Layers, Loader2, Printer, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import InvoicePromptModal, { type InvoicePromptData } from "../../InvoicePromptModal";
import { markInvoicedExternallyAction, unmarkInvoicedExternallyAction } from "./actions";
import { formatCbteNumero } from "@/lib/arca/amounts";
import type {
  BillingControlEstado,
  BillingControlRow,
  CtaCteAccount,
} from "@/lib/types";

type Props = {
  rows: BillingControlRow[];
  accounts: CtaCteAccount[];
  from: string;
  to: string;
  cliente: string;
  estado: string;
};

function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

const ESTADO_META: Record<BillingControlEstado, { label: string; className: string }> = {
  facturado: { label: "Facturado", className: "bg-emerald-100 text-emerald-700" },
  facturado_consolidado: { label: "Consolidado", className: "bg-teal-100 text-teal-700" },
  facturado_externo: { label: "Facturado afuera", className: "bg-indigo-100 text-indigo-700" },
  en_proceso: { label: "En proceso", className: "bg-amber-100 text-amber-700" },
  pendiente_consolidada: { label: "Espera consolidada", className: "bg-sky-100 text-sky-700" },
  no_corresponde: { label: "No corresponde", className: "bg-slate-100 text-slate-500" },
  falta: { label: "FALTA FACTURAR", className: "bg-rose-100 text-rose-700" },
};

const CIERRE_LABEL: Record<BillingControlRow["cierre"], string> = {
  caja: "Caja",
  cuenta_corriente: "Cta. cte.",
  vale_blanco: "Vale blanco",
};

const ORDER: BillingControlEstado[] = [
  "falta",
  "pendiente_consolidada",
  "en_proceso",
  "facturado",
  "facturado_consolidado",
  "facturado_externo",
  "no_corresponde",
];

const inputClass =
  "px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm";

export default function ControlClient({ rows, accounts, from, to, cliente, estado }: Props) {
  const router = useRouter();
  const [invoicePrompt, setInvoicePrompt] = useState<InvoicePromptData | null>(null);
  // Marca "ya se facturó afuera": siempre con confirmación, porque afirma un hecho
  // fiscal que el sistema no puede verificar contra ARCA.
  const [externalTarget, setExternalTarget] = useState<BillingControlRow | null>(null);
  const [externalRef, setExternalRef] = useState("");
  const [externalFecha, setExternalFecha] = useState("");
  const [externalNotes, setExternalNotes] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const openExternalModal = (r: BillingControlRow) => {
    setExternalTarget(r);
    setExternalRef("");
    setExternalFecha(r.fch_hasta);
    setExternalNotes("");
  };

  const confirmExternal = async () => {
    if (!externalTarget) return;
    if (!externalRef.trim()) {
      toast.error("Indicá con qué comprobante se facturó.");
      return;
    }
    setBusyId(externalTarget.reservation_id);
    const result = await markInvoicedExternallyAction(
      externalTarget.reservation_id,
      externalRef.trim(),
      externalFecha || undefined,
      externalNotes.trim() || undefined
    );
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Registrado como facturado por fuera del sistema.");
    setExternalTarget(null);
    router.refresh();
  };

  const undoExternal = async (r: BillingControlRow) => {
    setBusyId(r.reservation_id);
    const result = await unmarkInvoicedExternallyAction(r.reservation_id);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Marca deshecha: vuelve a figurar como pendiente.");
    router.refresh();
  };

  const counts = useMemo(() => {
    const map = {} as Record<BillingControlEstado, number>;
    for (const e of ORDER) map[e] = 0;
    for (const r of rows) map[r.estado] = (map[r.estado] ?? 0) + 1;
    return map;
  }, [rows]);

  const visible = estado ? rows.filter((r) => r.estado === estado) : rows;

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

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="control-desde">
            Desde
          </label>
          <input
            id="control-desde"
            type="date"
            defaultValue={from}
            onChange={(e) => applyFilters({ desde: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="control-hasta">
            Hasta
          </label>
          <input
            id="control-hasta"
            type="date"
            defaultValue={to}
            onChange={(e) => applyFilters({ hasta: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="min-w-[220px]">
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="control-cliente">
            Cliente
          </label>
          <select
            id="control-cliente"
            value={cliente}
            onChange={(e) => applyFilters({ cliente: e.target.value })}
            className={`${inputClass} w-full`}
          >
            <option value="">Todos</option>
            {accounts.map((a) => (
              <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="control-estado">
            Estado
          </label>
          <select
            id="control-estado"
            value={estado}
            onChange={(e) => applyFilters({ estado: e.target.value })}
            className={inputClass}
          >
            <option value="">Todos</option>
            {ORDER.map((e) => (
              <option key={e} value={e}>
                {ESTADO_META[e].label}
              </option>
            ))}
          </select>
        </div>
        <Link
          href="/admin/fiscal/consolidada"
          className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors"
        >
          <Layers size={16} /> Factura consolidada
        </Link>
      </section>

      {/* Contadores */}
      <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
        {ORDER.filter((e) => counts[e] > 0).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => applyFilters({ estado: estado === e ? "" : e })}
            className={`px-3 py-1 rounded-full transition-opacity ${ESTADO_META[e].className} ${
              estado && estado !== e ? "opacity-40" : ""
            }`}
          >
            {ESTADO_META[e].label}: {counts[e]}
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
                <th className="px-4 py-3">Salida</th>
                <th className="px-4 py-3">Hab.</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Cierre</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Cargo cta. cte.</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Comprobante</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">
                    No hay check-outs en este rango con los filtros elegidos.
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.reservation_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                      {shortDate(r.fch_hasta)}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-800">{r.room_number}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 max-w-[220px] truncate">
                      {r.cliente}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-500">
                      {CIERRE_LABEL[r.cierre]}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 text-right whitespace-nowrap">
                      ${money(r.total_price)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 text-right whitespace-nowrap">
                      {r.cargo_cc === null ? "—" : `$${money(r.cargo_cc)}`}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          ESTADO_META[r.estado].className
                        }`}
                      >
                        {ESTADO_META[r.estado].label}
                      </span>
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
                    <td className="px-4 py-3 text-xs font-mono text-slate-500 whitespace-nowrap">
                      {r.external_ref
                        ? r.external_ref
                        : r.cbte_nro && r.pto_vta
                          ? `${r.cbte_tipo === 1 ? "A" : "B"} ${formatCbteNumero(r.pto_vta, r.cbte_nro)}`
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
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
                            onClick={() => openExternalModal(r)}
                            disabled={busyId !== null}
                            title="Registrar que ya se facturó fuera del sistema"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-60 rounded-lg transition-colors"
                          >
                            <ExternalLink size={14} /> Ya facturado
                          </button>
                        )}
                        {r.estado === "facturado_externo" && (
                          <button
                            type="button"
                            onClick={() => void undoExternal(r)}
                            disabled={busyId !== null}
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
                            <a
                              href={`/admin/factura/${r.invoice_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                            >
                              <Printer size={14} /> Ver
                            </a>
                          )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

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
      {externalTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <ExternalLink size={17} className="text-indigo-600" />
                Ya facturado por fuera
              </h3>
              <button
                type="button"
                onClick={() => setExternalTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-600">
                Hab. <strong>{externalTarget.room_number}</strong> ·{" "}
                {shortDate(externalTarget.fch_desde)} → {shortDate(externalTarget.fch_hasta)} ·{" "}
                {externalTarget.cliente} · ${money(externalTarget.cargo_cc ?? externalTarget.total_price)}
              </p>
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
                onClick={() => setExternalTarget(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmExternal()}
                disabled={busyId !== null || !externalRef.trim()}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {busyId !== null ? <Loader2 size={16} className="animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
