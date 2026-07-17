// Tipos del cliente ARCA (ex AFIP) — factura electrónica por WSFEv1.
// Sin `server-only`: importable desde tests y componentes de UI.

export type ArcaEnvironment = "homologacion" | "produccion";

/** Ticket de Acceso del WSAA (válido 12 hs). Se persiste en DB (tabla arca_ta). */
export type TaData = {
  token: string;
  sign: string;
  generationTime: string; // ISO
  expirationTime: string; // ISO
};

export type WsfeAuth = {
  token: string;
  sign: string;
  cuit: string; // CUIT del emisor, solo dígitos
};

/**
 * Pedido de CAE para UN comprobante (FECAESolicitar con CantReg=1).
 * Fechas en formato ARCA `yyyymmdd` (zona del hotel).
 */
export type FecaeRequest = {
  ptoVta: number;
  cbteTipo: number; // 6 = Factura B
  concepto: number; // 2 = Servicios
  docTipo: number; // 96 = DNI
  docNro: string; // solo dígitos
  cbteNro: number;
  cbteFch: string; // yyyymmdd
  impTotal: number;
  impNeto: number;
  impIva: number;
  ivaId: number; // 5 = 21%
  monId: string; // 'PES'
  monCotiz: number; // 1
  /** RG 5616 — obligatorio desde 1/7/2025. 5 = Consumidor Final. */
  condicionIvaReceptorId: number;
  fchServDesde: string; // yyyymmdd
  fchServHasta: string; // yyyymmdd
  fchVtoPago: string; // yyyymmdd
};

export type WsfeObservacion = { code: number; msg: string };

export type FecaeResult =
  | { resultado: "A"; cae: string; caeVto: string; raw: unknown }
  | {
      resultado: "R";
      observaciones: WsfeObservacion[];
      errores: WsfeObservacion[];
      raw: unknown;
    };

/** Comprobante ya autorizado en ARCA (FECompConsultar). null = no existe (err 602). */
export type CbteConsultado = {
  cbteNro: number;
  impTotal: number;
  docNro: string;
  cbteFch: string; // yyyymmdd
  cae: string;
  caeVto: string; // yyyymmdd
} | null;

export type FeDummyResult = {
  appServer: string;
  dbServer: string;
  authServer: string;
};

/** No llegamos a ARCA (DNS/conexión/TLS): seguro reintentar → invoice queda 'pending'. */
export class ArcaNetworkError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "ArcaNetworkError";
  }
}

/**
 * El pedido PUDO haber llegado (timeout post-envío, 5xx): outcome desconocido.
 * La invoice queda 'processing' y el próximo intento consulta FECompConsultar
 * antes de re-emitir (anti-duplicado).
 */
export class ArcaUnknownOutcomeError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "ArcaUnknownOutcomeError";
  }
}

/** Códigos de observación de WSFE que indican problema de numeración (reintentable con nro nuevo). */
export const WSFE_NUMBERING_CODES = new Set([10016]);

/** Estado local de una factura (tabla invoices). */
export type InvoiceStatus = "pending" | "processing" | "authorized" | "rejected";
