// Formato del codigo impreso en el remito: PREFIJO-NUMERO-DV, ej. "T-000123-47".
//
// PREFIJO: 1 a 3 letras. Identifica quien emitio el comprobante. "T" son los de
//   prueba de esta etapa; "R" van a ser los reales del hotel. Distinto prefijo,
//   distinto DV: un "T" no puede pasar por un "R" aunque el numero coincida.
// NUMERO: 6 digitos con ceros a la izquierda.
// DV: 2 digitos, MOD 97-10 (ISO 7064, el mismo esquema que el IBAN).
//
// El DV es PUBLICO a proposito. No protege contra falsificacion; protege contra
// errores de lectura y de tipeo, que es el riesgo real: detecta todo cambio de un
// digito y toda transposicion de dos digitos vecinos. Al ser publico, cualquier
// unidad de negocio puede validar el codigo de otra sin compartir secretos.

const PATRON = /^([A-Z]{1,3})-(\d{6})-(\d{2})$/;
const PATRON_PREFIJO = /^[A-Z]{1,3}$/;

// Letras a numeros como el IBAN: A=10 ... Z=35.
function prefijoANumeros(prefijo) {
  let s = "";
  for (const ch of prefijo) s += String(ch.charCodeAt(0) - 55);
  return s;
}

// Resto mod 97 de un entero arbitrariamente largo escrito en decimal.
function mod97(digitos) {
  let resto = 0;
  for (const d of digitos) resto = (resto * 10 + Number(d)) % 97;
  return resto;
}

function base(prefijo, numero) {
  return prefijoANumeros(prefijo) + String(numero).padStart(6, "0");
}

/** DV de dos digitos para (prefijo, numero). */
export function calcularDV(prefijo, numero) {
  if (!PATRON_PREFIJO.test(prefijo)) throw new Error(`Prefijo invalido: ${prefijo}`);
  if (!Number.isInteger(numero) || numero < 0 || numero > 999999) {
    throw new Error(`Numero fuera de rango: ${numero}`);
  }
  const dv = 98 - mod97(base(prefijo, numero) + "00");
  return String(dv).padStart(2, "0");
}

/** "T-000123-47" */
export function formatearCodigo(prefijo, numero) {
  const nro = String(numero).padStart(6, "0");
  return `${prefijo}-${nro}-${calcularDV(prefijo, numero)}`;
}

/** "T-000123", lo que se imprime grande y lo que se usa como nombre de archivo. */
export function numeroVisible(prefijo, numero) {
  return `${prefijo}-${String(numero).padStart(6, "0")}`;
}

/**
 * Interpreta un texto leido de un codigo.
 *   { ok: true,  prefijo, numero, visible }             si el formato y el DV cierran
 *   { ok: false, motivo: "formato" | "dv_invalido" }    si no
 * Nunca "corrige": un DV que no cierra es un rechazo, no una sugerencia.
 */
export function interpretarCodigo(texto) {
  const m = PATRON.exec(String(texto).trim());
  if (!m) return { ok: false, motivo: "formato" };
  const [, prefijo, nroTxt, dv] = m;
  if (mod97(base(prefijo, Number(nroTxt)) + dv) !== 1) {
    return { ok: false, motivo: "dv_invalido" };
  }
  const numero = Number(nroTxt);
  return { ok: true, prefijo, numero, visible: numeroVisible(prefijo, numero) };
}
