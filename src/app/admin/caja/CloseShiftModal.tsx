"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  BedDouble,
  CalendarPlus,
  CheckCircle2,
  CreditCard,
  DoorOpen,
  EyeOff,
  Flag,
  Landmark,
  Loader2,
  Lock,
  Printer,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  closeShiftAction,
  getCloseShiftBlockersAction,
  openShiftAction,
  reportShiftConflictAction,
} from "./actions";
import { handleExtendReservation } from "@/app/admin/actions";
import { logout } from "@/app/login/actions";
import ExportCsvButton from "./ExportCsvButton";
import { formatHotelShortDateTime } from "@/lib/time";
import type { CloseShiftBlocker, PaymentMethod } from "@/lib/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  shiftNumber: number;
  totalsByMethod: Record<PaymentMethod, number>;
  /** Piezas rendidas = check-outs hechos en el turno. */
  checkoutsCount: number;
  /**
   * Qué hacer al apretar "Listo" tras cerrar:
   *  - "logout": recepción cerró su propia caja al fin de turno → cierra sesión.
   *  - "reopen": recepción cerró una caja ajena (rendición forzada) → abre la suya y sigue.
   *  - "refresh": admin → sólo refresca (comportamiento actual).
   */
  afterClose?: "logout" | "reopen" | "refresh";
  /** En rendición forzada el modal no se puede descartar sin cerrar la caja. */
  dismissable?: boolean;
  /** Aviso destacado arriba del formulario (ej. quién dejó la caja abierta). */
  notice?: string;
  /**
   * "handover": rendición forzada de una caja ajena. Se oculta la salida
   * "Check-out" (quien llega no debe cobrar en una caja que no es suya);
   * quedan Ampliar y Reportar como válvula de escape.
   */
  context?: "normal" | "handover";
  hotelTimezone?: string;
};

type CloseResult = {
  expected_cash: number;
  actual_cash: number;
  discrepancy: number;
  shouldLogout: boolean;
};

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "hace 3 h" / "hace 2 días 5 h" a partir de horas vencidas. */
function formatOverdue(hours: number): string {
  if (hours < 1) return "hace menos de 1 h";
  if (hours < 48) return `hace ${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest > 0 ? `hace ${days} días ${rest} h` : `hace ${days} días`;
}

const METHOD_META: Record<PaymentMethod, { label: string; icon: ReactNode }> = {
  cash: { label: "Efectivo", icon: <Banknote size={14} /> },
  mercado_pago: { label: "Mercado Pago", icon: <Wallet size={14} className="text-blue-500" /> },
  bank_transfer: { label: "Transferencia", icon: <Landmark size={14} /> },
  credit_card: { label: "Tarjeta credito", icon: <CreditCard size={14} /> },
  debit_card: { label: "Tarjeta debito", icon: <CreditCard size={14} /> },
  vale_blanco: { label: "Vale Blanco", icon: <Banknote size={14} className="text-slate-400" /> },
  cuenta_corriente: {
    label: "Cta. Corriente",
    icon: <Wallet size={14} className="text-purple-500" />,
  },
  other: { label: "Otro", icon: <Wallet size={14} /> },
};

export default function CloseShiftModal({
  isOpen,
  onClose,
  shiftId,
  shiftNumber,
  totalsByMethod,
  checkoutsCount,
  afterClose = "refresh",
  dismissable = true,
  notice,
  context = "normal",
  hotelTimezone,
}: Props) {
  const router = useRouter();
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<CloseResult | null>(null);

  // Paso 1: salidas vencidas que bloquean el cierre (guard "bloqueo con salida").
  const [blockers, setBlockers] = useState<CloseShiftBlocker[] | null>(null);
  const [occupiedAlerts, setOccupiedAlerts] = useState(0);
  const [blockersError, setBlockersError] = useState<string | null>(null);
  const [checkingBlockers, setCheckingBlockers] = useState(false);
  // Acción expandida en una card de bloqueo (mini-form de ampliar o de reporte).
  const [expanded, setExpanded] = useState<{ id: string; mode: "extend" | "report" } | null>(null);
  const [extendNights, setExtendNights] = useState("1");
  const [reportNote, setReportNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Arqueo a ciegas: tras el primer intento con diferencia, el monto declarado
  // queda bloqueado (evita tantear montos hasta adivinar el esperado).
  const [cashLocked, setCashLocked] = useState(false);
  const [notesRequired, setNotesRequired] = useState(false);

  const fetchBlockers = useCallback(async () => {
    setCheckingBlockers(true);
    setBlockersError(null);
    const result = await getCloseShiftBlockersAction();
    setCheckingBlockers(false);
    if (!result.success) {
      // Si la RPC todavía no existe o falla, no trabamos el cierre: el guard
      // real está en el servidor (rpc_close_cash_shift).
      setBlockers([]);
      setOccupiedAlerts(0);
      setBlockersError(result.error);
      return;
    }
    setBlockers(result.data!.blockers);
    setOccupiedAlerts(result.data!.occupied_alerts_count);
    setExpanded(null);
    setActionError(null);
  }, []);

  useEffect(() => {
    if (!isOpen || closed) return;
    fetchBlockers();
  }, [isOpen, closed, fetchBlockers]);

  // Al cerrar la caja se abre solo el comprobante de rendicion para imprimir
  // (con kiosk sale sin dialogo). Cerrar la caja ya no cierra sesion.
  useEffect(() => {
    if (!closed) return;
    window.open(
      `/admin/caja/rendiciones/${shiftId}?autoprint=1`,
      `rendicion-${shiftId}`,
      "width=420,height=720"
    );
  }, [closed, shiftId]);

  if (!isOpen) return null;

  const parsedActual = parseFloat(actualCash.replace(",", "."));
  const otherMethods = (Object.entries(totalsByMethod) as [PaymentMethod, number][])
    .filter(([method, amount]) => method !== "cash" && amount > 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isNaN(parsedActual) || parsedActual < 0) {
      setError("Ingresa el efectivo declarado (cero o mayor).");
      return;
    }

    setLoading(true);
    const result = await closeShiftAction({
      shiftId,
      actualCash: parsedActual,
      notes: notes.trim() || undefined,
    });
    setLoading(false);

    if (!result.success) {
      if (result.code === "P0012") {
        // La caja no cuadra y falta la nota. Mensaje fijo (sin monto ni signo)
        // y monto bloqueado: se justifica con nota, no se re-tantea el número.
        setCashLocked(true);
        setNotesRequired(true);
        setError(
          "La caja no coincide con lo declarado. Explica la diferencia en las notas para poder cerrar."
        );
        document.getElementById("close-notes")?.focus();
        return;
      }
      if (result.code === "P0011") {
        // Carrera: una salida venció entre la verificación y el cierre.
        setError(null);
        await fetchBlockers();
        return;
      }
      setError(result.error);
      return;
    }

    setClosed(result.data!);
  };

  const handleExtend = async (reservationId: string) => {
    const nights = parseInt(extendNights, 10);
    if (isNaN(nights) || nights < 1) {
      setActionError("Ingresa cuantas noches se queda (1 o mas).");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    const result = await handleExtendReservation(reservationId, nights);
    setActionLoading(false);
    if (!result.success) {
      setActionError(result.error);
      return;
    }
    toast.success("Reserva ampliada. La habitación ya no bloquea el cierre.");
    setExtendNights("1");
    await fetchBlockers();
  };

  const handleReport = async (reservationId: string) => {
    setActionLoading(true);
    setActionError(null);
    const result = await reportShiftConflictAction({
      reservationId,
      notes: reportNote,
    });
    setActionLoading(false);
    if (!result.success) {
      setActionError(result.error);
      return;
    }
    toast.success("Conflicto reportado al administrador. Podes seguir con el cierre.");
    setReportNote("");
    await fetchBlockers();
  };

  const goToCheckout = () => {
    onClose();
    toast.info("Hace el check-out desde el tablero y volve a Cerrar Turno.");
    router.push("/admin");
  };

  const handleFinish = async () => {
    if (afterClose === "logout") {
      // Fin de turno de recepción: cerrar sesión (el próximo arranca con login propio).
      setFinishing(true);
      await logout();
      return;
    }
    if (afterClose === "reopen") {
      // Rendición forzada de caja ajena: abrir la propia y seguir trabajando.
      setFinishing(true);
      await openShiftAction();
      onClose();
      router.refresh();
      return;
    }
    onClose();
    router.refresh();
  };

  // Vista de resultado: se muestra la rendicion una vez cerrada la caja.
  if (closed) {
    const d = closed.discrepancy;
    // "Efectivo" cobrado = efectivo esperado (se revela recien al cerrar; en el
    // arqueo a ciegas totalsByMethod.cash llega en 0). Tarjeta = credito + debito.
    const cobradoRows = [
      { label: "Efectivo", amount: closed.expected_cash },
      { label: "Tarjeta", amount: totalsByMethod.credit_card + totalsByMethod.debit_card },
      { label: "Vale Blanco", amount: totalsByMethod.vale_blanco },
      { label: "Cta Cte", amount: totalsByMethod.cuenta_corriente },
    ];
    const extraRows = [
      { label: "Mercado Pago", amount: totalsByMethod.mercado_pago },
      { label: "Transferencia", amount: totalsByMethod.bank_transfer },
      { label: "Otro", amount: totalsByMethod.other },
    ].filter((r) => r.amount > 0);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
          <div className="p-6 text-center">
            <div className="inline-flex w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center mb-3">
              <CheckCircle2 size={28} />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-1">Caja cerrada</h2>
            <p className="text-sm text-slate-500 mb-5">
              {d === 0
                ? "La caja cuadra perfecto."
                : d > 0
                  ? `Quedo un sobrante de $${formatMoney(d)}.`
                  : `Quedo un faltante de $${formatMoney(Math.abs(d))}.`}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl border border-slate-200 p-3 text-left">
                <p className="text-xs text-slate-500">Efectivo esperado</p>
                <p className="font-bold text-slate-800">${formatMoney(closed.expected_cash)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-left">
                <p className="text-xs text-slate-500">Efectivo declarado</p>
                <p className="font-bold text-slate-800">${formatMoney(closed.actual_cash)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6 text-left overflow-hidden">
              <div className="flex items-center justify-between p-3 bg-slate-50">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <BedDouble size={15} />
                  Piezas rendidas
                </span>
                <span className="text-lg font-bold text-slate-900">{checkoutsCount}</span>
              </div>
              {[...cobradoRows, ...extraRows].map((r) => (
                <div key={r.label} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-slate-600 font-medium">{r.label}</span>
                  <span className="font-bold text-slate-800">${formatMoney(r.amount)}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() =>
                  window.open(
                    `/admin/caja/rendiciones/${shiftId}?autoprint=1`,
                    `rendicion-${shiftId}`,
                    "width=420,height=720"
                  )
                }
                className="flex-1 px-5 py-2.5 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              >
                <Printer size={18} />
                Imprimir
              </button>
              <ExportCsvButton shiftId={shiftId} shiftNumber={shiftNumber} />
            </div>
            <button
              type="button"
              onClick={handleFinish}
              disabled={finishing}
              className="w-full mt-3 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {finishing ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
              Listo
            </button>
            <p className="text-[11px] text-slate-400 mt-3">
              {afterClose === "logout"
                ? "Imprimí el comprobante y descargá el CSV. Al terminar se cierra la sesión."
                : afterClose === "reopen"
                  ? "Imprimí el comprobante y descargá el CSV. Al terminar se abre tu caja y seguís."
                  : "Imprimí el comprobante y descargá el CSV. Para el próximo turno abrí una caja nueva."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const occupiedBanner =
    occupiedAlerts > 0 ? (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm font-semibold text-amber-800">
          Limpieza marcó {occupiedAlerts === 1 ? "1 habitación ocupada" : `${occupiedAlerts} habitaciones ocupadas`}{" "}
          sin reserva activa. Podés cerrar igual; el administrador ya fue notificado.
        </div>
      </div>
    ) : null;

  // ── Paso 1: salidas vencidas sin resolver ──
  const hasBlockers = blockers !== null && blockers.length > 0;
  if (blockers === null || hasBlockers) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                <DoorOpen size={20} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">Salidas vencidas</h2>
                <p className="text-slate-500 text-sm font-medium">
                  Resolvé cada habitación antes de rendir la caja.
                </p>
              </div>
            </div>
            {dismissable && (
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            )}
          </div>

          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {notice && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm font-semibold text-amber-800">{notice}</div>
              </div>
            )}
            {occupiedBanner}

            {blockers === null ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
                <Loader2 className="animate-spin" size={20} />
                <span className="text-sm font-medium">Verificando salidas pendientes…</span>
              </div>
            ) : (
              blockers.map((b) => {
                const isExtend = expanded?.id === b.reservation_id && expanded.mode === "extend";
                const isReport = expanded?.id === b.reservation_id && expanded.mode === "report";
                return (
                  <div
                    key={b.reservation_id}
                    className="rounded-xl border border-red-200 bg-red-50/50 overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-slate-800">
                          Hab. {b.room_number} — {b.client_name ?? "Sin nombre"}
                        </p>
                        {b.balance_due > 0 && (
                          <span className="text-xs font-bold text-red-700 bg-red-100 rounded-full px-2 py-0.5 shrink-0">
                            Debe ${formatMoney(b.balance_due)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Salida prevista {formatHotelShortDateTime(b.effective_deadline, hotelTimezone)} (
                        {formatOverdue(b.hours_overdue)})
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setExpanded(isExtend ? null : { id: b.reservation_id, mode: "extend" });
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
                        >
                          <CalendarPlus size={13} />
                          Sigue alojado: ampliar
                        </button>
                        {context === "normal" && (
                          <button
                            type="button"
                            onClick={goToCheckout}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
                          >
                            <DoorOpen size={13} />
                            Se fue: hacer check-out
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setExpanded(isReport ? null : { id: b.reservation_id, mode: "report" });
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                        >
                          <Flag size={13} />
                          Reportar al admin
                        </button>
                      </div>
                    </div>

                    {isExtend && (
                      <div className="border-t border-red-200 bg-white p-4 space-y-2">
                        <label className="block text-xs font-bold text-slate-700">
                          ¿Cuántas noches más se queda?
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={extendNights}
                            onChange={(e) => setExtendNights(e.target.value)}
                            className="w-24 px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none text-sm font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => handleExtend(b.reservation_id)}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-70 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                          >
                            {actionLoading && <Loader2 className="animate-spin" size={14} />}
                            Ampliar reserva
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Se recalcula el total con la tarifa ya cotizada. El saldo se cobra al check-out.
                        </p>
                      </div>
                    )}

                    {isReport && (
                      <div className="border-t border-red-200 bg-white p-4 space-y-2">
                        <label className="block text-xs font-bold text-slate-700">
                          ¿Qué pasó con esta habitación? (llega al administrador)
                        </label>
                        <textarea
                          value={reportNote}
                          onChange={(e) => setReportNote(e.target.value)}
                          rows={2}
                          maxLength={500}
                          placeholder="Ej. El huésped no aparece y tiene las llaves; no puedo hacer el check-out."
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none resize-none text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleReport(b.reservation_id)}
                          disabled={actionLoading || reportNote.trim().length < 5}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-70 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                        >
                          {actionLoading && <Loader2 className="animate-spin" size={14} />}
                          Reportar y desbloquear
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {actionError && (
              <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">{actionError}</p>
            )}
            {blockersError && (
              <p className="text-amber-700 text-sm font-medium bg-amber-50 p-3 rounded-lg">
                {blockersError}
              </p>
            )}
          </div>

          <div className="p-6 border-t border-slate-100 flex gap-3 justify-end bg-slate-50 shrink-0">
            {dismissable && (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={fetchBlockers}
              disabled={checkingBlockers}
              className="px-5 py-2.5 border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-100 disabled:opacity-70 transition-colors flex items-center gap-2"
            >
              {checkingBlockers ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              Volver a verificar
            </button>
            <button
              type="button"
              disabled
              title="Resolvé todas las salidas vencidas para continuar"
              className="px-5 py-2.5 bg-amber-600 text-white font-bold rounded-xl opacity-50 cursor-not-allowed flex items-center gap-2"
            >
              <Wallet size={18} />
              Continuar con el arqueo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Paso 2: arqueo a ciegas ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
              <Wallet size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Rendir Caja</h2>
              <p className="text-slate-500 text-sm font-medium">
                Conta el efectivo real y cerramos el turno.
              </p>
            </div>
          </div>
          {dismissable && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={24} />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {notice && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm font-semibold text-amber-800">{notice}</div>
            </div>
          )}
          {occupiedBanner}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-start gap-3">
            <EyeOff size={18} className="text-slate-400 shrink-0 mt-0.5" />
            <div className="text-sm text-slate-600">
              El efectivo esperado se mantiene oculto hasta que declares cuanto hay
              fisicamente en caja. La diferencia saldra en la rendicion final.
            </div>
          </div>

          {otherMethods.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-2">
                Otros medios a controlar
              </p>
              <ul className="space-y-1.5 text-sm">
                {otherMethods.map(([method, amount]) => {
                  const meta = METHOD_META[method] ?? METHOD_META.other;
                  return (
                    <li key={method} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-indigo-700 font-medium">
                        {meta.icon}
                        {meta.label}
                      </span>
                      <span className="font-bold text-indigo-900">${formatMoney(amount)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-indigo-600 mt-2">
                Verifica que lo cobrado por cada medio coincida con sus comprobantes.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="actual-cash" className="block text-sm font-bold text-slate-700 mb-2">
              Efectivo declarado ($)
            </label>
            <div className="relative">
              <input
                id="actual-cash"
                type="number"
                step="0.01"
                min="0"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                readOnly={cashLocked}
                className={`w-full px-4 py-3 rounded-xl border outline-none text-xl font-bold ${
                  cashLocked
                    ? "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed pr-10"
                    : "border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 text-slate-800"
                }`}
                placeholder="0.00"
                required
                autoFocus
              />
              {cashLocked && (
                <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {cashLocked
                ? "El efectivo declarado quedó registrado. Si te equivocaste, explicalo en las notas."
                : "Aca registras cuanto efectivo hay fisicamente en caja al cierre."}
            </p>
          </div>

          <div>
            <label htmlFor="close-notes" className="block text-sm font-bold text-slate-700 mb-2">
              Notas {notesRequired ? "(obligatorias por la diferencia)" : "(opcional)"}
            </label>
            <textarea
              id="close-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ej. Devolvi vuelto a huesped de Hab 5 por $200."
              className={`w-full px-4 py-3 rounded-xl border focus:ring outline-none resize-none text-sm ${
                notesRequired
                  ? "border-red-300 focus:border-red-500 focus:ring-red-200"
                  : "border-slate-200 focus:border-brand-500"
              }`}
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">{error}</p>
          )}
        </form>

        <div className="p-6 border-t border-slate-100 flex gap-3 justify-end bg-slate-50 shrink-0">
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={(e) => handleSubmit(e as unknown as FormEvent)}
            disabled={loading}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Wallet size={18} />}
            Cerrar Turno
          </button>
        </div>
      </div>
    </div>
  );
}
