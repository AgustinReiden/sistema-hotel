// Logica de negocio de la ingesta, en funciones puras.
//
// Estas funciones se INCRUSTAN en los nodos Code de n8n (ver construir.mjs): el
// archivo se copia tal cual sin los "export". Por eso: nada de imports, nada de
// APIs de Node, solo JavaScript plano. Los tests las importan como modulo normal.

// Columnas de cada pestana de la planilla. El orden importa: se escribe por
// posicion con la API de Sheets.
const COLUMNAS = {
  Comprobantes: [
    "numero", "codigo", "movimiento_id", "cliente", "carpeta_cliente", "documento",
    "habitacion", "check_in", "check_out", "created_at", "periodo", "monto", "verdad_firmado",
  ],
  Resultados: [
    "procesado_at", "lote_archivo", "lote_hash", "pagina", "estado", "motivo", "numero", "codigo",
    "cliente", "periodo", "version", "reescaneo", "firma", "confianza", "observacion", "modelo",
    "archivo_nombre", "archivo_id", "archivo_link", "hash_sha256",
  ],
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
 * @param {object[]} p.comprobantes                 filas de la pestana Comprobantes
 * @param {object[]} p.resultados                   filas de la pestana Resultados
 * @param {object[]} p.lotes                        filas de la pestana Lotes
 * @param {string} p.unidad                         "Hotel"
 * @param {string} p.ahora                          ISO, para nombres de revision
 *
 * Devuelve { lote_duplicado, piezas: [...], rutas: [...], resumen }.
 * Cada pieza trae `accion`: "archivar" | "revisar" | "saltear".
 * En el resumen, `paginas` cuenta hojas escaneadas; el resto cuenta piezas.
 */
function planificarLote({ archivo, worker, comprobantes, resultados, lotes, unidad, ahora }) {
  const resumen = { paginas: worker.total_paginas, archivadas: 0, revisar: 0, saltadas: 0 };

  // El mismo archivo ya se proceso entero: no se toca nada, solo se aparta.
  const loteYaProcesado = lotes.some(
    (l) => l.hash_archivo === worker.hash_archivo && l.estado === "procesado"
  );
  if (loteYaProcesado) {
    return { lote_duplicado: true, piezas: [], rutas: [], resumen: { ...resumen, saltadas: worker.piezas.length } };
  }

  const porNumero = new Map(comprobantes.map((c) => [String(c.numero).trim(), c]));
  // Piezas ya guardadas (en cualquier lote anterior): por hash.
  const hashesGuardados = new Set(
    resultados.filter((r) => r.estado === "archivado" || r.estado === "revisar").map((r) => r.hash_sha256)
  );
  // Cuantas versiones hay de cada remito, para nombrar los re-escaneos.
  const versiones = new Map();
  for (const r of resultados) {
    if (r.estado === "archivado" && r.numero) versiones.set(r.numero, (versiones.get(r.numero) ?? 0) + 1);
  }
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
      piezas.push({
        ...base,
        ...extra,
        accion: "revisar",
        motivo,
        destino: "revisar",
        archivo_nombre: `${fechaCorta}_${loteCorto}_${lugar}_${motivo}.pdf`,
      });
    };

    if (pag.estado !== "identificado") {
      revisar(pag.motivo, pag.codigos ? { codigo: pag.codigos.join(" | ") } : {});
      continue;
    }

    const comp = porNumero.get(pag.numero_visible);
    // El DV ya garantiza que el codigo se leyo bien. Que no este en el manifiesto
    // es otra cosa: un comprobante que no existe (o de otra tanda).
    if (!comp || String(comp.codigo).trim() !== pag.codigo) {
      revisar("codigo_inexistente", { numero: pag.numero_visible, codigo: pag.codigo });
      continue;
    }

    const version = (versiones.get(pag.numero_visible) ?? 0) + 1;
    versiones.set(pag.numero_visible, version);
    const carpetaCliente = limpiarNombre(comp.carpeta_cliente || comp.cliente) || "SIN NOMBRE";
    const periodo = String(comp.periodo).trim();
    const rutaClave = [carpetaCliente, unidad, periodo].join("/");
    rutas.set(rutaClave, { ruta_clave: rutaClave, carpeta_cliente: carpetaCliente, unidad, periodo });

    resumen.archivadas++;
    piezas.push({
      ...base,
      accion: "archivar",
      destino: "ruta",
      ruta_clave: rutaClave,
      numero: pag.numero_visible,
      codigo: pag.codigo,
      cliente: comp.cliente,
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
  "La imagen es un escaneo. En algun lugar hay un ticket termico angosto con el titulo",
  "'COMPROBANTE CTA. CTE.' y, abajo, dos renglones impresos: 'Firma: ______' y 'Aclaración: ______'.",
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
 * Respuesta de Gemini -> { firma: "si"|"no"|"error", confianza, observacion }.
 * Cualquier cosa rara es "error", nunca "no": no se confunde "no pude mirar"
 * con "mire y no hay firma".
 */
function interpretarFirma(respuesta) {
  const error = (detalle) => ({ firma: "error", confianza: "", observacion: String(detalle).slice(0, 300) });
  if (!respuesta || typeof respuesta !== "object") return error("sin respuesta");
  if (respuesta.error) {
    const e = respuesta.error;
    return error(`gemini: ${e.message || e.status || JSON.stringify(e)}`);
  }
  const texto = respuesta.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (!texto) return error(`sin contenido (${respuesta.candidates?.[0]?.finishReason ?? "?"})`);
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

// --- Filas -------------------------------------------------------------------

function filaResultado(pagina, firma, subido, modelo, ahora) {
  return objetoAFila("Resultados", {
    procesado_at: ahora,
    lote_archivo: pagina.lote_archivo,
    lote_hash: pagina.lote_hash,
    pagina: pagina.pagina,
    estado: pagina.accion === "archivar" ? "archivado" : "revisar",
    motivo: pagina.motivo ?? "",
    numero: pagina.numero ?? "",
    codigo: pagina.codigo ?? "",
    cliente: pagina.cliente ?? "",
    periodo: pagina.periodo ?? "",
    version: pagina.version ?? "",
    reescaneo: pagina.accion === "archivar" ? Boolean(pagina.reescaneo) : "",
    firma: firma.firma,
    confianza: firma.confianza,
    observacion: firma.observacion,
    modelo,
    archivo_nombre: subido.name ?? pagina.archivo_nombre,
    archivo_id: subido.id ?? "",
    archivo_link: subido.webViewLink ?? "",
    hash_sha256: pagina.hash_sha256,
  });
}

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

// --- Reintento de firmas ----------------------------------------------------------
//
// Cuando Gemini falla (sobrecarga, cuota), el remito se archiva igual y la firma
// queda "error". Un workflow aparte vuelve a preguntar mas tarde, con el PDF ya
// archivado, de a un remito por corrida. Los intentos se cuentan en la observacion
// para no insistir para siempre con uno que nunca va a andar.

const MARCA_REINTENTOS = /\[reintentos: (\d+)\]/;

/** Cuantos reintentos lleva una firma, segun su observacion. */
function reintentosDe(observacion) {
  const m = MARCA_REINTENTOS.exec(String(observacion ?? ""));
  return m ? Number(m[1]) : 0;
}

/** Letra de columna de Sheets (0 -> A, 25 -> Z, 26 -> AA). */
function letraColumna(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Rango de las celdas de firma de una fila de Resultados: firma, confianza, observacion, modelo. */
function rangoFirma(fila) {
  const c = COLUMNAS.Resultados;
  return `Resultados!${letraColumna(c.indexOf("firma"))}${fila}:${letraColumna(c.indexOf("modelo"))}${fila}`;
}

/**
 * La firma pendiente con menos intentos (y, a igualdad, la mas vieja).
 * Trabaja sobre los valores crudos de la API para conocer el numero de fila real.
 * Devuelve null si no hay nada pendiente.
 */
function elegirFirmaPendiente(values, maxReintentos) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const col = Object.fromEntries(values[0].map((h, i) => [String(h).trim(), i]));
  let elegida = null;
  for (let i = 1; i < values.length; i++) {
    const f = values[i];
    if (String(f[col.firma] ?? "").trim() !== "error") continue;
    const archivo_id = String(f[col.archivo_id] ?? "").trim();
    if (!archivo_id) continue;
    const reintentos = reintentosDe(f[col.observacion]);
    if (reintentos >= maxReintentos) continue;
    if (!elegida || reintentos < elegida.reintentos) {
      elegida = {
        fila: i + 1, // la fila 1 es el encabezado
        archivo_id,
        numero: f[col.numero] ?? "",
        hash_sha256: f[col.hash_sha256] ?? "",
        reintentos,
      };
    }
  }
  return elegida;
}

/** ¿La fila de la planilla sigue siendo la misma que se eligio? (alguien pudo borrar filas) */
function mismaFila(valoresFila, hashEsperado) {
  const i = COLUMNAS.Resultados.indexOf("hash_sha256");
  return Boolean(hashEsperado) && String((valoresFila || [])[i] ?? "").trim() === String(hashEsperado).trim();
}

/** Valores nuevos para firma, confianza, observacion y modelo. Si sigue en error, cuenta el intento. */
function firmaReintentada(firma, modelo, reintentos) {
  const observacion = firma.firma === "error"
    ? `${String(firma.observacion ?? "").replace(MARCA_REINTENTOS, "").trim()} [reintentos: ${reintentos}]`.trim()
    : firma.observacion;
  return [firma.firma, firma.confianza, observacion, modelo];
}

/** Como cuerpoGemini, pero para un archivo cualquiera (el PDF archivado del remito). */
function cuerpoGeminiArchivo(b64, mimeType, nivelRazonamiento) {
  const cuerpo = cuerpoGemini(b64, nivelRazonamiento);
  cuerpo.contents[0].parts[1].inlineData.mimeType = mimeType;
  return cuerpo;
}

export {
  reintentosDe, letraColumna, rangoFirma, elegirFirmaPendiente, mismaFila, firmaReintentada, cuerpoGeminiArchivo,
  NOMBRES, armarConfig,
  COLUMNAS, filasAObjetos, objetoAFila, limpiarNombre, planificarLote, PROMPT_FIRMA, cuerpoGemini,
  interpretarFirma, filaResultado, filaLote, filaError, evaluarRespuestaWorker, evaluarVigilancia,
};
