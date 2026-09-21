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
    "Remitos - Asegurar carpeta", "Remitos - Config", "Remitos - Errores", "Remitos - Ingesta", "Remitos - Instalación", "Remitos - Reintentar firmas", "Remitos - Vigilancia",
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
    }
  }
});

test("la ingesta: el lote se cierra al terminar el loop, y un error de Gemini no frena", () => {
  const ing = workflows.find((w) => w.name === "Remitos - Ingesta");
  const loop = ing.connections["Una página por vez"].main;
  assert.equal(loop[0][0].node, "Cierre", "la salida 'done' cierra el lote");
  assert.equal(loop[1][0].node, "¿Es página?");
  const gemini = ing.nodes.find((n) => n.name === "Gemini");
  assert.equal(gemini.onError, "continueRegularOutput");
  assert.equal(ing.nodes.find((n) => n.name === "Worker").onError, "continueErrorOutput");
});

test("ingesta, errores y vigilancia toman la config del sub-workflow, no de ids fijos", () => {
  for (const nombre of ["Remitos - Ingesta", "Remitos - Errores", "Remitos - Vigilancia", "Remitos - Reintentar firmas"]) {
    const wf = workflows.find((w) => w.name === nombre);
    const cfg = wf.nodes.find((n) => n.name === "Config");
    assert.equal(cfg.type, "n8n-nodes-base.executeWorkflow", nombre);
  }
  const texto = JSON.stringify(workflows.filter((w) => w.name !== "Remitos - Instalación"));
  assert.doesNotMatch(texto, /"(raiz|entrada|revisar|procesados|planilla)_id":\s*"[^"]/, "no quedan ids fijos");
});

test("reintentar firmas: prueba el respaldo solo si el principal fallo, y verifica la fila antes de escribir", () => {
  const wf = workflows.find((w) => w.name === "Remitos - Reintentar firmas");
  const c = wf.connections;
  assert.equal(c["¿Anduvo?"].main[0][0].node, "Leer fila");
  assert.equal(c["¿Anduvo?"].main[1][0].node, "Gemini respaldo");
  assert.equal(c["Descargar PDF"].main[1][0].node, "Sin archivo", "si no hay PDF, cuenta el intento");
  assert.equal(c["Leer fila"].main[0][0].node, "Armar actualización");
  const armar = wf.nodes.find((n) => n.name === "Armar actualización").parameters.jsCode;
  assert.match(armar, /mismaFila\(/);
  for (const n of ["Gemini", "Gemini respaldo"]) assert.equal(wf.nodes.find((x) => x.name === n).onError, "continueRegularOutput");
});

test("la ingesta no cambio por el reintento de firmas (no hace falta reimportarla)", () => {
  const ing = workflows.find((w) => w.name === "Remitos - Ingesta");
  const paginas = ing.nodes.find((n) => n.name === "Páginas").parameters.jsCode;
  assert.doesNotMatch(paginas, /cuerpoGeminiArchivo|elegirFirmaPendiente/);
});
