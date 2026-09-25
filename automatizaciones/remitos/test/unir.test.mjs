import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { unirPdfs, ErrorUnir } from "../worker/unir.mjs";

async function pdfDe(paginas) {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage([200, 300]);
  return Buffer.from(await d.save()).toString("base64");
}

test("une en el orden recibido y cuenta las páginas", async () => {
  const r = await unirPdfs([{ nombre: "R-000001", pdf_b64: await pdfDe(1) }, { nombre: "R-000002", pdf_b64: await pdfDe(2) }]);
  assert.equal(r.paginas, 3);
  const doc = await PDFDocument.load(Buffer.from(r.pdf_b64, "base64"));
  assert.equal(doc.getPageCount(), 3);
});

test("sin archivos: error claro", async () => {
  await assert.rejects(unirPdfs([]), (e) => e instanceof ErrorUnir && e.codigo === "sin_archivos");
});

test("un archivo que no es PDF corta todo y dice cuál", async () => {
  await assert.rejects(
    unirPdfs([{ nombre: "R-000001", pdf_b64: await pdfDe(1) }, { nombre: "R-000002", pdf_b64: Buffer.from("hola").toString("base64") }]),
    (e) => e instanceof ErrorUnir && e.codigo === "pdf_invalido" && e.message.includes("R-000002")
  );
});
