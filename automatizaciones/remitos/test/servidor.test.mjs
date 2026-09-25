import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { formatearCodigo } from "../comun/codigo.mjs";
import { crearServidor } from "../worker/servidor.mjs";
import { pdfConPaginas } from "./fixtures.mjs";

let servidor;
let base;
const TOKEN = "secreto-de-prueba";

before(async () => {
  servidor = crearServidor({ token: TOKEN, maxMb: 1 });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const post = (body, headers = { "X-Worker-Token": TOKEN }) =>
  fetch(`${base}/procesar`, { method: "POST", body, headers });

test("salud", async () => {
  const r = await fetch(`${base}/salud`);
  assert.equal(r.status, 200);
});

test("procesa un PDF", async () => {
  const cod = formatearCodigo("T", 42);
  const r = await post(await pdfConPaginas([{ codigos: [{ texto: cod }] }]));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.piezas[0].codigo, cod);
});

test("sin token: 401", async () => {
  const r = await post(Buffer.from("%PDF"), {});
  assert.equal(r.status, 401);
});

test("no soportado: 415", async () => {
  const r = await post(Buffer.from("PKdocx"));
  assert.equal(r.status, 415);
  assert.equal((await r.json()).error, "formato_no_soportado");
});

test("demasiado grande: 413", async () => {
  const r = await post(Buffer.alloc(2 * 1024 * 1024, 1)).catch((e) => e);
  // El servidor corta la conexion al pasar el limite; segun el timing, fetch
  // ve la respuesta 413 o un error de red. Las dos cosas son un rechazo.
  if (r instanceof Error) return;
  assert.equal(r.status, 413);
});

test("ruta y metodo equivocados", async () => {
  assert.equal((await fetch(`${base}/otra`)).status, 404);
  assert.equal((await fetch(`${base}/procesar`)).status, 405);
});

test("unir: devuelve el PDF unido", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const d = await PDFDocument.create();
  d.addPage([100, 100]);
  const b64 = Buffer.from(await d.save()).toString("base64");
  const r = await fetch(`${base}/unir`, {
    method: "POST",
    headers: { "X-Worker-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ archivos: [{ nombre: "R-000001", pdf_b64: b64 }, { nombre: "R-000002", pdf_b64: b64 }] }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).paginas, 2);
});

test("unir: sin token 401 y con basura 422", async () => {
  assert.equal((await fetch(`${base}/unir`, { method: "POST", body: "{}" })).status, 401);
  const r = await fetch(`${base}/unir`, {
    method: "POST", headers: { "X-Worker-Token": TOKEN },
    body: JSON.stringify({ archivos: [{ nombre: "R-000009", pdf_b64: "aG9sYQ==" }] }),
  });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error, "pdf_invalido");
});
