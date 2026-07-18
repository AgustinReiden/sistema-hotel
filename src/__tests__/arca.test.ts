import { describe, expect, it } from "vitest";

import {
  arcaDateFromIso,
  arcaDateFromDateKey,
  computeAmounts,
  formatArcaDate,
  formatCbteNumero,
  formatCuit,
  isValidCuit,
  parseDniForArca,
} from "@/lib/arca/amounts";
import { buildQrUrl } from "@/lib/arca/qr";
import { buildTra, buildLoginCmsEnvelope, parseLoginCmsResponse } from "@/lib/arca/wsaa";
import {
  buildFECAESolicitarEnvelope,
  buildFECompConsultarEnvelope,
  buildFECompUltimoAutorizadoEnvelope,
  parseFECAESolicitarResponse,
  parseFECompConsultarResponse,
  parseFECompUltimoAutorizadoResponse,
  parseFEDummyResponse,
} from "@/lib/arca/wsfe";
import { ArcaNetworkError, type FecaeRequest, type WsfeAuth } from "@/lib/arca/types";

const TZ = "America/Argentina/Tucuman";

const AUTH: WsfeAuth = { token: "TOKEN==", sign: "SIGN==", cuit: "30123456789" };

const REQ: FecaeRequest = {
  ptoVta: 3,
  cbteTipo: 6,
  concepto: 2,
  docTipo: 96,
  docNro: "30123456",
  cbteNro: 1235,
  cbteFch: "20260716",
  impTotal: 121000,
  impNeto: 100000,
  impIva: 21000,
  ivaId: 5,
  monId: "PES",
  monCotiz: 1,
  condicionIvaReceptorId: 5,
  fchServDesde: "20260714",
  fchServHasta: "20260716",
  fchVtoPago: "20260716",
};

// ─────────────────────────── amounts ───────────────────────────

describe("computeAmounts (IVA incluido)", () => {
  it("121 → neto 100, iva 21", () => {
    expect(computeAmounts(121, 21)).toEqual({ neto: 100, iva: 21 });
  });

  it("100 → neto 82.64, iva 17.36 (IVA absorbe el redondeo)", () => {
    expect(computeAmounts(100, 21)).toEqual({ neto: 82.64, iva: 17.36 });
  });

  it("propiedad: neto + iva == total para una tabla de casos", () => {
    for (const total of [1, 99.99, 1234.56, 50000, 123456.78, 0.01]) {
      const { neto, iva } = computeAmounts(total, 21);
      expect(Math.round((neto + iva) * 100)).toBe(Math.round(total * 100));
    }
  });
});

describe("fechas ARCA", () => {
  it("convierte ISO a yyyymmdd en zona del hotel (cruza medianoche UTC)", () => {
    // 01:30 UTC del 17/7 = 22:30 del 16/7 en Tucumán (UTC-3)
    expect(arcaDateFromIso("2026-07-17T01:30:00Z", TZ)).toBe("20260716");
    expect(arcaDateFromIso("2026-07-16T14:00:00-03:00", TZ)).toBe("20260716");
  });

  it("dateKey → yyyymmdd y formateo para mostrar", () => {
    expect(arcaDateFromDateKey("2026-07-16")).toBe("20260716");
    expect(formatArcaDate("20260716")).toBe("16/07/2026");
    expect(formatArcaDate(null)).toBe("—");
  });
});

describe("parseDniForArca", () => {
  it("acepta DNI con puntos y espacios", () => {
    expect(parseDniForArca("30.123.456")).toEqual({ docTipo: 96, docNro: "30123456" });
    expect(parseDniForArca(" 1234567 ")).toEqual({ docTipo: 96, docNro: "1234567" });
  });

  it("rechaza CUIT (11 dígitos) con mensaje de empresa", () => {
    const r = parseDniForArca("30-71234567-8");
    expect("error" in r && /CUIT/.test(r.error)).toBe(true);
  });

  it("rechaza largos inválidos y null", () => {
    expect("error" in parseDniForArca("12345")).toBe(true);
    expect("error" in parseDniForArca("123456789")).toBe(true);
    expect("error" in parseDniForArca(null)).toBe(true);
  });
});

describe("formatos", () => {
  it("formatCbteNumero", () => {
    expect(formatCbteNumero(3, 1234)).toBe("00003-00001234");
  });
  it("formatCuit", () => {
    expect(formatCuit("30123456789")).toBe("30-12345678-9");
  });
  it("isValidCuit: verifica dígito verificador", () => {
    expect(isValidCuit("20329642330")).toBe(true); // CUIT válido conocido
    expect(isValidCuit("20329642331")).toBe(false);
    expect(isValidCuit("123")).toBe(false);
  });
});

// ─────────────────────────── QR RG 4892 ───────────────────────────

describe("buildQrUrl", () => {
  it("genera la URL oficial con el JSON exacto en base64", () => {
    const url = buildQrUrl({
      fecha: "2026-07-16",
      cuit: 30123456789,
      ptoVta: 3,
      tipoCmp: 6,
      nroCmp: 1235,
      importe: 121000,
      tipoDocRec: 96,
      nroDocRec: 30123456,
      codAut: 76123456789012,
    });
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
    const payload = JSON.parse(
      Buffer.from(url.split("?p=")[1], "base64").toString("utf-8")
    );
    expect(payload).toEqual({
      ver: 1,
      fecha: "2026-07-16",
      cuit: 30123456789,
      ptoVta: 3,
      tipoCmp: 6,
      nroCmp: 1235,
      importe: 121000,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 96,
      nroDocRec: 30123456,
      tipoCodAut: "E",
      codAut: 76123456789012,
    });
  });
});

// ─────────────────────────── WSAA ───────────────────────────

describe("buildTra", () => {
  it("arma el TRA con ventana de tiempos correcta", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    const tra = buildTra("wsfe", now);
    expect(tra).toContain("<service>wsfe</service>");
    expect(tra).toContain("<generationTime>2026-07-16T11:50:00.000Z</generationTime>");
    expect(tra).toContain("<expirationTime>2026-07-17T00:00:00.000Z</expirationTime>");
    expect(tra).toContain(`<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`);
  });
});

describe("parseLoginCmsResponse", () => {
  const okXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">
<loginCmsReturn>&lt;?xml version="1.0" encoding="UTF-8"?&gt;
&lt;loginTicketResponse version="1.0"&gt;
&lt;header&gt;&lt;generationTime&gt;2026-07-16T09:00:00-03:00&lt;/generationTime&gt;&lt;expirationTime&gt;2026-07-16T21:00:00-03:00&lt;/expirationTime&gt;&lt;/header&gt;
&lt;credentials&gt;&lt;token&gt;TOK123==&lt;/token&gt;&lt;sign&gt;SIG456==&lt;/sign&gt;&lt;/credentials&gt;
&lt;/loginTicketResponse&gt;</loginCmsReturn>
</loginCmsResponse></soapenv:Body></soapenv:Envelope>`;

  it("hace el doble parse del XML escapado y extrae token/sign", () => {
    const ta = parseLoginCmsResponse(okXml);
    expect(ta.token).toBe("TOK123==");
    expect(ta.sign).toBe("SIG456==");
    expect(ta.expirationTime).toBe("2026-07-16T21:00:00-03:00");
  });

  const faultXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><soapenv:Fault>
<faultcode>ns1:coe.alreadyAuthenticated</faultcode>
<faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring>
</soapenv:Fault></soapenv:Body></soapenv:Envelope>`;

  it("traduce el fault 'ya posee un TA valido' a error retryable claro", () => {
    expect(() => parseLoginCmsResponse(faultXml)).toThrow(ArcaNetworkError);
    expect(() => parseLoginCmsResponse(faultXml)).toThrow(/ticket de acceso vigente/i);
  });
});

describe("buildLoginCmsEnvelope", () => {
  it("incluye el CMS en in0", () => {
    expect(buildLoginCmsEnvelope("CMSBASE64==")).toContain("<wsaa:in0>CMSBASE64==</wsaa:in0>");
  });
});

// ─────────────────────────── WSFE ───────────────────────────

describe("buildFECAESolicitarEnvelope", () => {
  const xml = buildFECAESolicitarEnvelope(AUTH, REQ);

  it("incluye CondicionIVAReceptorId (RG 5616) y la alícuota 21%", () => {
    expect(xml).toContain("<CondicionIVAReceptorId>5</CondicionIVAReceptorId>");
    expect(xml).toContain("<Iva><AlicIva><Id>5</Id><BaseImp>100000.00</BaseImp><Importe>21000.00</Importe></AlicIva></Iva>");
  });

  it("incluye fechas de servicio y vencimiento (concepto 2)", () => {
    expect(xml).toContain("<Concepto>2</Concepto>");
    expect(xml).toContain("<FchServDesde>20260714</FchServDesde>");
    expect(xml).toContain("<FchServHasta>20260716</FchServHasta>");
    expect(xml).toContain("<FchVtoPago>20260716</FchVtoPago>");
  });

  it("CbteDesde == CbteHasta (CantReg=1) y auth completo", () => {
    expect(xml).toContain("<CantReg>1</CantReg>");
    expect(xml).toContain("<CbteDesde>1235</CbteDesde><CbteHasta>1235</CbteHasta>");
    expect(xml).toContain("<Cuit>30123456789</Cuit>");
  });
});

// ── Factura A (Responsable Inscripto con CUIT) ──
const REQ_A: FecaeRequest = {
  ...REQ,
  cbteTipo: 1, // Factura A
  docTipo: 80, // CUIT
  docNro: "30707054537",
  condicionIvaReceptorId: 1, // Responsable Inscripto
};

describe("buildFECAESolicitarEnvelope — Factura A", () => {
  const xmlA = buildFECAESolicitarEnvelope(AUTH, REQ_A);

  it("emite CbteTipo=1, DocTipo=80 y CUIT del receptor", () => {
    expect(xmlA).toContain("<CbteTipo>1</CbteTipo>");
    expect(xmlA).toContain("<DocTipo>80</DocTipo>");
    expect(xmlA).toContain("<DocNro>30707054537</DocNro>");
  });

  it("CondicionIVAReceptorId=1 (RI) y misma alícuota 21% discriminada", () => {
    expect(xmlA).toContain("<CondicionIVAReceptorId>1</CondicionIVAReceptorId>");
    expect(xmlA).toContain("<Iva><AlicIva><Id>5</Id><BaseImp>100000.00</BaseImp><Importe>21000.00</Importe></AlicIva></Iva>");
  });
});

describe("buildQrUrl — Factura A", () => {
  it("refleja tipoCmp=1 y tipoDocRec=80", () => {
    const url = buildQrUrl({
      fecha: "2026-07-16",
      cuit: 30123456789,
      ptoVta: 3,
      tipoCmp: 1,
      nroCmp: 1235,
      importe: 121000,
      tipoDocRec: 80,
      nroDocRec: 30707054537,
      codAut: 76281234567890,
    });
    const json = JSON.parse(
      Buffer.from(url.split("p=")[1], "base64").toString("utf8")
    );
    expect(json.tipoCmp).toBe(1);
    expect(json.tipoDocRec).toBe(80);
    expect(json.nroDocRec).toBe(30707054537);
  });
});

const fecaeAprobada = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
<FECAESolicitarResult>
<FeCabResp><Cuit>30123456789</Cuit><PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20260716103000</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>
<FeDetResp><FECAEDetResponse><Concepto>2</Concepto><DocTipo>96</DocTipo><DocNro>30123456</DocNro><CbteDesde>1235</CbteDesde><CbteHasta>1235</CbteHasta><CbteFch>20260716</CbteFch><Resultado>A</Resultado><CAE>76281234567890</CAE><CAEFchVto>20260726</CAEFchVto></FECAEDetResponse></FeDetResp>
</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;

const fecaeRechazada10242 = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
<FECAESolicitarResult>
<FeCabResp><Resultado>R</Resultado><CantReg>1</CantReg></FeCabResp>
<FeDetResp><FECAEDetResponse><CbteDesde>1235</CbteDesde><CbteHasta>1235</CbteHasta><Resultado>R</Resultado>
<Observaciones><Obs><Code>10242</Code><Msg>El campo Condicion IVA receptor es obligatorio</Msg></Obs></Observaciones>
</FECAEDetResponse></FeDetResp>
</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;

const fecaeRechazadaNumeracion = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
<FECAESolicitarResult>
<FeCabResp><Resultado>R</Resultado></FeCabResp>
<FeDetResp><FECAEDetResponse><Resultado>R</Resultado>
<Observaciones><Obs><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar</Msg></Obs></Observaciones>
</FECAEDetResponse></FeDetResp>
<Errors><Err><Code>10016</Code><Msg>Detalle adicional</Msg></Err></Errors>
</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;

describe("parseFECAESolicitarResponse", () => {
  it("aprobada: extrae CAE y vencimiento", () => {
    const r = parseFECAESolicitarResponse(fecaeAprobada);
    expect(r.resultado).toBe("A");
    if (r.resultado === "A") {
      expect(r.cae).toBe("76281234567890");
      expect(r.caeVto).toBe("20260726");
    }
  });

  it("rechazada 10242: expone la observación", () => {
    const r = parseFECAESolicitarResponse(fecaeRechazada10242);
    expect(r.resultado).toBe("R");
    if (r.resultado === "R") {
      expect(r.observaciones).toEqual([
        { code: 10242, msg: "El campo Condicion IVA receptor es obligatorio" },
      ]);
    }
  });

  it("rechazada por numeración: observación 10016 + errores de cabecera", () => {
    const r = parseFECAESolicitarResponse(fecaeRechazadaNumeracion);
    expect(r.resultado).toBe("R");
    if (r.resultado === "R") {
      expect(r.observaciones[0].code).toBe(10016);
      expect(r.errores[0].code).toBe(10016);
    }
  });
});

describe("FECompUltimoAutorizado", () => {
  it("build incluye PV y tipo", () => {
    const xml = buildFECompUltimoAutorizadoEnvelope(AUTH, 3, 6);
    expect(xml).toContain("<PtoVta>3</PtoVta><CbteTipo>6</CbteTipo>");
  });

  it("parse devuelve el número", () => {
    const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>
<PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><CbteNro>1234</CbteNro>
</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`;
    expect(parseFECompUltimoAutorizadoResponse(xml)).toBe(1234);
  });
});

describe("FECompConsultar", () => {
  it("build arma el FeCompConsReq", () => {
    const xml = buildFECompConsultarEnvelope(AUTH, 3, 6, 1235);
    expect(xml).toContain("<CbteTipo>6</CbteTipo><CbteNro>1235</CbteNro><PtoVta>3</PtoVta>");
  });

  it("existente: devuelve los datos para recuperar el CAE", () => {
    const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><ResultGet>
<CbteDesde>1235</CbteDesde><CbteHasta>1235</CbteHasta><ImpTotal>121000.00</ImpTotal><DocNro>30123456</DocNro>
<CbteFch>20260716</CbteFch><CodAutorizacion>76281234567890</CodAutorizacion><FchVto>20260726</FchVto><EmisionTipo>CAE</EmisionTipo>
</ResultGet></FECompConsultarResult></FECompConsultarResponse></soap:Body></soap:Envelope>`;
    expect(parseFECompConsultarResponse(xml)).toEqual({
      cbteNro: 1235,
      impTotal: 121000,
      docNro: "30123456",
      cbteFch: "20260716",
      cae: "76281234567890",
      caeVto: "20260726",
    });
  });

  it("error 602 (no existe) → null", () => {
    const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>
<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>
</FECompConsultarResult></FECompConsultarResponse></soap:Body></soap:Envelope>`;
    expect(parseFECompConsultarResponse(xml)).toBeNull();
  });
});

describe("FEDummy", () => {
  it("parsea el estado de los tres servers", () => {
    const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult>
<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>
</FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>`;
    expect(parseFEDummyResponse(xml)).toEqual({ appServer: "OK", dbServer: "OK", authServer: "OK" });
  });
});
