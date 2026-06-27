"use client";

import { useEffect, useState } from "react";
import { Building2, CreditCard, Moon, Percent, Sun, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import AssociatedClientSelector from "./AssociatedClientSelector";
import CompanyPassengerSelector from "./CompanyPassengerSelector";
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
  CompanyPassenger,
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

type ReservationMode = "person" | "company";

const inputClass =
  "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all";

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
  const [mode, setMode] = useState<ReservationMode>("person");
  const [stayType, setStayType] = useState<WalkInStayType>("night");
  // Persona
  const [guestId, setGuestId] = useState<string | null>(null);
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [clientDni, setClientDni] = useState("");
  const [guestDiscountPercent, setGuestDiscountPercent] = useState(0);
  // Empresa
  const [associatedClientId, setAssociatedClientId] = useState("");
  const [companyPassengerId, setCompanyPassengerId] = useState<string | null>(null);
  const [passengerName, setPassengerName] = useState("");
  const [passengerDni, setPassengerDni] = useState("");
  // Compartido
  const [nights, setNights] = useState(1);
  const [guestCount, setGuestCount] = useState(1);
  const [registry, setRegistry] = useState<GuestRegistryInput>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode("person");
    setStayType("night");
    setGuestId(null);
    setClientFirstName("");
    setClientLastName("");
    setClientDni("");
    setGuestDiscountPercent(0);
    setAssociatedClientId("");
    setCompanyPassengerId(null);
    setPassengerName("");
    setPassengerDni("");
    setNights(1);
    setGuestCount(1);
    setRegistry({});
  }, [isOpen]);

  const handleGuestSelect = (entry: GuestDirectoryEntry) => {
    const { first, last } = splitName(entry.client_name);
    setGuestId(entry.id);
    setClientFirstName(first);
    setClientLastName(last);
    setClientDni(entry.client_dni ?? "");
    setGuestDiscountPercent(entry.discount_percent ?? 0);
    toast.success(`Huésped cargado: ${entry.client_name}`);
  };

  const handlePassengerSelect = (p: CompanyPassenger) => {
    setCompanyPassengerId(p.id);
    setPassengerName(p.full_name);
    setPassengerDni(p.document_id ?? "");
  };

  if (!isOpen) return null;

  const isHalfDay = stayType === "half_day";
  const selectedCompany =
    mode === "company"
      ? associatedClients.find((client) => client.id === associatedClientId) ?? null
      : null;

  const discountPercent = resolveEffectiveDiscountPercent({
    hasCompany: mode === "company",
    companyDiscountPercent: selectedCompany?.discount_percent,
    guestDiscountPercent,
  });

  const pricing = isHalfDay
    ? halfDayPrice > 0
      ? calculateHalfDayPriceBreakdown({ halfDayPrice, discountPercent })
      : null
    : basePrice > 0
      ? calculateWalkInPriceBreakdown({ basePrice, nights, discountPercent })
      : null;

  const personComplete =
    Boolean(clientFirstName.trim()) && Boolean(clientLastName.trim()) && Boolean(clientDni.trim());
  const companyComplete =
    Boolean(associatedClientId) && Boolean(passengerName.trim()) && Boolean(passengerDni.trim());
  const clientComplete = mode === "person" ? personComplete : companyComplete;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHalfDay && nights < 1) return;
    if (mode === "person" && !personComplete) {
      toast.error("Cargá nombre, apellido y DNI del huésped.");
      return;
    }
    if (mode === "company") {
      if (!associatedClientId) {
        toast.error("Seleccioná la empresa/convenio.");
        return;
      }
      if (!passengerName.trim() || !passengerDni.trim()) {
        toast.error("Cargá el nombre y el DNI del pasajero.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload: AssignWalkInPayload =
        mode === "company"
          ? {
              mode: "company",
              roomId: 0,
              associatedClientId,
              companyPassengerId: companyPassengerId ?? undefined,
              passengerName: passengerName.trim(),
              passengerDni: passengerDni.trim(),
              nights: isHalfDay ? 1 : nights,
              guestCount,
              stayType,
              ...registry,
            }
          : {
              mode: "person",
              roomId: 0,
              guestId: guestId ?? undefined,
              clientFirstName: clientFirstName.trim(),
              clientLastName: clientLastName.trim(),
              clientDni: clientDni.trim(),
              nights: isHalfDay ? 1 : nights,
              guestCount,
              stayType,
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
          {/* Tipo de reserva: Persona o Empresa */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("person")}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === "person" ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <p className="flex items-center gap-2 font-semibold text-slate-800">
                <UserRound size={16} className="text-emerald-600" />
                Persona
              </p>
              <p className="text-xs text-slate-500">Un huésped. Si tiene descuento, se aplica solo.</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("company")}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                mode === "company" ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <p className="flex items-center gap-2 font-semibold text-slate-800">
                <Building2 size={16} className="text-emerald-600" />
                Empresa / Convenio
              </p>
              <p className="text-xs text-slate-500">La empresa paga; se carga el pasajero real.</p>
            </button>
          </div>

          {/* Tipo de estadía */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStayType("night")}
              className={`rounded-xl border px-4 py-3 text-left transition-colors flex items-center gap-3 ${
                stayType === "night" ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
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
              onClick={() => setStayType("half_day")}
              className={`rounded-xl border px-4 py-3 text-left transition-colors flex items-center gap-3 ${
                stayType === "half_day" ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <Sun size={18} className="text-amber-500 shrink-0" />
              <span>
                <span className="block font-semibold text-slate-800">Media estadía (siesta)</span>
                <span className="block text-sm text-slate-500">Jornada de 12 a 17 hs.</span>
              </span>
            </button>
          </div>

          {mode === "person" ? (
            /* ----- PERSONA ----- */
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <UserRound size={16} className="text-emerald-600" />
                  Huésped
                </p>
                {guestId ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                    Del padrón
                    {guestDiscountPercent > 0 && (
                      <span className="flex items-center gap-0.5">
                        · <Percent size={10} />
                        {guestDiscountPercent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </span>
                ) : (
                  personComplete && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-500">
                      Nuevo · se guarda solo
                    </span>
                  )
                )}
              </div>

              <GuestSelector onSelect={handleGuestSelect} inputId="walkinGuestSearch" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="clientFirstName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Nombre
                  </label>
                  <input
                    id="clientFirstName"
                    type="text"
                    value={clientFirstName}
                    onChange={(e) => setClientFirstName(e.target.value)}
                    className={inputClass}
                    placeholder="Ej. Juan"
                  />
                </div>
                <div>
                  <label htmlFor="clientLastName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Apellido
                  </label>
                  <input
                    id="clientLastName"
                    type="text"
                    value={clientLastName}
                    onChange={(e) => setClientLastName(e.target.value)}
                    className={inputClass}
                    placeholder="Ej. Pérez"
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="clientDni" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <CreditCard size={14} />
                      DNI o CUIT
                    </span>
                  </label>
                  <input
                    id="clientDni"
                    type="text"
                    value={clientDni}
                    onChange={(e) => setClientDni(e.target.value)}
                    className={inputClass}
                    placeholder="Ej. 30123456"
                  />
                </div>
              </div>

              {guestId && (
                <button
                  type="button"
                  onClick={() => {
                    setGuestId(null);
                    setClientFirstName("");
                    setClientLastName("");
                    setClientDni("");
                    setGuestDiscountPercent(0);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline"
                >
                  Limpiar y cargar otro huésped
                </button>
              )}
            </div>
          ) : (
            /* ----- EMPRESA ----- */
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
              <AssociatedClientSelector
                clients={associatedClients}
                selectedId={associatedClientId}
                onSelect={(id) => {
                  setAssociatedClientId(id);
                  setCompanyPassengerId(null);
                  setPassengerName("");
                  setPassengerDni("");
                }}
                inputId="walkinAssociatedClient"
                label="Empresa / Convenio"
              />

              {selectedCompany && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-800 truncate">{selectedCompany.display_name}</span>
                  <span className="flex items-center gap-1 text-emerald-700 font-semibold shrink-0">
                    <Percent size={12} />
                    {selectedCompany.discount_percent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%
                  </span>
                </div>
              )}

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                  Pasajero que se hospeda <span className="text-red-500">*</span>
                </p>
                {associatedClientId ? (
                  <>
                    <CompanyPassengerSelector
                      key={associatedClientId}
                      companyId={associatedClientId}
                      onSelect={handlePassengerSelect}
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="walkinPassengerName" className="block text-xs font-semibold text-slate-600 mb-1">
                          Nombre del pasajero <span className="text-red-500">*</span>
                        </label>
                        <input
                          id="walkinPassengerName"
                          type="text"
                          value={passengerName}
                          onChange={(e) => {
                            setPassengerName(e.target.value);
                            setCompanyPassengerId(null);
                          }}
                          className={inputClass}
                          placeholder="Ej. María López"
                        />
                      </div>
                      <div>
                        <label htmlFor="walkinPassengerDni" className="block text-xs font-semibold text-slate-600 mb-1">
                          DNI del pasajero <span className="text-red-500">*</span>
                        </label>
                        <input
                          id="walkinPassengerDni"
                          type="text"
                          value={passengerDni}
                          onChange={(e) => {
                            setPassengerDni(e.target.value);
                            setCompanyPassengerId(null);
                          }}
                          className={inputClass}
                          placeholder="Ej. 30123456"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {companyPassengerId
                        ? "Pasajero de la empresa seleccionado."
                        : "Si no figura, se crea en la lista de la empresa al confirmar."}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Elegí primero la empresa/convenio.</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!isHalfDay && (
              <div>
                <label htmlFor="nights" className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Cantidad de Noches
                </label>
                <input
                  id="nights"
                  type="number"
                  min="1"
                  required
                  value={nights}
                  onChange={(e) => setNights(parseInt(e.target.value, 10) || 1)}
                  className={inputClass}
                />
              </div>
            )}
            <div>
              <label htmlFor="guestCount" className="block text-sm font-semibold text-slate-700 mb-1.5">
                Cantidad de pasajeros
              </label>
              <input
                id="guestCount"
                type="number"
                min="1"
                max="20"
                value={guestCount}
                onChange={(e) => setGuestCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
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
                discountPercent > 0 ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">Total estimado</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isHalfDay
                      ? `Media estadía (12 a 17 hs) · $${halfDayPrice.toLocaleString("es-AR")}`
                      : `${nights} noche${nights !== 1 ? "s" : ""} × $${basePrice.toLocaleString("es-AR")}`}
                  </p>
                </div>
                <div className="text-right">
                  {discountPercent > 0 && (
                    <p className="text-xs font-semibold text-emerald-700 mb-1">
                      Descuento {discountPercent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%: -$
                      {pricing.discountAmount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                    </p>
                  )}
                  <p className="text-2xl font-bold text-emerald-700">
                    ${pricing.finalTotalPrice.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
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
              disabled={isSubmitting || (isHalfDay && halfDayPrice <= 0) || !clientComplete}
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
