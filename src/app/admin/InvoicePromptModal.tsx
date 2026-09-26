"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, Building2, FileText, Loader2, User, X } from "lucide-react";
import { toast } from "sonner";

import {
  declineInvoiceAction,
  emitInvoiceForReservationAction,
  lookupReceptorByCuitAction,
} from "./fiscal/actions";
import { formatCuit, isValidCuit } from "@/lib/arca/amounts";
import {
  initialInvoiceStep,
  letraDeReceptor,
  stepAfterYes,
  type InvoiceStep,
} from "@/lib/billing";
import type { EmitInvoiceOutcome, InvoiceReceptorInput, ReceptorCondicionCuit } from "@/lib/types";

export type InvoicePromptData = {
  reservationId: string;
  clientName: string | null;
  total: number;
  /**
   * DNI cargado en la reserva: es el documento que va a llevar la Factura B, así que
   * se muestra en la confirmación. `undefined` cuando la pantalla que abre el modal
   * no lo tiene a mano (Control de facturación): ahí no se valida y decide el server.
   */
  clientDni?: string | null;
  /** Prefill para el receptor con CUIT (empresa de la ficha o CUIT ya en la reserva). */
  aPrefill: {
    razonSocial: string;
    cuit: string;
    condicionIva: ReceptorCondicionCuit | "";
    domicilio: string;
  };
  /** true si es empresa con CUIT válido → sugerir el camino con CUIT por defecto. */
  suggestA: boolean;
  /**
   * Se cobró por tarjeta, transferencia o Mercado Pago: hay rastro bancario, así
   * que facturar no es opcional y el paso SÍ/NO no se muestra (mig 83). El
   * enforcement real está en `rpc_decline_invoice` (P0032).
   */
  mandatory?: boolean;
  /** La ficha ya tiene los 4 datos fiscales: se confirma en vez de preguntar el tipo. */
  prefillComplete?: boolean;
};

type Props = {
  data: InvoicePromptData | null;
  onClose: () => void;
  /** Empezar en la elección de tipo (para /admin/fiscal, donde ya apretaron "Emitir"). */
  startAtTipo?: boolean;
};

/** A dónde vuelve el botón "Volver" desde la pantalla de confirmación. */
type ConfirmBack = "tipo" | "formB" | "formCuit";

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function openInvoicePrint(invoiceId: string) {
  if (typeof window === "undefined") return;
  window.open(
    `/admin/factura/${invoiceId}?autoprint=1`,
    `factura-${invoiceId}`,
    "width=420,height=720"
  );
}

/**
 * Prompt post check-out "¿Emitir factura?". El playero aprieta SÍ → elige el tipo:
 * Consumidor Final (Factura B con el DNI de la reserva) o "con CUIT". En el camino
 * con CUIT la condición IVA deriva el comprobante: Responsable Inscripto / Monotributo
 * → Factura A; IVA Sujeto Exento → Factura B con CUIT. Los datos se precargan si la
 * reserva es de una empresa de la ficha. Si ARCA no responde, la factura queda
 * pendiente en /admin/fiscal — el check-out ya está hecho y no se traba.
 *
 * NADA SALE SIN PASAR POR LA CONFIRMACIÓN. Los dos caminos terminan en la misma
 * pantalla, que muestra letra, nombre, documento y total antes de tocar ARCA. Es la
 * corrección del 18/09/2026: elegir "Consumidor Final" emitió una Factura A a nombre
 * de otra empresa sin mostrar nada, y una factura con CAE ya no se borra — se anula
 * con nota de crédito y quedan los dos papeles. Mirar antes de emitir cuesta un clic;
 * el par factura+NC cuesta una explicación al contador.
 *
 * SALIR SIN DECIDIR SE PREGUNTA. Después del check-out, la X (y el "Cancelar" del
 * tipo cuando no hay SÍ/NO) no cierra de una: pregunta "¿Salir sin facturar?". Si
 * sale, no se registra el "no facturar": la estadía le queda al administrador en
 * Por facturar, y recepción ya no la ve. En /admin/fiscal y en Control (startAtTipo)
 * el que factura es el admin, que la sigue viendo en la lista: ahí la X cierra directo.
 *
 * El estado se inicializa desde `data` en el montaje; el padre pasa `key` (el
 * reservationId) para que se remonte fresco cada vez que abre un prompt nuevo.
 */
export default function InvoicePromptModal({ data, onClose, startAtTipo = false }: Props) {
  const mandatory = Boolean(data?.mandatory);
  const prefillComplete = Boolean(data?.prefillComplete);

  const [step, setStep] = useState<InvoiceStep>(() =>
    initialInvoiceStep({ startAtTipo, mandatory, prefillComplete })
  );
  /** Dónde estaba cuando pidió salir: "Volver a la factura" lo deja como estaba. */
  const [stepAntesDeSalir, setStepAntesDeSalir] = useState<InvoiceStep>(step);
  const [emitting, setEmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupFuente, setLookupFuente] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    razonSocial: data?.aPrefill.razonSocial ?? "",
    cuit: data?.aPrefill.cuit ?? "",
    condicionIva: (data?.aPrefill.condicionIva ?? "") as ReceptorCondicionCuit | "",
    domicilio: data?.aPrefill.domicilio ?? "",
  }));
  // Nombre impreso en la Factura B: precargado con el de la reserva y editable
  // (el pasajero se anota apurado y la factura la quiere con el nombre completo).
  const [nombreB, setNombreB] = useState(() => data?.clientName ?? "");
  /** Lo que se va a emitir, ya armado. Se mira en "confirmar" y recién ahí se emite. */
  const [pending, setPending] = useState<InvoiceReceptorInput | null>(() =>
    data && prefillComplete
      ? {
          tipo: "cuit",
          condicionIva: data.aPrefill.condicionIva as ReceptorCondicionCuit,
          cuit: data.aPrefill.cuit,
          razonSocial: data.aPrefill.razonSocial,
          domicilio: data.aPrefill.domicilio,
        }
      : null
  );
  const [confirmBack, setConfirmBack] = useState<ConfirmBack>("tipo");

  if (!data) return null;

  // La condición IVA deriva el comprobante: exento → B; RI/Monotributo → A.
  const derivedLetra = form.condicionIva === "exento" ? "B" : form.condicionIva ? "A" : null;

  // DNI que va a llevar la Factura B. `undefined` = la pantalla no lo trajo: no se
  // valida acá (el RPC igual rechaza un DNI que no sirve, con el mismo mensaje).
  const dniDigits = (data.clientDni ?? "").replace(/\D/g, "");
  const dniConocido = data.clientDni !== undefined && data.clientDni !== null;
  const dniSirve = dniDigits.length === 7 || dniDigits.length === 8;

  /**
   * La X y el "Cancelar" sin a dónde volver. Con startAtTipo cierra directo, como
   * siempre. Después del check-out pregunta antes: cerrar ahí deja la estadía sin
   * facturar y fuera de la pantalla de recepción.
   */
  const pedirCierre = () => {
    if (startAtTipo) {
      onClose();
      return;
    }
    setStepAntesDeSalir(step);
    setStep("confirmSalir");
  };

  const handleOutcome = (outcome: EmitInvoiceOutcome) => {
    if (outcome.status === "authorized") {
      // Cubre tanto la emisión nueva como el caso "ya estaba facturada" (reimprime).
      toast.success(outcome.userMessage);
      if (outcome.invoiceId) openInvoicePrint(outcome.invoiceId);
    } else if (outcome.status === "rejected") {
      toast.error(outcome.userMessage, {
        description: "Revisá los datos en Facturación → Pendientes y con error.",
        duration: 9000,
      });
    } else {
      toast.warning(outcome.userMessage, { duration: 9000 });
    }
    onClose();
  };

  /** Arma el receptor y lleva a confirmar. Emitir de acá para abajo es un solo lugar. */
  const revisar = (receptor: InvoiceReceptorInput, back: ConfirmBack) => {
    setPending(receptor);
    setConfirmBack(back);
    setStep("confirmar");
  };

  const emitPending = async () => {
    if (emitting || !pending) return; // anti doble click
    setEmitting(true);
    const result = await emitInvoiceForReservationAction(data.reservationId, pending);
    setEmitting(false);

    if (!result.success) {
      toast.error(result.error);
      onClose();
      return;
    }
    handleOutcome(result.data!);
  };

  /**
   * "No facturar" queda REGISTRADO (mig 80): el playero no puede cambiarlo después,
   * sólo el administrador. Por eso se confirma antes. Si el registro falla, igual
   * se cierra: el check-out ya está hecho y no se traba por esto.
   */
  const confirmNo = async () => {
    if (emitting) return;
    setEmitting(true);
    const result = await declineInvoiceAction(data.reservationId);
    setEmitting(false);
    if (!result.success) toast.error(result.error);
    onClose();
  };

  /**
   * Al completar un CUIT válido busca si ya se le facturó antes (ficha de empresa,
   * de huésped, o la última factura) y completa el resto. Es exactamente el pedido
   * de "si ya se facturó al cliente, que traiga los datos solo".
   */
  const onCuitChange = async (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 11);
    setForm((f) => ({ ...f, cuit: digits }));
    setLookupFuente(null);
    if (!isValidCuit(digits)) return;

    setLookingUp(true);
    const result = await lookupReceptorByCuitAction(digits);
    setLookingUp(false);
    if (!result.success || !result.data?.found) return;

    const found = result.data;
    setLookupFuente(found.fuente);
    // No pisa lo que el usuario ya escribió a mano.
    setForm((f) => ({
      ...f,
      razonSocial: f.razonSocial.trim() || found.razon_social || "",
      condicionIva: f.condicionIva || found.condicion_iva || "",
      domicilio: f.domicilio.trim() || found.domicilio || "",
    }));
  };

  const submitFormB = () => {
    const nombre = nombreB.trim();
    if (!nombre) {
      toast.error("Ingresá el nombre que va en la factura.");
      return;
    }
    revisar({ tipo: "B", razonSocial: nombre }, "formB");
  };

  const submitFormCuit = () => {
    const cuitDigits = form.cuit.replace(/\D/g, "");
    if (!form.razonSocial.trim()) {
      toast.error("Ingresá la razón social del receptor.");
      return;
    }
    if (!isValidCuit(cuitDigits)) {
      toast.error("El CUIT no es válido (11 dígitos con dígito verificador).");
      return;
    }
    if (
      form.condicionIva !== "responsable_inscripto" &&
      form.condicionIva !== "monotributo" &&
      form.condicionIva !== "exento"
    ) {
      toast.error("Elegí la condición frente al IVA.");
      return;
    }
    if (!form.domicilio.trim()) {
      toast.error("Ingresá el domicilio del receptor.");
      return;
    }
    revisar(
      {
        tipo: "cuit",
        condicionIva: form.condicionIva,
        cuit: cuitDigits,
        razonSocial: form.razonSocial.trim(),
        domicilio: form.domicilio.trim(),
      },
      "formCuit"
    );
  };

  const tituloPaso =
    step === "formCuit" || step === "formB"
      ? "Datos de facturación"
      : step === "confirmar"
        ? "Revisá antes de emitir"
        : step === "confirmSalir"
          ? "¿Salir sin facturar?"
          : "¿Emitir factura?";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{tituloPaso}</h2>
              <p className="text-slate-500 text-sm font-medium">
                {data.clientName ?? "Huésped"} — ${formatMoney(data.total)}
              </p>
            </div>
          </div>
          {/* En "¿Salir sin facturar?" no hay X: está en el mismo lugar, y un doble
              click la cerraría sin haber leído la pregunta. */}
          {!emitting && step !== "confirmSalir" && (
            <button
              type="button"
              aria-label="Cerrar"
              onClick={pedirCierre}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={24} />
            </button>
          )}
        </div>

        <div className="p-6">
          {emitting ? (
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-slate-600">
              <Loader2 className="animate-spin" size={28} />
              <p className="text-sm font-semibold">Emitiendo factura en ARCA…</p>
              <p className="text-xs text-slate-400">No cierres esta ventana.</p>
            </div>
          ) : step === "ask" ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setStep(stepAfterYes(prefillComplete))}
                  className="py-6 bg-emerald-600 hover:bg-emerald-700 text-white text-2xl font-black rounded-2xl transition-colors"
                >
                  SÍ
                </button>
                <button
                  type="button"
                  onClick={() => setStep("confirmNo")}
                  className="py-6 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 text-2xl font-black rounded-2xl transition-colors"
                >
                  NO
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-4 text-center">
                La factura fiscal sale con la fecha y hora de ahora: se emite en el momento.
              </p>
            </>
          ) : step === "confirmNo" ? (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-sm font-bold text-amber-900">
                  Si confirmás, esta estadía queda SIN factura fiscal.
                </p>
                <p className="text-xs text-amber-800 mt-1.5">
                  No vas a poder emitirla más tarde: la decisión se registra y sólo el administrador
                  puede cambiarla. Si el huésped la pide, elegí SÍ ahora.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <button
                  type="button"
                  onClick={() => setStep("ask")}
                  className="py-5 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 text-base font-black rounded-2xl transition-colors"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={() => void confirmNo()}
                  className="py-5 bg-slate-700 hover:bg-slate-800 text-white text-base font-black rounded-2xl transition-colors"
                >
                  No facturar
                </button>
              </div>
            </>
          ) : step === "confirmSalir" ? (
            // Salir sin decidir: no se registra nada. La estadía queda en Por
            // facturar para el admin (también si se cobró por medio bancario).
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1.5">
                <p className="text-sm font-bold text-amber-900">
                  Queda pendiente para el administrador. Vos ya no la vas a ver en tu pantalla.
                </p>
                {mandatory && (
                  <p className="text-xs font-semibold text-amber-800">
                    Se cobró por medio bancario: la factura se tiene que emitir igual.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setStep(stepAntesDeSalir)}
                  className="py-5 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-black rounded-2xl transition-colors"
                >
                  Volver a la factura
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-5 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 text-base font-black rounded-2xl transition-colors"
                >
                  Salir sin facturar
                </button>
              </div>
            </>
          ) : step === "confirmar" && pending ? (
            // La última pantalla antes de ARCA: dice LETRA, NOMBRE, DOCUMENTO y TOTAL.
            // Lo que se lee acá es exactamente lo que se imprime.
            <>
              {mandatory && (
                <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 text-center">
                  Se cobró por medio bancario: esta estadía se factura sí o sí.
                </p>
              )}
              <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                  Se va a emitir
                </p>
                <p className="text-2xl font-black text-slate-800 mt-1">
                  Factura {letraDeReceptor(pending)}
                  <span className="text-sm font-bold text-slate-500 ml-2">
                    {pending.tipo === "B" ? "Consumidor Final" : "con CUIT"}
                  </span>
                </p>

                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-3">
                  A nombre de
                </p>
                <p className="text-lg font-bold text-slate-800 leading-tight break-words">
                  {pending.razonSocial || data.clientName || "—"}
                </p>

                {pending.tipo === "B" ? (
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    DNI {dniConocido ? dniDigits || "(sin cargar)" : "de la reserva"}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-slate-500 font-mono mt-1">
                      CUIT {formatCuit(pending.cuit)}
                    </p>
                    <p className="text-xs text-slate-500">{pending.domicilio}</p>
                  </>
                )}

                <p className="text-2xl font-black text-slate-800 mt-3">${formatMoney(data.total)}</p>
              </div>

              {pending.tipo === "B" && dniConocido && !dniSirve && (
                <div className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-xs font-semibold text-rose-800">
                    El documento de la reserva ({dniDigits || "vacío"}) no es un DNI de 7 u 8
                    dígitos, así que ARCA la va a rechazar. Corregilo en la reserva, o volvé y
                    facturá con CUIT.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => void emitPending()}
                disabled={pending.tipo === "B" && dniConocido && !dniSirve}
                className="w-full mt-4 py-5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-lg font-black rounded-2xl transition-colors"
              >
                Confirmar y emitir
              </button>
              <p className="text-[11px] text-slate-400 mt-3 text-center">
                Una vez emitida, corregirla exige una nota de crédito: quedan los dos
                comprobantes.
              </p>
              <button
                type="button"
                onClick={() => setStep(confirmBack)}
                className="mt-3 w-full text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                {confirmBack === "tipo" ? "Cambiar tipo o datos" : "Volver y corregir"}
              </button>
            </>
          ) : step === "tipo" ? (
            <>
              {mandatory && (
                <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 text-center">
                  Se cobró por medio bancario: esta estadía se factura sí o sí.
                </p>
              )}
              <p className="text-sm font-semibold text-slate-600 mb-4 text-center">
                ¿A quién se le factura?
              </p>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setStep("formB")}
                  className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-colors ${
                    data.suggestA
                      ? "border-slate-200 hover:bg-slate-50"
                      : "border-emerald-500 bg-emerald-50 hover:bg-emerald-100"
                  }`}
                >
                  <User size={22} className="text-slate-500 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-800">Consumidor Final</p>
                    <p className="text-xs text-slate-500">
                      Factura B con el DNI de la reserva.
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("formCuit")}
                  className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-colors ${
                    data.suggestA
                      ? "border-emerald-500 bg-emerald-50 hover:bg-emerald-100"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Building2 size={22} className="text-slate-500 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-800">Con CUIT</p>
                    <p className="text-xs text-slate-500">
                      Empresa / Responsable Inscripto / Monotributo / Exento.
                    </p>
                  </div>
                </button>
              </div>
              {/* Con pago bancario no hay a dónde volver: el SÍ/NO no existe. Ahí
                  "Cancelar" es salir, y después del check-out se pregunta antes. */}
              <button
                type="button"
                onClick={() => {
                  if (prefillComplete && pending) setStep("confirmar");
                  else if (startAtTipo || mandatory) pedirCierre();
                  else setStep("ask");
                }}
                className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                <ArrowLeft size={14} />{" "}
                {prefillComplete || !(startAtTipo || mandatory) ? "Volver" : "Cancelar"}
              </button>
            </>
          ) : step === "formB" ? (
            // Consumidor Final: el ÚNICO dato que se escribe es el nombre. El documento
            // sale de la reserva y no se toca acá (corregirlo es editar la reserva).
            <div className="space-y-4">
              <div>
                <label
                  className="block text-sm font-semibold text-slate-700 mb-1.5"
                  htmlFor="fb-nombre"
                >
                  Nombre para la factura
                </label>
                <input
                  id="fb-nombre"
                  type="text"
                  autoFocus
                  value={nombreB}
                  onChange={(e) => setNombreB(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Nombre y apellido del huésped"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Viene con el nombre de la reserva. Corregilo si el huésped lo pide con el
                  nombre completo.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                  Documento (sale de la reserva)
                </p>
                <p className="text-sm font-bold text-slate-700 font-mono mt-0.5">
                  DNI {dniConocido ? dniDigits || "(sin cargar)" : "de la reserva"}
                </p>
                {dniConocido && !dniSirve && (
                  <p className="text-[11px] font-semibold text-rose-600 mt-1">
                    No es un DNI de 7 u 8 dígitos: corregilo en la reserva o facturá con CUIT.
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep("tipo")}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft size={16} /> Volver
                </button>
                <button
                  type="button"
                  onClick={submitFormB}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-600/20"
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : (
            // step === "formCuit"
            <div className="space-y-4">
              {/* El CUIT va PRIMERO: es el dato que identifica al receptor y el que
                  trae el resto solo si ya se le facturó antes. */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-cuit">
                  CUIT
                </label>
                <div className="relative">
                  <input
                    id="fa-cuit"
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={form.cuit}
                    onChange={(e) => void onCuitChange(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                    placeholder="11 dígitos"
                  />
                  {lookingUp && (
                    <Loader2
                      size={16}
                      className="animate-spin text-slate-400 absolute right-3 top-1/2 -translate-y-1/2"
                    />
                  )}
                </div>
                {form.cuit.length === 11 && !isValidCuit(form.cuit) && (
                  <p className="text-[11px] text-rose-600 font-semibold mt-1">
                    El dígito verificador no cierra: revisá el CUIT.
                  </p>
                )}
                {lookupFuente && (
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                    Datos traídos de{" "}
                    {lookupFuente === "empresa"
                      ? "la ficha de la empresa"
                      : lookupFuente === "huesped"
                        ? "la ficha del huésped"
                        : "una factura anterior"}
                    .
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-razon">
                  Razón social
                </label>
                <input
                  id="fa-razon"
                  type="text"
                  value={form.razonSocial}
                  onChange={(e) => setForm((f) => ({ ...f, razonSocial: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Ej. Transportes del Norte S.A."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-cond">
                  Condición frente al IVA
                </label>
                <select
                  id="fa-cond"
                  value={form.condicionIva}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      condicionIva: e.target.value as typeof f.condicionIva,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                >
                  <option value="">Elegí…</option>
                  <option value="responsable_inscripto">Responsable Inscripto</option>
                  <option value="monotributo">Monotributo</option>
                  <option value="exento">IVA Sujeto Exento</option>
                </select>
                {derivedLetra && (
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                    Se emitirá Factura {derivedLetra}.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-domicilio">
                  Domicilio
                </label>
                <input
                  id="fa-domicilio"
                  type="text"
                  value={form.domicilio}
                  onChange={(e) => setForm((f) => ({ ...f, domicilio: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Av. San Martín 1234, Taco Pozo"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep("tipo")}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft size={16} /> Volver
                </button>
                <button
                  type="button"
                  onClick={submitFormCuit}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-600/20"
                >
                  {derivedLetra ? `Revisar Factura ${derivedLetra}` : "Revisar factura"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
