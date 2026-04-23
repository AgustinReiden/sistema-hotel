"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Guest } from "@/lib/types";
import { DollarSign, Loader2, X, XCircle } from "lucide-react";
import { toast } from "sonner";

import PaymentModal from "@/app/components/PaymentModal";
import { handleCancelReservation } from "@/app/admin/actions";

export default function GuestsClientTable({
  initialGuests,
  searchQuery,
}: {
  initialGuests: Guest[];
  searchQuery: string;
}) {
  const router = useRouter();
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [cancellingGuest, setCancellingGuest] = useState<Guest | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const submitCancel = () => {
    if (!cancellingGuest || !cancelReason.trim()) return;
    const reservationId = cancellingGuest.id;
    const reason = cancelReason.trim();
    startTransition(async () => {
      const result = await handleCancelReservation(reservationId, reason);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Huésped cancelado.");
      setCancellingGuest(null);
      setCancelReason("");
      router.refresh();
    });
  };

  return (
    <div className="bg-white border text-left border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
            <th className="px-6 py-4">Huésped</th>
            <th className="px-6 py-4">Habitación</th>
            <th className="px-6 py-4">Fechas</th>
            <th className="px-6 py-4">Estado</th>
            <th className="px-6 py-4 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {initialGuests.map((guest) => {
            const isCancelled = guest.status === "cancelled";
            const isCheckedOut = guest.status === "checked_out";
            const canPay = !isCancelled && !isCheckedOut;
            const canCancel = !isCancelled;
            const debt = Math.max(0, guest.total_price - guest.paid_amount);

            return (
              <tr key={guest.id} className={`hover:bg-slate-50/50 transition-colors group ${isCancelled ? "opacity-60" : ""}`}>
                <td className="px-6 py-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs shrink-0">
                      {guest.client_name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span
                        className={`font-medium ${isCancelled ? "text-slate-500 line-through" : isCheckedOut ? "text-slate-600" : "text-slate-900"}`}
                      >
                        {guest.client_name}
                      </span>
                      {debt > 0 && canPay && (
                        <span className="text-[10px] uppercase font-bold text-amber-600 tracking-wider">
                          Deuda: ${debt.toLocaleString("en-US")}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                    Hab. {guest.room_number}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-slate-900 font-medium">
                    {format(new Date(guest.check_in_target), "dd MMM, HH:mm", { locale: es })}
                  </p>
                  <p className="text-xs text-slate-500">
                    {format(new Date(guest.check_out_target), "dd MMM yyyy", { locale: es })}
                  </p>
                </td>
                <td className="px-6 py-4">
                  {guest.status === "checked_in" && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                      Hospedado
                    </span>
                  )}
                  {(guest.status === "pending" || guest.status === "confirmed") && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                      Por Llegar
                    </span>
                  )}
                  {isCheckedOut && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                      Finalizado
                    </span>
                  )}
                  {isCancelled && (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                      Cancelado
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex gap-1 justify-end">
                    {canPay && (
                      <button
                        onClick={() => setSelectedGuest(guest)}
                        className="inline-flex items-center justify-center p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        title="Registrar Pago"
                      >
                        <DollarSign size={18} />
                      </button>
                    )}
                    {canCancel && (
                      <button
                        onClick={() => {
                          setCancellingGuest(guest);
                          setCancelReason("");
                        }}
                        className="inline-flex items-center justify-center p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Cancelar reserva"
                      >
                        <XCircle size={18} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {initialGuests.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          {searchQuery
            ? "No hay resultados para la búsqueda indicada."
            : "No hay huéspedes registrados en el historial de reservas."}
        </div>
      )}

      {selectedGuest && (
        <PaymentModal
          isOpen={!!selectedGuest}
          onClose={() => setSelectedGuest(null)}
          reservationId={selectedGuest.id}
          clientName={selectedGuest.client_name}
          totalPrice={selectedGuest.total_price}
          paidAmount={selectedGuest.paid_amount}
          onSuccess={() => {
            setSelectedGuest(null);
            router.refresh();
          }}
        />
      )}

      {cancellingGuest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                  <XCircle size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Cancelar Huésped</h2>
                  <p className="text-slate-500 text-sm font-medium truncate">
                    {cancellingGuest.client_name} · Hab. {cancellingGuest.room_number}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCancellingGuest(null)}
                disabled={isPending}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Queda auditado en la tabla de cancelaciones. Los pagos registrados no se tocan.
              </p>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="guest-cancel-reason">
                  Motivo
                </label>
                <textarea
                  id="guest-cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  placeholder="Ej. Cobro duplicado, reserva de prueba, etc."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-red-500 focus:ring outline-none resize-none text-sm"
                />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setCancellingGuest(null)}
                  disabled={isPending}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={submitCancel}
                  disabled={isPending || !cancelReason.trim()}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
                >
                  {isPending ? <Loader2 className="animate-spin" size={18} /> : <XCircle size={18} />}
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
