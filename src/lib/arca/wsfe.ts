// WSFEv1 — WebService de Factura Electrónica de ARCA (RG 4291, manual v4.5).
// SOAP 1.1 armado a mano (fetch + fast-xml-parser): pares build*/parse* puros
// (testeables con fixtures) + `callWsfe` que es lo único que toca la red.

import { XMLParser } from "fast-xml-parser";

import {
  ArcaNetworkError,
  ArcaUnknownOutcomeError,
  type CbteConsultado,
  type FeDummyResult,
  type FecaeRequest,
  type FecaeResult,
  type WsfeAuth,
  type WsfeObservacion,
} from "./types";

const NS = "http://ar.gov.afip.dif.FEV1/";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false, // CAE y fechas son strings largos: no convertir
  removeNSPrefix: true, // soap:Body → Body (tolera soap/soapenv/s)
});

/** fast-xml-parser devuelve objeto para 1 elemento y array para N: normalizar. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function soapEnvelope(inner: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`,
    `<soap:Body>${inner}</soap:Body>`,
    `</soap:Envelope>`,
  ].join("");
}

function authXml(auth: WsfeAuth): string {
  return `<Auth><Token>${auth.token}</Token><Sign>${auth.sign}</Sign><Cuit>${auth.cuit}</Cuit></Auth>`;
}

// ─────────────────────────────── FECAESolicitar ───────────────────────────────

/** Monto con punto decimal y 2 decimales, como espera WSFE. */
const money = (n: number) => n.toFixed(2);

export function buildFECAESolicitarEnvelope(auth: WsfeAuth, req: FecaeRequest): string {
  return soapEnvelope(
    [
      `<FECAESolicitar xmlns="${NS}">`,
      authXml(auth),
      `<FeCAEReq>`,
      `<FeCabReq><CantReg>1</CantReg><PtoVta>${req.ptoVta}</PtoVta><CbteTipo>${req.cbteTipo}</CbteTipo></FeCabReq>`,
      `<FeDetReq><FECAEDetRequest>`,
      `<Concepto>${req.concepto}</Concepto>`,
      `<DocTipo>${req.docTipo}</DocTipo>`,
      `<DocNro>${req.docNro}</DocNro>`,
      `<CbteDesde>${req.cbteNro}</CbteDesde>`,
      `<CbteHasta>${req.cbteNro}</CbteHasta>`,
      `<CbteFch>${req.cbteFch}</CbteFch>`,
      `<ImpTotal>${money(req.impTotal)}</ImpTotal>`,
      `<ImpTotConc>0.00</ImpTotConc>`,
      `<ImpNeto>${money(req.impNeto)}</ImpNeto>`,
      `<ImpOpEx>0.00</ImpOpEx>`,
      `<ImpTrib>0.00</ImpTrib>`,
      `<ImpIVA>${money(req.impIva)}</ImpIVA>`,
      // Concepto 2 (servicios): período del servicio + vencimiento de pago.
      `<FchServDesde>${req.fchServDesde}</FchServDesde>`,
      `<FchServHasta>${req.fchServHasta}</FchServHasta>`,
      `<FchVtoPago>${req.fchVtoPago}</FchVtoPago>`,
      `<MonId>${req.monId}</MonId>`,
      `<MonCotiz>${req.monCotiz}</MonCotiz>`,
      // RG 5616 (obligatorio desde 1/7/2025): condición de IVA del receptor.
      `<CondicionIVAReceptorId>${req.condicionIvaReceptorId}</CondicionIVAReceptorId>`,
      `<Iva><AlicIva><Id>${req.ivaId}</Id><BaseImp>${money(req.impNeto)}</BaseImp><Importe>${money(req.impIva)}</Importe></AlicIva></Iva>`,
      `</FECAEDetRequest></FeDetReq>`,
      `</FeCAEReq>`,
      `</FECAESolicitar>`,
    ].join("")
  );
}

function parseObs(node: unknown): WsfeObservacion[] {
  const obs = toArray((node as { Obs?: unknown })?.Obs);
  return obs.map((o) => {
    const item = o as { Code?: string; Msg?: string };
    return { code: Number(item.Code) || 0, msg: String(item.Msg ?? "") };
  });
}

function parseErrors(node: unknown): WsfeObservacion[] {
  const errs = toArray((node as { Err?: unknown })?.Err);
  return errs.map((e) => {
    const item = e as { Code?: string; Msg?: string };
    return { code: Number(item.Code) || 0, msg: String(item.Msg ?? "") };
  });
}

export function parseFECAESolicitarResponse(xml: string): FecaeResult {
  const doc = parser.parse(xml);
  const result = doc?.Envelope?.Body?.FECAESolicitarResponse?.FECAESolicitarResult;
  if (!result) {
    throw new ArcaUnknownOutcomeError("Respuesta de FECAESolicitar sin resultado.");
  }

  const headerErrors = parseErrors(result.Errors);
  const det = toArray(result.FeDetResp?.FECAEDetResponse)[0] as
    | { Resultado?: string; CAE?: string; CAEFchVto?: string; Observaciones?: unknown }
    | undefined;

  const resultado = String(det?.Resultado ?? result.FeCabResp?.Resultado ?? "R");

  if (resultado === "A" && det?.CAE) {
    return {
      resultado: "A",
      cae: String(det.CAE),
      caeVto: String(det.CAEFchVto ?? ""),
      raw: result,
    };
  }

  return {
    resultado: "R",
    observaciones: parseObs(det?.Observaciones),
    errores: headerErrors,
    raw: result,
  };
}

// ──────────────────────────── FECompUltimoAutorizado ────────────────────────────

export function buildFECompUltimoAutorizadoEnvelope(
  auth: WsfeAuth,
  ptoVta: number,
  cbteTipo: number
): string {
  return soapEnvelope(
    `<FECompUltimoAutorizado xmlns="${NS}">${authXml(auth)}<PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo></FECompUltimoAutorizado>`
  );
}

export function parseFECompUltimoAutorizadoResponse(xml: string): number {
  const doc = parser.parse(xml);
  const result = doc?.Envelope?.Body?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult;
  if (!result) {
    throw new ArcaUnknownOutcomeError("Respuesta de FECompUltimoAutorizado sin resultado.");
  }
  const errors = parseErrors(result.Errors);
  if (errors.length > 0) {
    throw new ArcaNetworkError(
      `FECompUltimoAutorizado devolvió error: ${errors.map((e) => `${e.code} ${e.msg}`).join("; ")}`
    );
  }
  const nro = Number(result.CbteNro);
  if (!Number.isFinite(nro)) {
    throw new ArcaUnknownOutcomeError("FECompUltimoAutorizado sin CbteNro numérico.");
  }
  return nro;
}

// ─────────────────────────────── FECompConsultar ───────────────────────────────

export function buildFECompConsultarEnvelope(
  auth: WsfeAuth,
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number
): string {
  return soapEnvelope(
    `<FECompConsultar xmlns="${NS}">${authXml(auth)}<FeCompConsReq><CbteTipo>${cbteTipo}</CbteTipo><CbteNro>${cbteNro}</CbteNro><PtoVta>${ptoVta}</PtoVta></FeCompConsReq></FECompConsultar>`
  );
}

/** 602 = "No existen datos ... para el comprobante solicitado" → null. */
export function parseFECompConsultarResponse(xml: string): CbteConsultado {
  const doc = parser.parse(xml);
  const result = doc?.Envelope?.Body?.FECompConsultarResponse?.FECompConsultarResult;
  if (!result) {
    throw new ArcaUnknownOutcomeError("Respuesta de FECompConsultar sin resultado.");
  }
  const errors = parseErrors(result.Errors);
  if (errors.some((e) => e.code === 602)) return null;
  if (errors.length > 0) {
    throw new ArcaNetworkError(
      `FECompConsultar devolvió error: ${errors.map((e) => `${e.code} ${e.msg}`).join("; ")}`
    );
  }
  const g = result.ResultGet as
    | {
        CbteDesde?: string;
        ImpTotal?: string;
        DocNro?: string;
        CbteFch?: string;
        CodAutorizacion?: string;
        FchVto?: string;
      }
    | undefined;
  if (!g?.CodAutorizacion) return null;
  return {
    cbteNro: Number(g.CbteDesde) || 0,
    impTotal: Number(g.ImpTotal) || 0,
    docNro: String(g.DocNro ?? ""),
    cbteFch: String(g.CbteFch ?? ""),
    cae: String(g.CodAutorizacion),
    caeVto: String(g.FchVto ?? ""),
  };
}

// ─────────────────────────────────── FEDummy ───────────────────────────────────

export function buildFEDummyEnvelope(): string {
  return soapEnvelope(`<FEDummy xmlns="${NS}"/>`);
}

export function parseFEDummyResponse(xml: string): FeDummyResult {
  const doc = parser.parse(xml);
  const result = doc?.Envelope?.Body?.FEDummyResponse?.FEDummyResult;
  return {
    appServer: String(result?.AppServer ?? "?"),
    dbServer: String(result?.DbServer ?? "?"),
    authServer: String(result?.AuthServer ?? "?"),
  };
}

// ─────────────────────────────────── Red ───────────────────────────────────

/**
 * POST SOAP a WSFEv1. Clasifica los fallos:
 *  - No llegó (DNS/conexión/TLS) → ArcaNetworkError (retryable, invoice 'pending').
 *  - Pudo llegar (timeout/5xx post-envío) → ArcaUnknownOutcomeError (invoice
 *    queda 'processing'; el próximo intento consulta antes de re-emitir).
 */
export async function callWsfe(
  endpoint: string,
  soapAction: string,
  envelope: string
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `${NS}${soapAction}`,
      },
      body: envelope,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const cause = error as { name?: string; cause?: { code?: string } };
    const code = cause?.cause?.code ?? "";
    const beforeSend =
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "CERT_HAS_EXPIRED" ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
    if (beforeSend) {
      throw new ArcaNetworkError("No se pudo conectar con ARCA.", { cause: error });
    }
    // Timeout/abort: el pedido pudo haber llegado → outcome desconocido.
    throw new ArcaUnknownOutcomeError("ARCA no respondió a tiempo.", { cause: error });
  }

  const text = await response.text();
  if (!response.ok) {
    // 5xx tras enviar: pudo haberse procesado.
    throw new ArcaUnknownOutcomeError(`ARCA devolvió HTTP ${response.status}.`, {
      cause: text.slice(0, 500),
    });
  }
  return text;
}
