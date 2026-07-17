"use server";

import { revalidatePath } from "next/cache";

import { emitInvoice } from "@/lib/arca/emitter";
import {
  ARCA_ENDPOINTS,
  getArcaCertPem,
  getArcaInternalKey,
  getArcaKeyPem,
  getCertInfo,
} from "@/lib/arca/config";
import { loginWsaa } from "@/lib/arca/wsaa";
import {
  buildFEDummyEnvelope,
  buildFECompUltimoAutorizadoEnvelope,
  callWsfe,
  parseFEDummyResponse,
  parseFECompUltimoAutorizadoResponse,
} from "@/lib/arca/wsfe";
import {
  createInvoiceDraft,
  discardInvoice,
  fixReservationDniForInvoice,
  getFiscalSettings,
  setFiscalInternalKey,
  updateFiscalSettings,
} from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult, EmitInvoiceOutcome } from "@/lib/types";
import { fiscalSettingsSchema } from "@/lib/validations";

function revalidateFiscalViews() {
  revalidatePath("/admin/fiscal");
  revalidatePath("/admin");
}

/**
 * Flujo del prompt SÍ/NO y de "Emitir" en /admin/fiscal: crea (o reusa) el
 * borrador vía RPC (que valida turno/DNI/exclusiones) y lo emite contra ARCA.
 */
export async function emitInvoiceForReservationAction(
  reservationId: string
): Promise<ActionResult<EmitInvoiceOutcome>> {
  try {
    const draft = await createInvoiceDraft(reservationId);
    const outcome = await emitInvoice(draft.invoiceId);
    revalidateFiscalViews();
    return { success: true, data: outcome };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo emitir la factura.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/** Reintento desde /admin/fiscal (pendientes / rechazadas / en verificación). */
export async function retryInvoiceAction(
  invoiceId: string
): Promise<ActionResult<EmitInvoiceOutcome>> {
  try {
    const outcome = await emitInvoice(invoiceId);
    revalidateFiscalViews();
    return { success: true, data: outcome };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo reintentar la factura.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * "Corregir DNI" en una factura rechazada/pendiente: corrige el DNI de la reserva
 * (aunque ya esté cerrada) y reintenta la emisión (que re-lee el DNI corregido).
 */
export async function fixInvoiceDniAndRetryAction(
  invoiceId: string,
  reservationId: string,
  dni: string
): Promise<ActionResult<EmitInvoiceOutcome>> {
  try {
    await fixReservationDniForInvoice(reservationId, dni);
    const outcome = await emitInvoice(invoiceId);
    revalidateFiscalViews();
    return { success: true, data: outcome };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo corregir el DNI.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/** Descarta una factura pendiente/rechazada (la reserva vuelve a quedar facturable). */
export async function discardInvoiceAction(
  invoiceId: string
): Promise<ActionResult> {
  try {
    await discardInvoice(invoiceId);
    revalidateFiscalViews();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo descartar la factura.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export type ArcaHealthReport = {
  configured: boolean;
  certSubject: string | null;
  certExpiresAt: string | null;
  certExpiresSoon: boolean;
  dummy: { ok: boolean; detail: string };
  wsaa: { ok: boolean; detail: string };
  lastAuthorized: { ok: boolean; detail: string };
};

/** "Probar conexión ARCA" del panel de config: FEDummy + WSAA + último autorizado. */
export async function arcaHealthAction(): Promise<ActionResult<ArcaHealthReport>> {
  try {
    const settings = await getFiscalSettings();
    const env = settings?.environment ?? "homologacion";
    const endpoints = ARCA_ENDPOINTS[env];

    const certPem = getArcaCertPem();
    const keyPem = getArcaKeyPem();
    const internalKey = getArcaInternalKey();
    const certInfo = getCertInfo();
    const configured = Boolean(certPem && keyPem && internalKey);

    const report: ArcaHealthReport = {
      configured,
      certSubject: certInfo?.subject ?? null,
      certExpiresAt: certInfo?.notAfter.toISOString() ?? null,
      certExpiresSoon: certInfo
        ? certInfo.notAfter.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000
        : false,
      dummy: { ok: false, detail: "no probado" },
      wsaa: { ok: false, detail: "no probado" },
      lastAuthorized: { ok: false, detail: "no probado" },
    };

    // 1) FEDummy: salud de los servers de ARCA (no requiere auth).
    try {
      const xml = await callWsfe(endpoints.wsfe, "FEDummy", buildFEDummyEnvelope());
      const dummy = parseFEDummyResponse(xml);
      const ok = dummy.appServer === "OK" && dummy.dbServer === "OK" && dummy.authServer === "OK";
      report.dummy = {
        ok,
        detail: `app=${dummy.appServer} db=${dummy.dbServer} auth=${dummy.authServer}`,
      };
    } catch (error) {
      report.dummy = { ok: false, detail: error instanceof Error ? error.message : "error" };
    }

    // 2) WSAA: login real (valida certificado + clave privada).
    if (certPem && keyPem) {
      try {
        const ta = await loginWsaa(endpoints.wsaa, certPem, keyPem);
        report.wsaa = { ok: true, detail: `ticket válido hasta ${ta.expirationTime}` };

        // 3) Último autorizado (valida CUIT + punto de venta + permisos del WS).
        if (settings?.cuit && settings.punto_venta) {
          try {
            const xml = await callWsfe(
              endpoints.wsfe,
              "FECompUltimoAutorizado",
              buildFECompUltimoAutorizadoEnvelope(
                { token: ta.token, sign: ta.sign, cuit: settings.cuit },
                settings.punto_venta,
                settings.cbte_tipo
              )
            );
            const nro = parseFECompUltimoAutorizadoResponse(xml);
            report.lastAuthorized = { ok: true, detail: `último comprobante autorizado: ${nro}` };
          } catch (error) {
            report.lastAuthorized = {
              ok: false,
              detail: error instanceof Error ? error.message : "error",
            };
          }
        } else {
          report.lastAuthorized = { ok: false, detail: "falta CUIT o punto de venta en la config" };
        }
      } catch (error) {
        report.wsaa = { ok: false, detail: error instanceof Error ? error.message : "error" };
      }
    } else {
      report.wsaa = { ok: false, detail: "falta el certificado en el servidor (ARCA_CERT_B64 / ARCA_KEY_B64)" };
    }

    return { success: true, data: report };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo probar la conexión con ARCA.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/** Guardado de la config fiscal (admin; el RLS y el schema re-validan). */
export async function updateFiscalSettingsAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    const raw = {
      enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
      environment: String(formData.get("environment") ?? "homologacion"),
      cuit: String(formData.get("cuit") ?? "").trim(),
      razon_social: String(formData.get("razon_social") ?? "").trim(),
      domicilio_fiscal: String(formData.get("domicilio_fiscal") ?? "").trim(),
      iibb: String(formData.get("iibb") ?? "").trim(),
      inicio_actividades: String(formData.get("inicio_actividades") ?? "").trim(),
      punto_venta: String(formData.get("punto_venta") ?? "").trim(),
    };
    const parsed = fiscalSettingsSchema.parse(raw);

    await updateFiscalSettings({
      enabled: parsed.enabled,
      environment: parsed.environment,
      cuit: parsed.cuit || null,
      razon_social: parsed.razon_social || null,
      domicilio_fiscal: parsed.domicilio_fiscal || null,
      iibb: parsed.iibb || null,
      inicio_actividades: parsed.inicio_actividades || null,
      punto_venta: parsed.punto_venta ?? null,
    });

    // Sincronizar la clave interna del servidor (hash en fiscal_private) para
    // que los RPC sensibles acepten a ESTE server. Idempotente.
    const internalKey = getArcaInternalKey();
    if (internalKey) {
      await setFiscalInternalKey(internalKey);
    }

    revalidatePath("/admin/settings");
    revalidateFiscalViews();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo guardar la configuración fiscal.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
