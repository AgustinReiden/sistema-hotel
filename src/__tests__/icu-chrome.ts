import { vi } from "vitest";

/** Cómo cambia el texto de las fechas otro ICU respecto del de Node. */
export type CambioDeIcu = (texto: string) => string;

/**
 * Los espacios duros (U+00A0 y U+202F) pasan a comunes, como los escribe Chrome.
 *
 * Node y Chrome traen cada uno su propio ICU, y no escriben igual la hora de 12 h en
 * es-AR: Node pone un espacio duro (U+00A0) entre "p." y "m.", y Chrome, que parcha su
 * ICU, un espacio común. Medido el 26/09/2026 con los helpers de `@/lib/time` sobre
 * 1372 horarios de un año: Node 25 (ICU 77.1) escribe "02:30 p.", espacio duro, "m.",
 * y Chromium 148 (ICU 78.2) "02:30 p. m."; fechas numéricas, meses abreviados, días de
 * la semana, horas de 24 h y montos dan exactamente igual en esos dos.
 */
export const comoChrome: CambioDeIcu = (texto) => texto.replace(/[\xa0\u{202f}]/gu, " ");

/**
 * Septiembre abreviado "sep." en vez de "sept.". Los nombres de los meses son datos del
 * ICU y cambian con la versión y con el idioma: en el mismo Node 25, es-AR escribe
 * "sept." y es-MX "sep.". Nada asegura que el Node del servidor y el Chrome de la
 * recepción traigan los mismos.
 */
export const septiembreSinT: CambioDeIcu = (texto) => texto.replace(/\bsept\b/g, "sep");

/** Corre `fn` con las fechas escritas como las escribe Chrome. */
export function conIcuDeChrome<T>(fn: () => T | Promise<T>): Promise<T> {
  return conIcuCambiado(comoChrome, fn);
}

/**
 * Corre `fn` con las fechas escritas por otro ICU, para probar que lo que dibuja el
 * servidor (Node) y lo que dibuja el navegador al hidratar dan lo mismo.
 *
 * Mientras dura `fn`, todo lo que formatea fechas (toLocale*String e Intl.DateTimeFormat)
 * pasa su texto por `cambiar`.
 */
export async function conIcuCambiado<T>(
  cambiar: CambioDeIcu,
  fn: () => T | Promise<T>
): Promise<T> {
  const toLocaleString = Date.prototype.toLocaleString;
  const toLocaleDateString = Date.prototype.toLocaleDateString;
  const toLocaleTimeString = Date.prototype.toLocaleTimeString;
  const formatToParts = Intl.DateTimeFormat.prototype.formatToParts;
  // `format` es un getter que devuelve la función ya atada: los tipos lo declaran como
  // método y vi.spyOn no lo acepta, así que se reemplaza y se restaura a mano.
  const formatDescriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format");
  const getFormat = formatDescriptor?.get;
  if (!formatDescriptor || !getFormat) {
    throw new Error("Intl.DateTimeFormat.prototype.format no es un getter");
  }

  const espias = [
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
      this: Date,
      ...args: Parameters<Date["toLocaleString"]>
    ) {
      return cambiar(toLocaleString.apply(this, args));
    }),
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      ...args: Parameters<Date["toLocaleDateString"]>
    ) {
      return cambiar(toLocaleDateString.apply(this, args));
    }),
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (
      this: Date,
      ...args: Parameters<Date["toLocaleTimeString"]>
    ) {
      return cambiar(toLocaleTimeString.apply(this, args));
    }),
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
      this: Intl.DateTimeFormat,
      date?: Date | number
    ) {
      return formatToParts
        .call(this, date)
        .map((part) => ({ ...part, value: cambiar(part.value) }));
    }),
  ];
  Object.defineProperty(Intl.DateTimeFormat.prototype, "format", {
    ...formatDescriptor,
    get(this: Intl.DateTimeFormat) {
      const formatear = getFormat.call(this) as (date?: Date | number) => string;
      return (date?: Date | number) => cambiar(formatear(date));
    },
  });

  try {
    return await fn();
  } finally {
    Object.defineProperty(Intl.DateTimeFormat.prototype, "format", formatDescriptor);
    espias.forEach((espia) => espia.mockRestore());
  }
}
