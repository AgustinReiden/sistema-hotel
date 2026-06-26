"use client";

import { useEffect, useState } from "react";
import {
  BedDouble,
  Building2,
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  CreditCard,
  Loader2,
  Percent,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import AssociatedClientSelector from "./AssociatedClientSelector";
import DateTimePickerField from "./DateTimePickerField";
import GuestRegistryFields from "./GuestRegistryFields";
import GuestSelector from "./GuestSelector";
import { fetchAvailableRoomsAction } from "./actions";
import { calculateReservationPriceBreakdown, resolveEffectiveDiscountPercent } from "@/lib/pricing";
import type {
  AssociatedClient,
  CreateReservationPayload,
  GuestDirectoryEntry,
  GuestRegistryInput,
  Room,
} from "@/lib/types";

type InitialReservationValues = Partial<{
  roomId: number;
  checkIn: string;
  checkOut: string;
  guestCount: number;
}>;

type NewReservationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateReservationPayload) => Promise<{ success: boolean; error?: string }>;
  rooms: Room[];
  associatedClients: AssociatedClient[];
  initialValues?: InitialReservationValues;
  title?: string;
  /** Horas configuradas por admin en /admin/settings (formato "HH:MM" o "HH:MM:SS"). */
  standardCheckInTime?: string;
  standardCheckOutTime?: string;
};

type ReservationFormState = {
  /** Id del padron si el huesped se eligio del directorio (habilita su descuento personal). */
  guestId: string | null;
  clientFirstName: string;
  clientLastName: string;
  clientDni: string;
  clientPhone: string;
  /** Descuento personal del huesped elegido (solo display + preview; el RPC lo revalida). */
  guestDiscountPercent: number;
  /** Esta reserva la paga una empresa/convenio (con descuento). */
  hasCompany: boolean;
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
    guestId: null,
    clientFirstName: "",
    clientLastName: "",
    clientDni: "",
    clientPhone: "",
    guestDiscountPercent: 0,
    hasCompany: false,
    associatedClientId: "",
    roomId: initialValues?.roomId ?? "",
    checkIn: initialValues?.checkIn ?? defaults.checkIn,
    checkOut: initialValues?.checkOut ?? defaults.checkOut,
    guestCount: initialValues?.guestCount ?? 1,
  };
}

// Fecha corta "dd MMM" a partir del string local "yyyy-MM-ddTHH:mm" del form.
function shortDate(local: string): string {
  if (!local) return "";
  return new Date(local).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  const last = parts.pop() as string;
  return { first: parts.join(" "), last };
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
  const [registry, setRegistry] = useState<GuestRegistryInput>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildInitialState(initialValues, standardCheckInTime, standardCheckOutTime));
    setRegistry({});
  }, [isOpen, initialValues, standardCheckInTime, standardCheckOutTime]);

  // Habitaciones libres para las fechas elegidas; se actualiza al cambiar check-in/out.
  useEffect(() => {
    if (!isOpen) return;
    const checkIn = form.checkIn;
    const checkOut = form.checkOut;
    if (!checkIn || !checkOut || new Date(checkOut).getTime() <= new Date(checkIn).getTime()) {
      setAvailableRooms([]);
      setLoadingRooms(false);
      return;
    }
    let active = true;
    setLoadingRooms(true);
    const timer = setTimeout(async () => {
      const rooms = await fetchAvailableRoomsAction(
        new Date(checkIn).toISOString(),
        new Date(checkOut).toISOString()
      );
      if (!active) return;
      setAvailableRooms(rooms);
      setLoadingRooms(false);
      // Si la habitación elegida dejó de estar libre para las nuevas fechas, la limpiamos.
      setForm((current) =>
        current.roomId !== "" && !rooms.some((r) => r.id === Number(current.roomId))
          ? { ...current, roomId: "" }
          : current
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, form.checkIn, form.checkOut]);

  const handleGuestSelect = (entry: GuestDirectoryEntry) => {
    const { first, last } = splitName(entry.client_name);
    setForm((current) => ({
      ...current,
      guestId: entry.id,
      clientFirstName: first,
      clientLastName: last,
      clientDni: entry.client_dni ?? "",
      clientPhone: entry.client_phone ?? "",
      guestDiscountPercent: entry.discount_percent ?? 0,
    }));
    setRegistry((current) => ({
      ...current,
      guestLocality: current.guestLocality ?? entry.guest_locality ?? undefined,
      guestNationality: current.guestNationality ?? entry.guest_nationality ?? undefined,
      guestDocType: current.guestDocType ?? entry.guest_doc_type ?? undefined,
    }));
    toast.success(`Huésped cargado: ${entry.client_name}`);
  };

  const clearGuest = () =>
    setForm((current) => ({
      ...current,
      guestId: null,
      clientFirstName: "",
      clientLastName: "",
      clientDni: "",
      clientPhone: "",
      guestDiscountPercent: 0,
    }));

  if (!isOpen) return null;

  const selectedRoom =
    form.roomId === "" ? null : rooms.find((room) => room.id === Number(form.roomId)) ?? null;
  const selectedAssociatedClient = form.hasCompany
    ? associatedClients.find((client) => client.id === form.associatedClientId) ?? null
    : null;
  const hasValidDates =
    Boolean(form.checkIn) &&
    Boolean(form.checkOut) &&
    new Date(form.checkOut).getTime() > new Date(form.checkIn).getTime();

  // Precedencia de descuento: empresa/convenio -> descuento personal del huesped -> 0.
  const effectiveDiscount = resolveEffectiveDiscountPercent({
    hasCompany: Boolean(selectedAssociatedClient),
    companyDiscountPercent: selectedAssociatedClient?.discount_percent,
    guestDiscountPercent: form.guestDiscountPercent,
  });
  const discountSource = selectedAssociatedClient
    ? `Empresa/Convenio: ${selectedAssociatedClient.display_name}`
    : form.guestDiscountPercent > 0
      ? "Descuento del huésped"
      : null;

  const pricePreview =
    selectedRoom && hasValidDates
      ? calculateReservationPriceBreakdown({
          basePrice: selectedRoom.base_price,
          checkIn: new Date(form.checkIn).toISOString(),
          checkOut: new Date(form.checkOut).toISOString(),
          discountPercent: effectiveDiscount,
        })
      : null;

  const guestComplete =
    Boolean(form.clientFirstName.trim()) &&
    Boolean(form.clientLastName.trim()) &&
    Boolean(form.clientDni.trim());
  const companyComplete = !form.hasCompany || Boolean(form.associatedClientId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.roomId === "" || !form.checkIn || !form.checkOut) {
      toast.error("Elegí fechas y habitación.");
      return;
    }
    if (new Date(form.checkOut) <= new Date(form.checkIn)) {
      toast.error("La fecha de salida debe ser posterior a la fecha de entrada.");
      return;
    }
    if (!guestComplete) {
      toast.error("Cargá nombre, apellido y DNI del huésped.");
      return;
    }
    if (form.hasCompany && !form.associatedClientId) {
      toast.error("Seleccioná la empresa/convenio o desactivá esa opción.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: CreateReservationPayload = {
        roomId: Number(form.roomId),
        guestId: form.guestId ?? undefined,
        clientFirstName: form.clientFirstName.trim(),
        clientLastName: form.clientLastName.trim(),
        clientDni: form.clientDni.trim(),
        clientPhone: form.clientPhone.trim() || undefined,
        associatedClientId: form.hasCompany ? form.associatedClientId : undefined,
        checkIn: new Date(form.checkIn).toISOString(),
        checkOut: new Date(form.checkOut).toISOString(),
        guestCount: form.guestCount,
        ...registry,
      };

      const result = await onSubmit(payload);

      if (result.success) {
        toast.success("Reserva creada correctamente.");
        setForm(buildInitialState(initialValues, standardCheckInTime, standardCheckOutTime));
        setRegistry({});
        onClose();
      } else {
        toast.error(result.error || "Error al crear reserva");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all";

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
          {/* 1) Huésped: columna vertebral. Buscar en el padrón o cargar nuevo. */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <UserRound size={16} className="text-emerald-600" />
                Huésped
              </p>
              {form.guestId ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                  Del padrón
                  {form.guestDiscountPercent > 0 && (
                    <span className="flex items-center gap-0.5">
                      · <Percent size={10} />
                      {form.guestDiscountPercent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                    </span>
                  )}
                </span>
              ) : (
                guestComplete && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-500">
                    Nuevo · se guarda solo
                  </span>
                )
              )}
            </div>

            <GuestSelector onSelect={handleGuestSelect} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="clientFirstName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Nombre
                </label>
                <input
                  id="clientFirstName"
                  type="text"
                  required
                  value={form.clientFirstName}
                  onChange={(e) => setForm((current) => ({ ...current, clientFirstName: e.target.value }))}
                  className={inputClass}
                  placeholder="Ej. María"
                />
              </div>

              <div>
                <label htmlFor="clientLastName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Apellido
                </label>
                <input
                  id="clientLastName"
                  type="text"
                  required
                  value={form.clientLastName}
                  onChange={(e) => setForm((current) => ({ ...current, clientLastName: e.target.value }))}
                  className={inputClass}
                  placeholder="Ej. López"
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
                  className={inputClass}
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
                  className={inputClass}
                  placeholder="Opcional"
                />
              </div>
            </div>

            {form.guestId && (
              <button
                type="button"
                onClick={clearGuest}
                className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline"
              >
                Limpiar y cargar otro huésped
              </button>
            )}
          </div>

          {/* 2) Empresa/Convenio (opcional): aporta descuento y es la facturable. */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.hasCompany}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    hasCompany: e.target.checked,
                    associatedClientId: e.target.checked ? current.associatedClientId : "",
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <Building2 size={16} className="text-slate-400" />
                Esta reserva la paga una empresa/convenio (con descuento)
              </span>
            </label>

            {form.hasCompany && (
              <div className="space-y-3 pt-1">
                <AssociatedClientSelector
                  clients={associatedClients}
                  selectedId={form.associatedClientId}
                  onSelect={(id) => setForm((current) => ({ ...current, associatedClientId: id }))}
                  inputId="associatedClient"
                  label="Empresa / Convenio"
                />

                {selectedAssociatedClient ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Nombre</p>
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {selectedAssociatedClient.display_name}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">DNI/CUIT</p>
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {selectedAssociatedClient.document_id}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Descuento</p>
                      <p className="text-sm font-semibold text-emerald-700">
                        {selectedAssociatedClient.discount_percent.toLocaleString("es-AR", {
                          maximumFractionDigits: 2,
                        })}
                        %
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    Seleccioná una empresa/convenio activo para usar su descuento.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3) Campo destacado: solo habitaciones libres para las fechas elegidas. */}
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="roomId" className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                <BedDouble size={16} className="text-emerald-600" />
                Habitación
              </label>
              {hasValidDates && (
                <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                  {loadingRooms ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    `${availableRooms.length} libre${availableRooms.length === 1 ? "" : "s"}`
                  )}
                </span>
              )}
            </div>
            <select
              id="roomId"
              required
              value={form.roomId}
              disabled={loadingRooms || !hasValidDates}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  roomId: e.target.value ? Number(e.target.value) : "",
                }))
              }
              className="w-full px-4 py-2.5 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {!hasValidDates ? (
                <option value="">Elegí primero las fechas</option>
              ) : loadingRooms ? (
                <option value="">Buscando disponibilidad…</option>
              ) : availableRooms.length === 0 ? (
                <option value="">No hay habitaciones libres para esas fechas</option>
              ) : (
                <>
                  <option value="">Seleccioná una habitación</option>
                  {availableRooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      Hab. {room.room_number} - {room.room_type}
                    </option>
                  ))}
                </>
              )}
            </select>
            {hasValidDates && (
              <p className="mt-1.5 text-[11px] text-emerald-700/80">
                Libres para {shortDate(form.checkIn)} → {shortDate(form.checkOut)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DateTimePickerField
              id="checkIn"
              label="Entrada"
              icon={<CalendarIcon size={14} className="mr-1" />}
              value={form.checkIn}
              onChange={(value) => setForm((current) => ({ ...current, checkIn: value }))}
            />
            <DateTimePickerField
              id="checkOut"
              label="Salida"
              icon={<ClockIcon size={14} className="mr-1" />}
              value={form.checkOut}
              onChange={(value) => setForm((current) => ({ ...current, checkOut: value }))}
            />
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

          <GuestRegistryFields
            value={registry}
            onChange={(patch) => setRegistry((current) => ({ ...current, ...patch }))}
            idPrefix="reserva"
          />

          {pricePreview && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="flex items-center gap-2 text-emerald-700 mb-3">
                <Percent size={16} />
                <p className="text-sm font-bold">
                  {discountSource ? `Precio con ${discountSource.toLowerCase()}` : "Precio de la reserva"}
                </p>
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
                    {pricePreview.discountPercent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}% ($
                    {pricePreview.discountAmount.toLocaleString("es-AR", { minimumFractionDigits: 2 })})
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase font-bold text-emerald-600">Total final</p>
                  <p className="font-semibold text-emerald-700">
                    ${pricePreview.finalTotalPrice.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              {discountSource && (
                <p className="mt-2 text-[11px] text-emerald-700/80">{discountSource}</p>
              )}
            </div>
          )}

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
              disabled={isSubmitting || form.roomId === "" || !guestComplete || !companyComplete}
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
