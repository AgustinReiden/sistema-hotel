// Código escaneable del remito de cuenta corriente: "R-000158-47".
//
// Mismo formato y mismo dígito verificador (MOD 97-10, ISO 7064, público) que la
// automatización de remitos (automatizaciones/remitos/comun/codigo.mjs); un test
// compara los dos. El DV no es seguridad: hace que un código mal leído o mal
// tipeado se rechace en vez de imputarse a otro remito.

export const PREFIJO_REMITO = "R";

const PATRON = /^([A-Z]{1,3})-(\d{6})-(\d{2})$/;

function prefijoANumeros(prefijo: string): string {
  let s = "";
  for (const ch of prefijo) s += String(ch.charCodeAt(0) - 55); // A=10 … Z=35
  return s;
}

function mod97(digitos: string): number {
  let resto = 0;
  for (const d of digitos) resto = (resto * 10 + Number(d)) % 97;
  return resto;
}

function base(prefijo: string, numero: number): string {
  return prefijoANumeros(prefijo) + String(numero).padStart(6, "0");
}

export function calcularDV(prefijo: string, numero: number): string {
  if (!/^[A-Z]{1,3}$/.test(prefijo)) throw new Error(`Prefijo inválido: ${prefijo}`);
  if (!Number.isInteger(numero) || numero < 0 || numero > 999999) {
    throw new Error(`Número fuera de rango: ${numero}`);
  }
  return String(98 - mod97(base(prefijo, numero) + "00")).padStart(2, "0");
}

/** "R-000158": lo que se imprime grande y lo que se tipea. */
export function numeroVisible(numero: number, prefijo = PREFIJO_REMITO): string {
  return `${prefijo}-${String(numero).padStart(6, "0")}`;
}

/** "R-000158-47": lo que va en el QR. */
export function codigoRemito(numero: number, prefijo = PREFIJO_REMITO): string {
  return `${numeroVisible(numero, prefijo)}-${calcularDV(prefijo, numero)}`;
}

export type LecturaCodigo =
  | { ok: true; prefijo: string; numero: number; visible: string }
  | { ok: false; motivo: "formato" | "dv_invalido" };

/** Nunca "corrige": un DV que no cierra es un rechazo. */
export function interpretarCodigo(texto: string): LecturaCodigo {
  const m = PATRON.exec(String(texto ?? "").trim());
  if (!m) return { ok: false, motivo: "formato" };
  const [, prefijo, nroTxt, dv] = m;
  const numero = Number(nroTxt);
  if (mod97(base(prefijo, numero) + dv) !== 1) return { ok: false, motivo: "dv_invalido" };
  return { ok: true, prefijo, numero, visible: numeroVisible(numero, prefijo) };
}
