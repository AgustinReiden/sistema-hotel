// Arma los workflows de n8n de la ingesta de remitos.
//
//   node n8n/construir.mjs [--config n8n/config.local.json] [--asegurar-id <id>] [--salida dir]
//
// Escribe salida/n8n/*.json (fuera de git: llevan ids de Drive y, la instalacion,
// los comprobantes de prueba). Se suben a n8n con la herramienta MCP de n8n.
//
// Todas las llamadas a Google van por la API REST desde nodos HTTP, con UNA
// credencial "Google Drive OAuth2" (su alcance "drive" tambien habilita la API de
// Sheets). La logica de negocio vive en n8n/logica.mjs y se incrusta en los
// nodos Code, asi lo que se testea es exactamente lo que corre.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COLUMNAS, letraColumna } from "./logica.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const args = process.argv.slice(2);
const opcion = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

// --- Configuracion --------------------------------------------------------------

// Ajustes fijos. Los ids de carpetas y planilla NO van aca: el sub-workflow
// "Remitos - Config" los busca por nombre en cada corrida (sobrevive a reinstalar).
const CONFIG_BASE = {
  worker_url: "http://remitos-worker:8787",
  modelo: "gemini-3.8-flash",
  // Si el principal no responde al evaluar una firma, se prueba este.
  modelo_respaldo: "gemini-3.5-flash",
  // Intentos por firma antes de dejarla en "error" para que la mire una persona.
  max_reintentos_firma: 5,
  // "Evaluar firmas": cuantas mira por corrida (cada 5 min) y la pausa entre una y otra.
  firmas_por_corrida: 5,
  segundos_entre_firmas: 3,
  razonamiento: "low",
  unidad: "Hotel",
  minutos_bloqueo: 30,
  horas_sin_correr: 1,
  horas_en_entrada: 2,
  horas_entre_alertas: 6,
  aviso_webhook: "http://localhost:5678/webhook/hotel-reserva-notificacion",
  aviso_numero: "",
};

const rutaConfig = opcion("--config", join(AQUI, "config.local.json"));
const local = existsSync(rutaConfig) ? JSON.parse(await readFile(rutaConfig, "utf8")) : {};
const CONFIG = { ...CONFIG_BASE, ...(local.config ?? {}) };
// { google: {id, name}, gemini: {id, name}, worker: {id, name} }
const CREDENCIALES = local.credenciales ?? {};
const ID_ASEGURAR = opcion("--asegurar-id", local.asegurar_carpeta_id ?? "COMPLETAR_ID_SUBWORKFLOW");
const ID_ERRORES = local.errores_id ?? null;
const ID_CONFIG = opcion("--config-id", local.config_id ?? "COMPLETAR_ID_CONFIG");

// La logica partida en bloques de nivel superior (const/function). Cada nodo Code
// lleva solo los bloques que menciona, mas sus dependencias.
// Saltos de linea normalizados: un checkout de Windows (CRLF) tiene que armar
// exactamente los mismos workflows que uno de Linux.
const FUENTE = (await readFile(join(AQUI, "logica.mjs"), "utf8"))
  .replace(/\r\n/g, "\n")
  .replace(/^export \{[\s\S]*?\};\s*$/m, "");
const BLOQUES = (() => {
  // Cada bloque arranca en su declaracion o en el comentario pegado arriba de ella.
  const lineas = FUENTE.split("\n");
  const inicios = [];
  lineas.forEach((l, i) => {
    const m = /^(?:const|function) (\w+)/.exec(l);
    if (!m) return;
    let desde = i;
    while (desde > 0 && /^\s*(\/\/|\/\*\*|\*|\*\/)/.test(lineas[desde - 1])) desde--;
    inicios.push({ nombre: m[1], desde });
  });
  // Un encabezado de seccion ("// --- Firma ---" y su parrafo) separado por una
  // linea en blanco de lo que sigue no es de ningun bloque: si quedara al final
  // del bloque anterior, apareceria en nodos que no tienen nada que ver.
  const sinEncabezadoFinal = (ls) => {
    let fin = ls.length;
    for (;;) {
      while (fin > 0 && ls[fin - 1].trim() === "") fin--;
      let ini = fin;
      while (ini > 0 && /^\s*\/\//.test(ls[ini - 1])) ini--;
      if (ini === fin || ini === 0 || ls[ini - 1].trim() !== "") return ls.slice(0, fin);
      fin = ini;
    }
  };
  const b = new Map();
  inicios.forEach((ini, k) => {
    const hasta = inicios[k + 1]?.desde ?? lineas.length;
    b.set(ini.nombre, sinEncabezadoFinal(lineas.slice(ini.desde, hasta)).join("\n").trim());
  });
  return b;
})();

function logicaPara(texto) {
  const incluidos = new Set();
  const visitar = (t) => {
    for (const nombre of BLOQUES.keys()) {
      if (!incluidos.has(nombre) && new RegExp(`\\b${nombre}\\b`).test(t)) {
        incluidos.add(nombre);
        visitar(BLOQUES.get(nombre));
      }
    }
  };
  visitar(texto);
  // En el orden del archivo, para que las const esten definidas antes de usarse.
  return [...BLOQUES.keys()].filter((n) => incluidos.has(n)).map((n) => BLOQUES.get(n)).join("\n\n");
}

// --- Constructores de nodos ---------------------------------------------------

let contador = 0;
const uid = () => `n${String(++contador).padStart(3, "0")}`;

function nodo(name, type, typeVersion, parameters, pos, extra = {}) {
  return { id: uid(), name, type, typeVersion, position: pos, parameters, ...extra };
}

function codigo(name, cuerpo, pos, { cadaItem = false, conLogica = true, ...extra } = {}) {
  const logica = conLogica ? logicaPara(cuerpo) : "";
  const jsCode = (logica ? `// ---- logica (de n8n/logica.mjs, no editar aca) ----\n${logica}\n\n// ---- nodo ----\n` : "") + cuerpo.trim() + "\n";
  return nodo(
    name, "n8n-nodes-base.code", 2,
    { mode: cadaItem ? "runOnceForEachItem" : "runOnceForAllItems", jsCode },
    pos, extra
  );
}

function credencial(tipo) {
  if (tipo === "google") {
    const c = CREDENCIALES.google;
    return c ? { googleDriveOAuth2Api: c } : undefined;
  }
  const c = CREDENCIALES[tipo];
  return c ? { httpHeaderAuth: c } : undefined;
}

/**
 * Nodo HTTP.
 * auth: "google" | "gemini" | "worker"
 */
function http(name, pos, { method = "GET", url, query, json, binario, auth, archivo, completa, timeout, ...extra }) {
  const p = { method, url, options: {} };
  if (auth === "google") {
    p.authentication = "predefinedCredentialType";
    p.nodeCredentialType = "googleDriveOAuth2Api";
  } else if (auth) {
    p.authentication = "genericCredentialType";
    p.genericAuthType = "httpHeaderAuth";
  }
  if (query) {
    p.sendQuery = true;
    p.queryParameters = { parameters: Object.entries(query).map(([name, value]) => ({ name, value })) };
  }
  if (json) {
    p.sendBody = true;
    p.specifyBody = "json";
    p.jsonBody = json;
  }
  if (binario) {
    p.sendBody = true;
    p.contentType = "binaryData";
    p.inputDataFieldName = "data";
  }
  if (archivo || completa) {
    p.options.response = { response: {} };
    if (archivo) p.options.response.response.responseFormat = "file";
    if (completa) Object.assign(p.options.response.response, { fullResponse: true, neverError: true });
  }
  if (timeout) p.options.timeout = timeout;
  const creds = credencial(auth);
  return nodo(name, "n8n-nodes-base.httpRequest", 4.2, p, pos, { ...(creds ? { credentials: creds } : {}), ...extra });
}

function si(name, pos, izquierda, operador, derecha) {
  const condicion = { id: uid(), leftValue: izquierda, rightValue: derecha ?? "", operator: operador };
  return nodo(name, "n8n-nodes-base.if", 2, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
      conditions: [condicion],
      combinator: "and",
    },
    options: {},
  }, pos);
}

const OP = {
  verdadero: { type: "boolean", operation: "true", singleValue: true },
  falso: { type: "boolean", operation: "false", singleValue: true },
  igual: { type: "string", operation: "equals" },
  distinto: { type: "string", operation: "notEquals" },
  noVacio: { type: "string", operation: "notEmpty", singleValue: true },
  vacio: { type: "string", operation: "empty", singleValue: true },
};

// El nodo "Config" de cada workflow llama al sub-workflow "Remitos - Config". Se
// llama igual que antes, asi todas las referencias $('Config') siguen valiendo.
function configNodo(pos) {
  return nodo("Config", "n8n-nodes-base.executeWorkflow", 1.2, {
    workflowId: { __rl: true, value: ID_CONFIG, mode: "id" },
    mode: "once",
    options: { waitForSubWorkflow: true },
  }, pos);
}

// ================================================================================
// 0) Sub-workflow: configuracion. Ajustes fijos + ids buscados por nombre.
// ================================================================================

function wfConfig() {
  contador = 0;
  const cuerpoAjustes = `
// Ajustes de la ingesta de remitos. Los ids de carpetas y planilla se buscan por
// nombre en los nodos siguientes: no hace falta tocarlos al reinstalar.
return [{ json: ${JSON.stringify(CONFIG, null, 2)} }];`;
  return {
    name: "Remitos - Config",
    nodes: [
      nodo("Entrada", "n8n-nodes-base.executeWorkflowTrigger", 1.1, { inputSource: "passthrough" }, [x(0), 300]),
      codigo("Ajustes", cuerpoAjustes, [x(1), 300], { conLogica: false }),
      http("Buscar Remitos", [x(2), 300], {
        url: `=${DRIVE}`, auth: "google",
        query: { q: "name='Remitos' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", fields: "files(id,name)" },
      }),
      http("Contenido", [x(3), 300], {
        url: `=${DRIVE}`, auth: "google",
        query: {
          q: `={{ "'" + ((($json.files || [])[0] || {}).id || 'sin-carpeta-remitos') + "' in parents and trashed=false" }}`,
          fields: "files(id,name,mimeType)", pageSize: "200",
        },
      }),
      codigo("Config lista", `
return [{ json: armarConfig($('Ajustes').first().json, $('Buscar Remitos').first().json.files || [], $input.first().json.files || []) }];`, [x(4), 300]),
    ],
    connections: conexiones([
      ["Entrada", "Ajustes"],
      ["Ajustes", "Buscar Remitos"],
      ["Buscar Remitos", "Contenido"],
      ["Contenido", "Config lista"],
    ]),
  };
}

// Conexiones: [origen, destino] o [origen, destino, salida]
function conexiones(lista) {
  const c = {};
  for (const [origen, destino, salida = 0] of lista) {
    c[origen] ??= { main: [] };
    while (c[origen].main.length <= salida) c[origen].main.push([]);
    c[origen].main[salida].push({ node: destino, type: "main", index: 0 });
  }
  return c;
}

// Expresiones reutilizadas
const CFG = (campo) => `$('Config').first().json.${campo}`;
const SHEETS = `https://sheets.googleapis.com/v4/spreadsheets/{{ ${CFG("planilla_id")} }}`;
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const appendA = (pestana) => ({
  method: "POST",
  url: `=${SHEETS}/values/${pestana}!A1:append`,
  query: { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" },
  auth: "google",
});
const leerPestana = (pestana) => ({ url: `=${SHEETS}/values/${pestana}`, auth: "google" });
const estado = (fila, clave, valorExpr) => ({
  method: "PUT",
  url: `=${SHEETS}/values/Estado!A${fila}:B${fila}`,
  query: { valueInputOption: "RAW" },
  json: `={{ JSON.stringify({ values: [["${clave}", ${valorExpr}]] }) }}`,
  auth: "google",
});
const mover = (idExpr, destinoCampo) => ({
  method: "PATCH",
  url: `=${DRIVE}/{{ ${idExpr} }}`,
  query: {
    addParents: `={{ ${CFG(destinoCampo)} }}`,
    removeParents: `={{ ${CFG("entrada_id")} }}`,
    fields: "id,parents",
  },
  json: "={}",
  auth: "google",
});

const x = (col) => 200 + col * 220;

// ================================================================================
// 1) Sub-workflow: asegurar carpeta (buscar por nombre dentro de un padre; si no
//    esta, crearla). Devuelve el item que recibio + { id }.
// ================================================================================

function wfAsegurarCarpeta() {
  contador = 0;
  const qBuscar = String.raw`={{ "name='" + $json.nombre.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "' and '" + $json.padre + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false" }}`;
  const nodos = [
    nodo("Entrada", "n8n-nodes-base.executeWorkflowTrigger", 1.1, { inputSource: "passthrough" }, [x(0), 300]),
    si("¿Tiene nombre?", [x(1), 300], "={{ $json.nombre }}", OP.noVacio),
    http("Buscar carpeta", [x(2), 200], { url: `=${DRIVE}`, query: { q: qBuscar, fields: "files(id,name)", pageSize: "10" }, auth: "google" }),
    codigo("¿Existe?", `const f = ($input.first().json.files || [])[0];\nreturn [{ json: { id: f ? f.id : '' } }];`, [x(3), 200], { conLogica: false }),
    si("¿Hay que crearla?", [x(4), 200], "={{ $json.id }}", OP.vacio),
    http("Crear carpeta", [x(5), 100], {
      method: "POST", url: `=${DRIVE}`, query: { fields: "id" }, auth: "google",
      json: "={{ JSON.stringify({ name: $('Entrada').first().json.nombre, mimeType: 'application/vnd.google-apps.folder', parents: [$('Entrada').first().json.padre] }) }}",
    }),
    codigo("Devolver", `
const e = $('Entrada').first().json;
// Sin nombre (ruta vacia) no hay carpeta: id null, no el id que traia el item.
return [{ json: { ...e, id: e.nombre ? ($input.first().json.id || null) : null } }];`, [x(6), 300], { conLogica: false }),
  ];
  return {
    name: "Remitos - Asegurar carpeta",
    nodes: nodos,
    connections: conexiones([
      ["Entrada", "¿Tiene nombre?"],
      ["¿Tiene nombre?", "Buscar carpeta", 0],
      ["¿Tiene nombre?", "Devolver", 1],
      ["Buscar carpeta", "¿Existe?"],
      ["¿Existe?", "¿Hay que crearla?"],
      ["¿Hay que crearla?", "Crear carpeta", 0],
      ["¿Hay que crearla?", "Devolver", 1],
      ["Crear carpeta", "Devolver"],
    ]),
  };
}

// ================================================================================
// 2) Ingesta
// ================================================================================

function llamarAsegurar(name, pos) {
  return nodo(name, "n8n-nodes-base.executeWorkflow", 1.2, {
    workflowId: { __rl: true, value: ID_ASEGURAR, mode: "id" },
    mode: "each",
    options: { waitForSubWorkflow: true },
  }, pos);
}

function wfIngesta() {
  contador = 0;
  const F = 300; // fila principal
  const nodos = [
    nodo("Cada 5 minutos", "n8n-nodes-base.scheduleTrigger", 1.2,
      { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } }, [x(0), F]),
    configNodo([x(1), F]),
    http("Latido", [x(2), F], { ...estado(2, "ultima_corrida", "$now.toISO()"), executeOnce: true }),
    http("Listar _Entrada", [x(3), F], {
      url: `=${DRIVE}`, auth: "google", executeOnce: true,
      query: {
        q: `={{ "'" + ${CFG("entrada_id")} + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'" }}`,
        orderBy: "createdTime", pageSize: "1", fields: "files(id,name,mimeType,createdTime,size)",
      },
    }),
    codigo("Tomar archivo", `
// Un archivo por corrida, el mas viejo. Si no hay nada, la corrida termina aca.
const f = ($input.first().json.files || [])[0];
if (!f) return [];
const deGoogle = String(f.mimeType || '').startsWith('application/vnd.google-apps.');
return [{ json: {
  ...f,
  rechazar: deGoogle,
  tipo_rechazo: deGoogle ? 'archivo_de_google' : '',
  detalle_rechazo: deGoogle ? 'Es un documento de Google (' + f.mimeType + '), no un escaneo. Subir PDF o imagen.' : '',
} }];`, [x(4), F], { conLogica: false }),
    http("Leer Estado", [x(5), F], leerPestana("Estado")),
    codigo("¿Turno libre?", `
// Evita que dos corridas procesen a la vez (un lote largo puede pasar los 5 minutos).
// Un turno tomado hace mas de 'minutos_bloqueo' se considera abandonado (corrida caida).
const cfg = $('Config').first().json;
const est = Object.fromEntries(filasAObjetos($input.first().json.values).map(r => [r.clave, r.valor]));
const desde = Date.parse(est.en_proceso || '');
if (Number.isFinite(desde) && Date.now() - desde < cfg.minutos_bloqueo * 60000) return [];
return [{ json: $('Tomar archivo').first().json }];`, [x(6), F]),
    http("Tomar turno", [x(7), F], estado(5, "en_proceso", "$now.toISO()")),
    si("¿Se puede procesar?", [x(8), F], "={{ $('Tomar archivo').first().json.rechazar }}", OP.falso),
    http("Descargar", [x(9), F], {
      url: `=${DRIVE}/{{ $('Tomar archivo').first().json.id }}`, query: { alt: "media" }, archivo: true, auth: "google",
    }),
    http("Worker", [x(10), F], {
      method: "POST", url: `={{ ${CFG("worker_url")} }}/procesar`, binario: true, auth: "worker",
      completa: true, timeout: 300000, onError: "continueErrorOutput",
    }),
    codigo("Evaluar worker", `return [{ json: evaluarRespuestaWorker($input.first().json) }];`, [x(11), F]),
    si("¿Worker OK?", [x(12), F], "={{ $json.decision }}", OP.igual, "ok"),
    http("Leer Comprobantes", [x(13), F], { ...leerPestana("Comprobantes"), executeOnce: true }),
    http("Leer Resultados", [x(14), F], { ...leerPestana("Resultados"), executeOnce: true }),
    http("Leer Lotes", [x(15), F], { ...leerPestana("Lotes"), executeOnce: true }),
    codigo("Planificar", `
const cfg = $('Config').first().json;
const archivo = $('Tomar archivo').first().json;
const worker = $('Worker').first().json.body;
const plan = planificarLote({
  archivo,
  worker,
  comprobantes: filasAObjetos($('Leer Comprobantes').first().json.values),
  resultados: filasAObjetos($('Leer Resultados').first().json.values),
  lotes: filasAObjetos($('Leer Lotes').first().json.values),
  unidad: cfg.unidad,
  ahora: new Date().toISOString(),
});
return [{ json: { ...plan, archivo: { id: archivo.id, name: archivo.name }, hash_archivo: worker.hash_archivo } }];`, [x(16), F]),
    codigo("Rutas", `
const cfg = $('Config').first().json;
const plan = $input.first().json;
const rutas = plan.rutas.map(r => ({ ...r, padre: cfg.raiz_id, nombre: r.carpeta_cliente }));
// Siempre al menos un item: si todo va a revisar, no hay rutas pero la cadena sigue.
return (rutas.length ? rutas : [{ ruta_clave: null, padre: '', nombre: '' }]).map(json => ({ json }));`, [x(17), F], { conLogica: false }),
    llamarAsegurar("Carpeta cliente", [x(18), F]),
    codigo("→ unidad", `return $input.all().map(i => ({ json: { ...i.json, padre: i.json.id || '', nombre: i.json.ruta_clave ? i.json.unidad : '' } }));`, [x(19), F], { conLogica: false }),
    llamarAsegurar("Carpeta unidad", [x(20), F]),
    codigo("→ período", `return $input.all().map(i => ({ json: { ...i.json, padre: i.json.id || '', nombre: i.json.ruta_clave ? i.json.periodo : '' } }));`, [x(21), F], { conLogica: false }),
    llamarAsegurar("Carpeta período", [x(22), F]),
    codigo("Páginas", `
const cfg = $('Config').first().json;
const plan = $('Planificar').first().json;
const carpetas = Object.fromEntries($input.all().filter(i => i.json.ruta_clave).map(i => [i.json.ruta_clave, i.json.id]));
const piezas = plan.piezas.filter(p => p.accion !== 'saltear').map(p => {
  const destino_id = p.accion === 'archivar' ? carpetas[p.ruta_clave] : cfg.revisar_id;
  if (!destino_id) throw new Error('Sin carpeta destino para ' + (p.ruta_clave || p.archivo_nombre));
  // La firma no se mira aca (ver "Remitos - Evaluar firmas"): la imagen no hace falta.
  const { imagen_jpg_b64, ...resto } = p;
  return { json: { ...resto, destino_id } };
});
// Un item centinela si no hay nada que subir, para que el lote igual se cierre.
return piezas.length ? piezas : [{ json: { accion: 'nada' } }];`, [x(23), F]),
    nodo("Una página por vez", "n8n-nodes-base.splitInBatches", 3, { batchSize: 1, options: {} }, [x(24), F]),
    si("¿Es página?", [x(25), F - 150], "={{ $json.accion }}", OP.distinto, "nada"),
    codigo("Preparar subida", `
// La firma queda "pendiente": la evalua "Remitos - Evaluar firmas", aparte, para que
// una caida o una saturacion de Gemini nunca frene ni alargue el archivo.
const pag = $json;
const { pdf_pagina_b64, ...resto } = pag;
return {
  json: { ...resto, firma: firmaInicial(pag.accion) },
  binary: { data: { data: pdf_pagina_b64, mimeType: 'application/pdf', fileName: pag.archivo_nombre, fileExtension: 'pdf' } },
};`, [x(26), F - 150], { cadaItem: true }),
    http("Crear archivo", [x(27), F - 150], {
      method: "POST", url: `=${DRIVE}`, query: { fields: "id" }, auth: "google",
      json: "={{ JSON.stringify({ name: $json.archivo_nombre, parents: [$json.destino_id], mimeType: 'application/pdf', description: 'Lote ' + $json.lote_archivo + ', pieza ' + $json.pagina + ($json.motivo ? ' — ' + $json.motivo : '') }) }}",
    }),
    codigo("Recuperar PDF", `return { json: $json, binary: $('Preparar subida').item.binary };`, [x(28), F - 150], { cadaItem: true, conLogica: false }),
    http("Subir contenido", [x(29), F - 150], {
      method: "PATCH", url: "=https://www.googleapis.com/upload/drive/v3/files/{{ $json.id }}",
      query: { uploadType: "media", fields: "id,name,webViewLink" }, binario: true, auth: "google",
    }),
    codigo("Fila resultado", `
const pag = $('Preparar subida').item.json;
return { json: { values: [filaResultado(pag, pag.firma, $json, '', new Date().toISOString())] } };`, [x(30), F - 150], { cadaItem: true }),
    http("Anotar resultado", [x(31), F - 150], { ...appendA("Resultados"), json: "={{ JSON.stringify({ values: $json.values }) }}" }),
    codigo("Cierre", `
const plan = $('Planificar').first().json;
const ahora = new Date().toISOString();
const estado = plan.lote_duplicado ? 'duplicado' : 'procesado';
return [{ json: {
  archivo: plan.archivo,
  estado,
  ahora,
  values: [filaLote(plan.archivo, { hash_archivo: plan.hash_archivo }, plan.resumen, estado, ahora)],
} }];`, [x(25), F + 150], { executeOnce: true }),
    http("Mover a _Procesados", [x(26), F + 150], mover("$('Cierre').first().json.archivo.id", "procesados_id")),
    http("Anotar lote", [x(27), F + 150], { ...appendA("Lotes"), json: "={{ JSON.stringify({ values: $('Cierre').first().json.values }) }}" }),
    http("Liberar turno", [x(28), F + 150], {
      method: "POST", url: `=${SHEETS}/values:batchUpdate`, auth: "google",
      json: `={{ JSON.stringify({ valueInputOption: 'RAW', data: [
  { range: 'Estado!A3:B3', values: [['ultimo_lote', $('Cierre').first().json.ahora + ' ' + $('Cierre').first().json.archivo.name + ' (' + $('Cierre').first().json.estado + ')']] },
  { range: 'Estado!A5:B5', values: [['en_proceso', '']] }
] }) }}`,
    }),

    // --- Rechazo: el archivo nunca se va a poder procesar. Se aparta, no se reintenta.
    codigo("Preparar rechazo", `
const archivo = $('Tomar archivo').first().json;
let tipo = archivo.tipo_rechazo, detalle = archivo.detalle_rechazo;
if (!archivo.rechazar) { const ev = $('Evaluar worker').first().json; tipo = ev.tipo; detalle = ev.detalle; }
return [{ json: { values: [filaError('ingesta', archivo, tipo, detalle + ' — apartado a _Revisar', new Date().toISOString())] } }];`, [x(10), F + 350]),
    http("Apartar a _Revisar", [x(11), F + 350], mover("$('Tomar archivo').first().json.id", "revisar_id")),
    http("Anotar rechazo", [x(12), F + 350], { ...appendA("Errores"), json: "={{ JSON.stringify({ values: $('Preparar rechazo').first().json.values }) }}" }),
    http("Liberar turno (rechazo)", [x(13), F + 350], estado(5, "en_proceso", "''")),

    // --- Reintento: falla transitoria. El archivo queda en _Entrada.
    codigo("Preparar reintento", `
const archivo = $('Tomar archivo').first().json;
const j = $input.first().json;
const ev = j.decision ? j : evaluarRespuestaWorker({ error: j.error });
return [{ json: { values: [filaError('ingesta', archivo, ev.tipo, ev.detalle + ' — queda en _Entrada, se reintenta', new Date().toISOString())] } }];`, [x(12), F + 550]),
    http("Anotar reintento", [x(13), F + 550], { ...appendA("Errores"), json: "={{ JSON.stringify({ values: $json.values }) }}" }),
    http("Liberar turno (reintento)", [x(14), F + 550], estado(5, "en_proceso", "''")),
    si("¿Rechazar?", [x(13), F + 200], "={{ $json.decision }}", OP.igual, "rechazar"),
  ];

  return {
    name: "Remitos - Ingesta",
    // Van en el archivo para cuando se importa desde la interfaz de n8n; la
    // herramienta MCP no permite fijarlos.
    settings: { executionOrder: "v1", ...(ID_ERRORES ? { errorWorkflow: ID_ERRORES } : {}), timezone: "America/Argentina/Tucuman" },
    nodes: nodos,
    connections: conexiones([
      ["Cada 5 minutos", "Config"],
      ["Config", "Latido"],
      ["Latido", "Listar _Entrada"],
      ["Listar _Entrada", "Tomar archivo"],
      ["Tomar archivo", "Leer Estado"],
      ["Leer Estado", "¿Turno libre?"],
      ["¿Turno libre?", "Tomar turno"],
      ["Tomar turno", "¿Se puede procesar?"],
      ["¿Se puede procesar?", "Descargar", 0],
      ["¿Se puede procesar?", "Preparar rechazo", 1],
      ["Descargar", "Worker"],
      ["Worker", "Evaluar worker", 0],
      ["Worker", "Preparar reintento", 1],
      ["Evaluar worker", "¿Worker OK?"],
      ["¿Worker OK?", "Leer Comprobantes", 0],
      ["¿Worker OK?", "¿Rechazar?", 1],
      ["¿Rechazar?", "Preparar rechazo", 0],
      ["¿Rechazar?", "Preparar reintento", 1],
      ["Leer Comprobantes", "Leer Resultados"],
      ["Leer Resultados", "Leer Lotes"],
      ["Leer Lotes", "Planificar"],
      ["Planificar", "Rutas"],
      ["Rutas", "Carpeta cliente"],
      ["Carpeta cliente", "→ unidad"],
      ["→ unidad", "Carpeta unidad"],
      ["Carpeta unidad", "→ período"],
      ["→ período", "Carpeta período"],
      ["Carpeta período", "Páginas"],
      ["Páginas", "Una página por vez"],
      ["Una página por vez", "Cierre", 0], // done
      ["Una página por vez", "¿Es página?", 1], // loop
      ["¿Es página?", "Preparar subida", 0],
      ["¿Es página?", "Una página por vez", 1],
      ["Preparar subida", "Crear archivo"],
      ["Crear archivo", "Recuperar PDF"],
      ["Recuperar PDF", "Subir contenido"],
      ["Subir contenido", "Fila resultado"],
      ["Fila resultado", "Anotar resultado"],
      ["Anotar resultado", "Una página por vez"],
      ["Cierre", "Mover a _Procesados"],
      ["Mover a _Procesados", "Anotar lote"],
      ["Anotar lote", "Liberar turno"],
      ["Preparar rechazo", "Apartar a _Revisar"],
      ["Apartar a _Revisar", "Anotar rechazo"],
      ["Anotar rechazo", "Liberar turno (rechazo)"],
      ["Preparar reintento", "Anotar reintento"],
      ["Anotar reintento", "Liberar turno (reintento)"],
    ]),
  };
}

// ================================================================================
// 3) Errores: cualquier ejecucion que se cae deja rastro en la planilla y libera
//    el turno (si no, la ingesta queda frenada hasta que venza el bloqueo).
// ================================================================================

function wfErrores() {
  contador = 0;
  return {
    name: "Remitos - Errores",
    nodes: [
      nodo("Error Trigger", "n8n-nodes-base.errorTrigger", 1, {}, [x(0), 300]),
      configNodo([x(1), 300]),
      codigo("Fila", `
const e = $('Error Trigger').first().json;
const detalle = (e.workflow?.name || '') + ' · nodo "' + (e.execution?.lastNodeExecuted || '?') + '": ' + (e.execution?.error?.message || '') + ' · ' + (e.execution?.url || '');
return [{ json: { values: [filaError('n8n', {}, 'ejecucion_fallida', detalle, new Date().toISOString())] } }];`, [x(2), 300]),
      http("Anotar error", [x(3), 300], { ...appendA("Errores"), json: "={{ JSON.stringify({ values: $json.values }) }}" }),
      // El turno es de la ingesta: si se cayo otro workflow (Evaluar firmas,
      // Vigilancia), liberarlo dejaria arrancar una segunda ingesta encima de una
      // que sigue corriendo.
      si("¿Era la ingesta?", [x(4), 300], "={{ $('Error Trigger').first().json.workflow.name }}", OP.igual, "Remitos - Ingesta"),
      http("Liberar turno", [x(5), 300], estado(5, "en_proceso", "''")),
    ],
    connections: conexiones([
      ["Error Trigger", "Config"],
      ["Config", "Fila"],
      ["Fila", "Anotar error"],
      ["Anotar error", "¿Era la ingesta?"],
      ["¿Era la ingesta?", "Liberar turno", 0],
    ]),
  };
}

// ================================================================================
// 4) Vigilancia: la falla silenciosa. Si la ingesta no corre o deja archivos
//    en _Entrada, avisa por WhatsApp (webhook del hotel) cada 6 h como maximo.
// ================================================================================

function wfVigilancia() {
  contador = 0;
  return {
    name: "Remitos - Vigilancia",
    nodes: [
      nodo("Cada hora", "n8n-nodes-base.scheduleTrigger", 1.2, { rule: { interval: [{ field: "hours", hoursInterval: 1 }] } }, [x(0), 300]),
      configNodo([x(1), 300]),
      http("Leer Estado", [x(2), 300], leerPestana("Estado")),
      http("Listar _Entrada", [x(3), 300], {
        url: `=${DRIVE}`, auth: "google",
        query: {
          q: `={{ "'" + ${CFG("entrada_id")} + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'" }}`,
          pageSize: "50", fields: "files(name,createdTime)",
        },
      }),
      codigo("Evaluar", `
const cfg = $('Config').first().json;
const est = Object.fromEntries(filasAObjetos($('Leer Estado').first().json.values).map(r => [r.clave, r.valor]));
const ahora = new Date().toISOString();
const problemas = evaluarVigilancia({
  ultimaCorrida: est.ultima_corrida,
  archivosEntrada: $input.first().json.files || [],
  ahora,
  horasSinCorrer: cfg.horas_sin_correr,
  horasEnEntrada: cfg.horas_en_entrada,
});
if (!problemas.length) return [];
const ultima = Date.parse(est.ultima_alerta || '');
if (Number.isFinite(ultima) && Date.now() - ultima < cfg.horas_entre_alertas * 3600000) return [];
return [{ json: {
  texto: 'Remitos: ' + problemas.join(' '),
  ahora,
  values: [filaError('vigilancia', {}, 'alerta', problemas.join(' '), ahora)],
} }];`, [x(4), 300]),
      http("Anotar alerta", [x(5), 300], { ...appendA("Errores"), json: "={{ JSON.stringify({ values: $json.values }) }}" }),
      http("Marcar alerta", [x(6), 300], estado(4, "ultima_alerta", "$('Evaluar').first().json.ahora")),
      si("¿Hay número?", [x(7), 300], `={{ ${CFG("aviso_numero")} }}`, OP.noVacio),
      http("Avisar por WhatsApp", [x(8), 300], {
        method: "POST", url: `={{ ${CFG("aviso_webhook")} }}`,
        json: `={{ JSON.stringify({ number: ${CFG("aviso_numero")}, text: $('Evaluar').first().json.texto }) }}`,
        timeout: 15000,
      }),
    ],
    connections: conexiones([
      ["Cada hora", "Config"],
      ["Config", "Leer Estado"],
      ["Leer Estado", "Listar _Entrada"],
      ["Listar _Entrada", "Evaluar"],
      ["Evaluar", "Anotar alerta"],
      ["Anotar alerta", "Marcar alerta"],
      ["Marcar alerta", "¿Hay número?"],
      ["¿Hay número?", "Avisar por WhatsApp", 0],
    ]),
  };
}

// ================================================================================
// 4b) Evaluar firmas: la ingesta archiva y deja la firma "pendiente". Cada 5
//     minutos se toman unas pocas pendientes (o en "error" con intentos libres) y,
//     DE A UNA y con una pausa, se le pregunta a Gemini con el PDF archivado. Si
//     el modelo principal falla se prueba el de respaldo; si fallan los dos por
//     cuota, saturacion o red, la corrida se corta y sigue en la proxima.
//
//     Adentro del bucle cada nodo lee el remito de ESA vuelta ($('X').itemMatching,
//     por item emparejado), nunca $('X').first() de un nodo del bucle ni
//     .isExecuted: esos miran la ultima vez que corrio el nodo, que puede ser la
//     vuelta anterior, y escribirian la firma de un remito en la fila de otro.
//     Antes de escribir se confirma que la fila sigue siendo la misma (por huella).
// ================================================================================

const ULTIMA_COLUMNA_RESULTADOS = letraColumna(COLUMNAS.Resultados.length - 1);

function wfEvaluarFirmas() {
  contador = 0;
  const F = 300;
  const gemini = (name, pos, campoModelo, cuerpoExpr) => http(name, pos, {
    method: "POST",
    url: `=https://generativelanguage.googleapis.com/v1beta/models/{{ ${CFG(campoModelo)} }}:generateContent`,
    json: cuerpoExpr, auth: "gemini", timeout: 60000,
    // Respuesta completa y sin cortar en 4xx/5xx: asi se ve el codigo y el mensaje
    // reales de Google (429 cuota, 503 saturacion). Sin reintentos automaticos:
    // si falla se prueba el respaldo, y si no, la proxima corrida.
    completa: true,
    onError: "continueRegularOutput",
  });
  // Resultado de una evaluacion, con lo que hace falta para escribir la fila.
  const resultado = (origenDatos, firmaExpr, modeloExpr) => `
const cfg = $('Config').first().json;
return $input.all().map((item, i) => {
  const p = $('${origenDatos}').itemMatching(i).json;
  return {
    json: { fila: p.fila, hash_sha256: p.hash_sha256, reintentos: p.reintentos, numero: p.numero,
      firma: ${firmaExpr}, modelo_usado: ${modeloExpr} },
    pairedItem: { item: i },
  };
});`;
  // Escribir la firma: se relee la fila y solo se escribe si sigue siendo la misma.
  const escribir = (sufijo, origen, y) => [
    http(`Leer fila (${sufijo})`, [x(11), y], {
      url: `=${SHEETS}/values/Resultados!A{{ $json.fila }}:${ULTIMA_COLUMNA_RESULTADOS}{{ $json.fila }}`,
      auth: "google",
    }),
    codigo(`Armar actualización (${sufijo})`, `
const out = [];
for (const [i, item] of $input.all().entries()) {
  const r = $('${origen}').itemMatching(i).json;
  // Si alguien borro o movio filas entre la lectura y ahora, no se toca nada
  // (y la corrida termina aca: la proxima vuelve a leer la planilla).
  if (!mismaFila((item.json.values || [])[0], r.hash_sha256)) continue;
  out.push({
    json: { rango: rangoFirma(r.fila), values: [firmaReintentada(r.firma, r.modelo_usado, r.reintentos + 1)], seguir: !cortarCorrida(r.firma) },
    pairedItem: { item: i },
  });
}
return out;`, [x(12), y]),
    http(`Actualizar firma (${sufijo})`, [x(13), y], {
      method: "PUT", url: `=${SHEETS}/values/{{ $json.rango }}`, auth: "google",
      query: { valueInputOption: "RAW" },
      json: "={{ JSON.stringify({ values: $json.values }) }}",
    }),
  ];
  return {
    name: "Remitos - Evaluar firmas",
    nodes: [
      nodo("Cada 5 minutos", "n8n-nodes-base.scheduleTrigger", 1.2,
        { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } }, [x(0), F]),
      configNodo([x(1), F]),
      http("Leer Resultados", [x(2), F], leerPestana("Resultados")),
      codigo("Elegir pendientes", `
// Unas pocas por corrida. Si no hay ninguna, la corrida termina aca.
const cfg = $('Config').first().json;
return elegirFirmasPendientes($input.first().json.values, cfg.max_reintentos_firma, cfg.firmas_por_corrida).map(json => ({ json }));`, [x(3), F]),
      nodo("Una por vez", "n8n-nodes-base.splitInBatches", 3, { batchSize: 1, options: {} }, [x(4), F]),
      http("Descargar PDF", [x(5), F], {
        url: `=${DRIVE}/{{ $json.archivo_id }}`, query: { alt: "media" }, archivo: true, auth: "google",
        onError: "continueErrorOutput",
      }),
      codigo("Preparar pedido", `
const cfg = $('Config').first().json;
const out = [];
for (const [i] of $input.all().entries()) {
  const p = $('Una por vez').itemMatching(i).json;
  const buf = await this.helpers.getBinaryDataBuffer(i, 'data');
  out.push({
    json: { ...p, gemini_body: cuerpoGeminiArchivo(buf.toString('base64'), 'application/pdf', cfg.razonamiento) },
    pairedItem: { item: i },
  });
}
return out;`, [x(6), F]),
      gemini("Gemini", [x(7), F], "modelo", "={{ JSON.stringify($json.gemini_body) }}"),
      codigo("Interpretar", resultado("Preparar pedido", "interpretarFirma(item.json)", "cfg.modelo"), [x(8), F]),
      si("¿Anduvo?", [x(9), F], "={{ $json.firma.firma }}", OP.distinto, "error"),
      gemini("Gemini respaldo", [x(9), F + 200], "modelo_respaldo", "={{ JSON.stringify($('Preparar pedido').item.json.gemini_body) }}"),
      codigo("Interpretar respaldo", resultado("Preparar pedido", "interpretarFirma(item.json)", "cfg.modelo_respaldo"), [x(10), F + 200]),
      codigo("Sin archivo", resultado(
        "Una por vez",
        "{ firma: 'error', confianza: '', tipo_error: 'otro', observacion: 'no se pudo bajar el PDF archivado: ' + String((item.json.error && (item.json.error.message || JSON.stringify(item.json.error))) || 'error desconocido').slice(0, 200) }",
        "''",
      ), [x(6), F + 400]),
      ...escribir("principal", "Interpretar", F),
      ...escribir("respaldo", "Interpretar respaldo", F + 200),
      ...escribir("sin archivo", "Sin archivo", F + 400),
      si("¿Seguir?", [x(14), F + 200], "={{ $('Armar actualización (respaldo)').item.json.seguir }}", OP.verdadero),
      nodo("Pausa", "n8n-nodes-base.wait", 1.1,
        { amount: `={{ ${CFG("segundos_entre_firmas")} || 3 }}`, unit: "seconds" }, [x(15), F]),
    ],
    connections: conexiones([
      ["Cada 5 minutos", "Config"],
      ["Config", "Leer Resultados"],
      ["Leer Resultados", "Elegir pendientes"],
      ["Elegir pendientes", "Una por vez"],
      // La salida 0 de "Una por vez" es "termine": no hay nada mas que hacer.
      ["Una por vez", "Descargar PDF", 1],
      ["Descargar PDF", "Preparar pedido", 0],
      ["Descargar PDF", "Sin archivo", 1],
      ["Preparar pedido", "Gemini"],
      ["Gemini", "Interpretar"],
      ["Interpretar", "¿Anduvo?"],
      ["¿Anduvo?", "Leer fila (principal)", 0],
      ["¿Anduvo?", "Gemini respaldo", 1],
      ["Gemini respaldo", "Interpretar respaldo"],
      ["Interpretar respaldo", "Leer fila (respaldo)"],
      ["Sin archivo", "Leer fila (sin archivo)"],
      ["Leer fila (principal)", "Armar actualización (principal)"],
      ["Armar actualización (principal)", "Actualizar firma (principal)"],
      ["Actualizar firma (principal)", "Pausa"],
      ["Leer fila (respaldo)", "Armar actualización (respaldo)"],
      ["Armar actualización (respaldo)", "Actualizar firma (respaldo)"],
      ["Actualizar firma (respaldo)", "¿Seguir?"],
      // Si fallaron los dos modelos por cuota o saturacion, se corta aca.
      ["¿Seguir?", "Pausa", 0],
      ["Leer fila (sin archivo)", "Armar actualización (sin archivo)"],
      ["Armar actualización (sin archivo)", "Actualizar firma (sin archivo)"],
      ["Actualizar firma (sin archivo)", "Pausa"],
      ["Pausa", "Una por vez"],
    ]),
  };
}

// ================================================================================
// 5) Instalacion: crea Remitos/{_Entrada,_Revisar,_Procesados} y la planilla con
//    sus pestanas. Se corre UNA vez a mano. Si ya existe "Remitos", no hace nada.
// ================================================================================

async function wfInstalacion() {
  contador = 0;

  // Comprobantes de prueba, si ya se generaron: la planilla nace cargada.
  const rutaCsv = join(RAIZ, "salida", "comprobantes.csv");
  let filasComprobantes = [];
  if (existsSync(rutaCsv)) {
    const lineas = (await readFile(rutaCsv, "utf8")).trim().split("\n").slice(1);
    filasComprobantes = lineas.map(parsearCsv);
  }

  // La planilla nace con las pestanas vacias; encabezados, filas de Estado y
  // comprobantes se escriben despues en UNA llamada de valores (mucho mas compacta).
  const cuerpoPlanilla = {
    properties: { title: "Remitos - Control", locale: "es_AR", timeZone: "America/Argentina/Tucuman" },
    sheets: Object.keys(COLUMNAS).map((title) => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
  };
  const valoresIniciales = {
    valueInputOption: "RAW",
    data: Object.keys(COLUMNAS).map((pestana) => {
      const values = [COLUMNAS[pestana]];
      if (pestana === "Estado") for (const k of ["ultima_corrida", "ultimo_lote", "ultima_alerta", "en_proceso"]) values.push([k, ""]);
      if (pestana === "Comprobantes") values.push(...filasComprobantes);
      return { range: `${pestana}!A1`, values };
    }),
  };

  return {
    name: "Remitos - Instalación",
    nodes: [
      nodo("Ejecutar una vez", "n8n-nodes-base.manualTrigger", 1, {}, [x(0), 300]),
      http("¿Ya existe?", [x(1), 300], {
        url: `=${DRIVE}`, auth: "google",
        query: { q: "name='Remitos' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", fields: "files(id,name)" },
      }),
      codigo("Verificar", `
const f = ($input.first().json.files || [])[0];
if (f) throw new Error("Ya existe una carpeta 'Remitos' en Mi unidad (id " + f.id + "). La instalacion no se repite para no duplicar nada. Para reinstalar, renombrala primero.");
return [{ json: {} }];`, [x(2), 300], { conLogica: false }),
      http("Crear Remitos", [x(3), 300], {
        method: "POST", url: `=${DRIVE}`, query: { fields: "id,webViewLink" }, auth: "google",
        json: "={{ JSON.stringify({ name: 'Remitos', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] }) }}",
      }),
      codigo("Subcarpetas", `return ['_Entrada', '_Revisar', '_Procesados'].map(nombre => ({ json: { nombre, padre: $input.first().json.id } }));`, [x(4), 300], { conLogica: false }),
      http("Crear subcarpeta", [x(5), 300], {
        method: "POST", url: `=${DRIVE}`, query: { fields: "id,name" }, auth: "google",
        json: "={{ JSON.stringify({ name: $json.nombre, mimeType: 'application/vnd.google-apps.folder', parents: [$json.padre] }) }}",
      }),
      http("Crear planilla", [x(6), 300], {
        method: "POST", url: "=https://sheets.googleapis.com/v4/spreadsheets", auth: "google", executeOnce: true,
        query: { fields: "spreadsheetId,spreadsheetUrl" },
        json: `=${JSON.stringify(cuerpoPlanilla)}`,
      }),
      codigo("Datos iniciales", `
// Encabezados de cada pestana, filas de Estado y los comprobantes de prueba.
return [{ json: ${JSON.stringify(valoresIniciales)} }];`, [x(7), 300], { conLogica: false }),
      http("Cargar datos iniciales", [x(8), 300], {
        method: "POST", auth: "google",
        url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Crear planilla').first().json.spreadsheetId }}/values:batchUpdate",
        json: "={{ JSON.stringify($json) }}",
      }),
      http("Ubicación de la planilla", [x(9), 300], {
        url: `=${DRIVE}/{{ $('Crear planilla').first().json.spreadsheetId }}`, query: { fields: "id,parents" }, auth: "google",
      }),
      http("Mover planilla a Remitos", [x(10), 300], {
        method: "PATCH", url: `=${DRIVE}/{{ $json.id }}`, auth: "google", json: "={}",
        query: {
          addParents: "={{ $('Crear Remitos').first().json.id }}",
          removeParents: "={{ ($json.parents || []).join(',') }}",
          fields: "id,parents",
        },
      }),
      codigo("Resumen", `
const sub = Object.fromEntries($('Crear subcarpeta').all().map(i => [i.json.name, i.json.id]));
const hoja = $('Crear planilla').first().json;
return [{ json: {
  LISTO: 'Pasale este resultado a Claude para completar la configuracion de los workflows.',
  raiz_id: $('Crear Remitos').first().json.id,
  entrada_id: sub['_Entrada'],
  revisar_id: sub['_Revisar'],
  procesados_id: sub['_Procesados'],
  planilla_id: hoja.spreadsheetId,
  planilla_url: hoja.spreadsheetUrl,
  carpeta_url: $('Crear Remitos').first().json.webViewLink,
} }];`, [x(11), 300], { conLogica: false }),
    ],
    connections: conexiones([
      ["Ejecutar una vez", "¿Ya existe?"],
      ["¿Ya existe?", "Verificar"],
      ["Verificar", "Crear Remitos"],
      ["Crear Remitos", "Subcarpetas"],
      ["Subcarpetas", "Crear subcarpeta"],
      ["Crear subcarpeta", "Crear planilla"],
      ["Crear planilla", "Datos iniciales"],
      ["Datos iniciales", "Cargar datos iniciales"],
      ["Cargar datos iniciales", "Ubicación de la planilla"],
      ["Ubicación de la planilla", "Mover planilla a Remitos"],
      ["Mover planilla a Remitos", "Resumen"],
    ]),
  };
}

// Parser CSV minimo (comillas dobles), suficiente para el CSV que escribe el generador.
function parsearCsv(linea) {
  const celdas = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (entreComillas) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') entreComillas = false;
      else actual += ch;
    } else if (ch === '"') entreComillas = true;
    else if (ch === ",") { celdas.push(actual); actual = ""; }
    else actual += ch;
  }
  celdas.push(actual);
  return celdas;
}

// --- Escribir ---------------------------------------------------------------------

const destino = opcion("--salida", join(RAIZ, "salida", "n8n"));
await mkdir(destino, { recursive: true });
const workflows = {
  config: wfConfig(),
  "asegurar-carpeta": wfAsegurarCarpeta(),
  ingesta: wfIngesta(),
  errores: wfErrores(),
  vigilancia: wfVigilancia(),
  "evaluar-firmas": wfEvaluarFirmas(),
  instalacion: await wfInstalacion(),
};
for (const [archivo, wf] of Object.entries(workflows)) {
  await writeFile(join(destino, `${archivo}.json`), JSON.stringify(wf, null, 2));
  console.log(`  ${wf.name.padEnd(30)} ${String(wf.nodes.length).padStart(3)} nodos -> salida/n8n/${archivo}.json`);
}
if (ID_CONFIG.startsWith("COMPLETAR")) console.log("\n  Falta el id de 'Remitos - Config' (config_id en config.local.json)");
if (!CREDENCIALES.google) console.log("  Credenciales sin asignar: se eligen en n8n o se pasan en config.local.json");
