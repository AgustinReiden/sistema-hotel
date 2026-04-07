"use client";

import { useEffect, useState } from "react";
import { X, Calendar as CalendarIcon, Clock as ClockIcon, CreditCard, Phone } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Room } from "@/lib/types";

type ReservationFormData = {
  roomId: number;
  clientName: string;
  clientDni: string;
  clientPhone?: string;
  checkIn: string;
  checkOut: string;
};

type InitialReservationValues = Partial<ReservationFormData>;

type NewReservationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ReservationFormData) => Promise<{ success: boolean; error?: string }>;
  rooms: Room[];
  initialValues?: InitialReservationValues;
  title?: string;
};

type ReservationFormState = {
  clientName: string;
  clientDni: string;
  clientPhone: string;
  roomId: number | "";
  checkIn: string;
  checkOut: string;
};

function buildDefaultDateValues() {
  const defaultCheckIn = new Date();
  defaultCheckIn.setHours(14, 0, 0, 0);

  const defaultCheckOut = new Date();
  defaultCheckOut.setDate(defaultCheckOut.getDate() + 1);
  defaultCheckOut.setHours(10, 0, 0, 0);

  return {
    checkIn: format(defaultCheckIn, "yyyy-MM-dd'T'HH:mm"),
    checkOut: format(defaultCheckOut, "yyyy-MM-dd'T'HH:mm"),
  };
}

function buildInitialState(initialValues?: InitialReservationValues): ReservationFormState {
  const defaults = buildDefaultDateValues();

  return {
    clientName: initialValues?.clientName ?? "",
    clientDni: initialValues?.clientDni ?? "",
    clientPhone: initialValues?.clientPhone ?? "",
    roomId: initialValues?.roomId ?? "",
    checkIn: initialValues?.checkIn ?? defaults.checkIn,
    checkOut: initialValues?.checkOut ?? defaults.checkOut,
  };
}

export default function NewReservationModal({
  isOpen,
  onClose,
  onSubmit,
  rooms,
  initialValues,
  title = "Nueva Reserva",
}: NewReservationModalProps) {
  const [form, setForm] = useState<ReservationFormState>(() => buildInitialState(initialValues));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildInitialState(initialValues));
  }, [isOpen, initialValues]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientName.trim() || !form.clientDni.trim() || form.roomId === "" || !form.checkIn || !form.checkOut) {
      return;
    }

    if (new Date(form.checkOut) <= new Date(form.checkIn)) {
      toast.error("La fecha de salida debe ser posterior a la fecha de entrada.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onSubmit({
        roomId: Number(form.roomId),
        clientName: form.clientName.trim(),
        clientDni: form.clientDni.trim(),
        clientPhone: form.clientPhone.trim() || undefined,
        checkIn: new Date(form.checkIn).toISOString(),
        checkOut: new Date(form.checkOut).toISOString(),
      });

      if (result.success) {
        toast.success("Reserva creada correctamente.");
        setForm(buildInitialState(initialValues));
        onClose();
      } else {
        toast.error(result.error || "Error al crear reserva");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="clientName" className="block text-sm font-semibold text-slate-700 mb-1.5">Nombre del Huésped</label>
              <input
                id="clientName"
                type="text"
                required
                value={form.clientName}
                onChange={(e) => setForm((current) => ({ ...current, clientName: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Ej. María López"
              />
            </div>

            <div>
              <label htmlFor="clientDni" className="block text-sm font-semibold text-slate-700 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <CreditCard size={14} />
                  DNI o CUIT
                </span>
              </label>
              <input
                id="clientDni"
                type="text"
                required
                value={form.clientDni}
                onChange={(e) => setForm((current) => ({ ...current, clientDni: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Ej. 20-12345678-3"
              />
            </div>

            <div>
              <label htmlFor="clientPhone" className="block text-sm font-semibold text-slate-700 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Phone size={14} />
                  Teléfono
                </span>
              </label>
              <input
                id="clientPhone"
                type="tel"
                value={form.clientPhone}
                onChange={(e) => setForm((current) => ({ ...current, clientPhone: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Opcional"
              />
            </div>
          </div>

          <div>
            <label htmlFor="roomId" className="block text-sm font-semibold text-slate-700 mb-1.5">Habitación</label>
            <select
              id="roomId"
              required
              value={form.roomId}
              onChange={(e) => setForm((current) => ({ ...current, roomId: e.target.value ? Number(e.target.value) : "" }))}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            >
              <option value="">Seleccione una habitación</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  Hab. {room.room_number} - {room.room_type} ({room.status === "available" ? "Disponible" : "Ocupada/Aseo"})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="checkIn" className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center">
                <CalendarIcon size={14} className="mr-1" /> Entrada
              </label>
              <input
                id="checkIn"
                type="datetime-local"
                required
                value={form.checkIn}
                onChange={(e) => setForm((current) => ({ ...current, checkIn: e.target.value }))}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
              />
            </div>
            <div>
              <label htmlFor="checkOut" className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center">
                <ClockIcon size={14} className="mr-1" /> Salida Target
              </label>
              <input
                id="checkOut"
                type="datetime-local"
                required
                value={form.checkOut}
                onChange={(e) => setForm((current) => ({ ...current, checkOut: e.target.value }))}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Nombre y DNI/CUIT son obligatorios para el staff. El teléfono es opcional.
          </div>

          <div className="pt-4 border-t border-slate-100 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !form.clientName.trim() || !form.clientDni.trim() || form.roomId === ""}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors shadow-md shadow-emerald-600/20"
            >
              {isSubmitting ? "Creando..." : "Crear Reserva"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
