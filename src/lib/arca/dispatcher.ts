// Algunos endpoints de ARCA/AFIP (notablemente el WSFE de PRODUCCIÓN,
// servicios1.afip.gov.ar) siguen sirviendo TLS legacy: clave Diffie-Hellman de
// 1024 bits. OpenSSL 3 (el que trae el Node moderno del server) rechaza ese
// handshake con "dh key too small" (error 0A00018A). Como resultado, la app no
// llega a conectar y lo reporta como "ARCA no respondió a tiempo".
//
// Fix: bajar el nivel de seguridad de OpenSSL a 1 SOLO para las conexiones
// salientes a ARCA, mediante un dispatcher de undici que se pasa como `dispatcher`
// en el fetch de WSAA/WSFE. No afecta ninguna otra conexión de la app (Supabase,
// webhooks, etc., siguen con la seguridad por defecto).

import { Agent } from "undici";

let cached: Agent | null = null;

/**
 * Dispatcher de undici para las llamadas a ARCA: tolera el TLS viejo (DH 1024).
 * Singleton (reusa conexiones). SECLEVEL=1 permite DH ≥ 1024 bits sin desactivar
 * la verificación del certificado del servidor.
 */
export function arcaDispatcher(): Agent {
  if (!cached) {
    cached = new Agent({
      connect: {
        ciphers: "DEFAULT@SECLEVEL=1",
        minVersion: "TLSv1.2",
      },
    });
  }
  return cached;
}
