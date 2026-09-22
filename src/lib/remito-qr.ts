import "server-only";

/**
 * Opciones de la librería `qrcode` para el QR del remito. Copia de `OPCIONES_QR` de
 * automatizaciones/remitos/comun/ticket-compacto.mjs: es el dibujo que se probó en
 * la comandera (margen de 1 módulo, 8 px por módulo, corrección M). Un test compara
 * las dos.
 */
export const REMITO_QR_OPCIONES = { errorCorrectionLevel: "M", margin: 1, scale: 8 } as const;

/**
 * PNG data-URL del QR de un remito ("R-000158-56"). Escala entera: el <img> se
 * dibuja con image-rendering: pixelated y la comandera no suaviza los bordes.
 */
export async function remitoQrDataUrl(codigo: string): Promise<string> {
  const { toDataURL } = await import("qrcode");
  return toDataURL(codigo, REMITO_QR_OPCIONES);
}
