"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Loader2, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { emitInvoiceForReservationAction, retryInvoiceAction } from "./actions";
import { formatCbteNumero } from "@/lib/arca/amounts";
import { formatHotelShortDateTime } from "@/lib/time";
import type {
  EmitInvoiceOutcome,
  InvoiceableCheckoutRow,
  PendingInvoiceRow,
} from "@/lib/types";

type Props = {
  enabled: boolean;
  pending: PendingInvoiceRow[];
  invoiceable: InvoiceableCheckoutRow[];
  authorized: Array<{
    invoice_id: string;
    pto_vta: number;
    cbte_nro: number;
    receptor_nombre: string | null;
    imp_total: number;
  }>;
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

  const emit = async (reservationId: string) => {
    setBusyId(reservationId);
    const result = await emitInvoiceForReservationAction(reservationId);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    handleOutcome(result.data!);
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
              {pending.map((p) => (
                <li key={p.invoice_id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate">
                      Hab. {p.room_number} — {p.receptor_nombre ?? "Sin nombre"} — $
                      {money(p.imp_total)}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                      <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                      {STATUS_LABEL[p.status] ?? p.status}
                      {p.attempt_count > 0 && ` · ${p.attempt_count} intento${p.attempt_count === 1 ? "" : "s"}`}
                      {p.last_error && ` · ${p.last_error}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => retry(p.invoice_id)}
                    disabled={busyId !== null}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2 shrink-0"
                  >
                    {busyId === p.invoice_id ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Reintentar
                  </button>
                </li>
              ))}
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
                    onClick={() => emit(c.reservation_id)}
                    disabled={busyId !== null}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2 shrink-0"
                  >
                    {busyId === c.reservation_id ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
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
          <p className="text-xs text-slate-400 mt-0.5">Reimprimí la representación con QR.</p>
        </div>
        <div className="p-5">
          {authorized.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-2">Todavía no hay facturas emitidas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {authorized.map((a) => (
                <li key={a.invoice_id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate">
                      Factura B {formatCbteNumero(a.pto_vta, a.cbte_nro)} —{" "}
                      {a.receptor_nombre ?? "Sin nombre"} — ${money(a.imp_total)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openInvoicePrint(a.invoice_id)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 shrink-0"
                  >
                    <Printer size={14} />
                    Reimprimir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
