import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLUMNAS, filasAObjetos, planificarLote, interpretarFirma, cuerpoGemini, filaResultado,
  evaluarRespuestaWorker, evaluarVigilancia,
} from "../n8n/logica.mjs";
import { COLUMNAS as COLUMNAS_GENERADOR } from "../generador/manifiesto.mjs";
import { formatearCodigo } from "../comun/codigo.mjs";

const AHORA = "2026-09-21T15:00:00.000Z";
const cod = (n) => formatearCodigo("T", n);
const vis = (n) => `T-${String(n).padStart(6, "0")}`;

const comprobantes = [
  { numero: vis(1), codigo: cod(1), cliente: "ACME SA - PERFUMERIA", carpeta_cliente: "ACME SA - PERFUMERIA", periodo: "2026-09" },
  { numero: vis(2), codigo: cod(2), cliente: "ACME SA - DROGUERIA", carpeta_cliente: "ACME SA - DROGUERIA", periodo: "2026-09" },
  { numero: vis(3), codigo: cod(3), cliente: "CLINICA DEMO S.A", carpeta_cliente: "CLINICA DEMO S.A", periodo: "2026-08" },
];

const identificada = (pagina, n, hash = `h${pagina}`) => ({
  pagina, pieza: 1, ubicacion: String(pagina), modo: "pagina", estado: "identificado", codigo: cod(n), numero_visible: vis(n), hash_sha256: hash,
  pdf_pagina_b64: "PDF", imagen_jpg_b64: "JPG",
});
const aRevisar = (pagina, motivo, hash = `h${pagina}`) => ({
  pagina, pieza: 1, ubicacion: String(pagina), modo: "pagina", estado: "revisar", motivo, hash_sha256: hash, pdf_pagina_b64: "PDF", imagen_jpg_b64: "JPG",
});
const worker = (piezas, hash = "lotehash123456", hojas = piezas.length) => ({ hash_archivo: hash, total_paginas: hojas, piezas });
const plan = (w, extra = {}) =>
  planificarLote({
    archivo: { id: "arch1", name: "scan_0042.pdf" }, worker: w, comprobantes, resultados: [], lotes: [],
    unidad: "Hotel", ahora: AHORA, ...extra,
  });

test("la planilla Comprobantes que arma el generador es la que lee n8n", () => {
  assert.deepEqual(COLUMNAS.Comprobantes, COLUMNAS_GENERADOR);
});

test("archiva cada remito identificado en la ruta de su cliente y periodo", () => {
  const r = plan(worker([identificada(1, 1), identificada(2, 2), identificada(3, 3)]));
  assert.equal(r.lote_duplicado, false);
  assert.deepEqual(r.piezas.map((p) => [p.accion, p.ruta_clave, p.archivo_nombre]), [
    ["archivar", "ACME SA - PERFUMERIA/Hotel/2026-09", "T-000001.pdf"],
    ["archivar", "ACME SA - DROGUERIA/Hotel/2026-09", "T-000002.pdf"],
    ["archivar", "CLINICA DEMO S.A/Hotel/2026-08", "T-000003.pdf"],
  ]);
  assert.equal(r.rutas.length, 3);
  assert.deepEqual(r.resumen, { paginas: 3, archivadas: 3, revisar: 0, saltadas: 0 });
});

test("las rutas se deduplican: una carpeta por cliente/periodo aunque haya muchas paginas", () => {
  const r = plan(worker([identificada(1, 1, "a"), identificada(2, 1, "b")]));
  assert.equal(r.rutas.length, 1);
});

test("lo que el worker no identifico va a revisar con su motivo", () => {
  const r = plan(worker([aRevisar(1, "codigo_ilegible"), aRevisar(2, "dv_invalido")]));
  assert.deepEqual(r.piezas.map((p) => [p.accion, p.motivo]), [
    ["revisar", "codigo_ilegible"],
    ["revisar", "dv_invalido"],
  ]);
  assert.match(r.piezas[0].archivo_nombre, /^2026-09-21_lotehash_hoja001_codigo_ilegible\.pdf$/);
  assert.equal(r.rutas.length, 0);
});

test("codigo valido que no esta en el manifiesto: revisar, codigo_inexistente", () => {
  const r = plan(worker([identificada(1, 99)]));
  assert.equal(r.piezas[0].accion, "revisar");
  assert.equal(r.piezas[0].motivo, "codigo_inexistente");
  assert.equal(r.piezas[0].numero, vis(99));
});

test("re-escaneo de un remito ya archivado: version 2, marcado, sin pisar", () => {
  const resultados = [{ estado: "archivado", numero: vis(1), hash_sha256: "viejo" }];
  const r = plan(worker([identificada(1, 1, "nuevo")]), { resultados });
  assert.equal(r.piezas[0].archivo_nombre, "T-000001_v2.pdf");
  assert.equal(r.piezas[0].reescaneo, true);
  assert.equal(r.piezas[0].version, 2);
});

test("el mismo remito dos veces en un lote (hojas distintas) no se pisa", () => {
  const r = plan(worker([identificada(1, 1, "a"), identificada(2, 1, "b")]));
  assert.deepEqual(r.piezas.map((p) => p.archivo_nombre), ["T-000001.pdf", "T-000001_v2.pdf"]);
});

test("idempotencia: paginas ya guardadas se saltean (reproceso tras una caida)", () => {
  const resultados = [
    { estado: "archivado", numero: vis(1), hash_sha256: "h1" },
    { estado: "revisar", numero: "", hash_sha256: "h2" },
  ];
  const r = plan(worker([identificada(1, 1), aRevisar(2, "codigo_ilegible"), identificada(3, 2)]), { resultados });
  assert.deepEqual(r.piezas.map((p) => p.accion), ["saltear", "saltear", "archivar"]);
  assert.deepEqual(r.resumen, { paginas: 3, archivadas: 1, revisar: 0, saltadas: 2 });
});

test("la misma hoja dos veces dentro del mismo PDF se guarda una sola vez", () => {
  const r = plan(worker([identificada(1, 1, "igual"), identificada(2, 1, "igual")]));
  assert.deepEqual(r.piezas.map((p) => p.accion), ["archivar", "saltear"]);
});

test("un resultado viejo con estado distinto no cuenta como guardado", () => {
  const resultados = [{ estado: "saltado", hash_sha256: "h1" }];
  const r = plan(worker([identificada(1, 1)]), { resultados });
  assert.equal(r.piezas[0].accion, "archivar");
});

test("lote ya procesado: duplicado, no se toca ninguna pagina", () => {
  const lotes = [{ hash_archivo: "lotehash123456", estado: "procesado" }];
  const r = plan(worker([identificada(1, 1)]), { lotes });
  assert.equal(r.lote_duplicado, true);
  assert.equal(r.piezas.length, 0);
});

test("carpeta del cliente: caracteres que rompen rutas se reemplazan", () => {
  const comps = [{ ...comprobantes[0], carpeta_cliente: "ACME S/A: Norte" }];
  const r = plan(worker([identificada(1, 1)]), { comprobantes: comps });
  assert.equal(r.piezas[0].ruta_clave, "ACME S-A- Norte/Hotel/2026-09");
});

test("filasAObjetos ignora filas vacias y completa celdas faltantes", () => {
  assert.deepEqual(filasAObjetos([["a", "b"], ["1"], ["", ""], ["3", "4"]]), [{ a: "1", b: "" }, { a: "3", b: "4" }]);
  assert.deepEqual(filasAObjetos(undefined), []);
});

// --- Firma ---

const respuesta = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

test("interpreta una respuesta firmada", () => {
  assert.deepEqual(interpretarFirma(respuesta({ firmado: true, confianza: 0.93, observacion: "rubrica clara" })), {
    firma: "si", confianza: 0.93, observacion: "rubrica clara",
  });
});

test("confianza en porcentaje se normaliza; fuera de rango se acota", () => {
  assert.equal(interpretarFirma(respuesta({ firmado: false, confianza: 85, observacion: "" })).confianza, 0.85);
  assert.equal(interpretarFirma(respuesta({ firmado: false, confianza: -3, observacion: "" })).confianza, 0);
});

test("ignora las partes de razonamiento (thought) de la respuesta", () => {
  const r = { candidates: [{ content: { parts: [{ text: "pensando...", thought: true }, { text: '{"firmado":false,"confianza":0.9,"observacion":"vacio"}' }] } }] };
  assert.equal(interpretarFirma(r).firma, "no");
});

test("cualquier falla es 'error', nunca 'no firmado'", () => {
  for (const r of [
    null,
    { error: { message: "quota exceeded" } },
    { candidates: [{ finishReason: "SAFETY" }] },
    { candidates: [{ content: { parts: [{ text: "no es json" }] } }] },
    respuesta({ confianza: 0.9 }),
    respuesta({ firmado: true, confianza: "alta" }),
  ]) {
    assert.equal(interpretarFirma(r).firma, "error", JSON.stringify(r));
  }
});

test("el pedido a Gemini lleva la imagen y el esquema", () => {
  const c = cuerpoGemini("QUJD", "low");
  assert.equal(c.contents[0].parts[1].inlineData.data, "QUJD");
  assert.deepEqual(c.generationConfig.responseSchema.required, ["firmado", "confianza", "observacion"]);
  assert.equal(c.generationConfig.thinkingConfig.thinkingLevel, "low");
});

test("fila de resultado en el orden de la pestana", () => {
  const [pag] = plan(worker([identificada(1, 1)])).piezas;
  const fila = filaResultado(pag, { firma: "si", confianza: 0.9, observacion: "ok" }, { id: "F1", name: "T-000001.pdf", webViewLink: "L" }, "gemini-3.8-flash", AHORA);
  assert.equal(fila.length, COLUMNAS.Resultados.length);
  const obj = Object.fromEntries(COLUMNAS.Resultados.map((c, i) => [c, fila[i]]));
  assert.equal(obj.estado, "archivado");
  assert.equal(obj.reescaneo, "no");
  assert.equal(obj.firma, "si");
  assert.equal(obj.archivo_id, "F1");
});

// --- Worker y vigilancia ---

test("respuesta del worker: ok / rechazar / reintentar", () => {
  assert.equal(evaluarRespuestaWorker({ statusCode: 200, body: { piezas: [] } }).decision, "ok");
  assert.equal(evaluarRespuestaWorker({ statusCode: 415, body: { error: "formato_no_soportado" } }).decision, "rechazar");
  assert.equal(evaluarRespuestaWorker({ statusCode: 422, body: {} }).decision, "rechazar");
  assert.equal(evaluarRespuestaWorker({ statusCode: 500, body: {} }).decision, "reintentar");
  assert.equal(evaluarRespuestaWorker({ statusCode: 401, body: {} }).decision, "reintentar");
  assert.equal(evaluarRespuestaWorker(undefined).decision, "reintentar");
});

test("vigilancia: avisa si no corre o si hay archivos viejos en _Entrada", () => {
  const base = { ahora: AHORA, horasSinCorrer: 1, horasEnEntrada: 2 };
  assert.deepEqual(evaluarVigilancia({ ...base, ultimaCorrida: "2026-09-21T14:50:00Z", archivosEntrada: [] }), []);
  assert.equal(evaluarVigilancia({ ...base, ultimaCorrida: "2026-09-21T10:00:00Z", archivosEntrada: [] }).length, 1);
  assert.equal(evaluarVigilancia({ ...base, ultimaCorrida: "", archivosEntrada: [] }).length, 1);
  const viejos = evaluarVigilancia({
    ...base, ultimaCorrida: "2026-09-21T14:55:00Z",
    archivosEntrada: [{ name: "scan.pdf", createdTime: "2026-09-21T11:00:00Z" }, { name: "nuevo.pdf", createdTime: "2026-09-21T14:30:00Z" }],
  });
  assert.equal(viejos.length, 1);
  assert.match(viejos[0], /1 archivo\(s\).*scan\.pdf/);
});

// --- Piezas recortadas de una hoja con cartulina ---

const ticket = (hoja, pieza, n, hash) => ({
  ...identificada(hoja, n, hash), pieza, ubicacion: `${hoja}.${pieza}`, modo: "cartulina",
});

test("cartulina: cada ticket de la hoja se archiva por separado, con su ubicacion", () => {
  const r = plan(worker([ticket(1, 1, 1, "a"), ticket(1, 2, 2, "b"), ticket(1, 3, 3, "c")], "lotehash123456", 1));
  assert.deepEqual(r.piezas.map((p) => [p.pagina, p.accion, p.archivo_nombre]), [
    ["1.1", "archivar", "T-000001.pdf"],
    ["1.2", "archivar", "T-000002.pdf"],
    ["1.3", "archivar", "T-000003.pdf"],
  ]);
  assert.deepEqual(r.resumen, { paginas: 1, archivadas: 3, revisar: 0, saltadas: 0 });
});

test("cartulina: un ticket ilegible va a revision con la hoja y el lugar en el nombre", () => {
  const ilegible = { ...aRevisar(2, "codigo_ilegible", "z"), pieza: 3, ubicacion: "2.3", modo: "cartulina" };
  const r = plan(worker([ilegible], "lotehash123456", 2));
  assert.equal(r.piezas[0].pagina, "2.3");
  assert.match(r.piezas[0].archivo_nombre, /_hoja002-3_codigo_ilegible\.pdf$/);
});

test("lote duplicado: las saltadas cuentan piezas, no hojas", () => {
  const lotes = [{ hash_archivo: "lotehash123456", estado: "procesado" }];
  const r = plan(worker([ticket(1, 1, 1, "a"), ticket(1, 2, 2, "b")], "lotehash123456", 1), { lotes });
  assert.deepEqual(r.resumen, { paginas: 1, archivadas: 0, revisar: 0, saltadas: 2 });
});

// --- Configuracion por nombre (sobrevive a reinstalar) ---

import { armarConfig } from "../n8n/logica.mjs";

const CARPETA = "application/vnd.google-apps.folder";
const PLANILLA = "application/vnd.google-apps.spreadsheet";
const contenidoOk = [
  { id: "E", name: "_Entrada", mimeType: CARPETA },
  { id: "R", name: "_Revisar", mimeType: CARPETA },
  { id: "P", name: "_Procesados", mimeType: CARPETA },
  { id: "S", name: "Remitos - Control", mimeType: PLANILLA },
  { id: "X", name: "ACME SA - PERFUMERIA", mimeType: CARPETA },
];

test("config: arma los ids buscando por nombre", () => {
  const c = armarConfig({ modelo: "m" }, [{ id: "RAIZ" }], contenidoOk);
  assert.deepEqual(c, { modelo: "m", raiz_id: "RAIZ", entrada_id: "E", revisar_id: "R", procesados_id: "P", planilla_id: "S" });
});

test("config: sin carpeta Remitos, error claro (nunca 'no hay nada')", () => {
  assert.throws(() => armarConfig({}, [], contenidoOk), /No encuentro la carpeta "Remitos"/);
});

test("config: dos carpetas Remitos, error claro", () => {
  assert.throws(() => armarConfig({}, [{ id: "a" }, { id: "b" }], contenidoOk), /Hay 2 carpetas "Remitos"/);
});

test("config: falta una subcarpeta o la planilla, error claro", () => {
  assert.throws(() => armarConfig({}, [{ id: "r" }], contenidoOk.filter((f) => f.name !== "_Entrada")), /Falta "_Entrada"/);
  assert.throws(() => armarConfig({}, [{ id: "r" }], contenidoOk.filter((f) => f.id !== "S")), /Falta "Remitos - Control"/);
});

test("config: una carpeta con el nombre de la planilla no cuenta como planilla", () => {
  const raro = [...contenidoOk.filter((f) => f.id !== "S"), { id: "Z", name: "Remitos - Control", mimeType: CARPETA }];
  assert.throws(() => armarConfig({}, [{ id: "r" }], raro), /Falta "Remitos - Control"/);
});

test("config: subcarpeta repetida, error claro", () => {
  assert.throws(() => armarConfig({}, [{ id: "r" }], [...contenidoOk, { id: "E2", name: "_Entrada", mimeType: CARPETA }]), /Hay 2 "_Entrada"/);
});

// --- Reintento de firmas ---

import {
  reintentosDe, letraColumna, rangoFirma, elegirFirmaPendiente, mismaFila, firmaReintentada, cuerpoGeminiArchivo,
} from "../n8n/logica.mjs";

const encabezado = COLUMNAS.Resultados;
const filaRes = (o) => encabezado.map((c) => o[c] ?? "");

test("reintentos: se leen de la observacion", () => {
  assert.equal(reintentosDe("gemini: 503"), 0);
  assert.equal(reintentosDe("gemini: 503 [reintentos: 3]"), 3);
  assert.equal(reintentosDe(undefined), 0);
});

test("letras de columna y rango de firma en Resultados", () => {
  assert.deepEqual([0, 12, 15, 25, 26, 27].map(letraColumna), ["A", "M", "P", "Z", "AA", "AB"]);
  assert.equal(rangoFirma(6), "Resultados!M6:P6");
});

test("elige la firma en error con menos intentos y su fila real", () => {
  const values = [
    encabezado,
    filaRes({ numero: "T-000001", firma: "si", archivo_id: "a", hash_sha256: "h1" }),
    filaRes({ numero: "T-000002", firma: "error", observacion: "x [reintentos: 2]", archivo_id: "b", hash_sha256: "h2" }),
    [],
    filaRes({ numero: "T-000005", firma: "error", observacion: "gemini: 503", archivo_id: "c", hash_sha256: "h5" }),
  ];
  assert.deepEqual(elegirFirmaPendiente(values, 5), { fila: 5, archivo_id: "c", numero: "T-000005", hash_sha256: "h5", reintentos: 0 });
});

test("no elige las que agotaron los intentos ni las que no tienen archivo", () => {
  const values = [
    encabezado,
    filaRes({ firma: "error", observacion: "[reintentos: 5]", archivo_id: "a", hash_sha256: "h" }),
    filaRes({ firma: "error", observacion: "", archivo_id: "", hash_sha256: "h" }),
    filaRes({ firma: "no", archivo_id: "b", hash_sha256: "h" }),
  ];
  assert.equal(elegirFirmaPendiente(values, 5), null);
  assert.equal(elegirFirmaPendiente([encabezado], 5), null);
});

test("misma fila: se compara la huella, nunca se pisa otra fila", () => {
  const fila = filaRes({ hash_sha256: "h5" });
  assert.equal(mismaFila(fila, "h5"), true);
  assert.equal(mismaFila(fila, "otro"), false);
  assert.equal(mismaFila([], "h5"), false);
  assert.equal(mismaFila(fila, ""), false);
});

test("firma reintentada: si anduvo, limpia; si sigue en error, cuenta el intento", () => {
  assert.deepEqual(firmaReintentada({ firma: "no", confianza: 0.97, observacion: "renglon vacio" }, "gemini-3.8-flash", 1),
    ["no", 0.97, "renglon vacio", "gemini-3.8-flash"]);
  assert.deepEqual(firmaReintentada({ firma: "error", confianza: "", observacion: "gemini: 503 [reintentos: 1]" }, "gemini-3.5-flash", 2),
    ["error", "", "gemini: 503 [reintentos: 2]", "gemini-3.5-flash"]);
});

test("el pedido a Gemini con el PDF archivado usa el mismo prompt", () => {
  const c = cuerpoGeminiArchivo("UERG", "application/pdf", "low");
  assert.equal(c.contents[0].parts[1].inlineData.mimeType, "application/pdf");
  assert.equal(c.contents[0].parts[1].inlineData.data, "UERG");
  assert.equal(c.contents[0].parts[0].text, cuerpoGemini("x", "low").contents[0].parts[0].text);
});
