"use client";

import { useState, useTransition } from "react";
import { BedDouble, Clock } from "lucide-react";
import { toast } from "sonner";

import WalkInModal from "./WalkInModal";
import {
  handleLateCheckOut,
  handleMarkAvailable,
  handleCancelReservation,
  handleCheckOut,
  handleCheckIn,
  handleSetMaintenance,
  handleAssignWalkIn,
  handleExtendReservation,
} from "./actions";
import PaymentModal from "../components/PaymentModal";

type RoomCardProps = {
  room: {
    id: number;
    number: string;
    type: string;
    status: string;
    client: string | null;
    checkout: string | null;
    check_out_target: string | null;
    isLate: boolean;
    reservationId: string | null;
    reservationStatus: string | null;
    totalPrice: number;
    paidAmount: number;
    basePrice: number;
  };
};

export default function RoomCard({ room }: RoomCardProps) {
  const [isPending, startTransition] = useTransition();
  const [isWalkInModalOpen, setIsWalkInModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);
  const [isCheckoutConfirmOpen, setIsCheckoutConfirmOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [extendNights, setExtendNights] = useState(1);

  const debt = Math.max(0, room.totalPrice - room.paidAmount);
  const isConfirmedArrival = room.reservationStatus === "confirmed";

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

      toast.success("Medio dia cobrado y checkout extendido.");
    });
  };

  const onCheckoutClick = () => {
    const reservationId = room.reservationId;
    if (!reservationId) return;

    if (debt > 0) {
      setIsPaymentModalOpen(true);
      return;
    }

    setIsCheckoutConfirmOpen(true);
  };

  const executeCheckout = () => {
    const reservationId = room.reservationId;
    if (!reservationId) return;

    startTransition(async () => {
      const result = await handleCheckOut(reservationId);
      setIsCheckoutConfirmOpen(false);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Check-out realizado correctamente.");
    });
  };

  const executeCheckoutAfterPayment = () => {
    const reservationId = room.reservationId;
    if (!reservationId) return;
    startTransition(async () => {
      const result = await handleCheckOut(reservationId);
      if (!result.success) {
        toast.error("Pago registrado. Error al ejecutar el check-out: " + result.error);
        return;
      }
      toast.success("Pago registrado y check-out realizado.");
    });
  };

  const submitExtend = (e: React.FormEvent) => {
    e.preventDefault();
    const reservationId = room.reservationId;
    if (!reservationId) return;

    startTransition(async () => {
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
    const reservationId = room.reservationId;
    if (!reservationId) return;
    setIsCancelConfirmOpen(true);
  };

  const executeCancelReservation = () => {
    const reservationId = room.reservationId;
    if (!reservationId) return;

    startTransition(async () => {
      const result = await handleCancelReservation(reservationId);
      setIsCancelConfirmOpen(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
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
      className={`relative bg-white rounded-xl border transition-all duration-300 shadow-sm hover:shadow-md ${room.isLate ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200"
        }`}
    >
      <div
        className={`p-4 border-b flex justify-between items-start rounded-t-xl ${room.status === "available"
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
          {room.status === "occupied" && (room.isLate ? "Retraso Check-out" : "Ocupada")}
          {room.status === "cleaning" && "Limpieza"}
          {room.status === "maintenance" && "Mantenimiento"}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {room.status === "occupied" && (
          <>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Huesped</p>
              <p className="text-sm font-semibold text-slate-800 truncate">{room.client}</p>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Check-out Target</p>
                <p
                  className={`text-sm font-bold flex items-center ${room.isLate ? "text-amber-600" : "text-slate-800"
                    }`}
                >
                  <Clock size={14} className="mr-1.5" />
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
              {room.isLate && (
                <button
                  onClick={onLateCheckout}
                  disabled={isPending}
                  className="flex-1 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-700 border border-amber-200 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  Cobrar Medio Dia
                </button>
              )}
              <button
                onClick={() => setIsExtendModalOpen(true)}
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
                  <p className="text-xs text-green-600 font-bold uppercase tracking-wide mb-0.5">Reserva Confirmada</p>
                  <p className="text-sm font-semibold text-green-800 truncate">{room.client}</p>
                  <p className="text-xs text-green-600 mt-0.5">Check-out: {room.checkout}</p>
                </div>
                <button
                  onClick={onCheckIn}
                  disabled={isPending}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-2.5 rounded-lg text-sm font-bold transition-colors shadow-sm"
                >
                  Confirmar Check-In
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
                <BedDouble size={32} className="text-slate-200 mb-1" />
                <button
                  onClick={() => setIsWalkInModalOpen(true)}
                  className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2.5 rounded-lg text-sm font-bold transition-colors shadow-sm"
                >
                  Hacer Check-In
                </button>
                <button
                  onClick={onSetMaintenance}
                  disabled={isPending}
                  className="w-full text-xs font-bold text-slate-400 hover:text-slate-600 hover:underline transition-colors text-center mt-1"
                >
                  Poner en Mantenimiento
                </button>
              </>
            )}
          </div>
        )}

        {room.status === "cleaning" && (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="text-sm text-slate-500 font-medium text-center px-4">
              En proceso de aseo por el personal.
            </p>
            <button
              onClick={onMarkAvailable}
              disabled={isPending}
              className="mt-4 w-full bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 border border-slate-300 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
            >
              Marcar Lista
            </button>
          </div>
        )}

        {room.status === "maintenance" && (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="text-sm text-slate-500 font-medium text-center px-4">
              Habitación fuera de servicio por mantenimiento.
            </p>
            <button
              onClick={onMarkAvailable}
              disabled={isPending}
              className="mt-4 w-full bg-white hover:bg-slate-50 disabled:opacity-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
            >
              Marcar Disponible
            </button>
          </div>
        )}
      </div>

      <WalkInModal
        isOpen={isWalkInModalOpen}
        onClose={() => setIsWalkInModalOpen(false)}
        roomNumber={room.number}
        basePrice={room.basePrice}
        onSubmit={(clientName, nights) => handleAssignWalkIn(room.id, clientName, nights)}
      />

      {isPaymentModalOpen && room.reservationId && (
        <PaymentModal
          isOpen
          onClose={() => setIsPaymentModalOpen(false)}
          reservationId={room.reservationId}
          clientName={room.client || "Desconocido"}
          totalPrice={room.totalPrice}
          paidAmount={room.paidAmount}
          onSuccess={() => {
            setIsPaymentModalOpen(false);
            executeCheckoutAfterPayment();
          }}
        />
      )}

      {/* Checkout Confirm Modal */}
      {isCheckoutConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in text-left">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 relative">
            <h3 className="text-xl font-bold text-slate-800 mb-2">Confirmar Check-Out</h3>
            <p className="text-sm text-slate-600 mb-6">
              Estás a punto de finalizar la estadía de <strong>{room.client}</strong>. La deuda total está saldada y la habitación pasará a estado de limpieza.
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

      {/* Extend Reservation Modal */}
      {isExtendModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in text-left">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 relative">
            <h3 className="text-xl font-bold text-slate-800 mb-2">Ampliar Reserva</h3>
            <p className="text-sm text-slate-600 mb-4">
              Agrega noches a la estadía de <strong>{room.client}</strong>.
            </p>
            <form onSubmit={submitExtend}>
              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-700 mb-2">Noches Adicionales</label>
                <input
                  type="number"
                  min="1"
                  value={extendNights}
                  onChange={(e) => setExtendNights(parseInt(e.target.value) || 1)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                  required
                />
              </div>
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

      {/* Cancel Reservation Confirm Modal */}
      {isCancelConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in text-left">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 relative">
            <h3 className="text-xl font-bold text-slate-800 mb-2">Cancelar Reserva</h3>
            <p className="text-sm text-slate-600 mb-6">
              ¿Estás seguro de cancelar la reserva de <strong>{room.client}</strong>? Se vaciarán los registros de pago y se liberará la habitación.
            </p>
            <div className="flex gap-3 justify-end">
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
                className="px-4 py-2 text-white font-bold bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                onClick={executeCancelReservation}
                disabled={isPending}
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
