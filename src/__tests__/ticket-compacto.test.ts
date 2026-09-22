import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { CSS_TICKET_COMPACTO, REMITO_QR_MM } from "@/app/admin/comprobante-cc/ticket-compacto";
import { codigoRemito } from "@/lib/remito-codigo";
import { REMITO_QR_OPCIONES, remitoQrDataUrl } from "@/lib/remito-qr";

type DisenoAutomatizacion = {
  CSS_TICKET_COMPACTO: string;
  QR_MM: number;
  OPCIONES_QR: Record<string, unknown>;
};

async function automatizacion(): Promise<DisenoAutomatizacion> {
  const ruta = path.resolve(process.cwd(), "automatizaciones/remitos/comun/ticket-compacto.mjs");
  return (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as DisenoAutomatizacion;
}

describe("ticket compacto del remito", () => {
  it("es el mismo diseño que los tickets de prueba de la automatizacion", async () => {
    const a = await automatizacion();
    expect(CSS_TICKET_COMPACTO).toBe(a.CSS_TICKET_COMPACTO);
    expect(REMITO_QR_MM).toBe(a.QR_MM);
    // El dibujo del QR tambien: margen y tamaño de modulo son los que se probaron en la comandera.
    expect(REMITO_QR_OPCIONES).toEqual(a.OPCIONES_QR);
  });

  it("el QR sale como PNG, siempre igual para el mismo codigo y con el margen probado", async () => {
    const a = await remitoQrDataUrl(codigoRemito(158));
    expect(a.startsWith("data:image/png;base64,")).toBe(true);
    expect(await remitoQrDataUrl(codigoRemito(158))).toBe(a);
    // Un codigo R- entra en un QR de 21 modulos: con 1 de margen por lado y 8 px por
    // modulo, la imagen mide (21 + 2) x 8 = 184 px (el ancho va en el encabezado PNG).
    const png = Buffer.from(a.slice("data:image/png;base64,".length), "base64");
    expect(png.readUInt32BE(16)).toBe(184);
  });
});
