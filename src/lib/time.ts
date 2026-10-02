// Helpers para formatear tiempos en la timezone del hotel (por default Tucumán).
// Evitan que `toLocaleString` use la zona del navegador o del servidor.
//
// Ojo con el ICU: lo que dibuja un componente de cliente se calcula dos veces, una en
// el servidor (Node) y otra en el navegador al hidratar, y cada uno trae su propio ICU.
// Si el texto no da exactamente igual, React tira el HTML del servidor y redibuja todo
// (error #418). Por eso la hora de 12 h se arma a mano y no depende del ICU. Con un ICU
// 74 o posterior (CLDR 44 en adelante: Node 22 y los Chrome de hoy), es-AR escribe la
// hora en 12 h, pero el de Node pone "p.", espacio duro (U+00A0), "m.", y el de Chrome
// "p. m." con espacio común. Con un ICU 73 o anterior (CLDR 43), es-AR la escribía en
// 24 h ("14:30"): un servidor así imprimía "14:30" y estos helpers escriben "02:30 p. m.".
// Y el mes abreviado sale de una tabla: cada versión del ICU trae sus propios nombres
// ("sept" o "sep"), y el Node del servidor y el Chrome de la recepción no tienen por qué
// coincidir.

export const DEFAULT_TZ = "America/Argentina/Tucuman";

/** Fecha que no se puede leer: sin esto, `formatToParts` corta el dibujo con un RangeError. */
function isValidInstant(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

// "a. m." y "p. m." con el espacio duro que pone el ICU 74+ de Node entre las dos letras:
// en pantalla se ve igual que un espacio común, y en el ticket térmico la hora no se
// corta entre "p." y "m." cuando el renglón no alcanza.
const AM = "a.\xa0m.";
const PM = "p.\xa0m.";

// "14:30" -> "02:30 p. m.": la hora de 12 h de es-AR con ICU 74+, sin pasar por el ICU.
function toHotelClock12(timeKey: string): string {
  const [hours, minutes] = timeKey.split(":");
  const h = Number(hours);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${minutes} ${h < 12 ? AM : PM}`;
}

export function formatHotelTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso || !isValidInstant(iso)) return "—";
  return toHotelClock12(hotelTimeKey(iso, timezone));
}

// "26/09/2026, 02:30 p. m.", como la escribe toLocaleString("es-AR") con ICU 74+.
export function formatHotelDateTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso || !isValidInstant(iso)) return "—";
  const [year, month, day] = hotelDateKey(iso, timezone).split("-");
  return `${day}/${month}/${year}, ${toHotelClock12(hotelTimeKey(iso, timezone))}`;
}

export function formatHotelDate(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone || DEFAULT_TZ,
  });
}

// Los meses abreviados que ya se veían en es-AR, sin el punto. De una tabla y no del ICU:
// ver el comentario de arriba.
const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sept",
  "oct",
  "nov",
  "dic",
];

// Día, mes abreviado y año de la fecha en la zona del hotel: "26", "sept", "2026".
function hotelShortDateParts(iso: string, timezone?: string) {
  const [year, month, day] = hotelDateKey(iso, timezone).split("-");
  return { day, month: MESES_CORTOS[Number(month) - 1], year };
}

// Formato corto tipo "25 jun 13:00" en la zona del hotel, 24 hs y sin las comas ni los
// puntos que mete el locale. Da lo mismo en el servidor y en el navegador.
export function formatHotelShortDateTime(
  iso: string | null | undefined,
  timezone?: string
): string {
  if (!iso || !isValidInstant(iso)) return "—";
  const { day, month } = hotelShortDateParts(iso, timezone);
  return `${day} ${month} ${hotelTimeKey(iso, timezone)}`;
}

// Fecha con día de semana en la zona del hotel, tipo "lunes, 06 jul". Se arma con
// formatToParts para controlar el separador y quitar el punto del mes abreviado.
export function formatHotelWeekdayDate(
  iso: string | null | undefined,
  timezone?: string
): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    timeZone: timezone || DEFAULT_TZ,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const month = get("month").replace(".", "");
  return `${get("weekday")}, ${get("day")} ${month}`;
}

// Fecha local del hotel como clave comparable "YYYY-MM-DD". Sirve para comparar
// "qué día es hoy" contra la fecha de salida sin que la hora ni la zona del
// navegador/servidor lo corran de día.
export function hotelDateKey(iso: string | number | Date, timezone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone || DEFAULT_TZ,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Hora local del hotel como clave comparable "HH:MM" (24 hs). hourCycle h23 y no
// hour12:false: con hour12 algunos motores escriben la medianoche como "24:00".
export function hotelTimeKey(iso: string | number | Date, timezone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone || DEFAULT_TZ,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}

// Cantidad de noches calendario (zona del hotel) entre dos instantes. Puede ser
// negativa si `toIso` es anterior a `fromIso`; el llamador aplica el mínimo.
export function countHotelNights(
  fromIso: string | number | Date,
  toIso: string | number | Date,
  timezone?: string
): number {
  const [fy, fm, fd] = hotelDateKey(fromIso, timezone).split("-").map(Number);
  const [ty, tm, td] = hotelDateKey(toIso, timezone).split("-").map(Number);
  // Se comparan las fechas como medianoche UTC para no arrastrar horas ni DST.
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / (1000 * 60 * 60 * 24));
}

// Suma (o resta) días a una clave "YYYY-MM-DD" y devuelve otra clave. Puro: no
// depende de ninguna zona horaria, opera sobre la clave ya resuelta.
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Fecha corta tipo "25 jun 26" en la zona del hotel. Como la de arriba, da lo mismo en
// el servidor y en el navegador.
export function formatHotelShortDate(
  iso: string | null | undefined,
  timezone?: string
): string {
  if (!iso || !isValidInstant(iso)) return "—";
  const { day, month, year } = hotelShortDateParts(iso, timezone);
  return `${day} ${month} ${year.slice(-2)}`;
}
