// QR de la RG 4892: toda representación impresa de un comprobante electrónico
// lleva un QR que codifica la URL oficial de verificación de ARCA con un JSON
// base64 en el parámetro `p`.

export type QrInvoiceData = {
  /** Fecha del comprobante "yyyy-mm-dd". */
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  tipoDocRec: number;
  nroDocRec: number;
  /** CAE. */
  codAut: number;
};

/** Estructura EXACTA que exige la especificación del QR (RG 4892), ver 1. */
export function buildQrPayload(d: QrInvoiceData) {
  return {
    ver: 1,
    fecha: d.fecha,
    cuit: d.cuit,
    ptoVta: d.ptoVta,
    tipoCmp: d.tipoCmp,
    nroCmp: d.nroCmp,
    importe: d.importe,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: d.tipoDocRec,
    nroDocRec: d.nroDocRec,
    tipoCodAut: "E", // E = CAE
    codAut: d.codAut,
  };
}

export function buildQrUrl(d: QrInvoiceData): string {
  const json = JSON.stringify(buildQrPayload(d));
  const b64 = Buffer.from(json, "utf-8").toString("base64");
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
}

/**
 * PNG data-URL del QR para el <img> del ticket térmico. Se llama desde el
 * server component de impresión (la lib `qrcode` corre en Node).
 */
export async function qrPngDataUrl(url: string): Promise<string> {
  const { toDataURL } = await import("qrcode");
  return toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 260 });
}
