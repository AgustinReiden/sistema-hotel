import { test } from "node:test";
import assert from "node:assert/strict";

import QRCode from "qrcode";
import { readBarcodes } from "zxing-wasm/reader";

import { htmlTicket, pngQr } from "../generador/ticket.mjs";
import { OPCIONES_QR, QR_MM } from "../comun/ticket-compacto.mjs";

const HOTEL = { nombre: "Hotel de Prueba", direccion: "Ruta 1 km 1", zona: "America/Argentina/Tucuman" };
const C = {
  numero_visible: "T-000158", codigo: "T-000158-00", cliente: "EMPRESA DE PRUEBA SA", documento: "20000000001",
  habitacion: "7", check_in: "2026-09-16T15:00:00Z", check_out: "2026-09-17T11:00:00Z",
  created_at: "2026-09-17T11:00:00Z", monto: 50000,
};

test("ticket compacto: QR al costado del numero, sin titulos ni textos de mas", async () => {
  const h = await htmlTicket(C, HOTEL);
  assert.match(h, /class="thermal-page compacto"/);
  assert.match(h, /COMPROBANTE CTA\. CTE\./);
  assert.match(h, new RegExp(`width:${QR_MM}mm;height:${QR_MM}mm`));
  assert.match(h, /class="nro">T-000158</);
  assert.match(h, /class="firma"/);
  assert.match(h, /class="aclaracion"/);
  assert.doesNotMatch(h, /CARGO A CUENTA CORRIENTE/);
  assert.doesNotMatch(h, /reconoce adeudar/);
  assert.doesNotMatch(h, /Conserve este comprobante/);
  // Ni nombre ni direccion del hotel: solo gastaban papel.
  assert.doesNotMatch(h, /Hotel de Prueba/);
  assert.doesNotMatch(h, /Ruta 1 km 1/);
  assert.match(h, /^\s*<section class="thermal-page compacto">\s*<p class="tipo">/);
});

test("ticket compacto: el tamaño del QR y la leyenda de muestra se pueden cambiar", async () => {
  const h = await htmlTicket(C, HOTEL, { qrMm: 14, leyenda: "MUESTRA 14 mm" });
  assert.match(h, /width:14mm;height:14mm/);
  assert.match(h, /COMPROBANTE CTA\. CTE\. · MUESTRA 14 mm/);
});

test("ticket compacto: el QR es el mismo dibujo que imprime el sistema y se lee", async () => {
  const png = await pngQr("R-000158-56");
  // Mismas opciones de la libreria qrcode que el sistema: la prueba de impresion
  // mide exactamente el QR que despues sale en la comandera.
  assert.deepEqual(png, await QRCode.toBuffer("R-000158-56", OPCIONES_QR));
  const [lectura] = await readBarcodes(png, { formats: ["QRCode"] });
  assert.equal(lectura?.text, "R-000158-56");
});
