// Separa los tickets de una hoja escaneada sobre cartulina negra.
//
// Idea: tickets blancos sobre fondo negro. Se renderiza la pagina en baja
// resolucion, se separa claro de oscuro, y cada mancha clara del tamano de un
// ticket es un ticket. La orientacion sale del eje principal de la mancha (PCA),
// asi que un ticket torcido se endereza al recortarlo.
//
// Lo importante es que el ticket se encuentra POR SU FORMA, no por su codigo: si un
// ticket tiene el codigo ilegible, igual aparece (y va a revision). Con fondo
// blanco eso no se puede, y un ticket sin codigo leible desapareceria en silencio.

import * as mupdf from "mupdf";

// Resolucion del analisis de forma. Baja a proposito: es rapido y sobra para
// encontrar rectangulos de 8 cm.
const DPI_ANALISIS = 40;
const MM_POR_PULGADA = 25.4;

// Un ticket de comandera de 80 mm. Tolerancia amplia: papel de 57 mm o de 80 mm,
// escaneo con algo de sombra.
const TICKET = { anchoMinMm: 45, anchoMaxMm: 95, largoMinMm: 40 };
// Menos que esto es polvo, un recorte de papel o ruido del escaner.
const AREA_MINIMA_MM2 = 600;
// Margen que se agrega alrededor de cada ticket al recortarlo.
const MARGEN_MM = 3;
// Franja clara pegada al borde cuando la cartulina es mas chica que el vidrio.
const FRANJA_MAX_MM = 25;

const mmAPx = (mm, dpi) => (mm / MM_POR_PULGADA) * dpi;
const pxAMm = (px, dpi) => (px / dpi) * MM_POR_PULGADA;

function renderGris(pagina, dpi) {
  const e = dpi / 72;
  return pagina.toPixmap(mupdf.Matrix.scale(e, e), mupdf.ColorSpace.DeviceGray, false, true);
}

/** Pixeles en escala de gris (1 byte por pixel, sin padding). */
function grises(pix) {
  const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride(), n = pix.getNumberOfComponents();
  const src = pix.getPixels();
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[y * stride + x * n];
  return { w, h, px: out };
}

/** Umbral de Otsu: separa las dos poblaciones (cartulina y papel). */
export function umbralOtsu(px) {
  const hist = new Array(256).fill(0);
  for (const v of px) hist[v]++;
  const total = px.length;
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 127;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
    const varianza = pesoB * pesoF * (mB - mF) ** 2;
    if (varianza > mejor) { mejor = varianza; umbral = t; }
  }
  return umbral;
}

/**
 * ¿La hoja se escaneo sobre cartulina? Mira un anillo en el borde de la imagen:
 * con cartulina es casi todo oscuro; con la tapa blanca, casi todo claro.
 */
export function hayCartulina({ w, h, px }) {
  const borde = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  let oscuros = 0, total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= borde && x < w - borde && y >= borde && y < h - borde) continue;
      total++;
      if (px[y * w + x] < 90) oscuros++;
    }
  }
  // Casi todo el borde oscuro: un ticket puede tocar el borde, pero no mucho mas.
  return oscuros / total > 0.75;
}

/** Componentes conexas de la mascara (4-vecindad). Devuelve listas de indices. */
function componentes(mascara, w, h) {
  const etiqueta = new Int32Array(w * h).fill(-1);
  const grupos = [];
  const pila = [];
  for (let i = 0; i < mascara.length; i++) {
    if (!mascara[i] || etiqueta[i] !== -1) continue;
    const id = grupos.length;
    const miembros = [];
    etiqueta[i] = id;
    pila.push(i);
    while (pila.length) {
      const k = pila.pop();
      miembros.push(k);
      const x = k % w, y = (k - x) / w;
      if (x > 0 && mascara[k - 1] && etiqueta[k - 1] === -1) { etiqueta[k - 1] = id; pila.push(k - 1); }
      if (x < w - 1 && mascara[k + 1] && etiqueta[k + 1] === -1) { etiqueta[k + 1] = id; pila.push(k + 1); }
      if (y > 0 && mascara[k - w] && etiqueta[k - w] === -1) { etiqueta[k - w] = id; pila.push(k - w); }
      if (y < h - 1 && mascara[k + w] && etiqueta[k + w] === -1) { etiqueta[k + w] = id; pila.push(k + w); }
    }
    grupos.push(miembros);
  }
  return grupos;
}

// Dilata la mascara 1 pixel: une el papel que una linea impresa de borde a borde
// pudiera haber cortado en dos.
function dilatar(m, w, h) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ? 1 : 0;
    }
  }
  return out;
}

/**
 * Rectangulo orientado de una mancha: centro, eje largo y medidas, por PCA.
 * Todo en pixeles de analisis.
 */
function rectanguloOrientado(miembros, w) {
  let sx = 0, sy = 0;
  for (const k of miembros) { sx += k % w; sy += Math.floor(k / w); }
  const n = miembros.length, cx = sx / n, cy = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const k of miembros) {
    const dx = (k % w) - cx, dy = Math.floor(k / w) - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // Angulo del eje principal (el largo del ticket).
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta), uy = Math.sin(theta); // eje largo
  const vx = -uy, vy = ux; // eje corto
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const k of miembros) {
    const dx = (k % w) - cx, dy = Math.floor(k / w) - cy;
    const u = dx * ux + dy * uy, v = dx * vx + dy * vy;
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  // Centro del rectangulo (no del centroide: el texto corre el centroide).
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  return {
    cx: cx + cu * ux + cv * vx,
    cy: cy + cu * uy + cv * vy,
    largo: maxU - minU + 1,
    ancho: maxV - minV + 1,
    thetaGrados: (theta * 180) / Math.PI,
  };
}

/**
 * Busca los tickets de una pagina.
 * Devuelve { modo: "cartulina", tickets: [...], descartes: [...] } o { modo: "pagina" }.
 * Cada ticket trae su rectangulo en PUNTOS de la pagina (1/72 pulgada).
 */
export function buscarTickets(pagina) {
  const img = grises(renderGris(pagina, DPI_ANALISIS));
  if (!hayCartulina(img)) return { modo: "pagina" };

  const { w, h, px } = img;
  const umbral = Math.max(90, umbralOtsu(px)); // nunca tomar la cartulina como papel
  let mascara = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) mascara[i] = px[i] > umbral ? 1 : 0;
  mascara = dilatar(mascara, w, h);

  const aMm = (v) => pxAMm(v, DPI_ANALISIS);
  const aPt = (v) => (v / DPI_ANALISIS) * 72;
  const tickets = [];
  const descartes = [];

  for (const miembros of componentes(mascara, w, h)) {
    const areaMm2 = miembros.length * aMm(1) ** 2;
    if (areaMm2 < AREA_MINIMA_MM2) continue;
    const r = rectanguloOrientado(miembros, w);
    const anchoMm = aMm(r.ancho), largoMm = aMm(r.largo);
    const tocaBorde = miembros.some((k) => {
      const x = k % w, y = Math.floor(k / w);
      return x === 0 || y === 0 || x === w - 1 || y === h - 1;
    });
    const esTicket =
      anchoMm >= TICKET.anchoMinMm && anchoMm <= TICKET.anchoMaxMm && largoMm >= TICKET.largoMinMm;
    const rect = {
      cx: aPt(r.cx), cy: aPt(r.cy), anchoPt: aPt(r.ancho), largoPt: aPt(r.largo),
      thetaGrados: r.thetaGrados, anchoMm: Math.round(anchoMm), largoMm: Math.round(largoMm),
    };
    if (esTicket) tickets.push(rect);
    // La cartulina no cubrio todo el vidrio: franja clara y ANGOSTA pegada al borde.
    // Solo eso se ignora; una mancha ancha en el borde puede ser un ticket a medio
    // escanear o dos tickets pegados, y eso va a revision.
    else if (tocaBorde && anchoMm < FRANJA_MAX_MM) continue;
    // Algo claro que no tiene forma de ticket (dos tickets pegados, un papel doblado):
    // no se descarta en silencio, va a revision.
    else descartes.push({ ...rect, motivo: "forma_no_reconocida" });
  }

  // Orden de lectura: de arriba hacia abajo, y de izquierda a derecha en la misma fila.
  const orden = (a, b) => (Math.abs(a.cy - b.cy) > 60 ? a.cy - b.cy : a.cx - b.cx);
  tickets.sort(orden);
  descartes.sort(orden);
  return { modo: "cartulina", tickets, descartes };
}

/**
 * Renderiza un rectangulo orientado de la pagina, derecho y con el eje largo
 * vertical. `giroExtra` (0/90/180/270) endereza segun lo que diga el codigo.
 */
export function recortar(pagina, rect, dpi, giroExtra = 0) {
  const e = dpi / 72;
  const margen = mmAPx(MARGEN_MM, dpi);
  let ancho = Math.round(rect.anchoPt * e + 2 * margen);
  let alto = Math.round(rect.largoPt * e + 2 * margen);
  if (giroExtra % 180 !== 0) [ancho, alto] = [alto, ancho];

  // pagina (pt) -> px a la resolucion pedida -> centro en el origen ->
  // eje largo vertical -> giro extra -> centro del recorte.
  let m = mupdf.Matrix.scale(e, e);
  m = mupdf.Matrix.concat(m, mupdf.Matrix.translate(-rect.cx * e, -rect.cy * e));
  m = mupdf.Matrix.concat(m, mupdf.Matrix.rotate(90 - rect.thetaGrados + giroExtra));
  m = mupdf.Matrix.concat(m, mupdf.Matrix.translate(ancho / 2, alto / 2));

  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, ancho, alto], false);
  pix.clear(255);
  const dispositivo = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
  pagina.run(dispositivo, m);
  dispositivo.close();
  return pix;
}
