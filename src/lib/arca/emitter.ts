import "server-only";

// Orquestador de emisión de facturas contra ARCA. Nunca lanza al caller:
// devuelve siempre {status, userMessage} apto para un toast. El check-out ya
// commiteó antes de llegar acá — cualquier fallo deja la factura 'pending'
// (o 'processing' si el outcome es desconocido) y se reintenta después.
//
// Secuencia (ver plan / mig 72):
//  1. TA vigente (cache en DB; si vence en <5 min → WSAA → persistir ANTES de usar)
//  2. Recovery: si la invoice quedó 'processing' con número de un intento
//     anterior, FECompConsultar — si ARCA la tiene, recuperar el CAE (no duplicar)
//  3. FECompUltimoAutorizado → N
//  4. rpc_begin_invoice_emission(id, N+1)  ← claim + single-flight + número
//  5. FECAESolicitar
//  6. finalize según resultado (authorized / rejected / pending / unknown)

import {
  beginInvoiceEmission,
  finalizeInvoice,
  getArcaTa,
  getInvoiceById,
  getStaleProcessingInvoiceIds,
  setArcaTa,
  type BeginEmissionPayload,
} from "@/lib/data";
import type { EmitInvoiceOutcome, FiscalEnvironment } from "@/lib/types";

import { formatCbteNumero } from "./amounts";
import { ARCA_ENDPOINTS, getArcaCertPem, getArcaInternalKey, getArcaKeyPem } from "./config";
import { buildQrUrl } from "./qr";
import {
  ArcaNetworkError,
  ArcaUnknownOutcomeError,
  WSFE_NUMBERING_CODES,
  type FecaeRequest,
  type WsfeAuth,
} from "./types";
import { loginWsaa } from "./wsaa";
import {
  buildFECAESolicitarEnvelope,
  buildFECompConsultarEnvelope,
  buildFECompUltimoAutorizadoEnvelope,
  callWsfe,
  parseFECAESolicitarResponse,
  parseFECompConsultarResponse,
  parseFECompUltimoAutorizadoResponse,
} from "./wsfe";

const TA_RENEW_MARGIN_MS = 5 * 60 * 1000;

/** "yyyymmdd" → "yyyy-mm-dd" (para columnas date de Postgres). */
function isoFromArcaDate(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

async function ensureTa(
  environment: FiscalEnvironment,
  internalKey: string
): Promise<{ token: string; sign: string }> {
  const cached = await getArcaTa(environment, internalKey);
  if (cached && new Date(cached.expiration_time).getTime() - Date.now() > TA_RENEW_MARGIN_MS) {
    return { token: cached.token, sign: cached.sign };
  }

  const certPem = getArcaCertPem();
  const keyPem = getArcaKeyPem();
  if (!certPem || !keyPem) {
    throw new ArcaNetworkError(
      "Falta el certificado de ARCA en el servidor. Avisá al administrador."
    );
  }

  const ta = await loginWsaa(ARCA_ENDPOINTS[environment].wsaa, certPem, keyPem);
  // Persistir ANTES de usar: si el proceso muere, el próximo no re-pide un TA
  // (WSAA rechaza pedir uno nuevo mientras hay uno vigente).
  await setArcaTa({
    environment,
    token: ta.token,
    sign: ta.sign,
    generationTime: ta.generationTime || null,
    expirationTime: ta.expirationTime,
    internalKey,
  });
  return { token: ta.token, sign: ta.sign };
}

function requestFromPayload(p: BeginEmissionPayload): FecaeRequest {
  return {
    ptoVta: p.pto_vta,
    cbteTipo: p.cbte_tipo,
    concepto: p.concepto,
    docTipo: p.doc_tipo,
    docNro: p.doc_nro,
    cbteNro: p.cbte_nro,
    cbteFch: p.cbte_fch,
    impTotal: p.imp_total,
    impNeto: p.imp_neto,
    impIva: p.imp_iva,
    ivaId: p.iva_id,
    monId: p.mon_id,
    monCotiz: p.mon_cotiz,
    condicionIvaReceptorId: p.condicion_iva_receptor_id,
    fchServDesde: p.fch_serv_desde,
    fchServHasta: p.fch_serv_hasta,
    fchVtoPago: p.fch_vto_pago,
  };
}

/**
 * Consulta a ARCA si un comprobante 'processing' existe (FECompConsultar) y
 * reconcilia: si ARCA lo tiene y matchea (importe ±0.01 y documento), recupera el
 * CAE; si no, libera el número. Read-only + finalize idempotente: NO re-emite ni
 * duplica. Mismo criterio que el recovery de la propia factura (ver más abajo).
 */
async function reconcileProcessingInvoice(
  inv: NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>,
  wsfeUrl: string,
  auth: WsfeAuth,
  cuit: string,
  internalKey: string
): Promise<void> {
  if (inv.status !== "processing" || !inv.cbte_nro) return;
  const xml = await callWsfe(
    wsfeUrl,
    "FECompConsultar",
    buildFECompConsultarEnvelope(auth, inv.pto_vta, inv.cbte_tipo, inv.cbte_nro)
  );
  const found = parseFECompConsultarResponse(xml);
  if (found && Math.abs(found.impTotal - inv.imp_total) < 0.01 && found.docNro === inv.doc_nro) {
    const qrUrl = buildQrUrl({
      fecha: isoFromArcaDate(found.cbteFch) ?? found.cbteFch,
      cuit: Number(cuit),
      ptoVta: inv.pto_vta,
      tipoCmp: inv.cbte_tipo,
      nroCmp: found.cbteNro,
      importe: inv.imp_total,
      tipoDocRec: inv.doc_tipo,
      nroDocRec: Number(inv.doc_nro),
      codAut: Number(found.cae),
    });
    await finalizeInvoice({
      invoiceId: inv.id,
      outcome: "authorized",
      cae: found.cae,
      caeVto: isoFromArcaDate(found.caeVto),
      arcaResult: { recovered: true, sweep: true, consulta: found },
      qrUrl,
      internalKey,
    });
  } else {
    await finalizeInvoice({
      invoiceId: inv.id,
      outcome: "pending",
      lastError: "Auto-destrabado: intento anterior sin outcome; ARCA no tiene el comprobante.",
      internalKey,
    });
  }
}

/**
 * Barre las facturas 'processing' estancadas (>2 min sin intento) del ambiente y
 * les libera/recupera el número (auditoría B7): así una factura trabada no bloquea
 * la emisión del resto. Best-effort: cualquier fallo por-factura (incl. la carrera
 * de que otro emitInvoice la finalice primero) se ignora; nunca corta la emisión.
 */
async function sweepStaleProcessing(
  environment: FiscalEnvironment,
  wsfeUrl: string,
  auth: WsfeAuth,
  cuit: string,
  internalKey: string,
  excludeInvoiceId: string
): Promise<void> {
  const staleBeforeIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  let ids: string[];
  try {
    ids = await getStaleProcessingInvoiceIds(environment, excludeInvoiceId, staleBeforeIso);
  } catch {
    return; // sin DB no hay barrido; la emisión sigue igual
  }
  for (const id of ids) {
    try {
      const inv = await getInvoiceById(id);
      if (inv) await reconcileProcessingInvoice(inv, wsfeUrl, auth, cuit, internalKey);
    } catch {
      // carrera con otro emitInvoice / red / etc.: ignorar, es limpieza best-effort
    }
  }
}

export async function emitInvoice(invoiceId: string): Promise<EmitInvoiceOutcome> {
  const internalKey = getArcaInternalKey();
  if (!internalKey) {
    return {
      status: "pending",
      invoiceId,
      userMessage:
        "La facturación no está configurada en el servidor (falta la clave interna). Avisá al administrador.",
    };
  }

  try {
    const invoice = await getInvoiceById(invoiceId);
    if (!invoice) {
      return { status: "pending", invoiceId, userMessage: "Factura no encontrada." };
    }
    if (invoice.status === "authorized") {
      return {
        status: "authorized",
        invoiceId,
        cae: invoice.cae ?? undefined,
        numero: formatCbteNumero(invoice.pto_vta, invoice.cbte_nro ?? 0),
        userMessage: "La factura ya estaba emitida.",
      };
    }

    const environment = invoice.environment;
    const wsfeUrl = ARCA_ENDPOINTS[environment].wsfe;
    const ta = await ensureTa(environment, internalKey);
    // El auth de WSFE lleva el CUIT emisor; se lee de fiscal_settings (el
    // recovery lo necesita ANTES del claim, por eso no alcanza con el que
    // devuelve rpc_begin_invoice_emission).
    const cuit = await getEmitterCuit();
    if (!cuit) {
      return {
        status: "pending",
        invoiceId,
        userMessage: "Falta el CUIT en la configuración fiscal. Avisá al administrador.",
      };
    }
    const auth: WsfeAuth = { token: ta.token, sign: ta.sign, cuit };

    // Auto-destrabado: antes de asignar número, liberar el que retienen facturas
    // 'processing' estancadas de este ambiente (si no, colisionan la numeración).
    await sweepStaleProcessing(environment, wsfeUrl, auth, cuit, internalKey, invoiceId);

    // ── Recovery: intento anterior con outcome desconocido ──
    if (invoice.status === "processing" && invoice.cbte_nro) {
      const xml = await callWsfe(
        wsfeUrl,
        "FECompConsultar",
        buildFECompConsultarEnvelope(auth, invoice.pto_vta, invoice.cbte_tipo, invoice.cbte_nro)
      );
      const found = parseFECompConsultarResponse(xml);
      if (
        found &&
        Math.abs(found.impTotal - invoice.imp_total) < 0.01 &&
        found.docNro === invoice.doc_nro
      ) {
        // ARCA lo autorizó en el intento anterior: recuperar el CAE, no duplicar.
        const qrUrl = buildQrUrl({
          fecha: isoFromArcaDate(found.cbteFch) ?? found.cbteFch,
          cuit: Number(cuit),
          ptoVta: invoice.pto_vta,
          tipoCmp: invoice.cbte_tipo,
          nroCmp: found.cbteNro,
          importe: invoice.imp_total,
          tipoDocRec: invoice.doc_tipo,
          nroDocRec: Number(invoice.doc_nro),
          codAut: Number(found.cae),
        });
        await finalizeInvoice({
          invoiceId,
          outcome: "authorized",
          cae: found.cae,
          caeVto: isoFromArcaDate(found.caeVto),
          arcaResult: { recovered: true, consulta: found },
          qrUrl,
          internalKey,
        });
        return {
          status: "authorized",
          invoiceId,
          cae: found.cae,
          numero: formatCbteNumero(invoice.pto_vta, found.cbteNro),
          userMessage: `Factura recuperada de ARCA: ${formatCbteNumero(invoice.pto_vta, found.cbteNro)}.`,
        };
      }
      // No existe en ARCA: liberar el número y seguir como intento fresco.
      await finalizeInvoice({
        invoiceId,
        outcome: "pending",
        lastError: "Intento anterior sin outcome; ARCA no tiene el comprobante.",
        internalKey,
      });
    }

    // ── Emisión (hasta 2 pasadas: reintento inmediato si el número quedó viejo) ──
    for (let attempt = 0; attempt < 2; attempt++) {
      const lastXml = await callWsfe(
        wsfeUrl,
        "FECompUltimoAutorizado",
        buildFECompUltimoAutorizadoEnvelope(auth, invoice.pto_vta, invoice.cbte_tipo)
      );
      const lastNro = parseFECompUltimoAutorizadoResponse(lastXml);

      const payload = await beginInvoiceEmission(invoiceId, lastNro + 1, internalKey);
      const req = requestFromPayload(payload);

      let caeXml: string;
      try {
        caeXml = await callWsfe(wsfeUrl, "FECAESolicitar", buildFECAESolicitarEnvelope({ ...auth, cuit: payload.cuit }, req));
      } catch (error) {
        if (error instanceof ArcaUnknownOutcomeError) {
          await finalizeInvoice({
            invoiceId,
            outcome: "unknown",
            lastError: error.message,
            internalKey,
          });
          return {
            status: "processing",
            invoiceId,
            userMessage:
              "ARCA no respondió a tiempo. La factura quedó en verificación — reintentá en unos minutos desde Facturación (no se va a duplicar).",
          };
        }
        throw error; // network → catch general la deja pending
      }

      const result = parseFECAESolicitarResponse(caeXml);

      if (result.resultado === "A") {
        const qrUrl = buildQrUrl({
          fecha: isoFromArcaDate(req.cbteFch) ?? req.cbteFch,
          cuit: Number(payload.cuit),
          ptoVta: req.ptoVta,
          tipoCmp: req.cbteTipo,
          nroCmp: req.cbteNro,
          importe: req.impTotal,
          tipoDocRec: req.docTipo,
          nroDocRec: Number(req.docNro),
          codAut: Number(result.cae),
        });
        await finalizeInvoice({
          invoiceId,
          outcome: "authorized",
          cae: result.cae,
          caeVto: isoFromArcaDate(result.caeVto),
          arcaResult: result.raw,
          qrUrl,
          internalKey,
        });
        const numero = formatCbteNumero(req.ptoVta, req.cbteNro);
        const letra = req.cbteTipo === 1 ? "A" : "B";
        return {
          status: "authorized",
          invoiceId,
          cae: result.cae,
          numero,
          userMessage: `Factura ${letra} ${numero} emitida (CAE ${result.cae}).`,
        };
      }

      // Rechazada. ¿Fue por numeración (otro emisor usó el número)? → reintento inmediato.
      const all = [...result.observaciones, ...result.errores];
      const numbering = all.some((o) => WSFE_NUMBERING_CODES.has(o.code));
      const detail = all.map((o) => `${o.code}: ${o.msg}`).join(" · ") || "Rechazo sin detalle";

      if (numbering && attempt === 0) {
        await finalizeInvoice({
          invoiceId,
          outcome: "pending",
          lastError: `Numeración desactualizada, reintentando: ${detail}`,
          internalKey,
        });
        continue;
      }

      await finalizeInvoice({
        invoiceId,
        outcome: "rejected",
        arcaResult: result.raw,
        lastError: detail,
        internalKey,
      });
      return {
        status: "rejected",
        invoiceId,
        userMessage: `ARCA rechazó la factura: ${detail}`,
      };
    }

    // Dos pasadas con número viejo: dejarla pendiente.
    return {
      status: "pending",
      invoiceId,
      userMessage: "No se pudo emitir por conflicto de numeración. Reintentá desde Facturación.",
    };
  } catch (error) {
    // Colisión de numeración (unique_violation): otra factura retiene el número.
    // Traducir a algo accionable en vez del mensaje crudo de Postgres.
    const pgCode = (error as { code?: string } | null)?.code;
    const message =
      pgCode === "23505"
        ? "Hay otra factura en verificación que quedó reteniendo el número. Reintentá esa primero desde Facturación (En verificación) y volvé a intentar esta."
        : error instanceof ArcaNetworkError
          ? "ARCA no está respondiendo. La factura quedó pendiente — reintentá desde Facturación."
          : error instanceof Error
            ? error.message
            : "Error inesperado al emitir la factura.";

    // Mejor esfuerzo: si la invoice quedó en processing por un fallo previo al
    // envío, liberarla a pending para que el reintento no espere el TTL.
    try {
      const inv = await getInvoiceById(invoiceId);
      if (inv?.status === "processing" && error instanceof ArcaNetworkError) {
        await finalizeInvoice({
          invoiceId,
          outcome: "pending",
          lastError: message,
          internalKey,
        });
      }
    } catch {
      // sin red ni DB no hay nada más que hacer; queda para el reintento
    }

    console.error("[arca] emitInvoice fallo:", error);
    return { status: "pending", invoiceId, userMessage: message };
  }
}

/** CUIT del emisor desde la config fiscal (vía import dinámico para evitar ciclos). */
async function getEmitterCuit(): Promise<string | null> {
  const { getFiscalSettings } = await import("@/lib/data");
  const settings = await getFiscalSettings();
  return settings?.cuit ?? null;
}
