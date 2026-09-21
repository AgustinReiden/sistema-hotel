// Escaneos sinteticos para los tests: paginas A4 con codigos dibujados donde
// haga falta. No reemplazan la prueba con papel termico real, pero cubren la
// logica: que se lee, que se rechaza y por que.

import bwipjs from "bwip-js/node";
import { PDFDocument, degrees, rgb } from "pdf-lib";

export async function pngCodigo(texto, tipo = "qrcode") {
  const opciones =
    tipo === "qrcode"
      ? { bcid: "qrcode", text: texto, scale: 4, eclevel: "M" }
      : { bcid: "code128", text: texto, scale: 3, height: 12 };
  return bwipjs.toBuffer(opciones);
}

const MM = 72 / 25.4;

/**
 * Hoja escaneada sobre cartulina negra: A4 negra con tickets blancos encima.
 * tickets: [{ codigo?, tipo?, cxMm, cyMm, anguloGrados, anchoMm?, largoMm?, firma? }]
 * cxMm/cyMm: centro del ticket medido desde arriba a la izquierda de la hoja.
 * Sin `codigo`, el ticket va en blanco (simula un codigo ilegible).
 */
export async function hojaCartulina(tickets, { fondo = "negro" } = {}) {
  const pdf = await PDFDocument.create();
  const [anchoHoja, altoHoja] = [210 * MM, 297 * MM];
  const hoja = pdf.addPage([anchoHoja, altoHoja]);
  const colorFondo = fondo === "negro" ? rgb(0.05, 0.05, 0.05) : rgb(0.97, 0.97, 0.97);
  hoja.drawRectangle({ x: 0, y: 0, width: anchoHoja, height: altoHoja, color: colorFondo });

  for (const t of tickets) {
    const w = (t.anchoMm ?? 72) * MM, h = (t.largoMm ?? 110) * MM;
    // El ticket se arma en su propia pagina y se estampa girado.
    const aux = await PDFDocument.create();
    const p = aux.addPage([w, h]);
    p.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(1, 1, 1) });
    for (let i = 0; i < 6; i++) {
      p.drawRectangle({ x: 8 * MM, y: h - (12 + i * 5) * MM, width: w - 16 * MM, height: 1.2 * MM, color: rgb(0, 0, 0) });
    }
    if (t.codigo) {
      const img = await aux.embedPng(await pngCodigo(t.codigo, t.tipo ?? "qrcode"));
      const lado = (t.tipo === "code128" ? 60 : 25) * MM;
      const alto = t.tipo === "code128" ? 14 * MM : lado;
      p.drawImage(img, { x: (w - lado) / 2, y: h - 50 * MM - alto, width: lado, height: alto });
    }
    // Renglon de firma y, si se pide, una rubrica.
    p.drawRectangle({ x: 20 * MM, y: 20 * MM, width: w - 30 * MM, height: 0.5 * MM, color: rgb(0, 0, 0) });
    if (t.firma) {
      for (let i = 0; i < 5; i++) {
        p.drawLine({ start: { x: (25 + i * 7) * MM, y: 22 * MM }, end: { x: (30 + i * 7) * MM, y: 30 * MM }, thickness: 1.5, color: rgb(0.1, 0.1, 0.5) });
      }
    }
    const [emb] = await pdf.embedPdf(await aux.save());

    // Girar alrededor del centro: pdf-lib gira alrededor de la esquina inferior izquierda.
    const a = ((t.anguloGrados ?? 0) * Math.PI) / 180;
    const cx = t.cxMm * MM, cy = altoHoja - t.cyMm * MM;
    const x = cx - ((w / 2) * Math.cos(a) - (h / 2) * Math.sin(a));
    const y = cy - ((w / 2) * Math.sin(a) + (h / 2) * Math.cos(a));
    hoja.drawPage(emb, { x, y, width: w, height: h, rotate: degrees(t.anguloGrados ?? 0) });
  }
  return pdf.save();
}

/**
 * paginas: [{ codigos: [{ texto, tipo }], rotacion }]
 * Una pagina sin codigos es una hoja en blanco.
 */
export async function pdfConPaginas(paginas) {
  const pdf = await PDFDocument.create();
  for (const def of paginas) {
    const p = pdf.addPage([595, 842]);
    let y = 600;
    for (const c of def.codigos ?? []) {
      const img = await pdf.embedPng(await pngCodigo(c.texto, c.tipo));
      p.drawImage(img, { x: 180, y, width: img.width / 2, height: img.height / 2 });
      y -= 300;
    }
    if (def.rotacion) p.setRotation(degrees(def.rotacion));
  }
  return pdf.save();
}
