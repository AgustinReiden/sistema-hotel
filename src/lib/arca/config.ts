import "server-only";

// Configuración server-only del cliente ARCA (patrón src/lib/webhook.ts):
// los secretos viven en variables de entorno del servidor (Coolify / .env.local)
// y NUNCA en la DB ni en el navegador.
//
//   ARCA_CERT_B64     certificado X.509 (PEM) en base64 — evita el infierno de
//   ARCA_KEY_B64      clave privada (PEM) en base64       newlines en env vars
//   ARCA_INTERNAL_KEY clave interna que autoriza a ESTE servidor a finalizar
//                     facturas y leer/escribir el ticket WSAA (ver mig 72)

import forge from "node-forge";

import type { ArcaEnvironment } from "./types";

export const ARCA_ENDPOINTS: Record<
  ArcaEnvironment,
  { wsaa: string; wsfe: string }
> = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

function decodeB64(value: string | undefined): string | null {
  if (!value || value.trim() === "") return null;
  try {
    return Buffer.from(value.trim(), "base64").toString("utf-8");
  } catch {
    return null;
  }
}

export function getArcaCertPem(): string | null {
  return decodeB64(process.env.ARCA_CERT_B64);
}

export function getArcaKeyPem(): string | null {
  return decodeB64(process.env.ARCA_KEY_B64);
}

export function getArcaInternalKey(): string | null {
  const key = process.env.ARCA_INTERNAL_KEY;
  return key && key.trim() !== "" ? key.trim() : null;
}

/**
 * ¿Está el server listo para hablar con ARCA? Si falta algo, degradamos con
 * warn (la UI muestra "no configurado", el check-out sigue funcionando).
 */
export function isArcaConfigured(): boolean {
  const ok = Boolean(getArcaCertPem() && getArcaKeyPem() && getArcaInternalKey());
  if (!ok) {
    console.warn(
      "[arca] Falta ARCA_CERT_B64 / ARCA_KEY_B64 / ARCA_INTERNAL_KEY: la facturación electrónica está deshabilitada."
    );
  }
  return ok;
}

/** Datos del certificado para el health check (vencimiento, sujeto). */
export function getCertInfo(): { notAfter: Date; subject: string } | null {
  const pem = getArcaCertPem();
  if (!pem) return null;
  try {
    const cert = forge.pki.certificateFromPem(pem);
    const cn = cert.subject.getField("CN") as { value?: string } | null;
    return {
      notAfter: cert.validity.notAfter,
      subject: cn?.value ?? "(sin CN)",
    };
  } catch (error) {
    console.warn("[arca] No se pudo parsear el certificado:", error);
    return null;
  }
}
