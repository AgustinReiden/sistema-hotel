"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  DollarSign,
  Loader2,
  Printer,
  Receipt,
  Wand2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  loadClientOpenInvoicesAction,
  loadClientOpenStaysAction,
  registerAccountPaymentAction,
} from "./actions";
import BalanceTag from "./BalanceTag";
import { cbteLetra, formatCbteNumero } from "@/lib/arca/amounts";
import {
  aImputacionDestino,
  cancelaDesdeLoQueEntro,
  claveDeuda,
  PAGO_EN_CERO,
  problemasDeLoTipeado,
  problemasDelPago,
  repartirMasViejoPrimero,
  resumenPago,
  retencionesTotal,
  type DeudaAImputar,
  type ImputacionEnPantalla,
} from "@/lib/cc-pagos";
import ParsedAmountHint from "@/app/admin/ParsedAmountHint";
import { formatAmount, formatAmountForInput, formatShiftCode, parseArMoney } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-methods";
import type { CcOpenInvoiceRow, CcOpenStayRow, CtaCteAccount } from "@/lib/types";

/**
 * Cobro de cuenta corriente: monto, retenciones y a qué facturas se aplica.
 *
 * Antes era monto + método + notas, y con eso se podía decir CUÁNTO bajó el saldo
 * pero no QUÉ facturas quedaron pagas — que es justo lo que pregunta la empresa que
 * transfirió y lo que necesita el contador para conciliar. La migración 109 puso esa
 * información en la base; esta pantalla es la única forma de cargarla.
 *
 * LA REGLA QUE NO SE PUEDE DAR VUELTA (ver src/lib/cc-pagos.ts y la mig 109):
 *
 *     el monto es lo que CANCELA de deuda = lo que entró + las retenciones
 *
 * De ahí el resumen en vivo arriba del botón: con retenciones, lo que cancela y lo
 * que entra a la cuenta bancaria son números distintos, y hasta ahora la diferencia
 * recién se veía en el recibo, cuando el asiento ya estaba hecho.
 *
 * Desde F2-11 la pantalla pide LO QUE ENTRÓ (lo que dice el extracto del banco) y las
 * retenciones justo debajo, y el monto que cancela se CALCULA (`cancelaDesdeLoQueEntro`).
 * Antes se pedía primero "lo que cancela", y quien tenía el extracto en la mano tipeaba
 * lo que entró: la deuda bajaba de menos. La regla de arriba no cambia: lo que viaja
 * como `amount` sigue siendo lo que cancela.
 *
 * Imputar es OPCIONAL. Un pago a cuenta sin nada asignado —el cliente adelanta plata
 * y no dice por qué— es el flujo que existía antes de todo esto y tiene que seguir
 * andando sin tocar nada de la parte nueva.
 *
 * SE PUEDE APLICAR A DOS COSAS (mig 114): a una factura emitida, o a una ESTADÍA que
 * todavía no se facturó. Lo segundo es lo que faltaba: el cliente que transfiere en
 * agosto por las noches de julio, cuya factura sale recién a fin de mes. Cuando esa
 * estadía se factura, la plata se muda sola al comprobante — acá no hay que hacer
 * nada, y por eso la pantalla no ofrece ningún botón para moverla.
 */

/** Los medios que ofrece el cobro a cuenta; las etiquetas, de la tabla única. */
const METHODS = ["cash", "bank_transfer", "mercado_pago", "other"].map((value) => ({
  value,
  label: paymentMethodLabel(value),
}));

/** Lo que falta para poder guardar si nadie eligió el medio (F2-11). */
const FALTA_METODO = "Elegí cómo entró el pago: efectivo, transferencia, Mercado Pago u otro.";

const inputClass =
  "w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm";

/** Lo que se lee en pantalla de una factura: es también lo que dicen los errores. */
function etiquetaFactura(f: CcOpenInvoiceRow): string {
  const numero = f.cbte_nro !== null ? formatCbteNumero(f.pto_vta, f.cbte_nro) : "s/nro";
  return `Factura ${cbteLetra(f.cbte_tipo)} ${numero}`;
}

/** Ídem para una estadía sin facturar: habitación y fechas, que es como se la nombra. */
function etiquetaEstadia(e: CcOpenStayRow): string {
  const hab = e.room_number ? `Hab. ${e.room_number}` : "Sin habitación";
  return `Estadía ${hab} · ${fechaCorta(e.fch_desde)} al ${fechaCorta(e.fch_hasta)}`;
}

/**
 * Una deuda tildable en la pantalla, venga de una factura o de una estadía.
 *
 * Las dos se reparten y se validan igual, así que abajo de este tipo el resto del
 * modal no vuelve a preguntar de cuál se trata: sólo la etiqueta y el renglón de
 * detalle saben la diferencia.
 */
type DeudaEnPantalla = DeudaAImputar & {
  /** Clave de la fila para el estado de tildado y para React. */
  clave: string;
  etiqueta: string;
  /** El total de la deuda (la factura o el cargo de la estadía). */
  total: number;
  /** Lo que ya le habían imputado otros pagos. */
  yaImputado: number;
  /** El renglón chico de abajo: quién y qué, además de los números. */
  detalle: string;
};

function deudaDeFactura(f: CcOpenInvoiceRow): DeudaEnPantalla {
  return {
    destino: "factura",
    id: f.invoice_id,
    clave: claveDeuda("factura", f.invoice_id),
    etiqueta: etiquetaFactura(f),
    fecha: f.cbte_fch,
    numero: f.cbte_nro,
    saldo: f.saldo,
    total: f.imp_total,
    yaImputado: f.imputado,
    detalle: fechaCorta(f.cbte_fch),
  };
}

function deudaDeEstadia(e: CcOpenStayRow): DeudaEnPantalla {
  return {
    destino: "estadia",
    // El id que entiende la RPC es el del CARGO, no el de la reserva: es la fila que
    // representa esa deuda en la cuenta corriente.
    id: e.cargo_movimiento_id,
    clave: claveDeuda("estadia", e.cargo_movimiento_id),
    etiqueta: etiquetaEstadia(e),
    // La fecha con la que entra en la fila de antigüedad es la de salida: es cuando
    // nació el cargo. Sin número de comprobante, porque todavía no hay comprobante.
    fecha: e.fch_hasta,
    numero: null,
    saldo: e.saldo,
    total: e.amount,
    yaImputado: e.imputado,
    detalle: e.passenger ? `${e.passenger} · sin facturar` : "Sin facturar",
  };
}

/** "2026-08-12" (columna date) → "12/08/2026", sin pasar por una zona horaria. */
function fechaCorta(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

/**
 * Un campo de importe vacío o a medio tipear ("1.500.0" camino a "1.500.000")
 * no es un número válido para parseArMoney: acá cualquiera de los dos vale cero,
 * para que el resumen en vivo no parpadee en NaN mientras se escribe.
 */
function monto(value: string): number {
  return parseArMoney(value) ?? 0;
}

/** Formatea con separador de miles al salir del campo; si no es un número válido
 *  (vacío, a medio tipear), deja lo que el usuario tenía escrito. */
function alSalirDelCampo(value: string, setValue: (v: string) => void) {
  const parsed = parseArMoney(value);
  if (parsed !== null) setValue(formatAmountForInput(parsed));
}

/**
 * Abre el recibo de cobranza con auto-impresión, igual que PaymentModal con
 * /admin/recibo/. Devuelve la ventana, o null si el navegador la bloqueó: el pago ya
 * está hecho en la base, así que el bloqueo no se puede tragar en silencio.
 */
function openAccountReceipt(movementId: string): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(
    `/admin/recibo-cc/${movementId}?autoprint=1&copy=original`,
    `recibo-cc-${movementId}`,
    "width=420,height=720"
  );
}

/** El pago ya quedó asentado; lo que falta es el papel. */
type Guardado = { movementId: string; reciboCcNumero: number | null };

export default function RegisterPaymentModal({
  account,
  onClose,
  onSaved,
}: {
  account: CtaCteAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Lo que entró, sin precarga: precargar el saldo invitaba a guardar un número que
  // nadie había mirado contra el extracto.
  const [entroTipeado, setEntro] = useState("");
  // "Paga todo el saldo" deja el campo atado al saldo: mientras nadie lo toque a mano,
  // sigue valiendo saldo − retenciones aunque las retenciones se carguen DESPUÉS (el
  // chip está arriba y se aprieta primero). Si se tipea, el campo pasa a ser del admin.
  const [pagaTodo, setPagaTodo] = useState(false);
  // Sin medio preseleccionado: arrancar en "Efectivo" dejaba transferencias anotadas
  // como efectivo. Vacío hasta que alguien elija.
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [retGanancias, setRetGanancias] = useState("");
  const [retIibb, setRetIibb] = useState("");
  const [certificado, setCertificado] = useState("");
  const [saving, setSaving] = useState(false);
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  /**
   * Candado contra el doble envío. `saving` deshabilita el botón, pero un Enter en un
   * campo manda el formulario igual, y el estado de React recién se ve en el próximo
   * render: el ref corta en el acto. Se suelta sólo si la acción falla.
   */
  const enviando = useRef(false);

  /** Lo que se ve en el campo "Lo que entró": lo tipeado, o lo que pide el chip del saldo. */
  const entro = useMemo(() => {
    if (!pagaTodo) return entroTipeado;
    const retenciones = retencionesTotal({
      retencionGanancias: monto(retGanancias),
      retencionIibb: monto(retIibb),
    });
    const falta = Math.max(0, account.balance - retenciones);
    return formatAmountForInput(Math.round((falta + Number.EPSILON) * 100) / 100);
  }, [pagaTodo, entroTipeado, retGanancias, retIibb, account.balance]);

  /** Lo que CANCELA de deuda: lo que entró + las retenciones. Es el `amount` (mig 109). */
  const amount = useMemo(
    () =>
      cancelaDesdeLoQueEntro({
        entro: monto(entro),
        retencionGanancias: monto(retGanancias),
        retencionIibb: monto(retIibb),
      }),
    [entro, retGanancias, retIibb]
  );

  const [facturas, setFacturas] = useState<CcOpenInvoiceRow[]>([]);
  const [estadias, setEstadias] = useState<CcOpenStayRow[]>([]);
  const [loadingDeudas, setLoadingDeudas] = useState(true);
  /** clave de la deuda → importe tipeado. Está tildada si tiene entrada acá. */
  const [imputado, setImputado] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      // Las dos juntas: son dos lecturas independientes y esperar una atrás de la
      // otra sólo haría más largo el "Buscando…".
      const [resFacturas, resEstadias] = await Promise.all([
        loadClientOpenInvoicesAction(account.kind, account.id),
        loadClientOpenStaysAction(account.kind, account.id),
      ]);
      if (!active) return;
      // Los listados son una ayuda: si fallan, el pago a cuenta sin imputar tiene que
      // seguir cargándose igual, así que no bloquean el modal.
      if (resFacturas.success) setFacturas(resFacturas.data ?? []);
      else toast.error(resFacturas.error);
      if (resEstadias.success) setEstadias(resEstadias.data ?? []);
      else toast.error(resEstadias.error);
      setLoadingDeudas(false);
    })();
    return () => {
      active = false;
    };
  }, [account.kind, account.id]);

  const deudasFacturas = useMemo(() => facturas.map(deudaDeFactura), [facturas]);
  const deudasEstadias = useMemo(() => estadias.map(deudaDeEstadia), [estadias]);
  const deudas = useMemo(
    () => [...deudasFacturas, ...deudasEstadias],
    [deudasFacturas, deudasEstadias]
  );

  const imputaciones: ImputacionEnPantalla[] = useMemo(
    () =>
      deudas
        .filter((d) => imputado[d.clave] !== undefined)
        .map((d) => ({
          destino: d.destino,
          id: d.id,
          etiqueta: d.etiqueta,
          saldo: d.saldo,
          amount: monto(imputado[d.clave]),
        })),
    [deudas, imputado]
  );

  const resumen = useMemo(
    () =>
      resumenPago(
        {
          amount,
          retencionGanancias: monto(retGanancias),
          retencionIibb: monto(retIibb),
        },
        imputaciones
      ),
    [amount, retGanancias, retIibb, imputaciones]
  );

  const problemas = useMemo(() => {
    // Los importes que no se entienden valdrían 0 en silencio: se piden primero. Y si
    // "lo que entró" no se leyó, el aviso genérico de "cancela 0" sobra: ya se dijo.
    const entroLegible = parseArMoney(entro) !== null;
    return [
      ...problemasDeLoTipeado({
        entro,
        retencionGanancias: retGanancias,
        retencionIibb: retIibb,
      }),
      ...problemasDelPago({
        amount,
        retencionGanancias: monto(retGanancias),
        retencionIibb: monto(retIibb),
        imputaciones,
      }).filter((p) => entroLegible || p !== PAGO_EN_CERO),
      ...(method === "" ? [FALTA_METODO] : []),
    ];
  }, [amount, entro, retGanancias, retIibb, imputaciones, method]);

  /** Retener sin anotar el certificado no rompe nada, pero deja el papel inútil. */
  const faltaCertificado = resumen.retenciones > 0 && certificado.trim() === "";

  /**
   * El caso normal: "pagá lo que debe, empezando por lo más viejo". Facturas y
   * estadías entran en la MISMA fila de antigüedad (decisión de Agustín): una estadía
   * de julio sin facturar es más vieja que una factura de agosto, aunque todavía no
   * tenga papel.
   */
  const repartirSolo = () => {
    const reparto = repartirMasViejoPrimero(amount, deudas);
    setImputado(
      Object.fromEntries(
        reparto.map((i) => [claveDeuda(i.destino, i.id), formatAmountForInput(i.amount)])
      )
    );
    if (reparto.length === 0) {
      toast.info("No hay facturas ni estadías con saldo para aplicar este pago.");
    }
  };

  const toggleDeuda = (d: DeudaEnPantalla) => {
    setImputado((prev) => {
      const next = { ...prev };
      if (next[d.clave] !== undefined) {
        delete next[d.clave];
        return next;
      }
      // Al tildar se propone lo que entra: el saldo de la deuda, o lo que quede libre
      // del pago si es menos. Tildar y que aparezca un 0 obliga a hacer a mano la
      // cuenta que la pantalla ya tiene hecha.
      const yaImputado = Object.entries(prev).reduce((sum, [, v]) => sum + monto(v), 0);
      const libre = Math.max(0, amount - yaImputado);
      const propuesto = Math.round((Math.min(d.saldo, libre) + Number.EPSILON) * 100) / 100;
      next[d.clave] = formatAmountForInput(propuesto > 0 ? propuesto : d.saldo);
      return next;
    });
  };

  /**
   * "Paga todo el saldo": lo que tuvo que entrar para dejar la cuenta en cero, o sea
   * el saldo menos lo que ya se cargó de retenciones. Nunca negativo: si la retención
   * se come el saldo, no entró nada.
   */
  const pagaTodoElSaldo = () => setPagaTodo(true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando.current || problemas.length > 0) return;

    enviando.current = true;
    setSaving(true);
    const result = await registerAccountPaymentAction({
      kind: account.kind,
      clientId: account.id,
      amount,
      method,
      notes: notes.trim() || undefined,
      retencionGanancias: monto(retGanancias),
      retencionIibb: monto(retIibb),
      retencionCertificado: certificado.trim() || undefined,
      imputaciones: imputaciones.map(aImputacionDestino),
    });
    setSaving(false);

    if (!result.success) {
      // No se guardó nada: se puede corregir y volver a mandar.
      enviando.current = false;
      toast.error(result.error);
      return;
    }

    const data = result.data as Guardado;
    // El pago YA está asentado. Si la ventana del recibo no abre (bloqueador de
    // pop-ups), el modal no se cierra: se queda mostrando de qué recibo se trata y
    // con el botón para abrirlo. Cerrar acá dejaría un cobro sin papel y sin que
    // nadie se entere.
    if (openAccountReceipt(data.movementId)) {
      toast.success("Pago registrado. Sale el recibo.");
      onSaved();
      return;
    }
    setGuardado(data);
  };

  if (guardado) {
    return (
      <ReciboPendiente
        guardado={guardado}
        onListo={() => {
          onSaved();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Wallet size={18} className="text-emerald-600" />
            Registrar pago a cuenta
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">{account.name}</p>
            <p className="text-slate-500">
              Saldo actual: <BalanceTag balance={account.balance} />
            </p>
          </div>

          {/* El orden es el del papel que el admin tiene en la mano: primero lo que
              dice el extracto (lo que entró), justo debajo lo que dice el certificado
              de retención, y recién ahí lo que cancela, calculado. */}
          <div>
            <div className="flex flex-wrap items-end justify-between gap-2 mb-1.5">
              <label className="block text-sm font-bold text-slate-700" htmlFor="pago-entro">
                Lo que entró (a la cuenta o en mano)
              </label>
              {account.balance > 0 && (
                <button
                  type="button"
                  onClick={pagaTodoElSaldo}
                  title="Completa lo que tuvo que entrar para dejar la cuenta en cero, descontando las retenciones cargadas"
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded-full transition-colors"
                >
                  Paga todo el saldo
                </button>
              )}
            </div>
            <input
              id="pago-entro"
              type="text"
              inputMode="decimal"
              value={entro}
              onChange={(e) => {
                setPagaTodo(false);
                setEntro(e.target.value);
              }}
              onBlur={() => {
                if (!pagaTodo) alSalirDelCampo(entroTipeado, setEntro);
              }}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-lg font-bold"
              placeholder="0,00"
              autoFocus
            />
            <ParsedAmountHint value={entro} />
            <p className="text-[11px] text-slate-500 mt-1">
              Lo que dice el extracto del banco o lo que te dieron en mano, SIN las
              retenciones: esas van justo abajo.
            </p>
          </div>

          <Retenciones
            ganancias={retGanancias}
            iibb={retIibb}
            certificado={certificado}
            faltaCertificado={faltaCertificado}
            onGanancias={setRetGanancias}
            onIibb={setRetIibb}
            onCertificado={setCertificado}
          />

          <CancelaDeDeuda cancela={amount} retenciones={resumen.retenciones} />

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="pago-metodo">
              Cómo entró
            </label>
            <select
              id="pago-metodo"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={inputClass}
            >
              <option value="">Elegí…</option>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              No impacta el arqueo de caja; queda como registro de la cuenta corriente.
            </p>
          </div>

          <DeudasImputables
            facturas={deudasFacturas}
            estadias={deudasEstadias}
            loading={loadingDeudas}
            imputado={imputado}
            onToggle={toggleDeuda}
            onImporte={(clave, value) => setImputado((prev) => ({ ...prev, [clave]: value }))}
            onRepartir={repartirSolo}
            puedeRepartir={amount > 0}
          />

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="pago-notas">
              Notas
            </label>
            <input
              id="pago-notas"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
              placeholder="Opcional. Ej. comprobante N° / transferencia"
            />
          </div>

          {/* El resumen va ARRIBA del botón y en letra grande: es el número que la
              gente se equivoca, así que tiene que leerse antes de apretar y no
              después, en el recibo. */}
          <ResumenEnVivo resumen={resumen} imputaciones={imputaciones} />

          {problemas.length > 0 && (
            <ul
              data-testid="pago-problemas"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5"
            >
              {problemas.map((p) => (
                <li key={p} className="flex gap-2 text-sm font-semibold text-amber-800">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  {p}
                </li>
              ))}
            </ul>
          )}

          <div className="pt-1 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || problemas.length > 0}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <DollarSign size={18} />}
              Registrar e imprimir
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Lo que el cliente debe y se puede tildar: las facturas con saldo y las estadías que
 * todavía no se facturaron (mig 114).
 *
 * Van en dos bloques con título y no en una lista sola aunque el reparto automático
 * las mezcle: "Factura B 0008-00000123" y "Estadía Hab. 2" son dos cosas distintas
 * para el que cobra, y la estadía necesita además la advertencia de que su factura
 * todavía no salió.
 */
function DeudasImputables({
  facturas,
  estadias,
  loading,
  imputado,
  onToggle,
  onImporte,
  onRepartir,
  puedeRepartir,
}: {
  facturas: DeudaEnPantalla[];
  estadias: DeudaEnPantalla[];
  loading: boolean;
  imputado: Record<string, string>;
  onToggle: (d: DeudaEnPantalla) => void;
  onImporte: (clave: string, value: string) => void;
  onRepartir: () => void;
  puedeRepartir: boolean;
}) {
  const hayDeudas = facturas.length + estadias.length > 0;
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/70">
        <div>
          <p className="text-sm font-bold text-slate-700">Aplicar a lo que debe</p>
          <p className="text-[11px] text-slate-500">
            Opcional: sin tildar nada, el pago queda a cuenta.
          </p>
        </div>
        <button
          type="button"
          onClick={onRepartir}
          disabled={!puedeRepartir || !hayDeudas}
          title="Reparte el monto empezando por lo más viejo, sea factura o estadía"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-200 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <Wand2 size={14} /> Aplicar a lo más viejo primero
        </button>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Buscando lo que falta cobrar…
        </p>
      ) : !hayDeudas ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Este cliente no tiene facturas ni estadías con saldo. El pago se registra a
          cuenta.
        </p>
      ) : (
        <>
          {facturas.length > 0 && (
            <GrupoDeDeudas
              titulo="Facturas"
              deudas={facturas}
              imputado={imputado}
              onToggle={onToggle}
              onImporte={onImporte}
            />
          )}
          {estadias.length > 0 && (
            <GrupoDeDeudas
              titulo="Estadías sin facturar"
              ayuda="Cuando salga la factura, esta plata se pasa sola al comprobante."
              deudas={estadias}
              imputado={imputado}
              onToggle={onToggle}
              onImporte={onImporte}
            />
          )}
        </>
      )}
    </div>
  );
}

function GrupoDeDeudas({
  titulo,
  ayuda,
  deudas,
  imputado,
  onToggle,
  onImporte,
}: {
  titulo: string;
  ayuda?: string;
  deudas: DeudaEnPantalla[];
  imputado: Record<string, string>;
  onToggle: (d: DeudaEnPantalla) => void;
  onImporte: (clave: string, value: string) => void;
}) {
  return (
    <>
      <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {titulo}
        {ayuda && (
          <span className="block normal-case tracking-normal font-semibold text-slate-500">
            {ayuda}
          </span>
        )}
      </p>
      <ul className="divide-y divide-slate-100">
        {deudas.map((d) => {
          const tildada = imputado[d.clave] !== undefined;
          return (
            <li key={d.clave} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <label className="flex items-center gap-3 flex-1 min-w-[200px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={tildada}
                  onChange={() => onToggle(d)}
                  className="h-4 w-4 accent-emerald-600 shrink-0"
                  aria-label={`Aplicar a ${d.etiqueta}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{d.etiqueta}</span>
                  <span className="block text-xs text-slate-500">
                    {d.detalle} · total {formatAmount(d.total)} · falta{" "}
                    <span className="font-bold text-slate-700">{formatAmount(d.saldo)}</span>
                    {d.yaImputado > 0 ? ` (ya cobró ${formatAmount(d.yaImputado)})` : ""}
                  </span>
                </span>
              </label>
              <div className="w-32">
                <input
                  type="text"
                  inputMode="decimal"
                  value={imputado[d.clave] ?? ""}
                  onChange={(e) => onImporte(d.clave, e.target.value)}
                  onBlur={(e) => {
                    const parsed = parseArMoney(e.target.value);
                    if (parsed !== null) onImporte(d.clave, formatAmountForInput(parsed));
                  }}
                  disabled={!tildada}
                  aria-label={`Importe aplicado a ${d.etiqueta}`}
                  placeholder="0,00"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-right font-semibold outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
                {tildada && <ParsedAmountHint value={imputado[d.clave] ?? ""} className="text-right" />}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Ganancias e IIBB, con el certificado que después le sirve al contador. */
function Retenciones({
  ganancias,
  iibb,
  certificado,
  faltaCertificado,
  onGanancias,
  onIibb,
  onCertificado,
}: {
  ganancias: string;
  iibb: string;
  certificado: string;
  faltaCertificado: boolean;
  onGanancias: (v: string) => void;
  onIibb: (v: string) => void;
  onCertificado: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 space-y-3">
      <div>
        <p className="text-sm font-bold text-slate-700">Retenciones</p>
        {/* Por qué se SUMAN a lo que entró: es plata que el cliente le pagó a ARCA en
            nombre del hotel, así que cancela deuda igual que el efectivo. */}
        <p className="text-[11px] text-slate-500">
          Se suman a lo que entró: cancelan deuda igual que el efectivo. Dejalas en cero
          si el cliente no retuvo.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="ret-ganancias">
            Ganancias
          </label>
          <input
            id="ret-ganancias"
            type="text"
            inputMode="decimal"
            value={ganancias}
            onChange={(e) => onGanancias(e.target.value)}
            onBlur={() => alSalirDelCampo(ganancias, onGanancias)}
            placeholder="0,00"
            className={inputClass}
          />
          <ParsedAmountHint value={ganancias} />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="ret-iibb">
            Ingresos Brutos
          </label>
          <input
            id="ret-iibb"
            type="text"
            inputMode="decimal"
            value={iibb}
            onChange={(e) => onIibb(e.target.value)}
            onBlur={() => alSalirDelCampo(iibb, onIibb)}
            placeholder="0,00"
            className={inputClass}
          />
          <ParsedAmountHint value={iibb} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="ret-certificado">
          N° de certificado
        </label>
        <input
          id="ret-certificado"
          type="text"
          value={certificado}
          onChange={(e) => onCertificado(e.target.value)}
          placeholder="El que figura en el comprobante de retención"
          className={inputClass}
        />
        {/* Avisa, no bloquea: el número puede llegar después, y trabar el cobro por
            un dato administrativo dejaría la cuenta sin el pago que ya entró. */}
        {faltaCertificado && (
          <p className="text-[11px] font-semibold text-amber-600 mt-1">
            Cargaste una retención sin número de certificado: sin él el contador no la
            puede computar.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Lo que cancela de deuda, calculado y de solo lectura (F2-11). Va en grande y
 * pegado a lo que se tipeó, porque es el número que antes se tipeaba mal.
 */
function CancelaDeDeuda({ cancela, retenciones }: { cancela: number; retenciones: number }) {
  return (
    <div
      data-testid="pago-cancela"
      aria-live="polite"
      className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
        Cancela de deuda
      </p>
      <p className="text-2xl sm:text-3xl font-bold text-emerald-900 leading-tight">
        {formatAmount(cancela)}
      </p>
      <p className="text-[11px] font-semibold text-emerald-800/80 mt-1">
        {retenciones > 0
          ? `Lo que entró + ${formatAmount(retenciones)} de retenciones. Es lo que le baja de deuda al cliente y lo que dice el recibo.`
          : "Lo que entró. Es lo que le baja de deuda al cliente y lo que dice el recibo."}
      </p>
    </div>
  );
}

/** "1 factura", "2 estadías", "1 factura y 2 estadías": lo que se está pagando. */
function detalleDeLoAplicado(imputaciones: readonly ImputacionEnPantalla[]): string {
  const cuenta = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`;
  const f = imputaciones.filter((i) => i.destino === "factura").length;
  const e = imputaciones.length - f;
  const partes = [
    ...(f > 0 ? [cuenta(f, "factura", "facturas")] : []),
    ...(e > 0 ? [cuenta(e, "estadía", "estadías")] : []),
  ];
  return partes.join(" y ");
}

/** Las tres cifras del pago, en grande, antes de apretar el botón. */
function ResumenEnVivo({
  resumen,
  imputaciones,
}: {
  resumen: ReturnType<typeof resumenPago>;
  imputaciones: ImputacionEnPantalla[];
}) {
  const imputando = imputaciones.length;
  return (
    <div
      data-testid="pago-resumen"
      className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3"
    >
      <p className="text-lg sm:text-xl font-bold text-emerald-900 leading-snug">
        Cancela {formatAmount(resumen.cancela)} de deuda · entran{" "}
        {formatAmount(resumen.entran)} · {formatAmount(resumen.retenciones)} de retenciones
      </p>
      <p className="text-xs font-semibold text-emerald-800/80 mt-1">
        {imputando === 0
          ? "Sin aplicar a nada: queda como pago a cuenta."
          : `Aplicado a ${detalleDeLoAplicado(imputaciones)}: ${formatAmount(resumen.imputado)}${
              resumen.sinImputar > 0 ? ` · ${formatAmount(resumen.sinImputar)} quedan a cuenta` : ""
            }`}
      </p>
    </div>
  );
}

/**
 * El pago entró pero el recibo no salió: el navegador bloqueó la ventana.
 *
 * Es su propia pantalla y no un toast porque el cobro está hecho y el papel no, y
 * ese estado no se puede perder de vista con un aviso que se desvanece solo.
 */
function ReciboPendiente({
  guardado,
  onListo,
}: {
  guardado: Guardado;
  onListo: () => void;
}) {
  const numero =
    guardado.reciboCcNumero !== null ? formatShiftCode(guardado.reciboCcNumero) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg shrink-0">
            <Receipt size={20} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              El pago quedó registrado{numero ? ` (recibo N° ${numero})` : ""}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Falta el papel: el navegador bloqueó la ventana del recibo. Abrilo desde
              acá, o después desde la solapa Pagos de la ficha del cliente.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onListo}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => openAccountReceipt(guardado.movementId)}
            className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-2"
          >
            <Printer size={18} /> Abrir el recibo
          </button>
        </div>
      </div>
    </div>
  );
}
