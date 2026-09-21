// Nucleo del worker: recibe los bytes de un escaneo (PDF o imagen) y devuelve,
// por cada pieza (un ticket recortado, o la hoja entera si no hay cartulina), que
// codigo tiene, si es valido, y la pieza como PDF e imagen.
//
// NO decide nada de negocio: no sabe de clientes, ni de Drive, ni de firmas.
// Solo contesta "esta pieza es el remito T-000123" o "esta pieza no se puede
// identificar, y por que". El que archiva (n8n) decide que hacer con eso.
//
// Regla de oro: ante la duda, NO identificar. Una pieza mal imputada es peor que
// una pieza en la bandeja de revision.

import { createHash } from "node:crypto";
import * as mupdf from "mupdf";
import { PDFDocument } from "pdf-lib";
import { readBarcodes } from "zxing-wasm/reader";

import { interpretarCodigo } from "../comun/codigo.mjs";
import { buscarTickets, recortar } from "./segmentar.mjs";

// Resolucion a la que se renderiza cada pagina para buscar el codigo. Si a esta
// no aparece nada, se reintenta a la alta antes de darla por ilegible.
const DPI_LECTURA = 200;
const DPI_REINTENTO = 300;
// Imagen que se devuelve para mirar la firma (Gemini / humano). Mas chica: sobra
// para ver si hay tinta y no infla la respuesta.
const DPI_IMAGEN = 150;
const CALIDAD_JPEG = 85;

const OPCIONES_LECTOR = {
  formats: ["QRCode", "Code128"],
  tryHarder: true,
  tryRotate: true, // las cuatro rotaciones
  tryInvert: false,
  maxNumberOfSymbols: 8,
};

export class ErrorEntrada extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo; // "formato_no_soportado" | "archivo_vacio" | "archivo_corrupto"
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** "pdf" | "png" | "jpeg", o tira ErrorEntrada. Por contenido, nunca por nombre. */
export function detectarFormato(bytes) {
  if (!bytes || bytes.length === 0) throw new ErrorEntrada("archivo_vacio", "El archivo esta vacio.");
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf"; // %PDF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  throw new ErrorEntrada(
    "formato_no_soportado",
    "Solo se aceptan PDF, PNG o JPG. El archivo no es ninguno de esos."
  );
}

const MIME = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" };

function abrir(bytes, formato) {
  try {
    const doc = mupdf.Document.openDocument(bytes, MIME[formato]);
    if (doc.countPages() < 1) throw new Error("sin paginas");
    return doc;
  } catch (e) {
    throw new ErrorEntrada("archivo_corrupto", `No se pudo abrir el archivo: ${e.message}`);
  }
}

function renderizar(pagina, dpi) {
  const escala = dpi / 72;
  return pagina.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceRGB, false, true);
}

async function leerCodigos(png) {
  const resultados = await readBarcodes(png, OPCIONES_LECTOR);
  return resultados.filter((r) => r.isValid && r.text);
}

/**
 * De todo lo que el lector encontro en la pagina, decide que es.
 * Los codigos que no tienen nuestro formato se ignoran (puede haber un QR de ARCA,
 * un codigo de producto, etc.). De los nuestros tiene que haber exactamente UNO.
 */
export function clasificarLecturas(lecturas) {
  const textos = [...new Set(lecturas.map((l) => l.text.trim()))];
  const propios = [];
  let dvInvalido = false;
  for (const t of textos) {
    const r = interpretarCodigo(t);
    if (r.ok) propios.push({ ...r, texto: t });
    else if (r.motivo === "dv_invalido") dvInvalido = true;
  }

  const distintos = [...new Map(propios.map((p) => [p.texto, p])).values()];
  if (distintos.length === 1) {
    const lectura = lecturas.find((l) => l.text.trim() === distintos[0].texto);
    return {
      estado: "identificado",
      codigo: distintos[0].texto,
      numero_visible: distintos[0].visible,
      prefijo: distintos[0].prefijo,
      numero: distintos[0].numero,
      formato_codigo: lectura.format,
      rotacion: lectura.orientation ?? 0,
    };
  }
  if (distintos.length > 1) {
    // Dos remitos escaneados en la misma hoja: no sabemos partirlos, y adivinar
    // cual es cual es justo lo que no se hace.
    return { estado: "revisar", motivo: "varios_codigos", codigos: distintos.map((d) => d.texto) };
  }
  if (dvInvalido) return { estado: "revisar", motivo: "dv_invalido" };
  if (textos.length > 0) return { estado: "revisar", motivo: "codigo_ajeno", codigos: textos };
  return { estado: "revisar", motivo: "codigo_ilegible" };
}


// PDF de una sola pagina a partir de una imagen JPEG renderizada a `dpi`.
async function pdfDesdeJpeg(jpeg, dpi) {
  const nuevo = await PDFDocument.create();
  const img = await nuevo.embedJpg(jpeg);
  const escala = 72 / dpi;
  const p = nuevo.addPage([img.width * escala, img.height * escala]);
  p.drawImage(img, { x: 0, y: 0, width: img.width * escala, height: img.height * escala });
  fijarMetadatos(nuevo);
  return nuevo.save();
}

// La pagina entera como PDF. Se copia la pagina original (conserva la calidad del
// escaneo). Si pdf-lib no puede con el PDF del escaner, se arma desde la imagen.
async function paginaComoPdf(origen, indice, formato, pixmapRespaldo) {
  if (formato === "pdf" && origen.pdfLib) {
    try {
      const nuevo = await PDFDocument.create();
      const [copia] = await nuevo.copyPages(origen.pdfLib, [indice]);
      nuevo.addPage(copia);
      fijarMetadatos(nuevo);
      return { bytes: await nuevo.save(), origen: "copia" };
    } catch {
      // cae al respaldo
    }
  }
  const bytes = await pdfDesdeJpeg(pixmapRespaldo.asJPEG(CALIDAD_JPEG), DPI_LECTURA);
  return { bytes, origen: formato === "pdf" ? "raster" : "imagen" };
}

// Metadatos fijos: la misma pagina tiene que dar siempre los mismos bytes.
function fijarMetadatos(doc) {
  const cero = new Date(0);
  doc.setCreationDate(cero);
  doc.setModificationDate(cero);
  doc.setProducer("remitos-worker");
  doc.setCreator("remitos-worker");
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

/** Una hoja sin cartulina: la hoja entera es una pieza (un remito por hoja). */
async function piezaPagina(pagina, i, origen, formato) {
  const pixmap = renderizar(pagina, DPI_LECTURA);
  const png = pixmap.asPNG();
  let lecturas = await leerCodigos(png);
  let dpi = DPI_LECTURA;
  if (lecturas.length === 0) {
    lecturas = await leerCodigos(renderizar(pagina, DPI_REINTENTO).asPNG());
    if (lecturas.length > 0) dpi = DPI_REINTENTO;
  }
  const pdf = await paginaComoPdf(origen, i, formato, pixmap);
  return {
    pagina: i + 1,
    pieza: 1,
    ubicacion: String(i + 1),
    modo: "pagina",
    ...clasificarLecturas(lecturas),
    dpi_lectura: dpi,
    // Hash del contenido renderizado: identifica la pieza aunque llegue dentro de
    // otro lote. Es lo que hace idempotente el reproceso.
    hash_sha256: sha256(png),
    pdf_origen: pdf.origen,
    pdf_pagina_b64: b64(pdf.bytes),
    imagen_jpg_b64: b64(renderizar(pagina, DPI_IMAGEN).asJPEG(CALIDAD_JPEG)),
  };
}

/** Un ticket recortado de una hoja con cartulina. */
async function piezaTicket(pagina, i, n, rect) {
  let pix = recortar(pagina, rect, DPI_LECTURA);
  let lecturas = await leerCodigos(pix.asPNG());
  let dpi = DPI_LECTURA;
  if (lecturas.length === 0) {
    lecturas = await leerCodigos(recortar(pagina, rect, DPI_REINTENTO).asPNG());
    if (lecturas.length > 0) dpi = DPI_REINTENTO;
  }
  const clasificacion = clasificarLecturas(lecturas);

  // Si el codigo dice que el ticket quedo girado, se vuelve a recortar derecho:
  // el archivo y la imagen para la firma quedan siempre al derecho. Se gira en
  // sentido contrario al que marca el codigo (el lector puede dar -90 o -180).
  const giro = clasificacion.estado === "identificado" ? (((-clasificacion.rotacion) % 360) + 360) % 360 : 0;
  if (giro) pix = recortar(pagina, rect, DPI_LECTURA, giro);

  const png = pix.asPNG();
  return {
    pagina: i + 1,
    pieza: n,
    ubicacion: `${i + 1}.${n}`,
    modo: "cartulina",
    ...clasificacion,
    rotacion: giro,
    dpi_lectura: dpi,
    medidas_mm: [rect.anchoMm, rect.largoMm],
    hash_sha256: sha256(png),
    pdf_origen: "recorte",
    pdf_pagina_b64: b64(await pdfDesdeJpeg(pix.asJPEG(CALIDAD_JPEG), DPI_LECTURA)),
    imagen_jpg_b64: b64(recortar(pagina, rect, DPI_IMAGEN, giro).asJPEG(CALIDAD_JPEG)),
  };
}

/** Algo claro sobre la cartulina que no tiene forma de ticket: a revision, con su imagen. */
async function piezaDescarte(pagina, i, n, rect) {
  const pix = recortar(pagina, rect, DPI_IMAGEN);
  const png = pix.asPNG();
  return {
    pagina: i + 1,
    pieza: n,
    ubicacion: `${i + 1}.${n}`,
    modo: "cartulina",
    estado: "revisar",
    motivo: rect.motivo,
    medidas_mm: [rect.anchoMm, rect.largoMm],
    hash_sha256: sha256(png),
    pdf_origen: "recorte",
    pdf_pagina_b64: b64(await pdfDesdeJpeg(pix.asJPEG(CALIDAD_JPEG), DPI_IMAGEN)),
    imagen_jpg_b64: b64(pix.asJPEG(CALIDAD_JPEG)),
  };
}

/**
 * Procesa un escaneo completo.
 *
 * Cada hoja se analiza: si se escaneo sobre cartulina negra, se separa en un
 * pieza por ticket; si no, la hoja entera es una pieza. Devuelve las piezas en
 * orden de lectura (hoja, y dentro de la hoja de arriba abajo e izquierda a derecha).
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{formato_entrada, hash_archivo, total_paginas, piezas: object[]}>}
 */
export async function procesarEscaneo(bytes) {
  const datos = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const formato = detectarFormato(datos);
  const doc = abrir(datos, formato);

  const origen = {};
  if (formato === "pdf") {
    try {
      origen.pdfLib = await PDFDocument.load(datos, { ignoreEncryption: true });
    } catch {
      origen.pdfLib = null; // las paginas enteras saldran por el respaldo raster
    }
  }

  const total = doc.countPages();
  const piezas = [];
  for (let i = 0; i < total; i++) {
    const pagina = doc.loadPage(i);
    const seg = buscarTickets(pagina);

    if (seg.modo === "pagina") {
      piezas.push(await piezaPagina(pagina, i, origen, formato));
      continue;
    }

    let n = 0;
    for (const rect of seg.tickets) piezas.push(await piezaTicket(pagina, i, ++n, rect));
    for (const rect of seg.descartes) piezas.push(await piezaDescarte(pagina, i, ++n, rect));
    // Parecia cartulina pero no aparecio ningun ticket: se lee la hoja entera como
    // siempre. Si tampoco hay codigo, va a revision; nunca se descarta en silencio.
    if (n === 0) {
      const pieza = await piezaPagina(pagina, i, origen, formato);
      piezas.push(pieza.estado === "identificado" ? pieza : { ...pieza, motivo: "sin_tickets" });
    }
  }

  return {
    formato_entrada: formato,
    hash_archivo: sha256(datos),
    total_paginas: total,
    piezas,
  };
}
