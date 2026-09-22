import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLUMNAS, filasAObjetos, planificarLote, interpretarFirma, cuerpoGemini, PROMPT_FIRMA,
  evaluarRespuestaWorker, evaluarVigilancia, cortarCorrida,
  pedidoPlanificacion, registroDePieza, numeroVisibleR,
} from "../n8n/logica.mjs";
import { formatearCodigo } from "../comun/codigo.mjs";

const AHORA = "2026-09-21T15:00:00.000Z";
const codR = (n) => formatearCodigo("R", n);
const visR = (n) => `R-${String(n).padStart(6, "0")}`;

// Piezas como las devuelve el worker. Nombres de clientes ficticios: el repo es publico.
const identificadaR = (pagina, n, hash = `h${pagina}`.padEnd(64, "0")) => ({
  pagina, pieza: 1, ubicacion: String(pagina), modo: "pagina", estado: "identificado",
  prefijo: "R", numero: n, codigo: codR(n), numero_visible: visR(n), hash_sha256: hash,
  pdf_pagina_b64: "PDF", imagen_jpg_b64: "JPG",
});
const aRevisar = (pagina, motivo, hash = `h${pagina}`) => ({
  pagina, pieza: 1, ubicacion: String(pagina), modo: "pagina", estado: "revisar", motivo, hash_sha256: hash, pdf_pagina_b64: "PDF", imagen_jpg_b64: "JPG",
});
const worker = (piezas, hash = "lotehash123456", hojas = piezas.length) => ({ hash_archivo: hash, total_paginas: hojas, piezas });

// Lo que contesta rpc_remitos_planificar (mig 116).
const planificacion = (remitos, hashes = []) => ({ remitos, hashes_registrados: hashes });
const remito = (n, extra = {}) => ({ numero: n, existe: true, cliente: "EMPRESA DE PRUEBA SA", periodo: "2026-09", versiones: 0, ...extra });
const planDb = (w, pl, extra = {}) => planificarLote({
  archivo: { id: "arch1", name: "scan.pdf" }, worker: w, planificacion: pl, lotes: [], unidad: "Hotel", ahora: AHORA, ...extra,
});

test("la planilla queda solo como bitacora de n8n: Lotes, Errores y Estado", () => {
  assert.deepEqual(Object.keys(COLUMNAS), ["Lotes", "Errores", "Estado"]);
});

test("base: archiva el R- que existe en la carpeta de su cliente y periodo", () => {
  const r = planDb(worker([identificadaR(1, 158)]), planificacion([remito(158)]));
  assert.equal(r.piezas[0].accion, "archivar");
  assert.equal(r.piezas[0].ruta_clave, "EMPRESA DE PRUEBA SA/Hotel/2026-09");
  assert.equal(r.piezas[0].archivo_nombre, "R-000158.pdf");
  assert.equal(r.piezas[0].numero_int, 158);
});

test("archiva cada remito identificado en la ruta de su cliente y periodo", () => {
  const r = planDb(
    worker([identificadaR(1, 1), identificadaR(2, 2), identificadaR(3, 3)]),
    planificacion([
      remito(1, { cliente: "ACME SA - PERFUMERIA" }),
      remito(2, { cliente: "ACME SA - DROGUERIA" }),
      remito(3, { cliente: "CLINICA DEMO S.A", periodo: "2026-08" }),
    ])
  );
  assert.equal(r.lote_duplicado, false);
  assert.deepEqual(r.piezas.map((p) => [p.accion, p.ruta_clave, p.archivo_nombre]), [
    ["archivar", "ACME SA - PERFUMERIA/Hotel/2026-09", "R-000001.pdf"],
    ["archivar", "ACME SA - DROGUERIA/Hotel/2026-09", "R-000002.pdf"],
    ["archivar", "CLINICA DEMO S.A/Hotel/2026-08", "R-000003.pdf"],
  ]);
  assert.equal(r.rutas.length, 3);
  assert.deepEqual(r.resumen, { paginas: 3, archivadas: 3, revisar: 0, saltadas: 0 });
});

test("las rutas se deduplican: una carpeta por cliente/periodo aunque haya muchas paginas", () => {
  const r = planDb(worker([identificadaR(1, 1, "a"), identificadaR(2, 2, "b")]), planificacion([remito(1), remito(2)]));
  assert.equal(r.rutas.length, 1);
});

test("lo que el worker no identifico va a revisar con su motivo", () => {
  const r = planDb(worker([aRevisar(1, "codigo_ilegible"), aRevisar(2, "dv_invalido")]), planificacion([]));
  assert.deepEqual(r.piezas.map((p) => [p.accion, p.motivo]), [
    ["revisar", "codigo_ilegible"],
    ["revisar", "dv_invalido"],
  ]);
  assert.match(r.piezas[0].archivo_nombre, /^2026-09-21_lotehash_hoja001_codigo_ilegible\.pdf$/);
  assert.equal(r.rutas.length, 0);
});

test("varios tickets pegados: a revisar, con los numeros que se leyeron en el nombre, sin imputar", () => {
  const pegados = {
    ...aRevisar(1, "forma_no_reconocida", "p"), pieza: 1, ubicacion: "1.1", modo: "cartulina",
    codigos: [codR(3), codR(1)], numeros: [visR(1), visR(3)],
  };
  const r = planDb(worker([pegados], "lotehash123456", 1), planificacion([]));
  assert.equal(r.piezas[0].accion, "revisar");
  assert.equal(r.piezas[0].numero_int, undefined, "no se imputa a ninguno");
  assert.equal(r.piezas[0].archivo_nombre, "2026-09-21_lotehash_hoja001-1_forma_no_reconocida_R-000001_R-000003.pdf");
  assert.equal(r.resumen.archivadas, 0);
});

test("en el nombre del archivo solo entran numeros con forma de numero", () => {
  const raro = { ...aRevisar(1, "forma_no_reconocida", "q"), pieza: 1, ubicacion: "1.1", modo: "cartulina", numeros: ["../x", visR(2)] };
  assert.match(planDb(worker([raro], "lotehash123456", 1), planificacion([])).piezas[0].archivo_nombre, /_forma_no_reconocida_R-000002\.pdf$/);
});

test("base: un R- que no existe y un T- de prueba van a revisar, nunca se imputan", () => {
  const t = { ...identificadaR(2, 5), prefijo: "T", codigo: formatearCodigo("T", 5), numero_visible: "T-000005" };
  const r = planDb(worker([identificadaR(1, 999), t]), planificacion([remito(999, { existe: false })]));
  assert.deepEqual(r.piezas.map((p) => [p.accion, p.motivo]), [["revisar", "codigo_inexistente"], ["revisar", "codigo_inexistente"]]);
});

test("base: re-escaneo sigue la version de la base; dos en el mismo lote no se pisan", () => {
  const r = planDb(worker([identificadaR(1, 158), identificadaR(2, 158)]), planificacion([remito(158, { versiones: 1 })]));
  assert.deepEqual(r.piezas.map((p) => p.archivo_nombre), ["R-000158_v2.pdf", "R-000158_v3.pdf"]);
  assert.deepEqual(r.piezas.map((p) => p.reescaneo), [true, true]);
});

test("el mismo remito dos veces en un lote, sin escaneos previos: el segundo es v2", () => {
  const r = planDb(worker([identificadaR(1, 1, "a"), identificadaR(2, 1, "b")]), planificacion([remito(1)]));
  assert.deepEqual(r.piezas.map((p) => p.archivo_nombre), ["R-000001.pdf", "R-000001_v2.pdf"]);
});

test("base: lo que la base ya tiene registrado se saltea", () => {
  const p = identificadaR(1, 158);
  const r = planDb(worker([p]), planificacion([remito(158)], [p.hash_sha256]));
  assert.equal(r.piezas[0].accion, "saltear");
});

test("idempotencia: piezas ya registradas se saltean (reproceso tras una caida)", () => {
  const r = planDb(
    worker([identificadaR(1, 1), aRevisar(2, "codigo_ilegible"), identificadaR(3, 2)]),
    planificacion([remito(1), remito(2)], [identificadaR(1, 1).hash_sha256, "h2"])
  );
  assert.deepEqual(r.piezas.map((p) => p.accion), ["saltear", "saltear", "archivar"]);
  assert.deepEqual(r.resumen, { paginas: 3, archivadas: 1, revisar: 0, saltadas: 2 });
});

test("la misma hoja dos veces dentro del mismo PDF se guarda una sola vez", () => {
  const r = planDb(worker([identificadaR(1, 1, "igual"), identificadaR(2, 1, "igual")]), planificacion([remito(1)]));
  assert.deepEqual(r.piezas.map((p) => p.accion), ["archivar", "saltear"]);
});

test("lote ya procesado: duplicado, no se toca ninguna pagina", () => {
  const lotes = [{ hash_archivo: "lotehash123456", estado: "procesado" }];
  const r = planDb(worker([identificadaR(1, 1)]), planificacion([remito(1)]), { lotes });
  assert.equal(r.lote_duplicado, true);
  assert.equal(r.piezas.length, 0);
});

test("carpeta del cliente: caracteres que rompen rutas se reemplazan", () => {
  const r = planDb(worker([identificadaR(1, 1)]), planificacion([remito(1, { cliente: "ACME S/A: Norte" })]));
  assert.equal(r.piezas[0].ruta_clave, "ACME S-A- Norte/Hotel/2026-09");
});

test("filasAObjetos ignora filas vacias y completa celdas faltantes", () => {
  assert.deepEqual(filasAObjetos([["a", "b"], ["1"], ["", ""], ["3", "4"]]), [{ a: "1", b: "" }, { a: "3", b: "4" }]);
  assert.deepEqual(filasAObjetos(undefined), []);
});

// --- Base del sistema (mig 116) ---

test("pedido a la base: numeros R- unicos y todas las huellas", () => {
  const w = worker([identificadaR(1, 160), identificadaR(2, 158), identificadaR(3, 160), aRevisar(4, "codigo_ilegible")]);
  assert.deepEqual(pedidoPlanificacion(w), {
    p_numeros: [158, 160],
    p_hashes: w.piezas.map((p) => p.hash_sha256),
  });
});

test("pedido a la base: los T- de prueba no se preguntan", () => {
  const t = { ...identificadaR(1, 5), prefijo: "T", codigo: formatearCodigo("T", 5), numero_visible: "T-000005" };
  assert.deepEqual(pedidoPlanificacion(worker([t])).p_numeros, []);
});

test("registro: lo archivado es un escaneo; lo que va a revisar, una pieza con lo que se leyo adentro", () => {
  const [archivada] = planDb(worker([identificadaR(1, 158)]), planificacion([remito(158)])).piezas;
  const subido = { id: "F1", webViewLink: "L1" };
  assert.deepEqual(registroDePieza(archivada, subido), {
    funcion: "rpc_remitos_registrar_escaneo",
    body: { p: { numero: 158, drive_file_id: "F1", drive_link: "L1", hash_sha256: archivada.hash_sha256,
      lote_archivo: "scan.pdf", lote_hash: "lotehash123456", ubicacion: "1" } },
  });
  const pegados = { ...aRevisar(2, "forma_no_reconocida"), numeros: [visR(1), visR(2)] };
  const [rev] = planDb(worker([pegados]), planificacion([])).piezas;
  assert.equal(registroDePieza(rev, subido).funcion, "rpc_remitos_registrar_pieza");
  assert.equal(registroDePieza(rev, subido).body.p.motivo, "forma_no_reconocida");
  assert.deepEqual(registroDePieza(rev, subido).body.p.numeros_leidos, [visR(1), visR(2)]);
  assert.equal(numeroVisibleR(7), "R-000007");
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

test("respuesta completa del nodo HTTP (never error): 200 se interpreta, 429 y 503 se clasifican", () => {
  const ok = interpretarFirma({ statusCode: 200, body: respuesta({ firmado: false, confianza: 0.99, observacion: "renglon vacio" }) });
  assert.deepEqual(ok, { firma: "no", confianza: 0.99, observacion: "renglon vacio" });

  const cuota = interpretarFirma({ statusCode: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } } });
  assert.equal(cuota.firma, "error");
  assert.equal(cuota.tipo_error, "cuota");
  assert.match(cuota.observacion, /429 RESOURCE_EXHAUSTED Quota exceeded/);

  const saturado = interpretarFirma({
    statusCode: 503,
    body: JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }),
  });
  assert.equal(saturado.tipo_error, "sobrecarga");
  assert.match(saturado.observacion, /503 UNAVAILABLE/);
});

test("errores de n8n: el aviso de 429 cuenta como cuota y un timeout como red", () => {
  assert.equal(interpretarFirma({ error: { message: "Try spacing your requests out using the batching settings under 'Options'" } }).tipo_error, "cuota");
  assert.equal(interpretarFirma({ error: { message: "timeout of 60000ms exceeded" } }).tipo_error, "red");
  assert.equal(interpretarFirma({ statusCode: 200, body: { candidates: [] } }).tipo_error, "otro");
});

test("se corta la corrida solo si fallaron por cuota, saturacion o red", () => {
  assert.equal(cortarCorrida({ firma: "error", tipo_error: "cuota" }), true);
  assert.equal(cortarCorrida({ firma: "error", tipo_error: "sobrecarga" }), true);
  assert.equal(cortarCorrida({ firma: "error", tipo_error: "red" }), true);
  assert.equal(cortarCorrida({ firma: "error", tipo_error: "otro" }), false, "un json raro es de ese remito, no del servicio");
  assert.equal(cortarCorrida({ firma: "si", confianza: 0.98 }), false);
});

test("el pedido a Gemini lleva la imagen y el esquema", () => {
  const c = cuerpoGemini("QUJD", "low");
  assert.equal(c.contents[0].parts[1].inlineData.data, "QUJD");
  assert.deepEqual(c.generationConfig.responseSchema.required, ["firmado", "confianza", "observacion"]);
  assert.equal(c.generationConfig.thinkingConfig.thinkingLevel, "low");
});

test("el prompt describe el ticket compacto: titulo chico, Firma y Aclaracion", () => {
  assert.match(PROMPT_FIRMA, /'COMPROBANTE CTA\. CTE\.'/);
  assert.match(PROMPT_FIRMA, /'Firma' y 'Aclaración'/);
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
  ...identificadaR(hoja, n, hash), pieza, ubicacion: `${hoja}.${pieza}`, modo: "cartulina",
});

test("cartulina: cada ticket de la hoja se archiva por separado, con su ubicacion", () => {
  const r = planDb(
    worker([ticket(1, 1, 1, "a"), ticket(1, 2, 2, "b"), ticket(1, 3, 3, "c")], "lotehash123456", 1),
    planificacion([remito(1), remito(2), remito(3)])
  );
  assert.deepEqual(r.piezas.map((p) => [p.pagina, p.accion, p.archivo_nombre]), [
    ["1.1", "archivar", "R-000001.pdf"],
    ["1.2", "archivar", "R-000002.pdf"],
    ["1.3", "archivar", "R-000003.pdf"],
  ]);
  assert.deepEqual(r.resumen, { paginas: 1, archivadas: 3, revisar: 0, saltadas: 0 });
});

test("cartulina: un ticket ilegible va a revision con la hoja y el lugar en el nombre", () => {
  const ilegible = { ...aRevisar(2, "codigo_ilegible", "z"), pieza: 3, ubicacion: "2.3", modo: "cartulina" };
  const r = planDb(worker([ilegible], "lotehash123456", 2), planificacion([]));
  assert.equal(r.piezas[0].pagina, "2.3");
  assert.match(r.piezas[0].archivo_nombre, /_hoja002-3_codigo_ilegible\.pdf$/);
});

test("lote duplicado: las saltadas cuentan piezas, no hojas", () => {
  const lotes = [{ hash_archivo: "lotehash123456", estado: "procesado" }];
  const r = planDb(worker([ticket(1, 1, 1, "a"), ticket(1, 2, 2, "b")], "lotehash123456", 1), planificacion([]), { lotes });
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

// --- Evaluacion de firmas ---

import { cuerpoGeminiArchivo } from "../n8n/logica.mjs";

test("el pedido a Gemini con el PDF archivado usa el mismo prompt", () => {
  const c = cuerpoGeminiArchivo("UERG", "application/pdf", "low");
  assert.equal(c.contents[0].parts[1].inlineData.mimeType, "application/pdf");
  assert.equal(c.contents[0].parts[1].inlineData.data, "UERG");
  assert.equal(c.contents[0].parts[0].text, cuerpoGemini("x", "low").contents[0].parts[0].text);
});
