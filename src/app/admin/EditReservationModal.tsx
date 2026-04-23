"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import {
  handleLoadReservationForEdit,
  handleUpdateReservation,
} from "./actions";
import type { ReservationEditableRow } from "@/lib/data";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  reservationId: string;
  isAdmin: boolean;
};

// Convierte un ISO timestamp a formato `datetime-local` (sin timezone)
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditReservationModal({
  isOpen,
  onClose,
  reservationId,
  isAdmin,
}: Props) {
  const [data, setData] = useState<ReservationEditableRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientDni, setClientDni] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideValue, setOverrideValue] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      return handleLoadReservationForEdit(reservationId);
    }).then((result) => {
      if (cancelled || !result) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      const row = result.data!;
      setData(row);
      setClientName(row.client_name);
      setClientDni(row.client_dni ?? "");
      setClientPhone(row.client_phone ?? "");
      setNotes(row.notes ?? "");
      setCheckIn(toDateTimeLocal(row.check_in_target));
      setCheckOut(toDateTimeLocal(row.check_out_target));
      setGuestCount(row.guest_count ?? 1);
      setOverrideEnabled(false);
      setOverrideValue(row.total_price.toString());
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, reservationId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!data) return;
    if (!clientName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!checkIn || !checkOut) {
      setError("Las fechas son obligatorias.");
      return;
    }
    const inDate = new Date(checkIn);
    const outDate = new Date(checkOut);
    if (outDate <= inDate) {
      setError("La fecha de salida debe ser posterior a la de entrada.");
      return;
    }

    let override: number | null = null;
    if (isAdmin && overrideEnabled) {
      const parsed = parseFloat(overrideValue.replace(",", "."));
      if (isNaN(parsed) || parsed < 0) {
        setError("El precio override debe ser un número mayor o igual a 0.");
        return;
      }
      if (parsed < data.paid_amount) {
        setError(
          `No podés poner un total menor al ya pagado ($${data.paid_amount.toFixed(2)}).`
        );
        return;
      }
      override = parsed;
    }

    setSubmitting(true);
    const result = await handleUpdateReservation({
      reservationId: data.id,
      clientName: clientName.trim(),
      clientDni: clientDni.trim() || null,
      clientPhone: clientPhone.trim() || null,
      notes: notes.trim() || null,
      checkIn: inDate.toISOString(),
      checkOut: outDate.toISOString(),
      overrideTotalPrice: override,
      guestCount,
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    if (result.data?.dates_changed && !result.data.price_overridden) {
      toast.success(
        `Reserva actualizada. Nuevo total: $${result.data.total_price.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`
      );
    } else if (result.data?.price_overridden) {
      toast.success("Reserva actualizada con precio manual.");
    } else {
      toast.success("Reserva actualizada.");
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <Pencil size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-800 truncate">Editar Reserva</h2>
              {data && (
                <p className="text-slate-500 text-sm font-medium truncate">
                  Hab. {data.room_number} · Pagado ${data.paid_amount.toLocaleString("es-AR")}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={24} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 size={20} className="animate-spin mr-2" />
            Cargando reserva...
          </div>
        ) : !data ? (
          <div className="p-8 text-center text-slate-500">
            {error ?? "No se pudo cargar la reserva."}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">DNI</label>
                  <input
                    type="text"
                    value={clientDni}
                    onChange={(e) => setClientDni(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Teléfono</label>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Check-in</label>
                  <input
                    type="datetime-local"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Check-out</label>
                  <input
                    type="datetime-local"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Cantidad de pasajeros
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={guestCount}
                    onChange={(e) =>
                      setGuestCount(Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Notas</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none resize-none text-sm"
                />
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total actual</span>
                  <span className="font-bold text-slate-800">
                    ${data.total_price.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Si cambiás las fechas, el precio se recalcula automáticamente con los descuentos actuales.
                </p>
              </div>

              {isAdmin && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm font-bold text-amber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideEnabled}
                      onChange={(e) => setOverrideEnabled(e.target.checked)}
                      className="rounded border-amber-300"
                    />
                    Sobrescribir precio total (solo admin)
                  </label>
                  {overrideEnabled && (
                    <div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={overrideValue}
                        onChange={(e) => setOverrideValue(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-amber-300 focus:border-amber-500 focus:ring outline-none"
                      />
                      <p className="text-[11px] text-amber-700 mt-1">
                        Mínimo ${data.paid_amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })} (ya pagado).
                      </p>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">
                  {error}
                </p>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
              >
                {submitting ? <Loader2 className="animate-spin" size={18} /> : <Pencil size={18} />}
                Guardar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
