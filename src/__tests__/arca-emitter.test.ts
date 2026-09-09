// Red de tests del orquestador de emisión (`src/lib/arca/emitter.ts`): la pieza
// que evita facturas duplicadas o perdidas. Está mockeado todo lo que toca la red
// (`callWsfe`, `loginWsaa`) y la DB (`@/lib/data`), pero los parsers de WSFE son
// los REALES, alimentados con XML como el que devuelve ARCA: si cambia el parseo,
// estos tests lo ven.
//
// Cada escenario afirma QUÉ se llamó y EN QUÉ ORDEN (array `calls`), porque acá el
// orden ES la regla de negocio: persistir el TA antes de usarlo, consultar antes de
// re-emitir, y no pedir número si hay un intento en vuelo.

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dataMod from "@/lib/data";
import { ARCA_ENDPOINTS } from "@/lib/arca/config";
import { ArcaNetworkError, ArcaUnknownOutcomeError, type TaData } from "@/lib/arca/types";
import type { BeginEmissionPayload } from "@/lib/data";
import type { FiscalSettings, InvoiceRecord } from "@/lib/types";

// ─────────────────────────── mocks (hoisted) ───────────────────────────

const H = vi.hoisted(() => ({
  calls: [] as string[],
  INTERNAL_KEY: "clave-interna-de-test-0123456789abcdef",
  callWsfe: vi.fn(),
  loginWsaa: vi.fn(),
}));

// Automock (sin factory) a propósito: el emisor lee el CUIT con
// `await import("@/lib/data")`, y los mocks con factory de vitest tienen un guard
// de recursión que devuelve el módulo REAL cuando dos import() dinámicos del mismo
// módulo se pisan — justo lo que hace el test de concurrencia de abajo. El automock
// no pasa por ese guard. Cada función se configura en el beforeEach.
vi.mock("@/lib/data");

vi.mock("@/lib/arca/wsaa", () => ({ loginWsaa: H.loginWsaa }));

// Sólo `callWsfe` es mock: los build*/parse* reales entran en el test.
vi.mock("@/lib/arca/wsfe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/arca/wsfe")>();
  return { ...actual, callWsfe: H.callWsfe };
});

// Certificado y clave interna: sin depender de variables de entorno.
// Los endpoints quedan los reales (el test verifica contra cuál se pega).
vi.mock("@/lib/arca/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/arca/config")>();
  return {
    ...actual,
    getArcaCertPem: () => "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
    getArcaKeyPem: () => "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    getArcaInternalKey: () => H.INTERNAL_KEY,
  };
});

import { emitInvoice } from "@/lib/arca/emitter";

const db = vi.mocked(dataMod);

// ─────────────────────────── fixtures ───────────────────────────

const INVOICE_ID = "inv-principal";
const CUIT_EMISOR = "30123456789";
const CAE = "76281234567890";

const TA_VIGENTE = {
  token: "TOKEN-VIGENTE==",
  sign: "SIGN-VIGENTE==",
  expiration_time: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
};

/** Vence dentro del margen de 5 min → hay que renovarlo antes de usarlo. */
const TA_POR_VENCER = {
  token: "TOKEN-VIEJO==",
  sign: "SIGN-VIEJO==",
  expiration_time: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
};

const TA_NUEVO: TaData = {
  token: "TOKEN-NUEVO==",
  sign: "SIGN-NUEVO==",
  generationTime: "2026-09-09T09:00:00-03:00",
  expirationTime: "2026-09-09T21:00:00-03:00",
};

const FISCAL_SETTINGS: FiscalSettings = {
  id: 1,
  enabled: true,
  environment: "homologacion",
  cuit: CUIT_EMISOR,
  razon_social: "Hotel El Refugio SRL",
  domicilio_fiscal: "Av. Siempreviva 742",
  iibb: "901-123456-7",
  inicio_actividades: "2015-03-01",
  punto_venta: 3,
  cbte_tipo: 6,
  concepto: 2,
  iva_pct: 21,
};

function invoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: INVOICE_ID,
    reservation_id: "reserva-1",
    kind: "checkout",
    nota_credito_de: null,
    anulada_at: null,
    status: "pending",
    environment: "homologacion",
    pto_vta: 3,
    cbte_tipo: 6,
    concepto: 2,
    cbte_nro: null,
    cbte_fch: null,
    cae: null,
    cae_vto: null,
    doc_tipo: 96,
    doc_nro: "30123456",
    condicion_iva_receptor_id: 5,
    receptor_nombre: "Juan Perez",
    receptor_domicilio: null,
    imp_total: 121000,
    imp_neto: 100000,
    imp_iva: 21000,
    iva_id: 5,
    fch_serv_desde: "2026-09-07",
    fch_serv_hasta: "2026-09-09",
    qr_url: null,
    last_error: null,
    attempt_count: 0,
    detalle_nota: null,
    ...over,
  };
}

/** Lo que devolvería rpc_begin_invoice_emission para esa factura y ese número. */
function payload(invoiceId: string, cbteNro: number): BeginEmissionPayload {
  return {
    invoice_id: invoiceId,
    environment: "homologacion",
    pto_vta: 3,
    cbte_tipo: 6,
    concepto: 2,
    cbte_nro: cbteNro,
    cbte_fch: "20260909",
    doc_tipo: 96,
    doc_nro: "30123456",
    condicion_iva_receptor_id: 5,
    imp_total: 121000,
    imp_neto: 100000,
    imp_iva: 21000,
    iva_id: 5,
    mon_id: "PES",
    mon_cotiz: 1,
    fch_serv_desde: "20260907",
    fch_serv_hasta: "20260909",
    fch_vto_pago: "20260909",
    cbte_asoc_tipo: null,
    cbte_asoc_pto_vta: null,
    cbte_asoc_nro: null,
    cbte_asoc_fch: null,
    cuit: CUIT_EMISOR,
  };
}

// ── XML de respuesta de ARCA (mismo formato que los fixtures de arca.test.ts) ──

const soap = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

const xmlUltimoAutorizado = (nro: number) =>
  soap(
    `<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><CbteNro>${nro}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`
  );

const xmlCaeAprobado = (cbteNro: number, cae: string, caeVto: string) =>
  soap(
    `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` +
      `<FeCabResp><Cuit>${CUIT_EMISOR}</Cuit><PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><CantReg>1</CantReg><Resultado>A</Resultado></FeCabResp>` +
      `<FeDetResp><FECAEDetResponse><Concepto>2</Concepto><DocTipo>96</DocTipo><DocNro>30123456</DocNro>` +
      `<CbteDesde>${cbteNro}</CbteDesde><CbteHasta>${cbteNro}</CbteHasta><CbteFch>20260909</CbteFch>` +
      `<Resultado>A</Resultado><CAE>${cae}</CAE><CAEFchVto>${caeVto}</CAEFchVto></FECAEDetResponse></FeDetResp>` +
      `</FECAESolicitarResult></FECAESolicitarResponse>`
  );

const xmlCaeRechazado = (
  observaciones: Array<{ code: number; msg: string }>,
  errores: Array<{ code: number; msg: string }> = []
) =>
  soap(
    `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` +
      `<FeCabResp><Resultado>R</Resultado><CantReg>1</CantReg></FeCabResp>` +
      `<FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones>` +
      observaciones.map((o) => `<Obs><Code>${o.code}</Code><Msg>${o.msg}</Msg></Obs>`).join("") +
      `</Observaciones></FECAEDetResponse></FeDetResp>` +
      (errores.length > 0
        ? `<Errors>${errores.map((e) => `<Err><Code>${e.code}</Code><Msg>${e.msg}</Msg></Err>`).join("")}</Errors>`
        : "") +
      `</FECAESolicitarResult></FECAESolicitarResponse>`
  );

const xmlConsultaEncontrada = (d: {
  cbteNro: number;
  impTotal: number;
  docNro: string;
  cae: string;
  caeVto: string;
}) =>
  soap(
    `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><ResultGet>` +
      `<CbteDesde>${d.cbteNro}</CbteDesde><CbteHasta>${d.cbteNro}</CbteHasta><ImpTotal>${d.impTotal.toFixed(2)}</ImpTotal>` +
      `<DocNro>${d.docNro}</DocNro><CbteFch>20260909</CbteFch><CodAutorizacion>${d.cae}</CodAutorizacion>` +
      `<FchVto>${d.caeVto}</FchVto><EmisionTipo>CAE</EmisionTipo>` +
      `</ResultGet></FECompConsultarResult></FECompConsultarResponse>`
  );

/** Error 602 = "no existen datos": ARCA no tiene ese comprobante. */
const XML_CONSULTA_NO_EXISTE = soap(
  `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>` +
    `<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>` +
    `</FECompConsultarResult></FECompConsultarResponse>`
);

// ─────────────────────────── estado de cada test ───────────────────────────

type WsfeReply = string | Error;
type FinalizeInput = Parameters<typeof dataMod.finalizeInvoice>[0];

let facturas: Map<string, InvoiceRecord | Error>;
let taEnCache: { token: string; sign: string; expiration_time: string } | null;
let loginRespuesta: TaData | Error;
let loginDemoraMs: number;
let staleIds: string[];
let cuitEmisor: string | null;
let beginError: unknown;
let wsfeCola: Record<string, WsfeReply[]>;

/** Toma la respuesta preparada; con varias, las va consumiendo en orden. */
function siguienteWsfe(action: string): WsfeReply {
  const cola = wsfeCola[action];
  if (!cola || cola.length === 0) {
    throw new Error(`El test no preparó respuesta de ${action}`);
  }
  return cola.length > 1 ? (cola.shift() as WsfeReply) : cola[0];
}

function finalizeCalls(): FinalizeInput[] {
  return db.finalizeInvoice.mock.calls.map((c) => c[0]);
}

function qrPayload(url: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(url.split("?p=")[1], "base64").toString("utf-8"));
}

beforeEach(() => {
  vi.clearAllMocks();
  H.calls.length = 0;
  // El emisor loguea los fallos con console.error; los escenarios d/f/g los esperan.
  vi.spyOn(console, "error").mockImplementation(() => {});

  facturas = new Map();
  taEnCache = TA_VIGENTE;
  loginRespuesta = TA_NUEVO;
  loginDemoraMs = 0;
  staleIds = [];
  cuitEmisor = CUIT_EMISOR;
  beginError = null;
  wsfeCola = {};

  db.getInvoiceById.mockImplementation(async (id) => {
    H.calls.push(`getInvoiceById(${id})`);
    const v = facturas.get(id);
    if (v instanceof Error) throw v;
    return v ?? null;
  });

  db.getArcaTa.mockImplementation(async (environment) => {
    H.calls.push(`getArcaTa(${environment})`);
    return taEnCache;
  });

  db.setArcaTa.mockImplementation(async () => {
    H.calls.push("setArcaTa");
  });

  H.loginWsaa.mockImplementation(async () => {
    H.calls.push("loginWsaa");
    if (loginDemoraMs > 0) await new Promise((r) => setTimeout(r, loginDemoraMs));
    if (loginRespuesta instanceof Error) throw loginRespuesta;
    return loginRespuesta;
  });

  db.getFiscalSettings.mockImplementation(async () => {
    H.calls.push("getFiscalSettings");
    return { ...FISCAL_SETTINGS, cuit: cuitEmisor };
  });

  db.getStaleProcessingInvoiceIds.mockImplementation(async (_env, exclude) => {
    H.calls.push(`getStaleProcessingInvoiceIds(excluye=${exclude})`);
    return staleIds;
  });

  db.beginInvoiceEmission.mockImplementation(async (invoiceId, cbteNro) => {
    H.calls.push(`beginInvoiceEmission(${invoiceId}, ${cbteNro})`);
    if (beginError) throw beginError;
    return payload(invoiceId, cbteNro);
  });

  db.finalizeInvoice.mockImplementation(async (input) => {
    H.calls.push(`finalizeInvoice(${input.invoiceId}, ${input.outcome})`);
  });

  H.callWsfe.mockImplementation(async (_endpoint: string, action: string) => {
    H.calls.push(`callWsfe:${action}`);
    const r = siguienteWsfe(action);
    if (r instanceof Error) throw r;
    return r;
  });
});

// ═══════════════════════════ a. camino feliz ═══════════════════════════

describe("emitInvoice — camino feliz", () => {
  it("pide el último número, reserva N+1 y finaliza autorizada con CAE", async () => {
    facturas.set(INVOICE_ID, invoice());
    wsfeCola = {
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [xmlCaeAprobado(1235, CAE, "20260919")],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).toEqual([
      "getInvoiceById(inv-principal)",
      "getArcaTa(homologacion)",
      "getFiscalSettings",
      "getStaleProcessingInvoiceIds(excluye=inv-principal)",
      "callWsfe:FECompUltimoAutorizado",
      "beginInvoiceEmission(inv-principal, 1235)",
      "callWsfe:FECAESolicitar",
      "finalizeInvoice(inv-principal, authorized)",
    ]);

    // TA vigente en cache: no se molesta a WSAA.
    expect(H.loginWsaa).not.toHaveBeenCalled();
    expect(db.setArcaTa).not.toHaveBeenCalled();

    // Se pega al WSFE del ambiente de la factura, con el token cacheado.
    expect(H.callWsfe.mock.calls[0][0]).toBe(ARCA_ENDPOINTS.homologacion.wsfe);
    expect(H.callWsfe.mock.calls[0][2]).toContain(`<Token>${TA_VIGENTE.token}</Token>`);
    expect(H.callWsfe.mock.calls[1][2]).toContain(
      "<CbteDesde>1235</CbteDesde><CbteHasta>1235</CbteHasta>"
    );

    const [fin] = finalizeCalls();
    expect(fin).toMatchObject({
      invoiceId: INVOICE_ID,
      outcome: "authorized",
      cae: CAE,
      caeVto: "2026-09-19", // yyyymmdd de ARCA → date de Postgres
      internalKey: H.INTERNAL_KEY,
    });
    expect(qrPayload(String(fin.qrUrl))).toMatchObject({
      nroCmp: 1235,
      codAut: Number(CAE),
      importe: 121000,
      cuit: Number(CUIT_EMISOR),
      tipoCmp: 6,
    });

    expect(outcome).toEqual({
      status: "authorized",
      invoiceId: INVOICE_ID,
      cae: CAE,
      numero: "00003-00001235",
      userMessage: "Factura B 00003-00001235 emitida (CAE 76281234567890).",
    });
  });

  it("una factura ya autorizada no vuelve a ARCA", async () => {
    facturas.set(INVOICE_ID, invoice({ status: "authorized", cae: CAE, cbte_nro: 1235 }));

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.callWsfe).not.toHaveBeenCalled();
    expect(db.beginInvoiceEmission).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: "authorized",
      invoiceId: INVOICE_ID,
      cae: CAE,
      numero: "00003-00001235",
      userMessage: "Factura ya emitida.",
    });
  });
});

// ═══════════════════════ b/c. recovery de 'processing' ═══════════════════════

describe("emitInvoice — recovery de un intento sin outcome", () => {
  it("b. ARCA tiene el comprobante: recupera el CAE y NO vuelve a pedir uno", async () => {
    facturas.set(INVOICE_ID, invoice({ status: "processing", cbte_nro: 1235 }));
    wsfeCola = {
      FECompConsultar: [
        xmlConsultaEncontrada({
          cbteNro: 1235,
          impTotal: 121000,
          docNro: "30123456",
          cae: CAE,
          caeVto: "20260919",
        }),
      ],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).toEqual([
      "getInvoiceById(inv-principal)",
      "getArcaTa(homologacion)",
      "getFiscalSettings",
      "getStaleProcessingInvoiceIds(excluye=inv-principal)",
      "callWsfe:FECompConsultar",
      "finalizeInvoice(inv-principal, authorized)",
    ]);

    // Lo que evita el duplicado: ni número nuevo ni FECAESolicitar.
    expect(db.beginInvoiceEmission).not.toHaveBeenCalled();
    expect(H.calls).not.toContain("callWsfe:FECAESolicitar");

    expect(H.callWsfe.mock.calls[0][2]).toContain(
      "<CbteTipo>6</CbteTipo><CbteNro>1235</CbteNro><PtoVta>3</PtoVta>"
    );

    const [fin] = finalizeCalls();
    expect(fin).toMatchObject({ outcome: "authorized", cae: CAE, caeVto: "2026-09-19" });
    expect(fin.arcaResult).toMatchObject({ recovered: true });
    expect(fin.arcaResult).not.toHaveProperty("sweep");

    expect(outcome).toEqual({
      status: "authorized",
      invoiceId: INVOICE_ID,
      cae: CAE,
      numero: "00003-00001235",
      userMessage: "Factura recuperada de ARCA: 00003-00001235.",
    });
  });

  it("c. ARCA no lo tiene: libera el número y sigue como intento fresco", async () => {
    facturas.set(INVOICE_ID, invoice({ status: "processing", cbte_nro: 1235 }));
    wsfeCola = {
      FECompConsultar: [XML_CONSULTA_NO_EXISTE],
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [xmlCaeAprobado(1235, CAE, "20260919")],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).toEqual([
      "getInvoiceById(inv-principal)",
      "getArcaTa(homologacion)",
      "getFiscalSettings",
      "getStaleProcessingInvoiceIds(excluye=inv-principal)",
      "callWsfe:FECompConsultar",
      "finalizeInvoice(inv-principal, pending)",
      "callWsfe:FECompUltimoAutorizado",
      "beginInvoiceEmission(inv-principal, 1235)",
      "callWsfe:FECAESolicitar",
      "finalizeInvoice(inv-principal, authorized)",
    ]);

    const [liberada, emitida] = finalizeCalls();
    expect(liberada).toMatchObject({
      outcome: "pending",
      lastError: "Intento anterior sin outcome; ARCA no tiene el comprobante.",
    });
    expect(emitida).toMatchObject({ outcome: "authorized", cae: CAE });
    expect(outcome.status).toBe("authorized");
  });
});

// ═══════════════════════ d. outcome desconocido ═══════════════════════

describe("emitInvoice — outcome desconocido", () => {
  it("d. timeout post-envío: queda 'processing' (no 'pending') y no se reintenta acá", async () => {
    facturas.set(INVOICE_ID, invoice());
    wsfeCola = {
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [new ArcaUnknownOutcomeError("ARCA no respondió a tiempo.")],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).toEqual([
      "getInvoiceById(inv-principal)",
      "getArcaTa(homologacion)",
      "getFiscalSettings",
      "getStaleProcessingInvoiceIds(excluye=inv-principal)",
      "callWsfe:FECompUltimoAutorizado",
      "beginInvoiceEmission(inv-principal, 1235)",
      "callWsfe:FECAESolicitar",
      "finalizeInvoice(inv-principal, unknown)",
    ]);

    // Un solo envío: reintentar en la misma llamada duplicaría el comprobante.
    expect(H.callWsfe.mock.calls.filter((c) => c[1] === "FECAESolicitar")).toHaveLength(1);
    expect(db.beginInvoiceEmission).toHaveBeenCalledTimes(1);

    const finales = finalizeCalls();
    expect(finales).toHaveLength(1);
    expect(finales[0]).toMatchObject({
      outcome: "unknown",
      lastError: "ARCA no respondió a tiempo.",
    });
    expect(finales.some((f) => f.outcome === "pending")).toBe(false);

    expect(outcome.status).toBe("processing");
    expect(outcome.userMessage).toContain("verificación");
    expect(outcome.userMessage).toContain("no se va a duplicar");
  });
});

// ═══════════════════════ e. rechazo con observaciones ═══════════════════════

describe("emitInvoice — rechazo de ARCA", () => {
  it("e. finaliza 'rejected' con el texto de ARCA en last_error", async () => {
    facturas.set(INVOICE_ID, invoice());
    wsfeCola = {
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [
        xmlCaeRechazado(
          [{ code: 10242, msg: "El campo Condicion IVA receptor es obligatorio" }],
          [{ code: 10013, msg: "El campo DocNro no es valido" }]
        ),
      ],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    const detalle =
      "10242: El campo Condicion IVA receptor es obligatorio · 10013: El campo DocNro no es valido";

    const [fin] = finalizeCalls();
    expect(fin).toMatchObject({ invoiceId: INVOICE_ID, outcome: "rejected", lastError: detalle });
    expect(fin.arcaResult).toBeDefined();
    expect(fin.cae).toBeUndefined();

    // Rechazo que NO es de numeración: no hay segunda pasada.
    expect(db.beginInvoiceEmission).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      status: "rejected",
      invoiceId: INVOICE_ID,
      userMessage: `ARCA rechazó la factura: ${detalle}`,
    });
  });

  it("rechazo por numeración (10016): reintenta una vez con número nuevo", async () => {
    facturas.set(INVOICE_ID, invoice());
    wsfeCola = {
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234), xmlUltimoAutorizado(1240)],
      FECAESolicitar: [
        xmlCaeRechazado([
          {
            code: 10016,
            msg: "El numero o fecha del comprobante no se corresponde con el proximo a autorizar",
          },
        ]),
        xmlCaeAprobado(1241, CAE, "20260919"),
      ],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls.filter((c) => c.startsWith("beginInvoiceEmission"))).toEqual([
      "beginInvoiceEmission(inv-principal, 1235)",
      "beginInvoiceEmission(inv-principal, 1241)",
    ]);
    const [primera, segunda] = finalizeCalls();
    expect(primera).toMatchObject({ outcome: "pending" });
    expect(primera.lastError).toContain("Numeración desactualizada");
    expect(segunda).toMatchObject({ outcome: "authorized", cae: CAE });
    expect(outcome.numero).toBe("00003-00001241");
  });
});

// ═══════════════════════ f/g. la DB frena la emisión ═══════════════════════

describe("emitInvoice — el claim de número falla", () => {
  it("f. colisión de numeración (23505): mensaje accionable, sin pedir CAE", async () => {
    facturas.set(INVOICE_ID, invoice());
    beginError = Object.assign(
      new Error('duplicate key value violates unique constraint "invoices_env_pv_tipo_nro_uq"'),
      { code: "23505" }
    );
    wsfeCola = { FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)] };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).not.toContain("callWsfe:FECAESolicitar");
    expect(db.finalizeInvoice).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: "pending",
      invoiceId: INVOICE_ID,
      userMessage:
        "Hay otra factura en verificación que quedó reteniendo el número. Reintentá esa primero desde Facturación (En verificación) y volvé a intentar esta.",
    });
  });

  it("g. single-flight (P0021): otro intento en vuelo, no se pide CAE", async () => {
    facturas.set(INVOICE_ID, invoice());
    beginError = Object.assign(
      new Error("Hay otra factura emitiendose. Reintenta en unos segundos."),
      { code: "P0021" }
    );
    wsfeCola = { FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)] };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).not.toContain("callWsfe:FECAESolicitar");
    expect(db.finalizeInvoice).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: "pending",
      invoiceId: INVOICE_ID,
      userMessage: "Hay otra factura emitiendose. Reintenta en unos segundos.",
    });
  });
});

// ═══════════════════════ h. TA por vencer ═══════════════════════

describe("emitInvoice — ticket de acceso", () => {
  it("h. TA que vence en 2 min: login y persistencia ANTES del primer callWsfe", async () => {
    taEnCache = TA_POR_VENCER;
    facturas.set(INVOICE_ID, invoice());
    wsfeCola = {
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [xmlCaeAprobado(1235, CAE, "20260919")],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).toEqual([
      "getInvoiceById(inv-principal)",
      "getArcaTa(homologacion)",
      "loginWsaa",
      "setArcaTa",
      "getFiscalSettings",
      "getStaleProcessingInvoiceIds(excluye=inv-principal)",
      "callWsfe:FECompUltimoAutorizado",
      "beginInvoiceEmission(inv-principal, 1235)",
      "callWsfe:FECAESolicitar",
      "finalizeInvoice(inv-principal, authorized)",
    ]);

    // La invariante: el TA se guarda antes de usarse (si no, ARCA no deja pedir otro).
    expect(H.calls.indexOf("setArcaTa")).toBeLessThan(
      H.calls.findIndex((c) => c.startsWith("callWsfe"))
    );

    expect(H.loginWsaa).toHaveBeenCalledWith(
      ARCA_ENDPOINTS.homologacion.wsaa,
      expect.stringContaining("BEGIN CERTIFICATE"),
      expect.stringContaining("BEGIN PRIVATE KEY")
    );
    expect(db.setArcaTa).toHaveBeenCalledWith({
      environment: "homologacion",
      token: TA_NUEVO.token,
      sign: TA_NUEVO.sign,
      generationTime: TA_NUEVO.generationTime,
      expirationTime: TA_NUEVO.expirationTime,
      internalKey: H.INTERNAL_KEY,
    });

    // Y se usa el nuevo, no el que estaba por vencer.
    expect(H.callWsfe.mock.calls[0][2]).toContain(`<Token>${TA_NUEVO.token}</Token>`);
    expect(H.callWsfe.mock.calls[0][2]).not.toContain(TA_POR_VENCER.token);
    expect(outcome.status).toBe("authorized");
  });
});

// ═══════════════════════ i. barrido de 'processing' viejas ═══════════════════════

describe("emitInvoice — barrido de facturas trabadas", () => {
  it("i. reconcilia la que puede, ignora la que falla y emite igual", async () => {
    staleIds = ["inv-vieja-ok", "inv-vieja-rota"];
    facturas.set(INVOICE_ID, invoice());
    facturas.set(
      "inv-vieja-ok",
      invoice({
        id: "inv-vieja-ok",
        status: "processing",
        cbte_nro: 1200,
        imp_total: 50000,
        doc_nro: "12345678",
      })
    );
    facturas.set("inv-vieja-rota", new Error("la finalizó otro emitInvoice"));
    wsfeCola = {
      FECompConsultar: [
        xmlConsultaEncontrada({
          cbteNro: 1200,
          impTotal: 50000,
          docNro: "12345678",
          cae: "76280000000001",
          caeVto: "20260915",
        }),
      ],
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [xmlCaeAprobado(1235, CAE, "20260919")],
    };

    const outcome = await emitInvoice(INVOICE_ID);

    expect(H.calls).toEqual([
      "getInvoiceById(inv-principal)",
      "getArcaTa(homologacion)",
      "getFiscalSettings",
      "getStaleProcessingInvoiceIds(excluye=inv-principal)",
      "getInvoiceById(inv-vieja-ok)",
      "callWsfe:FECompConsultar",
      "finalizeInvoice(inv-vieja-ok, authorized)",
      "getInvoiceById(inv-vieja-rota)",
      "callWsfe:FECompUltimoAutorizado",
      "beginInvoiceEmission(inv-principal, 1235)",
      "callWsfe:FECAESolicitar",
      "finalizeInvoice(inv-principal, authorized)",
    ]);

    const [barrida, principal] = finalizeCalls();
    expect(barrida).toMatchObject({
      invoiceId: "inv-vieja-ok",
      outcome: "authorized",
      cae: "76280000000001",
    });
    expect(barrida.arcaResult).toMatchObject({ recovered: true, sweep: true });
    expect(principal).toMatchObject({ invoiceId: INVOICE_ID, outcome: "authorized", cae: CAE });

    // El corte de "estancada" son 2 minutos sin intento.
    const [env, exclude, staleBefore] = db.getStaleProcessingInvoiceIds.mock.calls[0];
    expect(env).toBe("homologacion");
    expect(exclude).toBe(INVOICE_ID);
    const antiguedadMs = Date.now() - new Date(staleBefore).getTime();
    expect(antiguedadMs).toBeGreaterThanOrEqual(2 * 60 * 1000);
    expect(antiguedadMs).toBeLessThan(2 * 60 * 1000 + 10_000);

    expect(outcome.status).toBe("authorized");
  });
});

// ═══════════════════ 2. dedupe del login de WSAA (por ambiente) ═══════════════════

describe("ensureTa — un solo login de WSAA por ambiente", () => {
  it("dos emisiones concurrentes con el TA vencido comparten un único loginWsaa", async () => {
    // Sin dedupe, ARCA rechaza el segundo login con "El CEE ya posee un TA valido"
    // y esa factura queda pendiente hasta que venza el ticket bueno (hasta 12 h).
    taEnCache = TA_POR_VENCER;
    loginDemoraMs = 20; // el segundo emitInvoice entra mientras el login está en vuelo
    facturas.set("inv-a", invoice({ id: "inv-a" }));
    facturas.set("inv-b", invoice({ id: "inv-b" }));
    wsfeCola = {
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [xmlCaeAprobado(1235, CAE, "20260919")],
    };

    const [a, b] = await Promise.all([emitInvoice("inv-a"), emitInvoice("inv-b")]);

    expect(H.loginWsaa).toHaveBeenCalledTimes(1);
    expect(db.setArcaTa).toHaveBeenCalledTimes(1);
    expect(db.getArcaTa).toHaveBeenCalledTimes(2); // las dos leen la cache
    expect(a.status).toBe("authorized");
    expect(b.status).toBe("authorized");
    // Las dos emitieron con el mismo TA nuevo.
    for (const call of H.callWsfe.mock.calls) {
      expect(call[2]).toContain(`<Token>${TA_NUEVO.token}</Token>`);
    }
  });

  it("un login fallido no queda cacheado: el intento siguiente vuelve a pedir el TA", async () => {
    taEnCache = TA_POR_VENCER;
    loginRespuesta = new ArcaNetworkError("No se pudo conectar con WSAA (ARCA).");
    facturas.set(INVOICE_ID, invoice());

    const primero = await emitInvoice(INVOICE_ID);
    expect(primero.status).toBe("pending");
    expect(primero.userMessage).toContain("ARCA no está respondiendo");

    loginRespuesta = TA_NUEVO;
    wsfeCola = {
      FECompUltimoAutorizado: [xmlUltimoAutorizado(1234)],
      FECAESolicitar: [xmlCaeAprobado(1235, CAE, "20260919")],
    };
    const segundo = await emitInvoice(INVOICE_ID);

    expect(H.loginWsaa).toHaveBeenCalledTimes(2);
    expect(segundo.status).toBe("authorized");
  });
});
