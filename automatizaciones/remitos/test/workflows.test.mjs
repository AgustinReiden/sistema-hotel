// Los workflows armados tienen que ser coherentes antes de subirlos a n8n:
// conexiones a nodos que existen, referencias $('Nodo') validas, codigo que compila.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
let workflows;

before(() => {
  const dir = mkdtempSync(join(tmpdir(), "remitos-wf-"));
  execFileSync(process.execPath, ["n8n/construir.mjs", "--salida", dir, "--config", join(dir, "no-existe.json")], {
    cwd: RAIZ, stdio: "pipe",
  });
  workflows = readdirSync(dir).map((f) => ({ archivo: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
});

test("se arman los siete workflows", () => {
  assert.deepEqual(workflows.map((w) => w.name).sort(), [
    "Remitos - Asegurar carpeta", "Remitos - Config", "Remitos - Errores", "Remitos - Evaluar firmas", "Remitos - Ingesta", "Remitos - Instalación", "Remitos - Vigilancia",
  ]);
});

test("nombres de nodo unicos y conexiones a nodos que existen", () => {
  for (const wf of workflows) {
    const nombres = new Set(wf.nodes.map((n) => n.name));
    assert.equal(nombres.size, wf.nodes.length, `${wf.name}: nombres repetidos`);
    for (const [origen, c] of Object.entries(wf.connections)) {
      assert.ok(nombres.has(origen), `${wf.name}: origen ${origen}`);
      for (const salida of c.main) for (const d of salida) assert.ok(nombres.has(d.node), `${wf.name}: destino ${d.node}`);
    }
  }
});

test("todo nodo que no es disparador tiene una entrada", () => {
  for (const wf of workflows) {
    const destinos = new Set(Object.values(wf.connections).flatMap((c) => c.main.flat().map((d) => d.node)));
    const huerfanos = wf.nodes.filter((n) => !/trigger/i.test(n.type) && !destinos.has(n.name)).map((n) => n.name);
    assert.deepEqual(huerfanos, [], wf.name);
  }
});

test("toda referencia $('Nodo') apunta a un nodo del mismo workflow", () => {
  for (const wf of workflows) {
    const nombres = new Set(wf.nodes.map((n) => n.name));
    const texto = JSON.stringify(wf.nodes.map((n) => n.parameters));
    const refs = new Set([...texto.matchAll(/\$\((?:\\)?'([^'\\]+)(?:\\)?'\)/g)].map((m) => m[1]));
    for (const r of refs) assert.ok(nombres.has(r), `${wf.name}: $('${r}') no existe`);
  }
});

test("el codigo de cada nodo Code compila", () => {
  for (const wf of workflows) {
    for (const n of wf.nodes.filter((n) => n.type === "n8n-nodes-base.code")) {
      // n8n corre el codigo de un nodo Code dentro de una funcion async (admite await).
      const AsyncFunction = (async () => {}).constructor;
      assert.doesNotThrow(() => new AsyncFunction("$input", "$", "$json", "$now", n.parameters.jsCode), `${wf.name} / ${n.name}`);
      // Mismo build en Windows y en Linux: sin CRLF de un checkout de Windows.
      assert.ok(!n.parameters.jsCode.includes("\r"), `${wf.name} / ${n.name}: tiene \\r`);
    }
  }
});

test("la ingesta: el lote se cierra al terminar el loop, y no depende de Gemini", () => {
  const ing = workflows.find((w) => w.name === "Remitos - Ingesta");
  const loop = ing.connections["Una página por vez"].main;
  assert.equal(loop[0][0].node, "Cierre", "la salida 'done' cierra el lote");
  assert.equal(loop[1][0].node, "¿Es página?");
  assert.equal(ing.nodes.find((n) => n.name === "Worker").onError, "continueErrorOutput");
  // La firma la evalua otro workflow: la ingesta nunca espera a Gemini.
  assert.doesNotMatch(JSON.stringify(ing.nodes), /generativelanguage|interpretarFirma|cuerpoGemini\(/);
  // La pieza se sube sin firma: la firma la guarda Evaluar firmas en la base.
  const subida = ing.nodes.find((n) => n.name === "Preparar subida").parameters.jsCode;
  assert.doesNotMatch(subida, /firma/);
});

test("ingesta, errores y vigilancia toman la config del sub-workflow, no de ids fijos", () => {
  for (const nombre of ["Remitos - Ingesta", "Remitos - Errores", "Remitos - Vigilancia", "Remitos - Evaluar firmas"]) {
    const wf = workflows.find((w) => w.name === nombre);
    const cfg = wf.nodes.find((n) => n.name === "Config");
    assert.equal(cfg.type, "n8n-nodes-base.executeWorkflow", nombre);
  }
  const texto = JSON.stringify(workflows.filter((w) => w.name !== "Remitos - Instalación"));
  assert.doesNotMatch(texto, /"(raiz|entrada|revisar|procesados|planilla)_id":\s*"[^"]/, "no quedan ids fijos");
});

const evaluar = () => workflows.find((w) => w.name === "Remitos - Evaluar firmas");
const destino = (wf, origen, salida = 0) => (wf.connections[origen]?.main[salida] ?? []).map((d) => d.node);

test("evaluar firmas: la base elige las pendientes y guarda cada firma, de a una por vuelta", () => {
  const wf = evaluar();
  assert.deepEqual(destino(wf, "Config"), ["Latido (base)"]);
  assert.deepEqual(destino(wf, "Latido (base)"), ["Pendientes (base)"]);
  assert.deepEqual(destino(wf, "Pendientes (base)"), ["Elegir pendientes"]);
  assert.deepEqual(destino(wf, "Elegir pendientes"), ["Una por vez"]);
  assert.deepEqual(destino(wf, "Una por vez", 0), [], "la salida 'termine' no hace nada");
  assert.deepEqual(destino(wf, "Una por vez", 1), ["Descargar PDF"]);
  assert.equal(wf.nodes.find((n) => n.name === "Una por vez").parameters.batchSize, 1);
  assert.deepEqual(destino(wf, "¿Anduvo?", 0), ["Guardar firma (principal)"]);
  assert.deepEqual(destino(wf, "¿Anduvo?", 1), ["Gemini respaldo"]);
  assert.deepEqual(destino(wf, "Interpretar respaldo"), ["Guardar firma (respaldo)"]);
  assert.deepEqual(destino(wf, "Descargar PDF", 1), ["Sin archivo"], "si no hay PDF, cuenta el intento");
  assert.deepEqual(destino(wf, "Sin archivo"), ["Guardar firma (sin archivo)"]);
  // Vuelve al bucle con una pausa; si fallaron los dos modelos por cuota o saturacion, corta.
  assert.deepEqual(destino(wf, "Guardar firma (principal)"), ["Pausa"]);
  assert.deepEqual(destino(wf, "Guardar firma (sin archivo)"), ["Pausa"]);
  assert.deepEqual(destino(wf, "Guardar firma (respaldo)"), ["¿Seguir?"]);
  assert.deepEqual(destino(wf, "¿Seguir?", 0), ["Pausa"]);
  assert.deepEqual(destino(wf, "¿Seguir?", 1), []);
  assert.deepEqual(destino(wf, "Pausa"), ["Una por vez"]);
  assert.doesNotMatch(JSON.stringify(wf.nodes), /values\/Resultados/);
});

test("base: toda llamada a Supabase lleva la clave por credencial y la anon key por encabezado", () => {
  let llamadas = 0;
  for (const wf of workflows) {
    for (const n of wf.nodes.filter((x) => String(x.parameters?.url ?? "").includes("/rest/v1/rpc/"))) {
      llamadas++;
      assert.equal(n.parameters.genericAuthType, "httpHeaderAuth", `${wf.name} / ${n.name}`);
      const headers = (n.parameters.headerParameters?.parameters ?? []).map((h) => h.name);
      assert.deepEqual(headers.sort(), ["Authorization", "apikey"], `${wf.name} / ${n.name}`);
    }
  }
  assert.ok(llamadas >= 7, `se esperaban las llamadas a la base de la ingesta y de evaluar firmas (${llamadas})`);
  // La clave nunca viaja en un workflow: vive en la credencial de n8n.
  assert.doesNotMatch(JSON.stringify(workflows), /x-remitos-clave/);
});

test("ingesta: pregunta a la base y registra cada pieza; ya no usa Comprobantes ni Resultados", () => {
  const ing = workflows.find((w) => w.name === "Remitos - Ingesta");
  const texto = JSON.stringify(ing.nodes);
  assert.doesNotMatch(texto, /values\/Comprobantes|values\/Resultados|Resultados!A1:append/);
  assert.deepEqual(destino(ing, "Latido"), ["Latido (base)"]);
  assert.deepEqual(destino(ing, "Latido (base)"), ["Listar _Entrada"]);
  assert.deepEqual(destino(ing, "¿Worker OK?", 0), ["Leer Lotes"]);
  assert.deepEqual(destino(ing, "Leer Lotes"), ["Pedido a la base"]);
  assert.deepEqual(destino(ing, "Pedido a la base"), ["Planificar (base)"]);
  assert.deepEqual(destino(ing, "Planificar (base)"), ["Planificar"]);
  assert.deepEqual(destino(ing, "Subir contenido"), ["Armar registro"]);
  assert.deepEqual(destino(ing, "Armar registro"), ["Registrar (base)"]);
  assert.deepEqual(destino(ing, "Registrar (base)"), ["Una página por vez"]);
  assert.match(texto, /rpc_remitos_latido/);
});

test("la instalacion crea solo las pestañas de la bitacora", () => {
  const inst = workflows.find((w) => w.name === "Remitos - Instalación");
  const texto = JSON.stringify(inst.nodes);
  assert.doesNotMatch(texto, /Comprobantes|Resultados/);
  for (const p of ["Lotes", "Errores", "Estado"]) assert.match(texto, new RegExp(p));
});

test("evaluar firmas: Gemini devuelve el error real (codigo y mensaje) y no reintenta a ciegas", () => {
  const wf = evaluar();
  for (const n of ["Gemini", "Gemini respaldo"]) {
    const g = wf.nodes.find((x) => x.name === n);
    assert.equal(g.onError, "continueRegularOutput", n);
    assert.equal(g.retryOnFail, undefined, `${n}: sin reintentos automaticos`);
    assert.deepEqual(g.parameters.options.response.response, { fullResponse: true, neverError: true }, n);
  }
});

test("evaluar firmas: adentro del bucle cada nodo lee el remito de su vuelta, nunca la de otra", () => {
  // Nodos del bucle: todo lo que se alcanza desde la salida 1 de "Una por vez".
  const wf = evaluar();
  const enBucle = new Set();
  const pendientes = destino(wf, "Una por vez", 1);
  while (pendientes.length) {
    const n = pendientes.pop();
    if (n === "Una por vez" || enBucle.has(n)) continue;
    enBucle.add(n);
    for (const salida of wf.connections[n]?.main ?? []) pendientes.push(...salida.map((d) => d.node));
  }
  assert.ok(enBucle.has("Interpretar respaldo") && enBucle.has("Pausa"));
  const prohibidos = [...enBucle, "Una por vez"];
  for (const n of wf.nodes.filter((x) => enBucle.has(x.name))) {
    const texto = JSON.stringify(n.parameters);
    assert.doesNotMatch(texto, /\.isExecuted/, `${n.name}: .isExecuted mira cualquier vuelta`);
    for (const otro of prohibidos) {
      const ref = `$('${otro}').first()`;
      assert.ok(!texto.includes(ref), `${n.name} usa ${ref}`);
    }
  }
});

test("errores: solo libera el turno de la ingesta si la que se cayo es la ingesta", () => {
  const wf = workflows.find((w) => w.name === "Remitos - Errores");
  assert.deepEqual(destino(wf, "Anotar error"), ["¿Era la ingesta?"]);
  assert.deepEqual(destino(wf, "¿Era la ingesta?", 0), ["Liberar turno"]);
  assert.deepEqual(destino(wf, "¿Era la ingesta?", 1), []);
  const cond = wf.nodes.find((n) => n.name === "¿Era la ingesta?").parameters.conditions.conditions[0];
  assert.equal(cond.rightValue, workflows.find((w) => w.name === "Remitos - Ingesta").name);
});

test("la ingesta no mira firmas y evaluar firmas no toca la ingesta", () => {
  const ing = workflows.find((w) => w.name === "Remitos - Ingesta");
  const paginas = ing.nodes.find((n) => n.name === "Páginas").parameters.jsCode;
  assert.doesNotMatch(paginas, /cuerpoGemini|gemini_body/);
  assert.doesNotMatch(JSON.stringify(evaluar().nodes), /appendA|:append/, "evaluar solo actualiza filas existentes");
});
