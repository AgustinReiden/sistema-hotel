// WSAA — WebService de Autenticación y Autorización de ARCA.
// Flujo: armar TRA (XML) → firmarlo CMS/PKCS#7 con el certificado → SOAP
// loginCms → Ticket de Acceso (token + sign, válido 12 hs).
//
// Las funciones build*/parse* son puras (testeables con fixtures); solo
// `loginWsaa` toca la red. Gotcha conocido: ARCA rechaza pedir un TA nuevo
// mientras hay uno vigente ("El CEE ya posee un TA valido") — por eso el TA
// se persiste en DB ANTES de usarse (ver emitter.ts / rpc_set_arca_ta).

import { XMLParser } from "fast-xml-parser";
import forge from "node-forge";

import { ArcaNetworkError, ArcaUnknownOutcomeError, type ArcaEnvironment, type TaData } from "./types";

const xmlEscape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * TRA (Ticket Request Access). generationTime 10 min atrás por clock skew;
 * expirationTime +12 h. uniqueId = epoch en segundos.
 */
export function buildTra(service: string, now: Date): string {
  const gen = new Date(now.getTime() - 10 * 60 * 1000);
  const exp = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const uniqueId = Math.floor(now.getTime() / 1000);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<loginTicketRequest version="1.0">`,
    `<header>`,
    `<uniqueId>${uniqueId}</uniqueId>`,
    `<generationTime>${gen.toISOString()}</generationTime>`,
    `<expirationTime>${exp.toISOString()}</expirationTime>`,
    `</header>`,
    `<service>${xmlEscape(service)}</service>`,
    `</loginTicketRequest>`,
  ].join("");
}

/** Firma CMS/PKCS#7 (SHA-256) del TRA → DER → base64 (lo que espera loginCms). */
export function signTraCms(tra: string, certPem: string, keyPem: string): string {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

export function buildLoginCmsEnvelope(cmsBase64: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">`,
    `<soapenv:Header/>`,
    `<soapenv:Body>`,
    `<wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms>`,
    `</soapenv:Body>`,
    `</soapenv:Envelope>`,
  ].join("");
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false, // tokens/signs son base64: jamás convertir a número
});

/**
 * El response SOAP trae `loginCmsReturn` con el loginTicketResponse XML
 * **escapado como texto** → doble parse.
 */
export function parseLoginCmsResponse(soapXml: string): TaData {
  const outer = parser.parse(soapXml);
  const body =
    outer?.["soapenv:Envelope"]?.["soapenv:Body"] ??
    outer?.["soap:Envelope"]?.["soap:Body"] ??
    outer?.Envelope?.Body;

  const fault = body?.["soapenv:Fault"] ?? body?.["soap:Fault"] ?? body?.Fault;
  if (fault) {
    const faultString = String(fault.faultstring ?? "Fault de WSAA");
    const alreadyValid = /ya posee un TA valido/i.test(faultString);
    throw new ArcaNetworkError(
      alreadyValid
        ? "ARCA reporta un ticket de acceso vigente que no tenemos guardado. Reintentá en unos minutos (se renueva solo al vencer)."
        : `WSAA rechazó la autenticación: ${faultString}`
    );
  }

  const inner = body?.loginCmsResponse?.loginCmsReturn;
  if (!inner) {
    throw new ArcaUnknownOutcomeError("Respuesta de WSAA sin loginCmsReturn.");
  }
  const ta = parser.parse(String(inner));
  const credentials = ta?.loginTicketResponse?.credentials;
  const header = ta?.loginTicketResponse?.header;
  if (!credentials?.token || !credentials?.sign) {
    throw new ArcaUnknownOutcomeError("Ticket de WSAA sin token/sign.");
  }
  return {
    token: String(credentials.token),
    sign: String(credentials.sign),
    generationTime: String(header?.generationTime ?? new Date().toISOString()),
    expirationTime: String(header?.expirationTime ?? ""),
  };
}

/** Login real contra WSAA. Lanza ArcaNetworkError / ArcaUnknownOutcomeError. */
export async function loginWsaa(
  endpoint: string,
  certPem: string,
  keyPem: string,
  service = "wsfe"
): Promise<TaData> {
  const tra = buildTra(service, new Date());
  const cms = signTraCms(tra, certPem, keyPem);
  const envelope = buildLoginCmsEnvelope(cms);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      body: envelope,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    // El login no emite comprobantes: cualquier fallo acá es retryable.
    throw new ArcaNetworkError("No se pudo conectar con WSAA (ARCA).", { cause: error });
  }

  const text = await response.text();
  return parseLoginCmsResponse(text);
}

/** Convierte el tipo de environment al endpoint de WSAA. */
export function wsaaEndpoint(env: ArcaEnvironment, endpoints: Record<ArcaEnvironment, { wsaa: string }>): string {
  return endpoints[env].wsaa;
}
