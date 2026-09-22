// Compara un workflow bajado de n8n (la salida de get_workflow del MCP, o un JSON
// exportado) contra el que arma construir.mjs. Sirve para confirmar que una
// importacion hecha a mano quedo exactamente igual al build.
//
//   node herramientas/comparar-workflow.mjs <desplegado.txt|json> <salida/n8n/build.json>
//
// Ignora ids y posiciones de nodos, CRLF contra LF, y los valores por defecto que
// n8n borra al guardar (GET, runOnceForAllItems, batchSize 1, mode once).
import { readFileSync } from "node:fs";

const [rutaDesplegado, rutaBuild] = process.argv.slice(2);
if (!rutaDesplegado || !rutaBuild) {
  console.error("Uso: node herramientas/comparar-workflow.mjs <desplegado> <build.json>");
  process.exit(2);
}
const leer = (ruta) => {
  const t = readFileSync(ruta, "utf8");
  return JSON.parse(t.slice(t.indexOf("{")));
};
const desplegado = leer(rutaDesplegado);
const build = leer(rutaBuild);

const PREDETERMINADOS = [
  ["method", "GET"],
  ["mode", "runOnceForAllItems"],
  ["batchSize", 1],
  ["mode", "once"],
  ["minutesInterval", 5],
];

function normalizar(v) {
  if (typeof v === "string") return v.replace(/\r\n/g, "\n");
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (PREDETERMINADOS.some(([pk, pv]) => pk === k && pv === x)) continue;
      if (x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0) continue;
      o[k] = normalizar(x);
    }
    return o;
  }
  return v;
}

const nodos = (wf) =>
  new Map(
    wf.nodes.map((n) => {
      const { id, position, webhookId, ...resto } = n;
      return [n.name, normalizar(resto)];
    })
  );

const a = nodos(desplegado);
const b = nodos(build);
let diferencias = 0;
for (const nombre of new Set([...a.keys(), ...b.keys()])) {
  if (!a.has(nombre)) { console.log(`SOLO EN EL BUILD: ${nombre}`); diferencias++; continue; }
  if (!b.has(nombre)) { console.log(`SOLO DESPLEGADO: ${nombre}`); diferencias++; continue; }
  const sa = JSON.stringify(a.get(nombre));
  const sb = JSON.stringify(b.get(nombre));
  if (sa !== sb) {
    diferencias++;
    let i = 0;
    while (i < sa.length && sa[i] === sb[i]) i++;
    console.log(`DISTINTO: ${nombre}\n  desplegado: ...${sa.slice(Math.max(0, i - 80), i + 120)}\n  build:      ...${sb.slice(Math.max(0, i - 80), i + 120)}`);
  }
}
if (JSON.stringify(normalizar(desplegado.connections)) !== JSON.stringify(normalizar(build.connections))) {
  console.log("CONEXIONES DISTINTAS");
  diferencias++;
}
console.log(`\n${a.size} nodos desplegados, ${b.size} en el build, ${diferencias} diferencia(s).`);
if (desplegado.settings) {
  const s = desplegado.settings;
  console.log(`settings: executionOrder=${s.executionOrder} errorWorkflow=${s.errorWorkflow ?? "(ninguno)"} active=${desplegado.active} archivado=${desplegado.isArchived}`);
}
process.exit(diferencias ? 1 : 0);
