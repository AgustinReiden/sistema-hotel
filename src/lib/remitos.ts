// Reglas de pantalla del panel de remitos firmados (/admin/remitos). Puras y
// testeadas: la decisión de fondo (qué estado queda) la toma la base (mig 116).

import { interpretarCodigo, numeroVisible } from "./remito-codigo";
import type { RemitoEstado, RemitoEstadoPersona, RemitoPanelRow, RemitosSalud } from "./types";

export const REMITO_ESTADO_LABEL: Record<RemitoEstado, string> = {
  sin_escanear: "Sin escanear",
  evaluando: "Evaluando",
  a_revisar: "A revisar",
  firmado: "Firmado",
  sin_firma: "Sin firma",
  sin_remito: "Sin remito",
};

export const REMITO_ESTADO_TONO: Record<RemitoEstado, string> = {
  sin_escanear: "bg-slate-100 text-slate-600 border-slate-200",
  evaluando: "bg-sky-50 text-sky-700 border-sky-200",
  a_revisar: "bg-amber-50 text-amber-800 border-amber-200",
  firmado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sin_firma: "bg-rose-50 text-rose-700 border-rose-200",
  sin_remito: "bg-slate-200 text-slate-700 border-slate-300",
};

export function numeroRemitoVisible(numero: number): string {
  return numeroVisible(numero);
}

const ACCIONES: { estado: RemitoEstadoPersona; label: string }[] = [
  { estado: "firmado", label: "Firmado" },
  { estado: "sin_firma", label: "Sin firma" },
  { estado: "sin_remito", label: "Sin remito" },
  { estado: "a_revisar", label: "Volver a revisar" },
];

/** Lo que se puede decidir sobre un remito. Sin escaneo, solo que el papel se perdió. */
export function accionesRemito(estado: RemitoEstado): { estado: RemitoEstadoPersona; label: string }[] {
  if (estado === "sin_escanear") return ACCIONES.filter((a) => a.estado === "sin_remito");
  return ACCIONES.filter((a) => a.estado !== estado);
}

const MOTIVO_PIEZA_LABEL: Record<string, string> = {
  forma_no_reconocida: "Tickets pegados o forma rara",
  varios_codigos: "Varios tickets en la hoja, sin cartulina",
  codigo_ilegible: "QR ilegible",
  dv_invalido: "QR mal leído",
  codigo_ajeno: "Código que no es de un remito",
  codigo_inexistente: "Número que no existe en el sistema",
  sin_tickets: "Hoja sin tickets",
};

export function motivoPiezaLabel(motivo: string): string {
  return MOTIVO_PIEZA_LABEL[motivo] ?? motivo.replace(/_/g, " ");
}

const MOTIVOS_VARIOS_TICKETS = new Set(["forma_no_reconocida", "varios_codigos"]);

/** Una imagen con varios tickets nunca queda como respaldo de uno: se re-escanea. */
export function piezaAsignable(motivo: string): boolean {
  return !MOTIVOS_VARIOS_TICKETS.has(motivo);
}

/**
 * "158", "000158", "R-158", "R-000158" o el código completo del QR. Con el código
 * completo, el DV tiene que cerrar: si no, es un número mal copiado y se rechaza.
 */
export function parseNumeroRemito(texto: string): number | null {
  const t = String(texto ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const completo = /^R-?(\d{1,6})-(\d{2})$/.exec(t);
  if (completo) {
    const lectura = interpretarCodigo(`R-${completo[1].padStart(6, "0")}-${completo[2]}`);
    return lectura.ok ? lectura.numero : null;
  }
  const simple = /^(?:R-?)?(\d{1,6})$/.exec(t);
  if (!simple) return null;
  const n = Number(simple[1]);
  return n >= 1 ? n : null;
}

export type ResumenRemitos = { total: number; porEstado: Record<RemitoEstado, number> };

export function resumirRemitos(rows: RemitoPanelRow[]): ResumenRemitos {
  const porEstado: Record<RemitoEstado, number> = {
    sin_escanear: 0, evaluando: 0, a_revisar: 0, firmado: 0, sin_firma: 0, sin_remito: 0,
  };
  for (const r of rows) porEstado[r.estado] += 1;
  return { total: rows.length, porEstado };
}

const PARTES: { estado: RemitoEstado; uno: string; varios: string }[] = [
  { estado: "firmado", uno: "firmado", varios: "firmados" },
  { estado: "sin_firma", uno: "sin firma", varios: "sin firma" },
  { estado: "a_revisar", uno: "a revisar", varios: "a revisar" },
  { estado: "evaluando", uno: "evaluando", varios: "evaluando" },
  { estado: "sin_escanear", uno: "sin escanear", varios: "sin escanear" },
  { estado: "sin_remito", uno: "sin remito", varios: "sin remito" },
];

export function textoSemaforo(r: ResumenRemitos): string {
  if (r.total === 0) return "No hay remitos en este período.";
  const partes = PARTES.filter((p) => r.porEstado[p.estado] > 0).map(
    (p) => `${r.porEstado[p.estado]} ${r.porEstado[p.estado] === 1 ? p.uno : p.varios}`
  );
  return `${r.total} ${r.total === 1 ? "remito" : "remitos"}: ${partes.join(" · ")}`;
}

export type AvisoSalud = { tono: "alert" | "info"; texto: string };

/** Lo que desde afuera se ve igual que "no hubo escaneos". */
export function avisosSalud(s: RemitosSalud, ahoraMs: number): AvisoSalud[] {
  const avisos: AvisoSalud[] = [];
  if (!s.ultima_ingesta_at) {
    avisos.push({ tono: "info", texto: "La ingesta de remitos todavía no registró ninguna corrida." });
  } else {
    const horas = Math.floor((ahoraMs - Date.parse(s.ultima_ingesta_at)) / 3_600_000);
    if (horas >= 1) {
      avisos.push({
        tono: "alert",
        texto: `La ingesta de remitos no corre desde hace ${horas} h: los escaneos nuevos no se están procesando. Revisá "Remitos - Ingesta" en n8n.`,
      });
    }
  }
  if (s.evaluando_viejos > 0) {
    avisos.push({
      tono: "alert",
      texto: `${s.evaluando_viejos} ${s.evaluando_viejos === 1 ? "remito espera" : "remitos esperan"} la evaluación de la firma hace más de 2 horas. Revisá "Remitos - Evaluar firmas" en n8n.`,
    });
  }
  return avisos;
}

export function iaTexto(r: RemitoPanelRow): string | null {
  const pct = r.firma_ia_confianza === null ? "" : ` ${Math.round(r.firma_ia_confianza * 100)}%`;
  if (r.firma_ia === "si") return `firmado${pct}`;
  if (r.firma_ia === "no") return `sin firma${pct}`;
  if (r.firma_ia === "error") return "no pudo leerlo";
  return r.estado === "evaluando" ? "esperando" : null;
}

export function haceDias(iso: string, ahoraMs: number): string {
  const dias = Math.floor((ahoraMs - Date.parse(iso)) / 86_400_000);
  if (dias <= 0) return "hoy";
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** "2026-09" → primer y último día del mes. */
export function rangoDeMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}
