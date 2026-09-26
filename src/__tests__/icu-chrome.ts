import { vi } from "vitest";

/**
 * Corre `fn` con las fechas escritas como las escribe Chrome, para probar que lo que
 * dibuja el servidor (Node) y lo que dibuja el navegador al hidratar dan lo mismo.
 *
 * Node y Chrome traen cada uno su propio ICU, y no escriben igual la hora de 12 h en
 * es-AR: Node pone un espacio duro (U+00A0) entre "p." y "m.", y Chrome, que parcha su
 * ICU, un espacio común. Medido el 26/09/2026 con los helpers de `@/lib/time` sobre
 * 1372 horarios de un año: Node 25 (ICU 77.1) escribe "02:30 p.", espacio duro, "m.",
 * y Chromium 148 (ICU 78.2) "02:30 p. m."; fechas numéricas, meses abreviados, días de
 * la semana, horas de 24 h y montos dan exactamente igual en los dos.
 *
 * Mientras dura `fn`, todo lo que formatea fechas (toLocale*String e Intl.DateTimeFormat)
 * cambia esos espacios duros (U+00A0 y U+202F) por uno común, como Chrome.
 */
export async function conIcuDeChrome<T>(fn: () => T | Promise<T>): Promise<T> {
  const comoChrome = (texto: string) => texto.replace(/[\xa0\u{202f}]/gu, " ");

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
      return comoChrome(toLocaleString.apply(this, args));
    }),
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      ...args: Parameters<Date["toLocaleDateString"]>
    ) {
      return comoChrome(toLocaleDateString.apply(this, args));
    }),
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (
      this: Date,
      ...args: Parameters<Date["toLocaleTimeString"]>
    ) {
      return comoChrome(toLocaleTimeString.apply(this, args));
    }),
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
      this: Intl.DateTimeFormat,
      date?: Date | number
    ) {
      return formatToParts
        .call(this, date)
        .map((part) => ({ ...part, value: comoChrome(part.value) }));
    }),
  ];
  Object.defineProperty(Intl.DateTimeFormat.prototype, "format", {
    ...formatDescriptor,
    get(this: Intl.DateTimeFormat) {
      const formatear = getFormat.call(this) as (date?: Date | number) => string;
      return (date?: Date | number) => comoChrome(formatear(date));
    },
  });

  try {
    return await fn();
  } finally {
    Object.defineProperty(Intl.DateTimeFormat.prototype, "format", formatDescriptor);
    espias.forEach((espia) => espia.mockRestore());
  }
}
