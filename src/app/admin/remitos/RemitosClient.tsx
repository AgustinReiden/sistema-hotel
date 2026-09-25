"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Info, Loader2, Settings2, X } from "lucide-react";
import { toast } from "sonner";

import ClientFilter from "../fiscal/control/ClientFilter";
import { formatAmount } from "@/lib/format";
import { formatHotelDate, formatHotelDateTime } from "@/lib/time";
import {
  REMITO_ESTADO_LABEL,
  REMITO_ESTADO_TONO,
  accionesRemito,
  avisosSalud,
  esVencido,
  haceDias,
  iaTexto,
  motivoPiezaLabel,
  numeroRemitoVisible,
  parseNumeroRemito,
  piezaAsignable,
  remitosParaRevisar,
  resumirRemitos,
  textoParaRevisar,
  textoSemaforo,
} from "@/lib/remitos";
import type {
  CtaCteAccount,
  RemitoEstadoPersona,
  RemitoLookup,
  RemitoPanelRow,
  RemitoPaqueteFactura,
  RemitoPieza,
  RemitosSalud,
} from "@/lib/types";
import {
  assignRemitoPiezaAction,
  lookupRemitoAction,
  markRemitoAction,
  resolveRemitoPiezaAction,
  saveRemitosAjustesAction,
} from "./actions";
import PaquetesSection from "./PaquetesSection";
import VencidosSection from "./VencidosSection";

type Props = {
  rows: RemitoPanelRow[];
  /** Remitos vencidos de cualquier mes (mig 124): no dependen del filtro. */
  vencidos?: RemitoPanelRow[];
  /** Consolidadas del cliente elegido, con su paquete (mig 124). */
  paquetes?: RemitoPaqueteFactura[];
  piezas: RemitoPieza[];
  salud: RemitosSalud;
  accounts: CtaCteAccount[];
  /** "company:<uuid>" | "guest:<uuid>" | "" (todos). */
  cliente: string;
  /** "AAAA-MM". */
  mes: string;
  nowMs: number;
  /** Qué no se pudo cargar (la pantalla lo dice en vez de mostrar una lista vacía). */
  errores: string[];
};

const inputClass =
  "px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500";
const botonSecundario =
  "flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors";
const botonPrimario =
  "flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2";
const botonChico = "text-xs px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 whitespace-nowrap";

function Modal({ titulo, onClose, children, pie }: { titulo: string; onClose: () => void; children: ReactNode; pie: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-y-auto overscroll-contain max-h-[92dvh] sm:max-h-[88dvh]">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800">{titulo}</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="p-5 border-t border-slate-100 flex gap-3">{pie}</div>
      </div>
    </div>
  );
}

function EstadoChip({ row }: { row: RemitoPanelRow }) {
  const quien =
    row.decidido_por === "ia" ? "la IA" : row.decidido_por === "persona" ? row.decidido_por_nombre ?? "una persona" : null;
  const titulo = quien && row.estado_at ? `Lo puso ${quien} el ${formatHotelDateTime(row.estado_at)}` : undefined;
  return (
    <span title={titulo} className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${REMITO_ESTADO_TONO[row.estado]}`}>
      {REMITO_ESTADO_LABEL[row.estado]}
      {row.decidido_por === "ia" ? " · IA" : ""}
    </span>
  );
}

function EnlaceEscaneo({ row }: { row: RemitoPanelRow }) {
  if (!row.escaneo_link) return <span className="text-slate-400">—</span>;
  return (
    <a href={row.escaneo_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
      Ver{row.escaneo_version && row.escaneo_version > 1 ? ` (v${row.escaneo_version})` : ""}
      <ExternalLink size={13} />
    </a>
  );
}

export default function RemitosClient({ rows, vencidos = [], paquetes = [], piezas, salud, accounts, cliente, mes, nowMs, errores }: Props) {
  const router = useRouter();
  const [clienteSel, setClienteSel] = useState(cliente);
  const [mesSel, setMesSel] = useState(mes);
  const [busy, setBusy] = useState(false);

  const [marca, setMarca] = useState<{ row: RemitoPanelRow; estado: RemitoEstadoPersona } | null>(null);
  const [nota, setNota] = useState("");

  const [asignando, setAsignando] = useState<RemitoPieza | null>(null);
  const [numeroTexto, setNumeroTexto] = useState("");
  const [encontrado, setEncontrado] = useState<RemitoLookup | null>(null);

  const [resolviendo, setResolviendo] = useState<RemitoPieza | null>(null);
  const [como, setComo] = useState<"reescaneada" | "descartada">("reescaneada");
  const [notaPieza, setNotaPieza] = useState("");

  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [umbralPct, setUmbralPct] = useState(String(Math.round(salud.umbral_confianza * 100)));
  const [desdeTexto, setDesdeTexto] = useState(String(salud.controlar_desde));
  const [horasTexto, setHorasTexto] = useState(String(salud.horas_vencimiento));
  const [alertarDesde, setAlertarDesde] = useState(salud.alertar_desde);

  const resumen = useMemo(() => resumirRemitos(rows), [rows]);
  const vencidosDelMes = useMemo(() => rows.filter((r) => esVencido(r, salud, nowMs)).length, [rows, salud, nowMs]);
  const paraRevisar = textoParaRevisar(remitosParaRevisar(salud));
  const avisos = useMemo(() => avisosSalud(salud, nowMs), [salud, nowMs]);
  const mostrarCliente = cliente === "";

  function aplicarFiltros() {
    const q = new URLSearchParams();
    if (clienteSel) q.set("cliente", clienteSel);
    if (mesSel) q.set("mes", mesSel);
    const qs = q.toString();
    router.push(`/admin/remitos${qs ? `?${qs}` : ""}`);
  }

  async function confirmarMarca() {
    if (!marca) return;
    setBusy(true);
    const r = await markRemitoAction(marca.row.movimiento_id, marca.estado, nota);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success(`${numeroRemitoVisible(marca.row.remito_numero)}: ${REMITO_ESTADO_LABEL[marca.estado]}`);
    setMarca(null);
    router.refresh();
  }

  async function buscarNumero() {
    const numero = parseNumeroRemito(numeroTexto);
    if (numero === null) {
      toast.error("Escribí el número como está impreso, por ejemplo R-000158.");
      return;
    }
    setBusy(true);
    const r = await lookupRemitoAction(numero);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    setEncontrado(r.data ?? { existe: false });
  }

  async function confirmarAsignacion() {
    if (!asignando || !encontrado?.existe) return;
    setBusy(true);
    const r = await assignRemitoPiezaAction(asignando.id, encontrado.remito_numero);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success(`Escaneo vinculado a ${numeroRemitoVisible(encontrado.remito_numero)}. La IA va a mirar la firma.`);
    setAsignando(null);
    router.refresh();
  }

  async function confirmarResolucion() {
    if (!resolviendo) return;
    setBusy(true);
    const r = await resolveRemitoPiezaAction(resolviendo.id, como, notaPieza);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success("Pieza resuelta.");
    setResolviendo(null);
    router.refresh();
  }

  async function guardarAjustes() {
    setBusy(true);
    const r = await saveRemitosAjustesAction(Number(umbralPct), Number(desdeTexto), Number(horasTexto), alertarDesde);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success("Ajustes guardados.");
    setAjustesAbiertos(false);
    router.refresh();
  }

  const accionesDe = (r: RemitoPanelRow) =>
    accionesRemito(r.estado).map((a) => (
      <button
        key={a.estado}
        type="button"
        onClick={() => {
          setMarca({ row: r, estado: a.estado });
          setNota("");
        }}
        className={botonChico}
      >
        {a.label}
      </button>
    ));

  return (
    <div className="space-y-4">
      {errores.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border p-3 text-sm bg-rose-50 border-rose-200 text-rose-800">
          <AlertTriangle size={18} className="shrink-0" />
          <span>No se pudo cargar: {errores.join(", ")}. Probá de nuevo; si sigue, avisá.</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-3 md:p-4 flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex-1 min-w-0">
          {/* ClientFilter trae su propia etiqueta "Cliente". */}
          <ClientFilter accounts={accounts} value={clienteSel} onChange={setClienteSel} inputId="remitos-cliente" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="remitos-mes">
            Mes
          </label>
          <input id="remitos-mes" type="month" value={mesSel} onChange={(e) => setMesSel(e.target.value)} className={inputClass} />
        </div>
        <button type="button" onClick={aplicarFiltros} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg">
          Ver
        </button>
        <button
          type="button"
          onClick={() => setAjustesAbiertos(true)}
          className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800 flex items-center gap-1.5"
          title="Umbral de la IA y desde qué remito se controla"
        >
          <Settings2 size={16} /> Ajustes
        </button>
      </div>

      {avisos.map((a) => (
        <div
          key={a.texto}
          role={a.tono === "alert" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            a.tono === "alert" ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-slate-50 border-slate-200 text-slate-600"
          }`}
        >
          {a.tono === "alert" ? <AlertTriangle size={18} className="shrink-0" /> : <Info size={18} className="shrink-0" />}
          <span>{a.texto}</span>
        </div>
      ))}

      <VencidosSection rows={vencidos} horas={salud.horas_vencimiento} nowMs={nowMs} renderAcciones={accionesDe} />

      {paraRevisar && (
        <p className="text-sm font-semibold text-rose-800" data-testid="para-revisar">
          {paraRevisar}
        </p>
      )}

      <p className="text-sm font-semibold text-slate-700" data-testid="semaforo">
        {textoSemaforo(resumen, vencidosDelMes)}
      </p>

      {rows.length > 0 && (
        <>
          <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Remito</th>
                  <th className="text-left px-3 py-2">Fecha</th>
                  {mostrarCliente && <th className="text-left px-3 py-2">Cliente</th>}
                  <th className="text-left px-3 py-2">Hab. / pasajero</th>
                  <th className="text-right px-3 py-2">Monto</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-left px-3 py-2">IA</th>
                  <th className="text-left px-3 py-2">Escaneo</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.movimiento_id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-mono font-semibold">{numeroRemitoVisible(r.remito_numero)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatHotelDate(r.created_at)}
                      {r.estado === "sin_escanear" && <span className="block text-xs text-slate-400">{haceDias(r.created_at, nowMs)}</span>}
                    </td>
                    {mostrarCliente && <td className="px-3 py-2">{r.cliente}</td>}
                    <td className="px-3 py-2">{[r.room_number ? `Hab. ${r.room_number}` : null, r.pasajero].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatAmount(r.amount)}</td>
                    <td className="px-3 py-2">
                      <EstadoChip row={r} />
                      {r.nota && <span className="block text-xs text-slate-500 mt-1">{r.nota}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600" title={r.firma_ia_observacion ?? undefined}>
                      {iaTexto(r) ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <EnlaceEscaneo row={r} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 justify-end">{accionesDe(r)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-2">
            {rows.map((r) => (
              <li key={r.movimiento_id} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{numeroRemitoVisible(r.remito_numero)}</span>
                  <EstadoChip row={r} />
                </div>
                <p className="text-sm text-slate-600">
                  {formatHotelDate(r.created_at)} · {formatAmount(r.amount)}
                  {mostrarCliente ? ` · ${r.cliente}` : ""}
                </p>
                <p className="text-xs text-slate-500">
                  {iaTexto(r) ?? (r.estado === "sin_escanear" ? haceDias(r.created_at, nowMs) : "")}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <EnlaceEscaneo row={r} />
                  {accionesDe(r)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <section className="bg-white border border-slate-200 rounded-xl">
        <h2 className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-700">
          Piezas a revisar ({piezas.length})
        </h2>
        {piezas.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">No hay nada para revisar.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {piezas.map((p) => (
              <li key={p.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{motivoPiezaLabel(p.motivo)}</p>
                  <p className="text-xs text-slate-500">
                    {formatHotelDateTime(p.created_at)}
                    {p.lote_archivo ? ` · ${p.lote_archivo}` : ""}
                    {p.ubicacion ? ` · pieza ${p.ubicacion}` : ""}
                  </p>
                  {p.numeros_leidos.length > 0 && (
                    <p className="text-xs text-slate-600 mt-0.5">Adentro se leyó: {p.numeros_leidos.join(", ")}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.drive_link && (
                    <a href={p.drive_link} target="_blank" rel="noopener noreferrer" className={`${botonChico} inline-flex items-center gap-1`}>
                      Ver imagen <ExternalLink size={12} />
                    </a>
                  )}
                  {piezaAsignable(p.motivo) && (
                    <button
                      type="button"
                      className={botonChico}
                      onClick={() => {
                        setAsignando(p);
                        setNumeroTexto("");
                        setEncontrado(null);
                      }}
                    >
                      Asignar a un remito
                    </button>
                  )}
                  <button
                    type="button"
                    className={botonChico}
                    onClick={() => {
                      setResolviendo(p);
                      setComo("reescaneada");
                      setNotaPieza("");
                    }}
                  >
                    Resuelta
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PaquetesSection facturas={paquetes} clienteElegido={cliente !== ""} nowMs={nowMs} />

      {marca && (
        <Modal
          titulo={`${numeroRemitoVisible(marca.row.remito_numero)}: ${REMITO_ESTADO_LABEL[marca.estado]}`}
          onClose={() => setMarca(null)}
          pie={
            <>
              <button type="button" onClick={() => setMarca(null)} className={botonSecundario}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarMarca()}
                disabled={busy || (marca.estado === "sin_remito" && !nota.trim())}
                className={botonPrimario}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Confirmar
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            {marca.row.cliente} · {formatHotelDate(marca.row.created_at)} · {formatAmount(marca.row.amount)}
          </p>
          <div>
            <label htmlFor="remito-nota" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Nota {marca.estado === "sin_remito" ? <span className="text-rose-600">*</span> : "(opcional)"}
            </label>
            <input
              id="remito-nota"
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={300}
              placeholder={marca.estado === "sin_remito" ? "Qué pasó con el papel" : ""}
              className={`${inputClass} w-full`}
              autoFocus
            />
          </div>
        </Modal>
      )}

      {asignando && (
        <Modal
          titulo="Asignar a un remito"
          onClose={() => setAsignando(null)}
          pie={
            <>
              <button type="button" onClick={() => setAsignando(null)} className={botonSecundario}>
                Cancelar
              </button>
              <button type="button" onClick={() => void confirmarAsignacion()} disabled={busy || !encontrado?.existe} className={botonPrimario}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Vincular
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Tipeá el número impreso en el ticket, al lado del QR.</p>
          <div className="flex gap-2">
            <input
              aria-label="Número del remito"
              value={numeroTexto}
              onChange={(e) => {
                setNumeroTexto(e.target.value);
                setEncontrado(null);
              }}
              placeholder="R-000158"
              className={`${inputClass} flex-1 font-mono`}
              autoFocus
            />
            <button
              type="button"
              onClick={() => void buscarNumero()}
              disabled={busy || !numeroTexto.trim()}
              className="px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Buscar
            </button>
          </div>
          {encontrado && !encontrado.existe && <p className="text-sm text-rose-700">Ese número no existe. Revisá el ticket.</p>}
          {encontrado?.existe && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-slate-700" data-testid="remito-encontrado">
              <p className="font-semibold">
                {numeroRemitoVisible(encontrado.remito_numero)} · {encontrado.cliente}
              </p>
              <p>
                {formatHotelDate(encontrado.created_at)} · {formatAmount(encontrado.amount)}
                {encontrado.room_number ? ` · Hab. ${encontrado.room_number}` : ""}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Estado actual: {REMITO_ESTADO_LABEL[encontrado.estado]}
                {encontrado.escaneos > 0 ? ` · ya tiene ${encontrado.escaneos} escaneo(s): este va a quedar como versión nueva` : ""}
              </p>
            </div>
          )}
        </Modal>
      )}

      {resolviendo && (
        <Modal
          titulo="Marcar la pieza como resuelta"
          onClose={() => setResolviendo(null)}
          pie={
            <>
              <button type="button" onClick={() => setResolviendo(null)} className={botonSecundario}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarResolucion()}
                disabled={busy || (como === "descartada" && !notaPieza.trim())}
                className={botonPrimario}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Confirmar
              </button>
            </>
          }
        >
          <fieldset className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="como" checked={como === "reescaneada"} onChange={() => setComo("reescaneada")} />
              Ya se volvió a escanear bien
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="como" checked={como === "descartada"} onChange={() => setComo("descartada")} />
              No era un remito (se descarta)
            </label>
          </fieldset>
          <div>
            <label htmlFor="pieza-nota" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Nota {como === "descartada" ? <span className="text-rose-600">*</span> : "(opcional)"}
            </label>
            <input
              id="pieza-nota"
              type="text"
              value={notaPieza}
              onChange={(e) => setNotaPieza(e.target.value)}
              maxLength={300}
              className={`${inputClass} w-full`}
            />
          </div>
        </Modal>
      )}

      {ajustesAbiertos && (
        <Modal
          titulo="Ajustes de remitos"
          onClose={() => setAjustesAbiertos(false)}
          pie={
            <>
              <button type="button" onClick={() => setAjustesAbiertos(false)} className={botonSecundario}>
                Cancelar
              </button>
              <button type="button" onClick={() => void guardarAjustes()} disabled={busy} className={botonPrimario}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Guardar
              </button>
            </>
          }
        >
          <div>
            <label htmlFor="ajuste-umbral" className="block text-sm font-semibold text-slate-700 mb-1.5">
              La IA decide sola desde este % de seguridad
            </label>
            <input
              id="ajuste-umbral"
              type="number"
              min={50}
              max={100}
              value={umbralPct}
              onChange={(e) => setUmbralPct(e.target.value)}
              className={`${inputClass} w-28`}
            />
            <p className="text-xs text-slate-500 mt-1">
              Por debajo de este número, el remito queda &quot;A revisar&quot; y lo decide una persona. Con 100, la IA
              solo decide cuando está totalmente segura.
            </p>
          </div>
          <div>
            <label htmlFor="ajuste-desde" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Controlar desde el remito número
            </label>
            <input
              id="ajuste-desde"
              type="number"
              min={1}
              value={desdeTexto}
              onChange={(e) => setDesdeTexto(e.target.value)}
              className={`${inputClass} w-32`}
            />
          </div>
          <div>
            <label htmlFor="ajuste-horas" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Horas para que un remito venza
            </label>
            <input
              id="ajuste-horas"
              type="number"
              min={1}
              max={720}
              value={horasTexto}
              onChange={(e) => setHorasTexto(e.target.value)}
              className={`${inputClass} w-full`}
            />
            <p className="text-xs text-slate-600 mt-1">Desde el check-out. Si no está firmado a esa altura, aparece en Vencidos.</p>
          </div>
          <div>
            <label htmlFor="ajuste-alertar" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Alertar desde
            </label>
            <input
              id="ajuste-alertar"
              type="date"
              value={alertarDesde}
              onChange={(e) => setAlertarDesde(e.target.value)}
              className={`${inputClass} w-full`}
            />
            <p className="text-xs text-slate-600 mt-1">Los cargos anteriores a esta fecha nunca vencen.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
