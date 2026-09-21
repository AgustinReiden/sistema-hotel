import { test } from "node:test";
import assert from "node:assert/strict";

import { formatearCodigo } from "../comun/codigo.mjs";
import { procesarEscaneo, clasificarLecturas } from "../worker/procesar.mjs";
import { pdfConPaginas, pngCodigo } from "./fixtures.mjs";

const A = formatearCodigo("T", 1);
const B = formatearCodigo("T", 2);
const C = formatearCodigo("T", 3);
// Mismo numero que A con el DV roto: lo que pasa si alguien tacha y reescribe.
const A_DV_MALO = A.slice(0, -2) + (A.endsWith("00") ? "01" : "00");

test("lote multipagina: identifica cada pagina con su codigo", async () => {
  const pdf = await pdfConPaginas([
    { codigos: [{ texto: A, tipo: "qrcode" }] },
    { codigos: [{ texto: B, tipo: "code128" }] },
    { codigos: [{ texto: C, tipo: "qrcode" }] },
  ]);
  const r = await procesarEscaneo(pdf);
  assert.equal(r.formato_entrada, "pdf");
  assert.equal(r.total_paginas, 3);
  assert.deepEqual(r.piezas.map((p) => [p.estado, p.codigo]), [
    ["identificado", A],
    ["identificado", B],
    ["identificado", C],
  ]);
  assert.equal(r.piezas[1].formato_codigo, "Code128");
  assert.equal(r.piezas[0].numero_visible, "T-000001");
});

test("lee paginas rotadas 90 y 180", async () => {
  const pdf = await pdfConPaginas([
    { codigos: [{ texto: A, tipo: "qrcode" }], rotacion: 180 },
    { codigos: [{ texto: B, tipo: "code128" }], rotacion: 90 },
    { codigos: [{ texto: C, tipo: "code128" }], rotacion: 180 },
  ]);
  const r = await procesarEscaneo(pdf);
  assert.deepEqual(r.piezas.map((p) => p.codigo), [A, B, C]);
});

test("DV invalido: se rechaza, nunca se imputa", async () => {
  const r = await procesarEscaneo(await pdfConPaginas([{ codigos: [{ texto: A_DV_MALO }] }]));
  assert.equal(r.piezas[0].estado, "revisar");
  assert.equal(r.piezas[0].motivo, "dv_invalido");
  assert.equal(r.piezas[0].codigo, undefined);
});

test("hoja sin codigo: codigo_ilegible, pero la pagina igual se devuelve", async () => {
  const r = await procesarEscaneo(await pdfConPaginas([{ codigos: [] }]));
  const p = r.piezas[0];
  assert.equal(p.estado, "revisar");
  assert.equal(p.motivo, "codigo_ilegible");
  assert.ok(p.pdf_pagina_b64.length > 0);
  assert.ok(p.imagen_jpg_b64.length > 0);
});

test("dos remitos en la misma hoja: varios_codigos", async () => {
  const r = await procesarEscaneo(
    await pdfConPaginas([{ codigos: [{ texto: A }, { texto: B, tipo: "code128" }] }])
  );
  assert.equal(r.piezas[0].motivo, "varios_codigos");
  assert.deepEqual(r.piezas[0].codigos.sort(), [A, B].sort());
});

test("el mismo codigo en QR y Code128 en la misma hoja es UN remito", async () => {
  const r = await procesarEscaneo(
    await pdfConPaginas([{ codigos: [{ texto: A, tipo: "qrcode" }, { texto: A, tipo: "code128" }] }])
  );
  assert.equal(r.piezas[0].estado, "identificado");
  assert.equal(r.piezas[0].codigo, A);
});

test("codigo ajeno (otro formato) no se confunde con un remito", async () => {
  const r = await procesarEscaneo(await pdfConPaginas([{ codigos: [{ texto: "https://www.afip.gob.ar/fe/qr/?p=x" }] }]));
  assert.equal(r.piezas[0].motivo, "codigo_ajeno");
});

test("un codigo ajeno al lado del nuestro no molesta", () => {
  const c = clasificarLecturas([
    { text: "7791234567890", format: "Code128", orientation: 0 },
    { text: A, format: "QRCode", orientation: 0 },
  ]);
  assert.equal(c.estado, "identificado");
  assert.equal(c.codigo, A);
});

test("acepta una imagen suelta (PNG)", async () => {
  const r = await procesarEscaneo(await pngCodigo(B));
  assert.equal(r.formato_entrada, "png");
  assert.equal(r.piezas[0].codigo, B);
  assert.equal(r.piezas[0].pdf_origen, "imagen");
});

test("rechaza lo que no es PDF ni imagen", async () => {
  const docx = Buffer.from("PK esto es un zip/docx");
  await assert.rejects(procesarEscaneo(docx), { codigo: "formato_no_soportado" });
  await assert.rejects(procesarEscaneo(new Uint8Array()), { codigo: "archivo_vacio" });
});

test("PDF roto: archivo_corrupto", async () => {
  await assert.rejects(procesarEscaneo(Buffer.from("%PDF-1.7 basura sin estructura")), {
    codigo: "archivo_corrupto",
  });
});

test("idempotente: el mismo escaneo da los mismos hashes y la misma pagina", async () => {
  const pdf = await pdfConPaginas([{ codigos: [{ texto: A }] }, { codigos: [{ texto: B }] }]);
  const r1 = await procesarEscaneo(pdf);
  const r2 = await procesarEscaneo(pdf);
  assert.equal(r1.hash_archivo, r2.hash_archivo);
  assert.deepEqual(r1.piezas.map((p) => p.hash_sha256), r2.piezas.map((p) => p.hash_sha256));
  assert.equal(r1.piezas[0].pdf_pagina_b64, r2.piezas[0].pdf_pagina_b64);
  assert.notEqual(r1.piezas[0].hash_sha256, r1.piezas[1].hash_sha256);
});

test("la misma pagina dentro de otro lote conserva su hash", async () => {
  const pagA = { codigos: [{ texto: A }] };
  const solo = await procesarEscaneo(await pdfConPaginas([pagA]));
  const lote = await procesarEscaneo(await pdfConPaginas([{ codigos: [{ texto: B }] }, pagA]));
  assert.equal(solo.piezas[0].hash_sha256, lote.piezas[1].hash_sha256);
  assert.notEqual(solo.hash_archivo, lote.hash_archivo);
});

// --- Varios tickets por hoja, sobre cartulina negra ---------------------------

import { hojaCartulina } from "./fixtures.mjs";
import { readBarcodes } from "zxing-wasm/reader";

// Orientacion del codigo en la imagen que se archiva (0 = derecho), leida tal cual,
// sin volver a pasar por el separador de tickets.
async function orientacionArchivada(pieza) {
  const [l] = await readBarcodes(Buffer.from(pieza.imagen_jpg_b64, "base64"), { formats: ["QRCode", "Code128"], tryHarder: true });
  return ((l.orientation % 360) + 360) % 360;
}

test("cartulina: separa cada ticket, aunque esten torcidos o al reves, y los deja derechos", async () => {
  const r = await procesarEscaneo(await hojaCartulina([
    { codigo: A, cxMm: 55, cyMm: 75, anguloGrados: 5 },
    { codigo: B, cxMm: 155, cyMm: 80, anguloGrados: -8, tipo: "code128" },
    { codigo: C, cxMm: 58, cyMm: 215, anguloGrados: 183 },
  ]));
  assert.equal(r.total_paginas, 1);
  assert.deepEqual(r.piezas.map((p) => [p.ubicacion, p.modo, p.codigo]), [
    ["1.1", "cartulina", A],
    ["1.2", "cartulina", B],
    ["1.3", "cartulina", C],
  ]);
});

test("cartulina: un ticket sin codigo legible NO desaparece, va a revision", async () => {
  const r = await procesarEscaneo(await hojaCartulina([
    { codigo: A, cxMm: 55, cyMm: 75, anguloGrados: 2 },
    { cxMm: 155, cyMm: 80, anguloGrados: -4 },
  ]));
  assert.equal(r.piezas.length, 2);
  assert.equal(r.piezas[1].estado, "revisar");
  assert.equal(r.piezas[1].motivo, "codigo_ilegible");
  assert.ok(r.piezas[1].imagen_jpg_b64.length > 0, "la imagen viaja para revisarla");
});

test("cartulina: el ticket al reves se archiva al derecho", async () => {
  const r = await procesarEscaneo(await hojaCartulina([{ codigo: A, cxMm: 105, cyMm: 150, anguloGrados: 178 }]));
  assert.equal(r.piezas[0].codigo, A);
  assert.equal(await orientacionArchivada(r.piezas[0]), 0);
});

test("cartulina: un ticket acostado (90 grados) tambien se archiva al derecho", async () => {
  const r = await procesarEscaneo(await hojaCartulina([{ codigo: B, cxMm: 105, cyMm: 150, anguloGrados: 92 }]));
  assert.equal(r.piezas[0].codigo, B);
  assert.equal(await orientacionArchivada(r.piezas[0]), 0);
});

test("cartulina: dos tickets pegados no se imputan, van a revision", async () => {
  const r = await procesarEscaneo(await hojaCartulina([
    { codigo: A, cxMm: 70, cyMm: 100 },
    { codigo: B, cxMm: 140, cyMm: 100 },
  ]));
  assert.equal(r.piezas.length, 1);
  assert.equal(r.piezas[0].estado, "revisar");
  assert.equal(r.piezas[0].motivo, "forma_no_reconocida");
});

test("cartulina vacia: la hoja va a revision como sin_tickets", async () => {
  const r = await procesarEscaneo(await hojaCartulina([]));
  assert.equal(r.piezas.length, 1);
  assert.equal(r.piezas[0].motivo, "sin_tickets");
});

test("sin cartulina (tapa blanca): la hoja entera es una pieza, como antes", async () => {
  const r = await procesarEscaneo(await hojaCartulina([{ codigo: A, cxMm: 105, cyMm: 150 }], { fondo: "blanco" }));
  assert.equal(r.piezas.length, 1);
  assert.equal(r.piezas[0].modo, "pagina");
  assert.equal(r.piezas[0].codigo, A);
});

test("sin cartulina y dos tickets en la hoja: varios_codigos (no se parte a ciegas)", async () => {
  const r = await procesarEscaneo(await hojaCartulina([
    { codigo: A, cxMm: 55, cyMm: 100 },
    { codigo: B, cxMm: 155, cyMm: 100 },
  ], { fondo: "blanco" }));
  assert.equal(r.piezas[0].motivo, "varios_codigos");
});

test("cartulina: el hash de cada ticket es estable entre corridas", async () => {
  const hoja = await hojaCartulina([
    { codigo: A, cxMm: 55, cyMm: 75, anguloGrados: 5 },
    { codigo: B, cxMm: 155, cyMm: 80, anguloGrados: -3 },
  ]);
  const r1 = await procesarEscaneo(hoja);
  const r2 = await procesarEscaneo(hoja);
  assert.deepEqual(r1.piezas.map((p) => p.hash_sha256), r2.piezas.map((p) => p.hash_sha256));
  assert.notEqual(r1.piezas[0].hash_sha256, r1.piezas[1].hash_sha256);
});

test("cartulina: en cualquier angulo, la imagen archivada queda derecha", async () => {
  for (const anguloGrados of [0, 30, 92, 135, 178, 225, 270, 315]) {
    for (const tipo of ["qrcode", "code128"]) {
      const r = await procesarEscaneo(await hojaCartulina([{ codigo: A, cxMm: 105, cyMm: 150, anguloGrados, tipo }]));
      assert.equal(r.piezas[0].codigo, A, `${anguloGrados}° ${tipo}`);
      assert.equal(await orientacionArchivada(r.piezas[0]), 0, `${anguloGrados}° ${tipo}`);
    }
  }
});

// --- Casos que salieron del primer escaneo real ---------------------------------

import { cuartoDeVuelta } from "../worker/procesar.mjs";

test("escaner Carta con cartulina A4: la franja blanca del costado no confunde", async () => {
  // Tickets acostados, como en el escaneo real, y el de la derecha tocando la franja.
  const r = await procesarEscaneo(await hojaCartulina([
    { codigo: A, cxMm: 60, cyMm: 70, anguloGrados: 90 },
    { codigo: B, cxMm: 150, cyMm: 150, anguloGrados: 91, largoMm: 125 },
    { codigo: C, cxMm: 60, cyMm: 230, anguloGrados: 89 },
  ], { anchoHojaMm: 216, cartulinaAnchoMm: 210 }));
  assert.deepEqual(r.piezas.map((p) => [p.modo, p.codigo]).sort(), [
    ["cartulina", A], ["cartulina", B], ["cartulina", C],
  ].sort());
  for (const p of r.piezas) assert.equal(await orientacionArchivada(p), 0, p.codigo);
});

test("el lector da angulos casi derechos en papel real: se redondea al cuarto de vuelta", () => {
  assert.deepEqual([1, 359, -1, 44, 46, 89, 91, 179, -179, 181, 269, -91].map(cuartoDeVuelta),
    [0, 0, 0, 0, 90, 90, 90, 180, 180, 180, 270, 270]);
});
