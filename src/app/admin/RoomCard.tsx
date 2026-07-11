"use client";

import { useState, useTransition } from "react";
import { BedDouble, Clock, Pencil, Plus, Replace } from "lucide-react";
import { toast } from "sonner";

import WalkInModal from "./WalkInModal";
import ExtraChargesModal from "./ExtraChargesModal";
import ChangeRoomModal from "./ChangeRoomModal";
import EditReservationModal from "./EditReservationModal";
import EarlyCheckoutModal from "./EarlyCheckoutModal";
import {
  handleLateCheckOut,
  handleMarkAvailable,
  handleCancelReservation,
  handleCheckOut,
  handleEarlyCheckOut,
  handleCheckIn,
  handleSetMaintenance,
  handleAssignWalkIn,
  handleExtendReservation,
} from "./actions";
import PaymentModal from "../components/PaymentModal";
import { calculateEarlyCheckoutBreakdown } from "@/lib/pricing";
import { formatHotelShortDate, hotelDateKey } from "@/lib/time";
import type { AssociatedClient } from "@/lib/types";

type RoomCardProps = {
  room: {
    id: number;
    number: string;
    type: string;
    status: string;
    client: string | null;
    checkout: string | null;
    check_in_target: string | null;
    check_out_target: string | null;
    isLate: boolean;
    hasLateCheckout: boolean;
    canChargeLateCheckout: boolean;
    reservationId: string | null;
    reservationStatus: string | null;
    baseTotalPrice: number;
    discountPercent: number;
    discountAmount: number;
    totalPrice: number;
    paidAmount: number;
    basePrice: number;
    halfDayPrice: number;
    hasArrivalToday: boolean;
    accountCreditEnabled: boolean;
  };
  associatedClients: AssociatedClient[];
  isAdmin?: boolean;
  timezone: string;
};

function openAccountVoucher(movementId: string) {
  if (typeof window === "undefined") return;
  window.open(
    `/admin/comprobante-cc/${movementId}?autoprint=1`,
    "comprobante-" + movementId,
    "width=420,height=720"
  );
}

export default function RoomCard({ room, associatedClients, isAdmin = false, timezone }: RoomCardProps) {
  const [isPending, startTransition] = useTransition();
  const [isWalkInModalOpen, setIsWalkInModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);
  const [isCheckoutConfirmOpen, setIsCheckoutConfirmOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [isExtrasModalOpen, setIsExtrasModalOpen] = useState(false);
  const [isChangeRoomModalOpen, setIsChangeRoomModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [extendNights, setExtendNights] = useState(1);
  const [extendMode, setExtendMode] = useState<"nights" | "half_day">("nights");
  const [cancelReason, setCancelReason] = useState("");
  const [isEarlyModalOpen, setIsEarlyModalOpen] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState<"normal" | "early">("normal");
  const [earlyPreview, setEarlyPreview] = useState<{
    breakdown: ReturnType<typeof calculateEarlyCheckoutBreakdown>;
    reservedUntilLabel: string;
    departureLabel: string;
  } | null>(null);

  const debt = Math.max(0, room.totalPrice - room.paidAmount);
  const isConfirmedArrival = room.hasArrivalToday;
  // Cuando el cobro es "salida anticipada", el PaymentModal usa los montos recalculados.
  const early = checkoutMode === "early" ? earlyPreview?.breakdown ?? null : null;

  // Devuelve el preview de salida anticipada si el huésped se retira antes del día
  // reservado (hay al menos una noche que no va a usar); si no, null.
  const buildEarlyPreview = () => {
    if (!room.check_in_target || !room.check_out_target) return null;
    const nowIso = new Date().toISOString();
    if (hotelDateKey(nowIso, timezone) >= hotelDateKey(room.check_out_target, timezone)) {
      return null;
    }
    const breakdown = calculateEarlyCheckoutBreakdown({
      checkInTargetIso: room.check_in_target,
      checkOutTargetIso: room.check_out_target,
      departureIso: nowIso,
      baseTotalPrice: room.baseTotalPrice,
      discountPercent: room.discountPercent,
      discountAmount: room.discountAmount,
      totalPrice: room.totalPrice,
      paidAmount: room.paidAmount,
      timezone,
    });
    if (breakdown.chargedNights >= breakdown.originalNights) return null;
    return {
      breakdown,
      reservedUntilLabel: formatHotelShortDate(room.check_out_target, timezone),
      departureLabel: formatHotelShortDate(nowIso, timezone),
    };
  };

  const onCheckIn = () => {
    const reservationId = room.reservationId;
    if (!reservationId) return;
    startTransition(async () => {
      const result = await handleCheckIn(reservationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Check-in realizado correctamente.");
    });
  };

  const onSetMaintenance = () => {
    startTransition(async () => {
      const result = await handleSetMaintenance(room.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Habitación puesta en mantenimiento.");
    });
  };

  const onLateCheckout = () => {
    const reservationId = room.reservationId;
    if (!reservationId) return;

    startTransition(async () => {
      const result = await handleLateCheckOut(reservationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        result.data?.halfDayCharged
          ? "Medio día cobrado."
          : "El medio día ya estaba aplicado; no se volvió a cobrar."
      );
    });
  };

  const onCheckoutClick = () => {
    if (!room.reservationId) return;

    // Si el huésped se va antes de lo reservado, primero mostramos el recálculo.
    const preview = buildEarlyPreview();
    if (preview) {
      setEarlyPreview(preview);
      setIsEarlyModalOpen(true);
      return;
    }

    setCheckoutMode("normal");
    if (debt > 0) {
      setIsPaymentModalOpen(true);
      return;
    }
    setIsCheckoutConfirmOpen(true);
  };

  // Salida anticipada elegida: cobrar solo las noches dormidas.
  const chooseChargeEarly = () => {
    setIsEarlyModalOpen(false);
    setCheckoutMode("early");
    if ((earlyPreview?.breakdown.newBalance ?? 0) > 0) {
      setIsPaymentModalOpen(true);
      return;
    }
    setIsCheckoutConfirmOpen(true);
  };

  // Se retira antes pero se cobra igual la reserva completa (flujo normal).
  const chooseChargeFull = () => {
    setIsEarlyModalOpen(false);
    setCheckoutMode("normal");
    if (debt > 0) {
      setIsPaymentModalOpen(true);
      return;
    }
    setIsCheckoutConfirmOpen(true);
  };

  const executeCheckout = () => {
    const reservationId = room.reservationId;
    if (!reservationId) return;

    const runCheckout = checkoutMode === "early" ? handleEarlyCheckOut : handleCheckOut;
    startTransition(async () => {
      const result = await runCheckout({ reservationId });
      setIsCheckoutConfirmOpen(false);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        checkoutMode === "early"
          ? "Salida anticipada realizada."
          : "Check-out realizado correctamente."
      );
    });
  };

  const submitCheckoutPayment = async ({
    amount,
    paymentMethod,
  }: {
    amount: number;
    paymentMethod: "cash" | "credit_card" | "debit_card" | "bank_transfer" | "other" | "mercado_pago" | "vale_blanco" | "cuenta_corriente";
  }) => {
    const reservationId = room.reservationId;
    if (!reservationId) return { success: false as const, error: "Reserva no encontrada." };

    const runCheckout = checkoutMode === "early" ? handleEarlyCheckOut : handleCheckOut;
    const result = await runCheckout({
      reservationId,
      paymentAmount: amount,
      paymentMethod,
    });

    if (result.success) {
      setIsPaymentModalOpen(false);
      // Cierre a cuenta corriente: imprimir el comprobante que firma el cliente.
      if (paymentMethod === "cuenta_corriente" && result.data?.movementId) {
        openAccountVoucher(result.data.movementId);
      }
    }

    return result;
  };

  const submitExtend = (e: React.FormEvent) => {
    e.preventDefault();
    const reservationId = room.reservationId;
    if (!reservationId) return;

    startTransition(async () => {
      if (extendMode === "half_day") {
        const result = await handleLateCheckOut(reservationId);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        setIsExtendModalOpen(false);
        toast.success(
          result.data?.halfDayCharged
            ? "Medio día agregado a la reserva."
            : "El medio día ya estaba aplicado; no se volvió a cobrar."
        );
        return;
      }

      const result = await handleExtendReservation(reservationId, extendNights);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setIsExtendModalOpen(false);
      toast.success("Reserva ampliada exitosamente.");
    });
  };

  const onCancelReservation = () => {
    if (!room.reservationId) return;
    setCancelReason("");
    setIsCancelConfirmOpen(true);
  };

  const executeCancelReservation = () => {
    const reservationId = room.reservationId;
    const reason = cancelReason.trim();
    if (!reservationId || !reason) return;

    startTransition(async () => {
      const result = await handleCancelReservation(reservationId, reason);
      setIsCancelConfirmOpen(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setCancelReason("");
      toast.success("Reserva cancelada exitosamente.");
    });
  };

  const onMarkAvailable = () => {
    startTransition(async () => {
      const result = await handleMarkAvailable(room.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Habitacion marcada como disponible.");
    });
  };

  return (
    <div
      className={`relative bg-white rounded-xl border transition-all duration-300 shadow-sm hover:shadow-md ${room.isLate ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200"}`}
    >
      <div
        className={`p-3 border-b flex justify-between items-start rounded-t-xl ${room.status === "available"
          ? "bg-slate-50 border-slate-100"
          : room.status === "occupied"
            ? room.isLate
              ? "bg-amber-50 border-amber-100"
              : "bg-blue-50 border-blue-100"
            : "bg-slate-100 border-slate-200"
          }`}
      >
        <div>
          <h3 className="text-xl font-bold text-slate-800">Hab. {room.number}</h3>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{room.type}</p>
        </div>

        <div
          className={`px-2.5 py-1 rounded-full text-xs font-bold border ${room.status === "available"
            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
            : room.status === "occupied"
              ? room.isLate
                ? "bg-amber-500 text-white border-amber-600 shadow-sm"
                : "bg-blue-100 text-blue-700 border-blue-200"
              : room.status === "maintenance"
                ? "bg-red-100 text-red-700 border-red-200"
                : "bg-slate-200 text-slate-600 border-slate-300"
            }`}
        >
          {room.status === "available" && "Disponible"}
          {room.status === "occupied" &&
            (room.isLate
              ? "Retraso Check-out"
              : room.hasLateCheckout
                ? "Late Check-out"
                : "Ocupada")}
          {room.status === "cleaning" && "Limpieza"}
          {room.status === "maintenance" && "Mantenimiento"}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {room.status === "occupied" && (
          <>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Huesped</p>
              <p className="text-sm font-semibold text-slate-800 truncate">{room.client}</p>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">
                  {room.hasLateCheckout ? "Check-out efectivo" : "Check-out"}
                </p>
                <p
                  className={`text-sm font-bold flex items-center ${room.isLate ? "text-amber-600" : "text-slate-800"}`}
                >
                  <Clock size={13} className="mr-1.5" />
                  {room.checkout}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 mb-0.5">Pendiente</p>
                <p className={`text-sm font-bold ${debt > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  ${debt.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            <div className="pt-1 flex gap-2">
              {room.canChargeLateCheckout && (
                <button
                  onClick={onLateCheckout}
                  disabled={isPending}
                  className="flex-1 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-700 border border-amber-200 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  Cobrar Medio Dia
                </button>
              )}
              <button
                onClick={() => {
                  setExtendMode("nights");
                  setExtendNights(1);
                  setIsExtendModalOpen(true);
                }}
                disabled={isPending}
                className="flex-1 px-3 py-2 rounded-lg disabled:opacity-50 text-sm font-bold transition-colors bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
              >
                Ampliar Reserva
              </button>
              <button
                onClick={onCheckoutClick}
                disabled={isPending}
                className={`flex-1 px-3 py-2 rounded-lg disabled:opacity-50 text-sm font-bold transition-colors ${room.isLate
                  ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  : "bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200"
                  }`}
              >
                Hacer Check-Out
              </button>
            </div>
            <div className={`pt-1 grid gap-2 ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`}>
              <button
                onClick={() => setIsExtrasModalOpen(true)}
                disabled={isPending}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-bold transition-colors bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50"
              >
                <Plus size={13} />
                Extra
              </button>
              <button
                onClick={() => setIsChangeRoomModalOpen(true)}
                disabled={isPending}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-bold transition-colors bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200 disabled:opacity-50"
              >
                <Replace size={13} />
                Cambiar
              </button>
              {isAdmin && (
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  disabled={isPending}
                  className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-bold transition-colors bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200 disabled:opacity-50"
                >
                  <Pencil size={13} />
                  Editar
                </button>
              )}
            </div>
            <div className="pt-1 flex">
              <button
                onClick={onCancelReservation}
                disabled={isPending}
                className="w-full text-xs font-bold text-red-500 hover:text-red-600 hover:underline transition-colors mt-2 text-center"
              >
                Cancelar Reserva
              </button>
            </div>
          </>
        )}

        {room.status === "available" && (
          <div className="flex flex-col items-center justify-center py-4 gap-2">
            {isConfirmedArrival ? (
              <>
                <div className="w-full bg-green-50 border border-green-200 rounded-lg p-3 text-center mb-1">
                  <p className="text-xs text-green-600 font-bold uppercase tracking-wide mb-0.5">Reserva para Hoy</p>
                  <p className="text-sm font-semibold text-green-800 truncate">{room.client}</p>
                  <p className="text-xs text-green-600 mt-0.5">Check-out: {room.checkout}</p>
                </div>
                <button
                  onClick={onCheckIn}
                  disabled={isPending}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-2.5 rounded-lg text-sm font-bold transition-colors shadow-sm"
                >
                  Hacer Check-In Automático
                </button>
                <button
                  onClick={onCancelReservation}
                  disabled={isPending}
                  className="w-full text-xs font-bold text-red-500 hover:text-red-600 hover:underline transition-colors text-center"
                >
                  Cancelar Reserva
                </button>
              </>
            ) : (
              <>
                <BedDouble size={24} className="text-slate-200 mb-1" />
                <button
                  onClick={() => setIsWalkInModalOpen(true)}
                  className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2.5 rounded-lg text-sm font-bold transition-colors shadow-sm"
                >
                  Hacer Check-In
                </button>
                {isAdmin && (
                  <button
                    onClick={onSetMaintenance}
                    disabled={isPending}
                    className="w-full text-xs font-bold text-slate-400 hover:text-slate-600 hover:underline transition-colors text-center mt-1"
                  >
                    Poner en Mantenimiento
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {room.status === "cleaning" && (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="text-sm text-slate-500 font-medium text-center px-4">
              En proceso de aseo por mantenimiento.
            </p>
            {isAdmin ? (
              <button
                onClick={onMarkAvailable}
                disabled={isPending}
                className="mt-4 w-full bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 border border-slate-300 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
              >
                Marcar Lista
              </button>
            ) : (
              <p className="mt-4 text-xs text-slate-400 text-center italic px-4">
                Esperando a que mantenimiento la marque como lista.
              </p>
            )}
          </div>
        )}

        {room.status === "maintenance" && (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="text-sm text-slate-500 font-medium text-center px-4">
              Habitación fuera de servicio por mantenimiento.
            </p>
            {isAdmin ? (
              <button
                onClick={onMarkAvailable}
                disabled={isPending}
                className="mt-4 w-full bg-white hover:bg-slate-50 disabled:opacity-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
              >
                Marcar Disponible
              </button>
            ) : (
              <p className="mt-4 text-xs text-slate-400 text-center italic px-4">
                Esperando a que mantenimiento la habilite.
              </p>
            )}
          </div>
        )}
      </div>

      <WalkInModal
        isOpen={isWalkInModalOpen}
        onClose={() => setIsWalkInModalOpen(false)}
        roomNumber={room.number}
        basePrice={room.basePrice}
        halfDayPrice={room.halfDayPrice}
        associatedClients={associatedClients}
        onSubmit={(data) => handleAssignWalkIn({ ...data, roomId: room.id })}
      />

      {isPaymentModalOpen && room.reservationId && (
        <PaymentModal
          isOpen
          onClose={() => setIsPaymentModalOpen(false)}
          clientName={room.client || "Desconocido"}
          baseTotalPrice={early ? early.newBaseTotal : room.baseTotalPrice}
          discountPercent={room.discountPercent}
          discountAmount={early ? early.newDiscountAmount : room.discountAmount}
          totalPrice={early ? early.newTotal : room.totalPrice}
          paidAmount={room.paidAmount}
          accountCreditEnabled={room.accountCreditEnabled}
          onSubmitPayment={submitCheckoutPayment}
          noteText={
            early
              ? `Salida anticipada: se cobran ${early.chargedNights} noche${early.chargedNights === 1 ? "" : "s"} (reservó ${early.originalNights}).`
              : undefined
          }
        />
      )}

      {isEarlyModalOpen && earlyPreview && (
        <EarlyCheckoutModal
          clientName={room.client || "Desconocido"}
          reservedUntilLabel={earlyPreview.reservedUntilLabel}
          departureLabel={earlyPreview.departureLabel}
          originalNights={earlyPreview.breakdown.originalNights}
          chargedNights={earlyPreview.breakdown.chargedNights}
          originalTotal={room.totalPrice}
          newTotal={earlyPreview.breakdown.newTotal}
          newBalance={earlyPreview.breakdown.newBalance}
          paidAmount={room.paidAmount}
          isOverpaid={earlyPreview.breakdown.isOverpaid}
          isPending={isPending}
          onChargeEarly={chooseChargeEarly}
          onChargeFull={chooseChargeFull}
          onClose={() => setIsEarlyModalOpen(false)}
        />
      )}

      {isCheckoutConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in text-left">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 relative">
            <h3 className="text-xl font-bold text-slate-800 mb-2">
              {early ? "Confirmar salida anticipada" : "Confirmar Check-Out"}
            </h3>
            <p className="text-sm text-slate-600 mb-6">
              {early ? (
                <>
                  Vas a cerrar la estadía de <strong>{room.client}</strong> cobrando{" "}
                  {early.chargedNights} noche{early.chargedNights === 1 ? "" : "s"} (salida
                  anticipada). La habitación pasará a estado de limpieza.
                </>
              ) : (
                <>
                  Estás a punto de finalizar la estadía de <strong>{room.client}</strong>. La deuda
                  total está saldada y la habitación pasará a estado de limpieza.
                </>
              )}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="px-4 py-2 text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                onClick={() => setIsCheckoutConfirmOpen(false)}
                disabled={isPending}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="px-4 py-2 text-white font-bold bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors flex items-center gap-2"
                onClick={executeCheckout}
                disabled={isPending}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {isExtendModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in text-left">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 relative">
            <h3 className="text-xl font-bold text-slate-800 mb-2">Ampliar Reserva</h3>
            <p className="text-sm text-slate-600 mb-4">
              Extendé la estadía de <strong>{room.client}</strong>.
            </p>
            <form onSubmit={submitExtend}>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setExtendMode("nights")}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                    extendMode === "nights"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  Noche(s)
                </button>
                <button
                  type="button"
                  onClick={() => setExtendMode("half_day")}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                    extendMode === "half_day"
                      ? "border-amber-500 bg-amber-50 text-amber-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  Medio día
                </button>
              </div>
              {extendMode === "nights" ? (
                <div className="mb-6">
                  <label className="block text-sm font-bold text-slate-700 mb-2">Noches Adicionales</label>
                  <input
                    type="number"
                    min="1"
                    value={extendNights}
                    onChange={(e) => setExtendNights(parseInt(e.target.value, 10) || 1)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                    required
                  />
                </div>
              ) : (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Se cobra el precio de <strong>medio día</strong> y la salida pasa al horario de
                  late check-out. Se aplica una vez por reserva.
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  className="px-4 py-2 text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  onClick={() => setIsExtendModalOpen(false)}
                  disabled={isPending}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-white font-bold bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  disabled={isPending}
                >
                  Ampliar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isExtrasModalOpen && room.reservationId && (
        <ExtraChargesModal
          isOpen
          onClose={() => setIsExtrasModalOpen(false)}
          reservationId={room.reservationId}
          clientName={room.client ?? "Reserva"}
          currentTotal={room.totalPrice}
        />
      )}

      {isChangeRoomModalOpen && room.reservationId && (
        <ChangeRoomModal
          isOpen
          onClose={() => setIsChangeRoomModalOpen(false)}
          reservationId={room.reservationId}
          clientName={room.client ?? "Reserva"}
          currentRoomNumber={room.number}
          checkInTarget={room.check_in_target}
          checkOutTarget={room.check_out_target}
          currentTotal={room.totalPrice}
          currentBaseTotal={room.baseTotalPrice}
          currentDiscountAmount={room.discountAmount}
          discountPercent={room.discountPercent}
        />
      )}

      {isEditModalOpen && room.reservationId && (
        <EditReservationModal
          isOpen
          onClose={() => setIsEditModalOpen(false)}
          reservationId={room.reservationId}
          isAdmin={isAdmin}
        />
      )}

      {isCancelConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in text-left">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden p-6 relative">
            <h3 className="text-xl font-bold text-slate-800 mb-2">Cancelar Reserva</h3>
            <p className="text-sm text-slate-600 mb-4">
              Indica el motivo de cancelación para la reserva de <strong>{room.client}</strong>. Quedará auditado en la tabla de control.
            </p>
            <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor={`cancel-reason-${room.id}`}>
              Motivo
            </label>
            <textarea
              id={`cancel-reason-${room.id}`}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-red-500 focus:ring outline-none resize-none"
              placeholder="Ej. El pasajero reprogramó el viaje."
            />
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                className="px-4 py-2 text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                onClick={() => setIsCancelConfirmOpen(false)}
                disabled={isPending}
              >
                Volver
              </button>
              <button
                type="button"
                className="px-4 py-2 text-white font-bold bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                onClick={executeCancelReservation}
                disabled={isPending || !cancelReason.trim()}
              >
                Sí, Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
