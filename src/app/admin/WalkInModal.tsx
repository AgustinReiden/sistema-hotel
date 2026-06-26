"use client";

import { useEffect, useState } from "react";
import { Building2, CreditCard, Moon, Percent, Phone, Sun, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import AssociatedClientSelector from "./AssociatedClientSelector";
import GuestRegistryFields from "./GuestRegistryFields";
import GuestSelector from "./GuestSelector";
import {
  calculateHalfDayPriceBreakdown,
  calculateWalkInPriceBreakdown,
  resolveEffectiveDiscountPercent,
} from "@/lib/pricing";
import type {
  AssignWalkInPayload,
  AssociatedClient,
  GuestDirectoryEntry,
  GuestRegistryInput,
  WalkInStayType,
} from "@/lib/types";

type WalkInModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AssignWalkInPayload) => Promise<{ success: boolean; error?: string }>;
  roomNumber: string;
  basePrice?: number;
  halfDayPrice?: number;
  associatedClients: AssociatedClient[];
};

type WalkInFormState = {
  /** Id del padron si el huesped se eligio del directorio (habilita su descuento personal). */
  guestId: string | null;
  clientFirstName: string;
  clientLastName: string;
  clientDni: string;
  clientPhone: string;
  /** Descuento personal del huesped elegido (solo display + preview; el RPC lo revalida). */
  guestDiscountPercent: number;
  /** Este check-in lo paga una empresa/convenio (con descuento). */
  hasCompany: boolean;
  associatedClientId: string;
  stayType: WalkInStayType;
  nights: number;
  guestCount: number;
};

function buildInitialState(): WalkInFormState {
  return {
    guestId: null,
    clientFirstName: "",
    clientLastName: "",
    clientDni: "",
    clientPhone: "",
    guestDiscountPercent: 0,
    hasCompany: false,
    associatedClientId: "",
    stayType: "night",
    nights: 1,
    guestCount: 1,
  };
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  const last = parts.pop() as string;
  return { first: parts.join(" "), last };
}

export default function WalkInModal({
  isOpen,
  onClose,
  onSubmit,
  roomNumber,
  basePrice = 0,
  halfDayPrice = 0,
  associatedClients,
}: WalkInModalProps) {
  const [form, setForm] = useState<WalkInFormState>(() => buildInitialState());
  const [registry, setRegistry] = useState<GuestRegistryInput>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildInitialState());
    setRegistry({});
  }, [isOpen]);

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

  const isHalfDay = form.stayType === "half_day";
  const selectedAssociatedClient = form.hasCompany
    ? associatedClients.find((client) => client.id === form.associatedClientId) ?? null
    : null;

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

  const pricing = isHalfDay
    ? halfDayPrice > 0
      ? calculateHalfDayPriceBreakdown({ halfDayPrice, discountPercent: effectiveDiscount })
      : null
    : basePrice > 0
      ? calculateWalkInPriceBreakdown({ basePrice, nights: form.nights, discountPercent: effectiveDiscount })
      : null;

  const guestComplete =
    Boolean(form.clientFirstName.trim()) &&
    Boolean(form.clientLastName.trim()) &&
    Boolean(form.clientDni.trim());
  const companyComplete = !form.hasCompany || Boolean(form.associatedClientId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHalfDay && form.nights < 1) return;
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
      const payload: AssignWalkInPayload = {
        roomId: 0, // el padre (RoomCard) sobreescribe con el id real de la habitacion.
        guestId: form.guestId ?? undefined,
        clientFirstName: form.clientFirstName.trim(),
        clientLastName: form.clientLastName.trim(),
        clientDni: form.clientDni.trim(),
        clientPhone: form.clientPhone.trim() || undefined,
        associatedClientId: form.hasCompany ? form.associatedClientId : undefined,
        nights: isHalfDay ? 1 : form.nights,
        guestCount: form.guestCount,
        stayType: form.stayType,
        ...registry,
      };

      const result = await onSubmit(payload);
      if (result.success) {
        toast.success("Habitación asignada correctamente.");
        onClose();
      } else {
        toast.error(result.error || "Ocurrió un error.");
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
          <h2 className="text-xl font-bold text-slate-800">Asignar Habitación {roomNumber}</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* 1) Tipo de estadía: noche(s) o media estadía (siesta). */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">Tipo de estadía</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, stayType: "night" }))}
                className={`rounded-xl border px-4 py-3 text-left transition-colors flex items-center gap-3 ${
                  form.stayType === "night"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <Moon size={18} className="text-slate-500 shrink-0" />
                <span>
                  <span className="block font-semibold text-slate-800">Noche(s)</span>
                  <span className="block text-sm text-slate-500">Estadía normal por noche.</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, stayType: "half_day" }))}
                className={`rounded-xl border px-4 py-3 text-left transition-colors flex items-center gap-3 ${
                  form.stayType === "half_day"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <Sun size={18} className="text-amber-500 shrink-0" />
                <span>
                  <span className="block font-semibold text-slate-800">Media estadía (siesta)</span>
                  <span className="block text-sm text-slate-500">Jornada de 12 a 17 hs.</span>
                </span>
              </button>
            </div>
          </div>

          {/* 2) Huésped: columna vertebral. Buscar en el padrón o cargar nuevo. */}
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

            <GuestSelector onSelect={handleGuestSelect} inputId="walkinGuestSearch" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="walkinClientFirstName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Nombre
                </label>
                <input
                  id="walkinClientFirstName"
                  type="text"
                  required
                  value={form.clientFirstName}
                  onChange={(e) => setForm((current) => ({ ...current, clientFirstName: e.target.value }))}
                  className={inputClass}
                  placeholder="Ej. Juan"
                />
              </div>

              <div>
                <label htmlFor="walkinClientLastName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Apellido
                </label>
                <input
                  id="walkinClientLastName"
                  type="text"
                  required
                  value={form.clientLastName}
                  onChange={(e) => setForm((current) => ({ ...current, clientLastName: e.target.value }))}
                  className={inputClass}
                  placeholder="Ej. Pérez"
                />
              </div>

              <div>
                <label htmlFor="walkinClientDni" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={14} />
                    DNI o CUIT
                  </span>
                </label>
                <input
                  id="walkinClientDni"
                  type="text"
                  required
                  value={form.clientDni}
                  onChange={(e) => setForm((current) => ({ ...current, clientDni: e.target.value }))}
                  className={inputClass}
                  placeholder="Ej. 30123456"
                />
              </div>

              <div>
                <label htmlFor="walkinClientPhone" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Phone size={14} />
                    Teléfono
                  </span>
                </label>
                <input
                  id="walkinClientPhone"
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

          {/* 3) Empresa/Convenio (opcional): aporta descuento y es la facturable. */}
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
                Este check-in lo paga una empresa/convenio (con descuento)
              </span>
            </label>

            {form.hasCompany && (
              <div className="space-y-3 pt-1">
                <AssociatedClientSelector
                  clients={associatedClients}
                  selectedId={form.associatedClientId}
                  onSelect={(id) => setForm((current) => ({ ...current, associatedClientId: id }))}
                  inputId="walkinAssociatedClient"
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

          {/* 4) Noches (solo estadía normal) + cantidad de pasajeros. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!isHalfDay && (
              <div>
                <label htmlFor="walkinNights" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Cantidad de Noches
                </label>
                <input
                  id="walkinNights"
                  type="number"
                  min="1"
                  required
                  value={form.nights}
                  onChange={(e) =>
                    setForm((current) => ({ ...current, nights: parseInt(e.target.value, 10) || 1 }))
                  }
                  className={inputClass}
                />
              </div>
            )}
            <div>
              <label htmlFor="walkinGuestCount" className="block text-sm font-semibold text-slate-700 mb-1.5">
                Cantidad de pasajeros
              </label>
              <input
                id="walkinGuestCount"
                type="number"
                min="1"
                max="20"
                value={form.guestCount}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    guestCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                  }))
                }
                className={inputClass}
              />
              <p className="text-xs text-slate-500 mt-1">Opcional (default 1).</p>
            </div>
          </div>

          <GuestRegistryFields
            value={registry}
            onChange={(patch) => setRegistry((current) => ({ ...current, ...patch }))}
            idPrefix="walkin"
          />

          {isHalfDay && halfDayPrice <= 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Esta habitación no tiene precio de media estadía (siesta) configurado. Cargalo en
              Categorías/Habitaciones antes de usar esta opción.
            </div>
          )}

          {pricing && (
            <div
              className={`rounded-xl border p-4 ${
                discountSource ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">
                    Total estimado
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isHalfDay
                      ? `Media estadía (12 a 17 hs) · $${halfDayPrice.toLocaleString("es-AR")}`
                      : `${form.nights} noche${form.nights !== 1 ? "s" : ""} × $${basePrice.toLocaleString("es-AR")}`}
                  </p>
                </div>
                <div className="text-right">
                  {discountSource && pricing.discountPercent > 0 && (
                    <p className="text-xs font-semibold text-emerald-700 mb-1">
                      Descuento {pricing.discountPercent.toLocaleString("es-AR", {
                        maximumFractionDigits: 2,
                      })}
                      %: -$
                      {pricing.discountAmount.toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  )}
                  <p className="text-2xl font-bold text-emerald-700">
                    ${pricing.finalTotalPrice.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {discountSource && (
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700">
                  <Percent size={12} />
                  {discountSource}
                </div>
              )}
            </div>
          )}

          <div className="pt-2 flex gap-3">
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
                (isHalfDay && halfDayPrice <= 0) ||
                !guestComplete ||
                !companyComplete
              }
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors shadow-md shadow-emerald-600/20"
            >
              {isSubmitting ? "Asignando..." : "Asignar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
