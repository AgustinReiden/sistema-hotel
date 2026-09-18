"use client";

import { useEffect, useMemo, useState } from "react";
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

import { loadClientOpenInvoicesAction, registerAccountPaymentAction } from "./actions";
import BalanceTag from "./BalanceTag";
import { cbteLetra, formatCbteNumero } from "@/lib/arca/amounts";
import {
  problemasDelPago,
  repartirMasViejoPrimero,
  resumenPago,
  type FacturaAImputar,
  type ImputacionEnPantalla,
} from "@/lib/cc-pagos";
import { formatAmount, formatShiftCode } from "@/lib/format";
import type { CcOpenInvoiceRow, CtaCteAccount } from "@/lib/types";

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
 * Imputar es OPCIONAL. Un pago a cuenta sin factura asignada —el cliente adelanta
 * plata, la factura sale el mes que viene— es el flujo que existía antes de todo
 * esto y tiene que seguir andando sin tocar nada de la parte nueva.
 */

const METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "bank_transfer", label: "Transferencia" },
  { value: "mercado_pago", label: "Mercado Pago" },
  { value: "other", label: "Otro" },
];

const inputClass =
  "w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm";

/** Lo que se lee en pantalla de una factura: es también lo que dicen los errores. */
function etiquetaFactura(f: CcOpenInvoiceRow): string {
  const numero = f.cbte_nro !== null ? formatCbteNumero(f.pto_vta, f.cbte_nro) : "s/nro";
  return `Factura ${cbteLetra(f.cbte_tipo)} ${numero}`;
}

/** "2026-08-12" (columna date) → "12/08/2026", sin pasar por una zona horaria. */
function fechaCorta(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

/**
 * Un <input type="number"> vacío o a medio tipear ("1.") es "" o NaN: acá cualquiera
 * de los dos vale cero, para que el resumen en vivo no parpadee en NaN mientras se
 * escribe.
 */
function monto(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
  const [amount, setAmount] = useState(account.balance > 0 ? account.balance.toString() : "");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [retGanancias, setRetGanancias] = useState("");
  const [retIibb, setRetIibb] = useState("");
  const [certificado, setCertificado] = useState("");
  const [saving, setSaving] = useState(false);
  const [guardado, setGuardado] = useState<Guardado | null>(null);

  const [facturas, setFacturas] = useState<CcOpenInvoiceRow[]>([]);
  const [loadingFacturas, setLoadingFacturas] = useState(true);
  /** invoice_id → importe tipeado. Una factura está tildada si tiene entrada acá. */
  const [imputado, setImputado] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadClientOpenInvoicesAction(account.kind, account.id);
      if (!active) return;
      if (result.success) {
        setFacturas(result.data ?? []);
      } else {
        // El listado de facturas es una ayuda: si falla, el pago a cuenta sin imputar
        // tiene que seguir cargándose igual, así que no bloquea el modal.
        toast.error(result.error);
      }
      setLoadingFacturas(false);
    })();
    return () => {
      active = false;
    };
  }, [account.kind, account.id]);

  const imputaciones: ImputacionEnPantalla[] = useMemo(
    () =>
      facturas
        .filter((f) => imputado[f.invoice_id] !== undefined)
        .map((f) => ({
          invoiceId: f.invoice_id,
          etiqueta: etiquetaFactura(f),
          saldo: f.saldo,
          amount: monto(imputado[f.invoice_id]),
        })),
    [facturas, imputado]
  );

  const resumen = useMemo(
    () =>
      resumenPago(
        {
          amount: monto(amount),
          retencionGanancias: monto(retGanancias),
          retencionIibb: monto(retIibb),
        },
        imputaciones
      ),
    [amount, retGanancias, retIibb, imputaciones]
  );

  const problemas = useMemo(
    () =>
      problemasDelPago({
        amount: monto(amount),
        retencionGanancias: monto(retGanancias),
        retencionIibb: monto(retIibb),
        imputaciones,
      }),
    [amount, retGanancias, retIibb, imputaciones]
  );

  /** Retener sin anotar el certificado no rompe nada, pero deja el papel inútil. */
  const faltaCertificado = resumen.retenciones > 0 && certificado.trim() === "";

  const paraRepartir: FacturaAImputar[] = useMemo(
    () =>
      facturas.map((f) => ({
        invoiceId: f.invoice_id,
        fecha: f.cbte_fch,
        numero: f.cbte_nro,
        saldo: f.saldo,
      })),
    [facturas]
  );

  /** El caso normal: "pagá lo que debe, empezando por lo más viejo". */
  const repartirSolo = () => {
    const reparto = repartirMasViejoPrimero(monto(amount), paraRepartir);
    setImputado(Object.fromEntries(reparto.map((i) => [i.invoiceId, String(i.amount)])));
    if (reparto.length === 0) {
      toast.info("No hay facturas con saldo para aplicar este pago.");
    }
  };

  const toggleFactura = (f: CcOpenInvoiceRow) => {
    setImputado((prev) => {
      const next = { ...prev };
      if (next[f.invoice_id] !== undefined) {
        delete next[f.invoice_id];
        return next;
      }
      // Al tildar se propone lo que entra: el saldo de la factura, o lo que quede
      // libre del pago si es menos. Tildar y que aparezca un 0 obliga a hacer a mano
      // la cuenta que la pantalla ya tiene hecha.
      const yaImputado = Object.entries(prev).reduce((sum, [, v]) => sum + monto(v), 0);
      const libre = Math.max(0, monto(amount) - yaImputado);
      const propuesto = Math.round((Math.min(f.saldo, libre) + Number.EPSILON) * 100) / 100;
      next[f.invoice_id] = String(propuesto > 0 ? propuesto : f.saldo);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problemas.length > 0) return;

    setSaving(true);
    const result = await registerAccountPaymentAction({
      kind: account.kind,
      clientId: account.id,
      amount: monto(amount),
      method,
      notes: notes.trim() || undefined,
      retencionGanancias: monto(retGanancias),
      retencionIibb: monto(retIibb),
      retencionCertificado: certificado.trim() || undefined,
      imputaciones: imputaciones.map((i) => ({ invoiceId: i.invoiceId, amount: i.amount })),
    });
    setSaving(false);

    if (!result.success) {
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="pago-monto">
                Monto que cancela
              </label>
              <input
                id="pago-monto"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-lg font-bold"
                required
                autoFocus
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Incluye las retenciones: es lo que le baja de deuda al cliente.
              </p>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="pago-metodo">
                Método (informativo)
              </label>
              <select
                id="pago-metodo"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={inputClass}
              >
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
          </div>

          <FacturasImputables
            facturas={facturas}
            loading={loadingFacturas}
            imputado={imputado}
            onToggle={toggleFactura}
            onImporte={(id, value) => setImputado((prev) => ({ ...prev, [id]: value }))}
            onRepartir={repartirSolo}
            puedeRepartir={monto(amount) > 0}
          />

          <Retenciones
            ganancias={retGanancias}
            iibb={retIibb}
            certificado={certificado}
            faltaCertificado={faltaCertificado}
            onGanancias={setRetGanancias}
            onIibb={setRetIibb}
            onCertificado={setCertificado}
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
          <ResumenEnVivo resumen={resumen} imputando={imputaciones.length} />

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

/** Las facturas con saldo del cliente, para tildar cuáles se están pagando. */
function FacturasImputables({
  facturas,
  loading,
  imputado,
  onToggle,
  onImporte,
  onRepartir,
  puedeRepartir,
}: {
  facturas: CcOpenInvoiceRow[];
  loading: boolean;
  imputado: Record<string, string>;
  onToggle: (f: CcOpenInvoiceRow) => void;
  onImporte: (invoiceId: string, value: string) => void;
  onRepartir: () => void;
  puedeRepartir: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/70">
        <div>
          <p className="text-sm font-bold text-slate-700">Aplicar a facturas</p>
          <p className="text-[11px] text-slate-500">
            Opcional: sin tildar nada, el pago queda a cuenta.
          </p>
        </div>
        <button
          type="button"
          onClick={onRepartir}
          disabled={!puedeRepartir || facturas.length === 0}
          title="Reparte el monto empezando por la factura más vieja"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-200 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <Wand2 size={14} /> Aplicar a lo más viejo primero
        </button>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Buscando facturas impagas…
        </p>
      ) : facturas.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Este cliente no tiene facturas con saldo. El pago se registra a cuenta.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {facturas.map((f) => {
            const tildada = imputado[f.invoice_id] !== undefined;
            return (
              <li key={f.invoice_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <label className="flex items-center gap-3 flex-1 min-w-[200px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tildada}
                    onChange={() => onToggle(f)}
                    className="h-4 w-4 accent-emerald-600 shrink-0"
                    aria-label={`Aplicar a ${etiquetaFactura(f)}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">
                      {etiquetaFactura(f)}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fechaCorta(f.cbte_fch)} · total {formatAmount(f.imp_total)} · falta{" "}
                      <span className="font-bold text-slate-700">{formatAmount(f.saldo)}</span>
                      {f.imputado > 0 ? ` (ya cobró ${formatAmount(f.imputado)})` : ""}
                    </span>
                  </span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={imputado[f.invoice_id] ?? ""}
                  onChange={(e) => onImporte(f.invoice_id, e.target.value)}
                  disabled={!tildada}
                  aria-label={`Importe imputado a ${etiquetaFactura(f)}`}
                  placeholder="0,00"
                  className="w-32 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-right font-semibold outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
        {/* Por qué no se restan del monto: es plata que el cliente le pagó a ARCA en
            nombre del hotel, así que cancela deuda igual que el efectivo. */}
        <p className="text-[11px] text-slate-500">
          Van DENTRO del monto: cancelan deuda igual que el efectivo. Dejalas en cero si
          el cliente no retuvo.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="ret-ganancias">
            Ganancias
          </label>
          <input
            id="ret-ganancias"
            type="number"
            step="0.01"
            min="0"
            value={ganancias}
            onChange={(e) => onGanancias(e.target.value)}
            placeholder="0,00"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="ret-iibb">
            Ingresos Brutos
          </label>
          <input
            id="ret-iibb"
            type="number"
            step="0.01"
            min="0"
            value={iibb}
            onChange={(e) => onIibb(e.target.value)}
            placeholder="0,00"
            className={inputClass}
          />
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

/** Las tres cifras del pago, en grande, antes de apretar el botón. */
function ResumenEnVivo({
  resumen,
  imputando,
}: {
  resumen: ReturnType<typeof resumenPago>;
  imputando: number;
}) {
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
          ? "Sin aplicar a facturas: queda como pago a cuenta."
          : `Aplicado a ${imputando} factura${imputando === 1 ? "" : "s"}: ${formatAmount(resumen.imputado)}${
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
