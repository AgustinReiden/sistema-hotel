// Une los PDF de un paquete de remitos, en el orden en que llegan. Si uno no es un
// PDF valido, no devuelve nada: un paquete a medias es peor que ninguno.

import { PDFDocument } from "pdf-lib";

export class ErrorUnir extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/** @param {{ nombre?: string, pdf_b64: string }[]} archivos */
export async function unirPdfs(archivos) {
  if (!Array.isArray(archivos) || archivos.length === 0) {
    throw new ErrorUnir("sin_archivos", "No llegó ningún PDF para unir.");
  }
  const salida = await PDFDocument.create();
  for (const [i, a] of archivos.entries()) {
    let doc;
    try {
      doc = await PDFDocument.load(Buffer.from(String(a?.pdf_b64 ?? ""), "base64"));
    } catch {
      throw new ErrorUnir("pdf_invalido", `El archivo ${a?.nombre ?? i + 1} no es un PDF válido.`);
    }
    const paginas = await salida.copyPages(doc, doc.getPageIndices());
    for (const p of paginas) salida.addPage(p);
  }
  const bytes = await salida.save();
  return { paginas: salida.getPageCount(), pdf_b64: Buffer.from(bytes).toString("base64") };
}
