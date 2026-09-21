// Servidor HTTP del worker. n8n le manda el escaneo y recibe las paginas.
//
//   POST /procesar   body = bytes del PDF/imagen (cualquier Content-Type)
//   GET  /salud      -> { ok: true }
//
// Variables de entorno:
//   PORT          puerto (default 8787)
//   HOST          interfaz (default 127.0.0.1; en Docker se pone 0.0.0.0 y NO se
//                 publica el puerto: solo lo ve n8n por la red interna)
//   WORKER_TOKEN  si esta, se exige en el header X-Worker-Token
//   MAX_MB        tamano maximo del archivo (default 50)

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import { procesarEscaneo, ErrorEntrada } from "./procesar.mjs";

const HTTP_POR_ERROR = {
  archivo_vacio: 400,
  formato_no_soportado: 415,
  archivo_corrupto: 422,
};

function responder(res, estado, cuerpo) {
  const json = JSON.stringify(cuerpo);
  res.writeHead(estado, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function tokenValido(req, token) {
  if (!token) return true;
  const recibido = Buffer.from(String(req.headers["x-worker-token"] ?? ""));
  const esperado = Buffer.from(token);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

function leerCuerpo(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("demasiado_grande"), { demasiadoGrande: true }));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

export function crearServidor({ token = process.env.WORKER_TOKEN, maxMb = Number(process.env.MAX_MB) || 50 } = {}) {
  const maxBytes = maxMb * 1024 * 1024;

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/salud") {
      return responder(res, 200, { ok: true });
    }
    if (url.pathname !== "/procesar") return responder(res, 404, { error: "no_encontrado" });
    if (req.method !== "POST") return responder(res, 405, { error: "metodo_no_permitido" });
    if (!tokenValido(req, token)) return responder(res, 401, { error: "token_invalido" });

    const inicio = Date.now();
    try {
      const cuerpo = await leerCuerpo(req, maxBytes);
      const resultado = await procesarEscaneo(cuerpo);
      console.log(
        `[procesar] ${resultado.total_paginas} hojas, ${resultado.piezas.length} piezas, ` +
          `${resultado.piezas.filter((p) => p.estado === "identificado").length} identificadas, ` +
          `${Date.now() - inicio} ms`
      );
      return responder(res, 200, resultado);
    } catch (e) {
      if (e.demasiadoGrande) {
        return responder(res, 413, { error: "demasiado_grande", mensaje: `Maximo ${maxMb} MB.` });
      }
      if (e instanceof ErrorEntrada) {
        return responder(res, HTTP_POR_ERROR[e.codigo] ?? 400, { error: e.codigo, mensaje: e.message });
      }
      console.error("[procesar] error inesperado", e);
      return responder(res, 500, { error: "error_interno", mensaje: e.message });
    }
  });
}

// Arranque directo: `node worker/servidor.mjs`
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || "127.0.0.1";
  crearServidor().listen(port, host, () => {
    console.log(`remitos-worker escuchando en http://${host}:${port}`);
    if (!process.env.WORKER_TOKEN) console.warn("AVISO: sin WORKER_TOKEN, cualquiera en la red puede usarlo.");
  });
}
