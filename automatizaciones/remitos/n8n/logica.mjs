// Logica de negocio de la ingesta, en funciones puras.
//
// Estas funciones se INCRUSTAN en los nodos Code de n8n (ver construir.mjs): el
// archivo se copia tal cual sin los "export". Por eso: nada de imports, nada de
// APIs de Node, solo JavaScript plano. Los tests las importan como modulo normal.

// Columnas de cada pestana de la planilla. El orden importa: se escribe por
// posicion con la API de Sheets. La planilla queda como bitacora tecnica de n8n
// (turno, lotes, errores): los remitos, sus escaneos y sus firmas viven en la
// base del sistema (mig 116).
const COLUMNAS = {
  Lotes: [
    "procesado_at", "archivo_nombre", "archivo_id", "hash_archivo", "estado",
    "paginas", "archivadas", "revisar", "saltadas",
  ],
  Errores: ["fecha", "origen", "archivo_nombre", "archivo_id", "tipo", "detalle"],
  Estado: ["clave", "valor"],
};

/** [[encabezado...], [fila...], ...] de la API de Sheets -> [{...}] */
function filasAObjetos(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const [encabezado, ...filas] = values;
  return filas
    .filter((f) => f.some((c) => String(c ?? "").trim() !== ""))
    .map((f) => Object.fromEntries(encabezado.map((h, i) => [String(h).trim(), f[i] ?? ""])));
}

/** {...} -> [valor, valor, ...] en el orden de la pestana. */
function objetoAFila(pestana, obj) {
  return COLUMNAS[pestana].map((c) => {
    const v = obj[c];
    if (v === undefined || v === null) return "";
    return typeof v === "boolean" ? (v ? "si" : "no") : v;
  });
}

// Nombres de archivo seguros para Drive.
function limpiarNombre(s) {
  return String(s ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

/**
 * Decide que hacer con cada pieza de un escaneo. Una pieza es un ticket recortado
 * (hoja escaneada sobre cartulina) o la hoja entera (sin cartulina).
 *
 * @param {object} p
 * @param {{id: string, name: string}} p.archivo   el lote que se esta procesando
 * @param {object} p.worker                         respuesta del worker
 * @param {object} p.planificacion                  respuesta de rpc_remitos_planificar:
 *                                                  { remitos: [{numero, existe, cliente, periodo, versiones}],
 *                                                    hashes_registrados: [...] }
 * @param {object[]} p.lotes                        filas de la pestana Lotes
 * @param {string} p.unidad                         "Hotel"
 * @param {string} p.ahora                          ISO, para nombres de revision
 *
 * Devuelve { lote_duplicado, piezas: [...], rutas: [...], resumen }.
 * Cada pieza trae `accion`: "archivar" | "revisar" | "saltear".
 * En el resumen, `paginas` cuenta hojas escaneadas; el resto cuenta piezas.
 */
function planificarLote({ archivo, worker, planificacion, lotes, unidad, ahora }) {
  const resumen = { paginas: worker.total_paginas, archivadas: 0, revisar: 0, saltadas: 0 };

  // El mismo archivo ya se proceso entero: no se toca nada, solo se aparta.
  const loteYaProcesado = lotes.some(
    (l) => l.hash_archivo === worker.hash_archivo && l.estado === "procesado"
  );
  if (loteYaProcesado) {
    return { lote_duplicado: true, piezas: [], rutas: [], resumen: { ...resumen, saltadas: worker.piezas.length } };
  }

  const remitos = planificacion?.remitos ?? [];
  // Los remitos que existen como cargo, por "R-000158".
  const porNumero = new Map(remitos.filter((r) => r.existe).map((r) => [numeroVisibleR(r.numero), r]));
  // Piezas ya registradas en la base (en cualquier lote anterior): por huella.
  const hashesGuardados = new Set(planificacion?.hashes_registrados ?? []);
  // Cuantos escaneos tiene ya cada remito, para nombrar los re-escaneos.
  const versiones = new Map(remitos.map((r) => [numeroVisibleR(r.numero), Number(r.versiones) || 0]));
  const hashesDeEsteLote = new Set();

  const fechaCorta = String(ahora).slice(0, 10);
  const loteCorto = String(worker.hash_archivo).slice(0, 8);
  const rutas = new Map();
  const piezas = [];

  for (const pag of worker.piezas) {
    const base = {
      // "3" (hoja entera) o "3.2" (segundo ticket de la tercera hoja).
      pagina: pag.ubicacion ?? String(pag.pagina),
      hash_sha256: pag.hash_sha256,
      pdf_pagina_b64: pag.pdf_pagina_b64,
      imagen_jpg_b64: pag.imagen_jpg_b64,
      lote_archivo: archivo.name,
      lote_hash: worker.hash_archivo,
      // Lo que se alcanzo a leer adentro de una pieza con varios tickets.
      numeros: pag.numeros ?? [],
    };

    // Idempotencia: si el flujo murio a mitad de lote, lo ya guardado no se repite.
    // Tambien cubre la misma hoja escaneada dos veces dentro del mismo PDF.
    if (hashesGuardados.has(pag.hash_sha256) || hashesDeEsteLote.has(pag.hash_sha256)) {
      piezas.push({ ...base, accion: "saltear", motivo: "pieza_ya_guardada" });
      resumen.saltadas++;
      continue;
    }
    hashesDeEsteLote.add(pag.hash_sha256);

    const revisar = (motivo, extra = {}) => {
      resumen.revisar++;
      const lugar = `hoja${String(pag.pagina).padStart(3, "0")}${pag.pieza > 1 || pag.modo === "cartulina" ? "-" + pag.pieza : ""}`;
      // Si adentro se leyeron remitos (varios tickets pegados), van en el nombre:
      // quien mira _Revisar sabe cuales volver a escanear. No se imputan.
      const numeros = (Array.isArray(pag.numeros) ? pag.numeros : []).filter((n) => /^[A-Z]{1,3}-\d{6}$/.test(n));
      const sufijo = numeros.length ? "_" + numeros.slice(0, 6).join("_") : "";
      piezas.push({
        ...base,
        ...extra,
        accion: "revisar",
        motivo,
        destino: "revisar",
        archivo_nombre: `${fechaCorta}_${loteCorto}_${lugar}_${motivo}${sufijo}.pdf`,
      });
    };

    if (pag.estado !== "identificado") {
      revisar(pag.motivo, pag.codigos ? { codigo: pag.codigos.join(" | ") } : {});
      continue;
    }

    // El DV ya garantiza que el codigo se leyo bien. Que no este en la base es otra
    // cosa: un remito que no existe, o un T- de prueba. Nunca se imputa al parecido.
    const rem = pag.prefijo === PREFIJO_REMITOS ? porNumero.get(pag.numero_visible) : undefined;
    if (!rem) {
      revisar("codigo_inexistente", { numero: pag.numero_visible, codigo: pag.codigo });
      continue;
    }

    const version = (versiones.get(pag.numero_visible) ?? 0) + 1;
    versiones.set(pag.numero_visible, version);
    const carpetaCliente = limpiarNombre(rem.cliente) || "SIN NOMBRE";
    const periodo = String(rem.periodo).trim();
    const rutaClave = [carpetaCliente, unidad, periodo].join("/");
    rutas.set(rutaClave, { ruta_clave: rutaClave, carpeta_cliente: carpetaCliente, unidad, periodo });

    resumen.archivadas++;
    piezas.push({
      ...base,
      accion: "archivar",
      destino: "ruta",
      ruta_clave: rutaClave,
      numero: pag.numero_visible,
      numero_int: pag.numero,
      codigo: pag.codigo,
      cliente: rem.cliente,
      periodo,
      version,
      reescaneo: version > 1,
      archivo_nombre: version === 1 ? `${pag.numero_visible}.pdf` : `${pag.numero_visible}_v${version}.pdf`,
    });
  }

  return { lote_duplicado: false, piezas, rutas: [...rutas.values()], resumen };
}

// --- Firma -------------------------------------------------------------------

const PROMPT_FIRMA = [
  "Sos un control de calidad de comprobantes de cuenta corriente de un hotel.",
  "La imagen es un escaneo de un ticket termico angosto de un hotel que dice 'COMPROBANTE CTA. CTE.'",
  "y, abajo, tiene dos renglones con una linea para completar a mano: 'Firma' y 'Aclaración'.",
  "",
  "Decidi si el comprobante esta FIRMADO:",
  "- firmado=true si sobre o junto al renglon 'Firma' hay un trazo manuscrito que funciona como firma o rubrica.",
  "- Una aclaracion escrita a mano (nombre en letra) SIN firma no cuenta: firmado=false, y decilo en la observacion.",
  "- Los guiones bajos impresos, sellos o texto impreso no son firma.",
  "- Si no ves un comprobante en la imagen, firmado=false y confianza baja.",
  "",
  "confianza (0 a 1) es que tan seguro estas de tu decision, no de que haya firma:",
  "- 0.9 a 1: trazo claro o renglon claramente vacio.",
  "- 0.6 a 0.9: trazo tenue, parcial, corrido del renglon, o imagen de mala calidad.",
  "- menos de 0.6: no se puede decidir con lo que se ve.",
  "",
  "observacion: una frase corta con lo que viste (ej. 'rubrica clara sobre la linea', 'renglon vacio', 'solo aclaracion').",
].join("\n");

/** Cuerpo del pedido a Gemini (generateContent) para una pagina. */
function cuerpoGemini(imagenJpgB64, nivelRazonamiento) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: PROMPT_FIRMA }, { inlineData: { mimeType: "image/jpeg", data: imagenJpgB64 } }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          firmado: { type: "BOOLEAN" },
          confianza: { type: "NUMBER" },
          observacion: { type: "STRING" },
        },
        required: ["firmado", "confianza", "observacion"],
      },
      thinkingConfig: { thinkingLevel: nivelRazonamiento || "low" },
    },
  };
}

/**
 * Que clase de falla de Gemini es, para decidir si seguir preguntando:
 *   "cuota"      429 / RESOURCE_EXHAUSTED: Google pide que se espacien los pedidos
 *   "sobrecarga" 5xx / UNAVAILABLE: el modelo esta saturado
 *   "red"        timeout, conexion cortada
 *   "otro"       algo propio de este pedido (respuesta rara, json invalido...)
 */
function tipoErrorGemini(codigo, texto) {
  const c = String(codigo ?? "");
  const t = String(texto ?? "");
  if (c === "429" || /RESOURCE_EXHAUSTED|too many requests|Try spacing|quota/i.test(t)) return "cuota";
  if (/^5\d\d$/.test(c) || /UNAVAILABLE|high demand|overloaded|INTERNAL/i.test(t)) return "sobrecarga";
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(t)) return "red";
  return "otro";
}

/**
 * Respuesta de Gemini -> { firma: "si"|"no"|"error", confianza, observacion }.
 * Cualquier cosa rara es "error", nunca "no": no se confunde "no pude mirar"
 * con "mire y no hay firma". Los errores traen ademas `tipo_error` (no va a la
 * planilla; decide si la corrida sigue preguntando).
 *
 * Acepta la respuesta completa del nodo HTTP ({ statusCode, body }, con "never
 * error": asi se ve el codigo y el mensaje reales de Google), el error de n8n
 * ({ error }) cuando ni siquiera hubo respuesta, o el cuerpo solo.
 */
function interpretarFirma(respuesta) {
  const error = (detalle, tipo = "otro") => ({
    firma: "error", confianza: "", observacion: String(detalle).slice(0, 300), tipo_error: tipo,
  });
  if (!respuesta || typeof respuesta !== "object") return error("sin respuesta");
  let cuerpo = respuesta;
  if (respuesta.statusCode !== undefined) {
    cuerpo = respuesta.body;
    if (typeof cuerpo === "string") {
      try {
        cuerpo = JSON.parse(cuerpo);
      } catch {
        // queda como texto
      }
    }
    const codigo = Number(respuesta.statusCode);
    if (codigo !== 200) {
      const e = (cuerpo && typeof cuerpo === "object" && cuerpo.error) || {};
      const detalle = [codigo, e.status, e.message || (typeof cuerpo === "string" ? cuerpo : "")].filter(Boolean).join(" ");
      return error(`gemini ${detalle}`, tipoErrorGemini(codigo, detalle));
    }
  }
  if (!cuerpo || typeof cuerpo !== "object") return error("sin respuesta");
  if (cuerpo.error) {
    const e = cuerpo.error;
    const detalle = [e.httpCode || e.code, e.status, e.message, e.description].filter(Boolean).join(" ") || JSON.stringify(e);
    return error(`gemini: ${detalle}`, tipoErrorGemini(e.httpCode || e.code, detalle));
  }
  const texto = cuerpo.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (!texto) return error(`sin contenido (${cuerpo.candidates?.[0]?.finishReason ?? "?"})`);
  let d;
  try {
    d = JSON.parse(texto.replace(/```json|```/g, "").trim());
  } catch {
    return error(`json invalido: ${texto.slice(0, 120)}`);
  }
  if (typeof d.firmado !== "boolean") return error("falta 'firmado'");
  let c = Number(d.confianza);
  if (!Number.isFinite(c)) return error("confianza no numerica");
  if (c > 1 && c <= 100) c = c / 100; // por si contesta en porcentaje
  c = Math.min(1, Math.max(0, c));
  return { firma: d.firmado ? "si" : "no", confianza: Math.round(c * 100) / 100, observacion: String(d.observacion ?? "").slice(0, 300) };
}

// --- Base del sistema (mig 116) ---------------------------------------------------------

/** Prefijo de los remitos reales. Los T- de prueba no estan en la base. */
const PREFIJO_REMITOS = "R";

/** 158 -> "R-000158" */
function numeroVisibleR(numero) {
  return `${PREFIJO_REMITOS}-${String(numero).padStart(6, "0")}`;
}

/** Lo que se le pregunta a la base antes de planificar un lote (rpc_remitos_planificar). */
function pedidoPlanificacion(worker) {
  const numeros = new Set();
  for (const p of worker.piezas) {
    if (p.estado === "identificado" && p.prefijo === PREFIJO_REMITOS && Number.isInteger(p.numero)) numeros.add(p.numero);
  }
  return { p_numeros: [...numeros].sort((a, b) => a - b), p_hashes: worker.piezas.map((p) => p.hash_sha256) };
}

/**
 * Que funcion de la base registra esta pieza ya subida a Drive, y con que datos:
 * lo archivado es un escaneo del remito; lo que va a revisar, una pieza suelta con
 * su motivo y lo que se alcanzo a leer adentro.
 */
function registroDePieza(pag, subido) {
  const base = {
    drive_file_id: subido.id ?? "",
    drive_link: subido.webViewLink ?? "",
    hash_sha256: pag.hash_sha256,
    lote_archivo: pag.lote_archivo,
    lote_hash: pag.lote_hash,
    ubicacion: String(pag.pagina),
  };
  if (pag.accion === "archivar") {
    return { funcion: "rpc_remitos_registrar_escaneo", body: { p: { numero: pag.numero_int, ...base } } };
  }
  return {
    funcion: "rpc_remitos_registrar_pieza",
    body: { p: { ...base, motivo: pag.motivo, numeros_leidos: pag.numeros ?? [] } },
  };
}

// --- Filas -------------------------------------------------------------------

function filaLote(archivo, worker, resumen, estado, ahora) {
  return objetoAFila("Lotes", {
    procesado_at: ahora,
    archivo_nombre: archivo.name,
    archivo_id: archivo.id,
    hash_archivo: worker?.hash_archivo ?? "",
    estado,
    paginas: resumen?.paginas ?? "",
    archivadas: resumen?.archivadas ?? "",
    revisar: resumen?.revisar ?? "",
    saltadas: resumen?.saltadas ?? "",
  });
}

function filaError(origen, archivo, tipo, detalle, ahora) {
  return objetoAFila("Errores", {
    fecha: ahora,
    origen,
    archivo_nombre: archivo?.name ?? "",
    archivo_id: archivo?.id ?? "",
    tipo,
    detalle: String(detalle ?? "").slice(0, 500),
  });
}

/**
 * Respuesta completa del worker (fullResponse) -> que hacer con el lote.
 *   ok          -> seguir
 *   rechazar    -> el archivo nunca va a poder procesarse (no es PDF/imagen, esta roto):
 *                  se aparta a _Revisar para que no se reintente para siempre
 *   reintentar  -> falla transitoria (worker caido, 5xx): el archivo queda en _Entrada
 */
function evaluarRespuestaWorker(r) {
  const status = Number(r?.statusCode ?? 0);
  const cuerpo = r?.body ?? {};
  if (status === 200 && Array.isArray(cuerpo.piezas)) return { decision: "ok" };
  if ([400, 413, 415, 422].includes(status)) {
    return { decision: "rechazar", tipo: cuerpo.error || `http_${status}`, detalle: cuerpo.mensaje || "" };
  }
  return {
    decision: "reintentar",
    tipo: status ? `worker_http_${status}` : "worker_sin_respuesta",
    detalle: cuerpo.mensaje || r?.error?.message || JSON.stringify(cuerpo).slice(0, 300),
  };
}

/**
 * Vigilancia: la falla silenciosa. Devuelve la lista de problemas (vacia si todo bien).
 * @param {{ultimaCorrida: string, archivosEntrada: {name, createdTime}[], ahora: string,
 *          horasSinCorrer: number, horasEnEntrada: number}} p
 */
function evaluarVigilancia({ ultimaCorrida, archivosEntrada, ahora, horasSinCorrer, horasEnEntrada }) {
  const problemas = [];
  const t = Date.parse(ahora);
  const hs = (iso) => (t - Date.parse(iso)) / 3_600_000;
  if (!ultimaCorrida || !Number.isFinite(Date.parse(ultimaCorrida))) {
    problemas.push("La ingesta de remitos nunca registro una corrida.");
  } else if (hs(ultimaCorrida) > horasSinCorrer) {
    problemas.push(`La ingesta de remitos no corre desde hace ${Math.floor(hs(ultimaCorrida))} h.`);
  }
  const viejos = archivosEntrada.filter((a) => hs(a.createdTime) > horasEnEntrada);
  if (viejos.length) {
    problemas.push(
      `${viejos.length} archivo(s) en _Entrada hace mas de ${horasEnEntrada} h sin procesar: ` +
        viejos.slice(0, 5).map((a) => a.name).join(", ")
    );
  }
  return problemas;
}

// --- Configuracion -------------------------------------------------------------

const NOMBRES = {
  raiz: "Remitos",
  entrada: "_Entrada",
  revisar: "_Revisar",
  procesados: "_Procesados",
  planilla: "Remitos - Control",
};
const MIME_CARPETA = "application/vnd.google-apps.folder";
const MIME_PLANILLA = "application/vnd.google-apps.spreadsheet";

/**
 * Arma la configuracion buscando las carpetas y la planilla POR NOMBRE, no por id.
 * Asi reinstalar (que crea todo de nuevo, con ids nuevos) no deja a los workflows
 * mirando carpetas viejas en la papelera. Si algo falta o esta repetido, tira un
 * error claro: nunca "no hay nada que procesar" en silencio.
 *
 * @param {object} ajustes     configuracion fija (modelo, worker, tiempos...)
 * @param {object[]} raices    carpetas llamadas "Remitos" en Mi unidad
 * @param {object[]} contenido lo que hay adentro de "Remitos" {id, name, mimeType}
 */
function armarConfig(ajustes, raices, contenido) {
  if (raices.length === 0) {
    throw new Error(`No encuentro la carpeta "${NOMBRES.raiz}" en Mi unidad. Correr "Remitos - Instalacion".`);
  }
  if (raices.length > 1) {
    throw new Error(`Hay ${raices.length} carpetas "${NOMBRES.raiz}" en Mi unidad: dejar una sola (renombrar o borrar las otras).`);
  }
  const unico = (nombre, mime) => {
    const encontrados = contenido.filter((f) => f.name === nombre && f.mimeType === mime);
    if (encontrados.length === 0) throw new Error(`Falta "${nombre}" dentro de "${NOMBRES.raiz}". Correr "Remitos - Instalacion" o recrearla.`);
    if (encontrados.length > 1) throw new Error(`Hay ${encontrados.length} "${nombre}" dentro de "${NOMBRES.raiz}": dejar uno solo.`);
    return encontrados[0].id;
  };
  return {
    ...ajustes,
    raiz_id: raices[0].id,
    entrada_id: unico(NOMBRES.entrada, MIME_CARPETA),
    revisar_id: unico(NOMBRES.revisar, MIME_CARPETA),
    procesados_id: unico(NOMBRES.procesados, MIME_CARPETA),
    planilla_id: unico(NOMBRES.planilla, MIME_PLANILLA),
  };
}

// --- Evaluacion de firmas ----------------------------------------------------------
//
// La ingesta NO mira firmas: archiva, registra el escaneo en la base y el remito queda
// "evaluando". Asi una caida o una saturacion de Gemini nunca frena ni alarga el
// archivo de los remitos. Un workflow aparte ("Remitos - Evaluar firmas") le pide a
// la base unas pocas pendientes por corrida, las evalua de a una y con pausa con el
// PDF ya archivado, y le devuelve a la base lo que dijo Gemini. La base cuenta los
// intentos y decide el estado con su umbral (mig 116): n8n no decide nada.

/**
 * ¿Hay que cortar la corrida despues de esta firma? Si fallaron los dos modelos
 * por cuota, saturacion o red, el proximo pedido va a fallar igual: se corta y se
 * sigue en la corrida siguiente, sin gastar intentos de las demas.
 */
function cortarCorrida(firma) {
  return firma?.firma === "error" && ["cuota", "sobrecarga", "red"].includes(firma.tipo_error);
}

/** Como cuerpoGemini, pero para un archivo cualquiera (el PDF archivado del remito). */
function cuerpoGeminiArchivo(b64, mimeType, nivelRazonamiento) {
  const cuerpo = cuerpoGemini(b64, nivelRazonamiento);
  cuerpo.contents[0].parts[1].inlineData.mimeType = mimeType;
  return cuerpo;
}

export {
  cortarCorrida, tipoErrorGemini, cuerpoGeminiArchivo,
  NOMBRES, armarConfig,
  COLUMNAS, filasAObjetos, objetoAFila, limpiarNombre, planificarLote, PROMPT_FIRMA, cuerpoGemini,
  interpretarFirma, filaLote, filaError, evaluarRespuestaWorker, evaluarVigilancia,
  PREFIJO_REMITOS, numeroVisibleR, pedidoPlanificacion, registroDePieza,
};
