"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  X,
  Loader2,
  CheckCircle2,
  BedDouble,
  Users,
  CalendarDays,
  ShieldCheck,
  Phone,
  CreditCard,
} from "lucide-react";
import { differenceInDays } from "date-fns";

import { handlePublicBooking } from "../actions";
import { localToISO } from "@/lib/format";
import { getRoomCapacity } from "@/lib/rooms";
import { Room } from "@/lib/types";

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: Room;
  checkIn: string;
  checkOut: string;
  imageSrc: string;
  checkInTime: string;
  checkOutTime: string;
  timezone: string;
}

export default function BookingModal({
  isOpen,
  onClose,
  room,
  checkIn,
  checkOut,
  imageSrc,
  checkInTime,
  checkOutTime,
  timezone,
}: BookingModalProps) {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [clientDni, setClientDni] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("54");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const COUNTRY_OPTIONS = [
    { code: "54", flag: "🇦🇷", label: "Argentina" },
    { code: "55", flag: "🇧🇷", label: "Brasil" },
    { code: "598", flag: "🇺🇾", label: "Uruguay" },
    { code: "56", flag: "🇨🇱", label: "Chile" },
    { code: "595", flag: "🇵🇾", label: "Paraguay" },
    { code: "591", flag: "🇧🇴", label: "Bolivia" },
  ];

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  const nights = Math.max(1, differenceInDays(new Date(checkOut), new Date(checkIn)));
  const totalAmount = nights * room.base_price;
  const showPlaceholder = !imageSrc || imageSrc.includes("fallback");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!clientName.trim()) {
      setError("Por favor ingresa tu nombre completo.");
      return;
    }

    if (!clientDni.trim() || clientDni.trim().length < 6) {
      setError("Por favor ingresa un DNI o CUIT valido (minimo 6 caracteres).");
      return;
    }

    const phoneDigits = phoneLocal.replace(/\D/g, "");
    if (phoneDigits.length < 6) {
      setError("Por favor ingresa un numero de telefono valido (minimo 6 digitos).");
      return;
    }

    setLoading(true);
    setError(null);

    const checkInDateTime = localToISO(checkIn, checkInTime, timezone);
    const checkOutDateTime = localToISO(checkOut, checkOutTime, timezone);

    const result = await handlePublicBooking(
      room.room_type,
      clientName,
      checkInDateTime,
      checkOutDateTime,
      phoneCountryCode,
      phoneDigits,
      clientDni.trim(),
      guestCount
    );

    setLoading(false);

    if (result.success) {
      setSuccess(true);
      return;
    }

    setError(result.error || "Ocurrio un error inesperado al procesar tu reserva. Es posible que ya no este disponible.");
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-white">
      <div className="relative w-full h-full bg-white overflow-hidden">
        {!success && (
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="fixed top-4 right-4 md:top-6 md:right-6 z-50 w-11 h-11 rounded-full bg-white/95 hover:bg-white text-slate-600 hover:text-slate-900 flex items-center justify-center shadow-lg border border-slate-200 transition-colors"
          >
            <X size={22} />
          </button>
        )}

        {success ? (
          <div className="w-full h-full flex flex-col items-center justify-center px-8 py-14 md:px-16 md:py-20 text-center animate-in zoom-in-95 duration-500">
                <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-inner border border-emerald-100">
                  <CheckCircle2 size={48} />
                </div>
                <h3 className="text-4xl font-serif text-slate-900 mb-4">Reserva Registrada</h3>
                <p className="text-slate-600 text-lg mb-3 max-w-2xl">
                  Tu reserva para la <strong>{room.room_type}</strong> quedo registrada y esta <span className="text-emerald-600 font-bold">pendiente de confirmacion</span>.
                </p>
                <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-2xl px-6 py-4 mb-5 max-w-xl">
                  <Phone size={20} className="text-green-600 shrink-0" />
                  <p className="text-sm text-green-700 text-left">
                    Te vamos a avisar por <strong>WhatsApp</strong> al numero proporcionado cuando la reserva sea confirmada.
                  </p>
                </div>
                <p className="text-slate-400 mb-10 text-sm font-light max-w-md">
                  El pago se coordinara al momento del check-in en recepcion.
                </p>
                <button
                  onClick={() => {
                    onClose();
                    setSuccess(false);
                    setClientName("");
                    setClientDni("");
                    setPhoneLocal("");
                    setPhoneCountryCode("54");
                    router.refresh();
                  }}
                  className="px-10 py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl tracking-wide uppercase text-sm transition-all shadow-xl shadow-slate-900/20"
                >
                  Volver al Inicio
                </button>
              </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[0.92fr_1.08fr] w-full h-full">
            <div className="bg-slate-50 md:h-full overflow-y-auto">
              <div className="relative h-64 md:h-72 w-full">
                    {showPlaceholder ? (
                      <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center">
                        <span className="text-slate-500 font-bold uppercase tracking-widest">{room.room_type}</span>
                      </div>
                    ) : (
                      <Image
                        src={imageSrc}
                        alt={`Categoria ${room.room_type}`}
                        fill
                        className="object-cover"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/35 to-transparent" />
                    <div className="absolute bottom-6 left-6 right-6 text-white">
                      <h2 className="text-3xl md:text-4xl font-serif mb-2 capitalize">{room.room_type}</h2>
                      <p className="text-sm md:text-base text-slate-200 max-w-md">
                        {room.description || "Su espacio de descanso garantizado con los mas altos estandares."}
                      </p>
                    </div>
                  </div>

                  <div className="px-8 py-8 md:px-10 md:py-9 space-y-7">
                    <div className="flex gap-4 items-start pb-6 border-b border-slate-200">
                      <CalendarDays className="text-brand-500 shrink-0 mt-1" size={22} />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.18em] mb-3">Fechas Seleccionadas</div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs text-slate-500">Check-in</div>
                            <div className="font-semibold text-slate-800">{new Date(`${checkIn}T12:00:00Z`).toLocaleDateString("es-AR")}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Check-out</div>
                            <div className="font-semibold text-slate-800">{new Date(`${checkOut}T12:00:00Z`).toLocaleDateString("es-AR")}</div>
                          </div>
                        </div>
                        <div className="mt-3 inline-flex items-center px-3 py-1.5 rounded-lg bg-white text-sm font-medium text-slate-700 border border-slate-200">
                          Total: {nights} noche{nights > 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4 items-start pb-6 border-b border-slate-200">
                      <BedDouble className="text-slate-400 shrink-0 mt-1" size={22} />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.18em] mb-3">Detalles</div>
                        <div className="text-lg font-semibold text-slate-900 mb-1">Camas: {room.beds_configuration}</div>
                        <div className="text-sm text-slate-600 flex items-center gap-2">
                          <Users size={14} /> Hasta {getRoomCapacity(room)} personas
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-950 text-white rounded-3xl p-6 shadow-inner">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">Resumen Financiero</div>
                      <div className="flex justify-between items-end mb-4 text-slate-300">
                        <span>${room.base_price.toLocaleString("es-AR")} x {nights} {nights > 1 ? "noches" : "noche"}</span>
                      </div>
                      <div className="flex justify-between items-end pt-4 border-t border-slate-800">
                        <span className="font-light text-slate-300">Total</span>
                        <span className="text-3xl font-bold">${totalAmount.toLocaleString("es-AR")}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white md:h-full overflow-y-auto">
                  <div className="max-w-xl mx-auto px-8 py-10 md:px-12 md:py-12">
                    <h3 className="text-xs font-bold text-brand-500 uppercase tracking-[0.22em] mb-4">Paso Final</h3>
                    <h2 className="text-3xl md:text-5xl font-serif text-slate-900 mb-8 leading-[1.05]">
                      Completa tus datos para reservar
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="clientName" className="block text-sm font-bold tracking-wide uppercase text-slate-700">
                          Nombre Completo
                        </label>
                        <input
                          id="clientName"
                          type="text"
                          value={clientName}
                          onChange={(e) => setClientName(e.target.value)}
                          className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none font-medium text-slate-800"
                          placeholder="Ingresa tu nombre y apellido"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="clientDni" className="block text-sm font-bold tracking-wide uppercase text-slate-700">
                          <span className="flex items-center gap-2">
                            <CreditCard size={14} />
                            DNI o CUIT
                          </span>
                        </label>
                        <input
                          id="clientDni"
                          type="text"
                          value={clientDni}
                          onChange={(e) => setClientDni(e.target.value)}
                          className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none font-medium text-slate-800"
                          placeholder="20-12345678-3"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="clientPhone" className="block text-sm font-bold tracking-wide uppercase text-slate-700">
                          <span className="flex items-center gap-2">
                            <Phone size={14} />
                            Telefono
                          </span>
                        </label>
                        <div className="flex gap-2">
                          <select
                            aria-label="Prefijo de pais"
                            value={phoneCountryCode}
                            onChange={(e) => setPhoneCountryCode(e.target.value)}
                            className="px-3 py-4 bg-slate-50 rounded-2xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none font-medium text-slate-800 cursor-pointer"
                          >
                            {COUNTRY_OPTIONS.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.flag} +{c.code}
                              </option>
                            ))}
                          </select>
                          <input
                            id="clientPhone"
                            type="tel"
                            value={phoneLocal}
                            onChange={(e) => setPhoneLocal(e.target.value)}
                            className="flex-1 min-w-0 px-5 py-4 bg-slate-50 rounded-2xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none font-medium text-slate-800"
                            placeholder="3814XXXXXX"
                            inputMode="numeric"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="guestCount" className="block text-sm font-bold tracking-wide uppercase text-slate-700">
                          <span className="flex items-center gap-2">
                            <Users size={14} />
                            Cantidad de pasajeros
                          </span>
                        </label>
                        <input
                          id="guestCount"
                          type="number"
                          min={1}
                          max={getRoomCapacity(room)}
                          value={guestCount}
                          onChange={(e) =>
                            setGuestCount(Math.max(1, parseInt(e.target.value, 10) || 1))
                          }
                          className="w-full md:w-48 px-5 py-4 bg-slate-50 rounded-2xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none font-medium text-slate-800"
                        />
                        <p className="text-xs text-slate-500">
                          Capacidad maxima: {getRoomCapacity(room)} pasajero(s).
                        </p>
                      </div>

                      {error && (
                        <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm border border-red-100 font-medium">
                          {error}
                        </div>
                      )}

                      <div className="flex items-start gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-100">
                        <ShieldCheck className="text-brand-600 shrink-0 mt-0.5" size={24} />
                        <p className="text-sm text-slate-600 leading-relaxed">
                          Al confirmar, estas generando una solicitud de reserva. Te notificaremos por WhatsApp cuando sea confirmada. El pago se coordinara al momento del check-in.
                        </p>
                      </div>

                      <div className="pt-3">
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full py-4 md:py-5 bg-brand-600 hover:bg-brand-700 active:scale-[0.99] text-white font-bold tracking-[0.16em] uppercase rounded-2xl transition-all shadow-xl shadow-brand-500/25 flex items-center justify-center disabled:opacity-70 disabled:active:scale-100"
                        >
                          {loading ? <Loader2 className="animate-spin" size={24} /> : "Solicitar Reserva"}
                        </button>
                        <p className="text-center text-[11px] uppercase font-bold tracking-[0.18em] text-slate-400 mt-4">
                          Proceso 100% Seguro
                        </p>
                      </div>
            </form>
          </div>
        </div>
      </div>
    )}
      </div>
    </div>,
    document.body
  );
}
