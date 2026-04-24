"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Phone,
  CreditCard,
  User,
  CalendarDays,
  BedDouble,
  RefreshCw,
  MessageCircle,
  AlertCircle,
  Loader2,
  DollarSign,
} from "lucide-react";

import { handleConfirmReservation, handleCancelReservation, handleResendWhatsapp } from "../actions";
import type { PendingReservation } from "@/lib/types";
import {
  CANCEL_REASON_OPTIONS,
  CANCEL_REASON_LABELS,
  type CancelReasonKey,
} from "@/lib/cancel-reasons";

type Props = {
  solicitudes: PendingReservation[];
};

type ActionState = {
  id: string;
  type: "confirm" | "cancel" | "resend";
} | null;

type ResultState = {
  id: string;
  action: "confirmed" | "cancelled" | "resent";
  whatsappSent: boolean;
} | null;

export default function SolicitudesClient({ solicitudes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDialog, setConfirmDialog] = useState<ActionState>(null);
  const [result, setResult] = useState<ResultState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [cancelReasonKey, setCancelReasonKey] = useState<CancelReasonKey>("fechas_no_disponibles");
  const [cancelReasonCustom, setCancelReasonCustom] = useState("");

  const resolvedCancelReason =
    cancelReasonKey === "otro"
      ? cancelReasonCustom.trim()
      : CANCEL_REASON_LABELS[cancelReasonKey].es;
  const cancelReasonValid =
    cancelReasonKey !== "otro" || cancelReasonCustom.trim().length > 0;

  const pending = solicitudes.filter((s) => s.status === "pending");
  const processed = solicitudes.filter((s) => s.status !== "pending");

  const executeAction = async (id: string, type: "confirm" | "cancel" | "resend") => {
    setConfirmDialog(null);
    setLoadingId(id);
    setActionError(null);
    setResult(null);

    startTransition(async () => {
      try {
        let res;
        if (type === "confirm") {
          res = await handleConfirmReservation(id);
        } else if (type === "cancel") {
          res = await handleCancelReservation(id, resolvedCancelReason);
        } else {
          res = await handleResendWhatsapp(id);
        }

        if (res.success) {
          const whatsappSent = res.data?.whatsappSent ?? false;
          setResult({
            id,
            action: type === "confirm" ? "confirmed" : type === "cancel" ? "cancelled" : "resent",
            whatsappSent,
          });
        } else {
          setActionError(res.error);
        }
      } catch {
        setActionError("Error inesperado al procesar la solicitud.");
      } finally {
        setCancelReasonKey("fechas_no_disponibles");
        setCancelReasonCustom("");
        setLoadingId(null);
        router.refresh();
      }
    });
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const statusBadge = (status: string, whatsappNotified: boolean) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      pending: { bg: "bg-amber-100", text: "text-amber-700", label: "Pendiente" },
      confirmed: { bg: "bg-green-100", text: "text-green-700", label: "Confirmada" },
      cancelled: { bg: "bg-red-100", text: "text-red-700", label: "Cancelada" },
    };
    const s = map[status] ?? { bg: "bg-slate-100", text: "text-slate-600", label: status };
    return (
      <div className="flex items-center gap-2">
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${s.bg} ${s.text}`}>
          {s.label}
        </span>
        {status !== "pending" && (
          whatsappNotified ? (
            <span className="flex items-center gap-1 text-xs text-green-600" title="WhatsApp enviado">
              <MessageCircle size={12} /> Enviado
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-red-500" title="WhatsApp no enviado">
              <AlertCircle size={12} /> No enviado
            </span>
          )
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-8 animate-in zoom-in-95 duration-200">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 ${confirmDialog.type === "confirm" ? "bg-green-50 text-green-500" : "bg-red-50 text-red-500"}`}>
              {confirmDialog.type === "confirm" ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">
              {confirmDialog.type === "confirm" ? "Confirmar reserva" : "Cancelar reserva"}
            </h3>
            <p className="text-sm text-slate-500 text-center mb-6">
              {confirmDialog.type === "confirm"
                ? "Se confirmara la reserva y se enviara un mensaje de WhatsApp al cliente."
                : "Se cancelara la reserva, quedara auditada con un motivo y se notificara al cliente por WhatsApp."}
            </p>

            {confirmDialog.type === "cancel" && (
              <div className="mb-6 space-y-3">
                <div>
                  <label htmlFor="solicitud-cancel-reason-key" className="block text-sm font-semibold text-slate-700 mb-2">
                    Motivo de cancelacion
                  </label>
                  <select
                    id="solicitud-cancel-reason-key"
                    value={cancelReasonKey}
                    onChange={(e) => setCancelReasonKey(e.target.value as CancelReasonKey)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-red-400 focus:ring outline-none bg-white cursor-pointer"
                  >
                    {CANCEL_REASON_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {cancelReasonKey === "otro" && (
                  <div>
                    <label htmlFor="solicitud-cancel-reason-custom" className="block text-xs font-semibold text-slate-500 mb-1">
                      Describi el motivo
                    </label>
                    <textarea
                      id="solicitud-cancel-reason-custom"
                      rows={3}
                      value={cancelReasonCustom}
                      onChange={(e) => setCancelReasonCustom(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-red-400 focus:ring outline-none resize-none"
                      placeholder="Ej. No hay disponibilidad real para esas fechas."
                    />
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  El cliente recibira este motivo y la invitacion a comunicarse para reprogramar.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setConfirmDialog(null);
                  setCancelReasonKey("fechas_no_disponibles");
                  setCancelReasonCustom("");
                }}
                className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Volver
              </button>
              <button
                onClick={() => executeAction(confirmDialog.id, confirmDialog.type)}
                disabled={confirmDialog.type === "cancel" && !cancelReasonValid}
                className={`flex-1 py-3 px-4 font-semibold rounded-xl transition-colors cursor-pointer text-white disabled:opacity-50 ${
                  confirmDialog.type === "confirm"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {confirmDialog.type === "confirm" ? "Si, confirmar" : "Si, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className={`p-4 rounded-xl border flex items-center justify-between ${result.whatsappSent ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
          <div className="flex items-center gap-3">
            {result.whatsappSent ? (
              <CheckCircle2 className="text-green-600 shrink-0" size={20} />
            ) : (
              <AlertCircle className="text-amber-600 shrink-0" size={20} />
            )}
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Reserva {result.action === "confirmed" ? "confirmada" : result.action === "cancelled" ? "cancelada" : "reenviada"} exitosamente
              </p>
              <p className={`text-xs ${result.whatsappSent ? "text-green-600" : "text-amber-600"}`}>
                {result.whatsappSent
                  ? "Mensaje de WhatsApp enviado correctamente."
                  : "No se pudo enviar el mensaje de WhatsApp. Puedes reenviar manualmente."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!result.whatsappSent && (
              <button
                onClick={() => executeAction(result.id, "resend")}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} /> Reenviar
              </button>
            )}
            <button
              onClick={() => setResult(null)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <XCircle size={18} />
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <XCircle className="text-red-500 shrink-0" size={20} />
            <p className="text-sm text-red-700 font-medium">{actionError}</p>
          </div>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 cursor-pointer">
            <XCircle size={18} />
          </button>
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">
          Pendientes de Aprobacion ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <CheckCircle2 size={48} className="text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 font-medium">No hay solicitudes pendientes</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {pending.map((s) => (
              <div
                key={s.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="flex items-start gap-3">
                      <User className="text-slate-400 shrink-0 mt-0.5" size={18} />
                      <div>
                        <div className="text-xs text-slate-400 font-semibold uppercase">Cliente</div>
                        <div className="font-semibold text-slate-800">{s.client_name}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CreditCard className="text-slate-400 shrink-0 mt-0.5" size={18} />
                      <div>
                        <div className="text-xs text-slate-400 font-semibold uppercase">DNI</div>
                        <div className="font-medium text-slate-700">{s.client_dni || "—"}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Phone className="text-slate-400 shrink-0 mt-0.5" size={18} />
                      <div>
                        <div className="text-xs text-slate-400 font-semibold uppercase">Telefono</div>
                        <div className="font-medium text-slate-700">{s.client_phone || "—"}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <BedDouble className="text-slate-400 shrink-0 mt-0.5" size={18} />
                      <div>
                        <div className="text-xs text-slate-400 font-semibold uppercase">Habitacion</div>
                        <div className="font-medium text-slate-700 capitalize">{s.room_type} (Nro {s.room_number})</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 border-t lg:border-t-0 lg:border-l border-slate-100 pt-4 lg:pt-0 lg:pl-6">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarDays size={14} className="text-slate-400" />
                      <span className="text-slate-600">
                        {formatDate(s.check_in_target)} → {formatDate(s.check_out_target)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                      <DollarSign size={14} />
                      {Number(s.total_price).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t lg:border-t-0 lg:border-l border-slate-100 pt-4 lg:pt-0 lg:pl-6 shrink-0">
                    {loadingId === s.id ? (
                      <Loader2 className="animate-spin text-slate-400" size={24} />
                    ) : (
                      <>
                        <button
                          onClick={() => setConfirmDialog({ id: s.id, type: "confirm" })}
                          disabled={isPending}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 size={16} />
                          Confirmar
                        </button>
                        <button
                          onClick={() => {
                            setConfirmDialog({ id: s.id, type: "cancel" });
                            setCancelReasonKey("fechas_no_disponibles");
                            setCancelReasonCustom("");
                          }}
                          disabled={isPending}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl transition-colors border border-red-200 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle size={16} />
                          Rechazar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {processed.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">
            Procesadas Recientemente ({processed.length})
          </h2>
          <div className="grid gap-3">
            {processed.map((s) => (
              <div
                key={s.id}
                className="bg-white rounded-xl border border-slate-200 p-5 opacity-80 hover:opacity-100 transition-opacity"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="font-semibold text-slate-700 truncate">{s.client_name}</div>
                    <div className="text-sm text-slate-400">DNI: {s.client_dni || "—"}</div>
                    <div className="text-sm text-slate-400 capitalize">{s.room_type} #{s.room_number}</div>
                    <div className="text-sm text-slate-400">
                      {formatDate(s.check_in_target)} → {formatDate(s.check_out_target)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {statusBadge(s.status, s.whatsapp_notified)}
                    {!s.whatsapp_notified && s.status !== "pending" && (
                      <button
                        onClick={() => executeAction(s.id, "resend")}
                        disabled={isPending || loadingId === s.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {loadingId === s.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        Reenviar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
