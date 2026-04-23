"use client";

import { useEffect, useState } from "react";
import {
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  CreditCard,
  Percent,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import AssociatedClientSelector from "./AssociatedClientSelector";
import { calculateReservationPriceBreakdown } from "@/lib/pricing";
import type {
  AssociatedClient,
  CreateReservationPayload,
  ReservationCustomerMode,
  Room,
} from "@/lib/types";

type ReservationFormData = CreateReservationPayload;

type InitialReservationValues = Partial<{
  customerMode: ReservationCustomerMode;
  roomId: number;
  clientName: string;
  clientDni: string;
  clientPhone: string;
  associatedClientId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
}>;

type NewReservationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ReservationFormData) => Promise<{ success: boolean; error?: string }>;
  rooms: Room[];
  associatedClients: AssociatedClient[];
  initialValues?: InitialReservationValues;
  title?: string;
  /** Horas configuradas por admin en /admin/settings (formato "HH:MM" o "HH:MM:SS"). */
  standardCheckInTime?: string;
  standardCheckOutTime?: string;
};

type ReservationFormState = {
  customerMode: ReservationCustomerMode;
  clientName: string;
  clientDni: string;
  clientPhone: string;
  associatedClientId: string;
  roomId: number | "";
  checkIn: string;
  checkOut: string;
  guestCount: number;
};

function parseHour(value: string | undefined, fallbackH: number, fallbackM: number): { h: number; m: number } {
  if (!value) return { h: fallbackH, m: fallbackM };
  const [hh, mm] = value.split(":").map((p) => parseInt(p, 10));
  return {
    h: Number.isFinite(hh) ? hh : fallbackH,
    m: Number.isFinite(mm) ? mm : fallbackM,
  };
}

function buildDefaultDateValues(checkInTime?: string, checkOutTime?: string) {
  const checkInH = parseHour(checkInTime, 14, 0);
  const checkOutH = parseHour(checkOutTime, 10, 0);

  const defaultCheckIn = new Date();
  defaultCheckIn.setHours(checkInH.h, checkInH.m, 0, 0);

  const defaultCheckOut = new Date();
  defaultCheckOut.setDate(defaultCheckOut.getDate() + 1);
  defaultCheckOut.setHours(checkOutH.h, checkOutH.m, 0, 0);

  return {
    checkIn: format(defaultCheckIn, "yyyy-MM-dd'T'HH:mm"),
    checkOut: format(defaultCheckOut, "yyyy-MM-dd'T'HH:mm"),
  };
}

function buildInitialState(
  initialValues?: InitialReservationValues,
  checkInTime?: string,
  checkOutTime?: string
): ReservationFormState {
  const defaults = buildDefaultDateValues(checkInTime, checkOutTime);

  return {
    customerMode: initialValues?.customerMode ?? "manual",
    clientName: initialValues?.clientName ?? "",
    clientDni: initialValues?.clientDni ?? "",
    clientPhone: initialValues?.clientPhone ?? "",
    associatedClientId: initialValues?.associatedClientId ?? "",
    roomId: initialValues?.roomId ?? "",
    checkIn: initialValues?.checkIn ?? defaults.checkIn,
    checkOut: initialValues?.checkOut ?? defaults.checkOut,
    guestCount: initialValues?.guestCount ?? 1,
  };
}

export default function NewReservationModal({
  isOpen,
  onClose,
  onSubmit,
  rooms,
  associatedClients,
  initialValues,
  title = "Nueva Reserva",
  standardCheckInTime,
  standardCheckOutTime,
}: NewReservationModalProps) {
  const [form, setForm] = useState<ReservationFormState>(() =>
    buildInitialState(initialValues, standardCheckInTime, standardCheckOutTime)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildInitialState(initialValues, standardCheckInTime, standardCheckOutTime));
  }, [isOpen, initialValues, standardCheckInTime, standardCheckOutTime]);

  if (!isOpen) return null;

  const selectedRoom =
    form.roomId === "" ? null : rooms.find((room) => room.id === Number(form.roomId)) ?? null;
  const selectedAssociatedClient =
    associatedClients.find((client) => client.id === form.associatedClientId) ?? null;
  const hasValidDates =
    Boolean(form.checkIn) &&
    Boolean(form.checkOut) &&
    new Date(form.checkOut).getTime() > new Date(form.checkIn).getTime();
  const pricePreview =
    form.customerMode === "associated" && selectedRoom && selectedAssociatedClient && hasValidDates
      ? calculateReservationPriceBreakdown({
          basePrice: selectedRoom.base_price,
          checkIn: new Date(form.checkIn).toISOString(),
          checkOut: new Date(form.checkOut).toISOString(),
          discountPercent: selectedAssociatedClient.discount_percent,
        })
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.roomId === "" || !form.checkIn || !form.checkOut) {
      return;
    }

    if (new Date(form.checkOut) <= new Date(form.checkIn)) {
      toast.error("La fecha de salida debe ser posterior a la fecha de entrada.");
      return;
    }

    if (form.customerMode === "manual") {
      if (!form.clientName.trim() || !form.clientDni.trim()) return;
    } else if (!form.associatedClientId) {
      toast.error("Selecciona un asociado para continuar.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: ReservationFormData =
        form.customerMode === "manual"
          ? {
              customerMode: "manual",
              roomId: Number(form.roomId),
              clientName: form.clientName.trim(),
              clientDni: form.clientDni.trim(),
              clientPhone: form.clientPhone.trim() || undefined,
              checkIn: new Date(form.checkIn).toISOString(),
              checkOut: new Date(form.checkOut).toISOString(),
              guestCount: form.guestCount,
            }
          : {
              customerMode: "associated",
              roomId: Number(form.roomId),
              associatedClientId: form.associatedClientId,
              checkIn: new Date(form.checkIn).toISOString(),
              checkOut: new Date(form.checkOut).toISOString(),
              guestCount: form.guestCount,
            };

      const result = await onSubmit(payload);

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
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">Tipo de cliente</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, customerMode: "manual" }))}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  form.customerMode === "manual"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="font-semibold text-slate-800">Cliente ocasional</p>
                <p className="text-sm text-slate-500">
                  Carga manual. No se guarda en el padrón de asociados.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, customerMode: "associated" }))}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  form.customerMode === "associated"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="font-semibold text-slate-800">Asociado</p>
                <p className="text-sm text-slate-500">
                  Selecciona uno existente y aplica su descuento automáticamente.
                </p>
              </button>
            </div>
          </div>

          {form.customerMode === "manual" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="clientName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Nombre del Huésped
                </label>
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
          ) : (
            <div className="space-y-4">
              <AssociatedClientSelector
                clients={associatedClients}
                selectedId={form.associatedClientId}
                onSelect={(id) => setForm((current) => ({ ...current, associatedClientId: id }))}
                inputId="associatedClient"
                label="Asociado"
              />

              {selectedAssociatedClient ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                      Nombre
                    </p>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <UserRound size={14} className="text-slate-400" />
                      {selectedAssociatedClient.display_name}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                      DNI/CUIT
                    </p>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <CreditCard size={14} className="text-slate-400" />
                      {selectedAssociatedClient.document_id}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                      Teléfono
                    </p>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Phone size={14} className="text-slate-400" />
                      {selectedAssociatedClient.phone || "Sin dato"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Selecciona un asociado activo para usar sus datos y descuento en esta reserva.
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="roomId" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Habitación
            </label>
            <select
              id="roomId"
              required
              value={form.roomId}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  roomId: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            >
              <option value="">Seleccione una habitación</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  Hab. {room.room_number} - {room.room_type} (
                  {room.status === "available" ? "Disponible" : "Ocupada/Aseo"})
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

          <div>
            <label htmlFor="guestCount" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Cantidad de pasajeros
            </label>
            <input
              id="guestCount"
              type="number"
              min={1}
              max={20}
              value={form.guestCount}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  guestCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                }))
              }
              className="w-full md:w-40 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
            />
            <p className="text-xs text-slate-500 mt-1">
              Opcional. No afecta el precio (se calcula por habitacion).
            </p>
          </div>

          {pricePreview && selectedAssociatedClient && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="flex items-center gap-2 text-emerald-700 mb-3">
                <Percent size={16} />
                <p className="text-sm font-bold">Vista previa del descuento del asociado</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs uppercase font-bold text-emerald-600">Noches</p>
                  <p className="font-semibold text-slate-800">{pricePreview.nights}</p>
                </div>
                <div>
                  <p className="text-xs uppercase font-bold text-emerald-600">Total base</p>
                  <p className="font-semibold text-slate-800">
                    ${pricePreview.baseTotalPrice.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase font-bold text-emerald-600">Descuento</p>
                  <p className="font-semibold text-slate-800">
                    {selectedAssociatedClient.discount_percent.toLocaleString("es-AR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                    % (${pricePreview.discountAmount.toLocaleString("es-AR", { minimumFractionDigits: 2 })})
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase font-bold text-emerald-600">Total final</p>
                  <p className="font-semibold text-emerald-700">
                    ${pricePreview.finalTotalPrice.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {form.customerMode === "manual"
              ? "Nombre y DNI/CUIT son obligatorios para reservas manuales. El teléfono es opcional."
              : "Al seleccionar un asociado, la reserva guarda una copia de sus datos y del descuento vigente en ese momento."}
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
              disabled={
                isSubmitting ||
                form.roomId === "" ||
                (form.customerMode === "manual"
                  ? !form.clientName.trim() || !form.clientDni.trim()
                  : !form.associatedClientId)
              }
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
