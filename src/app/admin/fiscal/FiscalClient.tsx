"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileMinus, FileText, Loader2, Pencil, Printer, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  discardInvoiceAction,
  emitCreditNoteAction,
  fixInvoiceDniAndRetryAction,
  retryInvoiceAction,
} from "./actions";
import InvoicePromptModal, { type InvoicePromptData } from "../InvoicePromptModal";
import { cbteLetra, cbteNombre, formatCbteNumero, isNotaCredito, isValidCuit } from "@/lib/arca/amounts";
import { formatHotelShortDateTime } from "@/lib/time";
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
};

function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

export default function FiscalClient({ enabled, pending, invoiceable, authorized }: Props) {
  const router = useRouter();
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
      {/* Pendientes / con error */}
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
              {pending.map((p) => {
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
        </div>
      </section>

      {/* Check-outs sin facturar */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-base font-bold text-slate-800">Check-outs sin facturar</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Si al momento del check-out elegiste NO, acá podés emitir la factura igual.
          </p>
        </div>
        <div className="p-5">
          {invoiceable.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-2">
              No hay check-outs sin facturar a tu alcance.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {invoiceable.map((c) => (
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
        </div>
      </section>

      {/* Emitidas recientes */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-base font-bold text-slate-800">Emitidas recientes</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Reimprimí la representación con QR. Si una factura salió mal, anulala con nota de crédito
            y volvé a emitirla.
          </p>
        </div>
        <div className="p-5">
          {authorized.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-2">Todavía no hay facturas emitidas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {authorized.map((a) => {
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
        </div>
      </section>

      {/* Confirmación de nota de crédito: es irreversible y genera un 3er papel. */}
      {ncTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
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
