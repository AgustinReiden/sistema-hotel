import { formatAmount } from "./format";
import type {
  ClientSummary,
  GlobalSearchHit,
  GlobalSearchResult,
  ReservationStatus,
  RoomStatus,
} from "./types";

/**
 * Buscador global (F1-5a): las reglas puras. La consulta a la base vive en
 * `searchGlobal` (data.ts) y la acción del servidor en `admin/search-actions.ts`.
 *
 * Qué ve cada rol (decisión 4 del plan de reorden): recepción, un resumen de solo
 * lectura (descuento, si debe, última estadía, reserva activa) sin montos ni links;
 * el admin, además el monto de la cuenta corriente y links con el filtro puesto.
 */

/** Tope de resultados por grupo (Habitaciones, Huéspedes, Empresas, Pasajeros). */
export const GLOBAL_SEARCH_PER_GROUP = 5;

export type SearchTermKind = "habitacion" | "dni" | "cuit" | "numero" | "texto";

/**
 * Lo que se busca. `value` son los dígitos para habitación, DNI, CUIT y número, y el
 * texto normalizado (ver normalizeSearchText) para texto.
 */
export type SearchQuery = { kind: SearchTermKind; value: string };

/** Minúsculas, sin tildes, sin signos y con un solo espacio entre palabras. */
export function normalizeSearchText(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function onlyDigits(text: string | null | undefined): string {
  return (text ?? "").replace(/\D/g, "");
}

/** "30123456" -> "30.123.456": como se suele cargar el DNI en las reservas. */
export function dniWithDots(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const ROOM_PREFIX = /^hab(?:itaci[oó]n)?\.?\s*(\d{1,3})$/i;

/**
 * Qué escribió: habitación (hasta 3 dígitos, o "hab 7"), DNI (7 u 8 dígitos, con o sin
 * puntos), CUIT (11 dígitos, con o sin guiones), otro número (busca dentro del
 * documento) o texto. Null si no alcanza para buscar: menos de 2 caracteres, salvo un
 * número de habitación.
 */
export function classifySearchTerm(term: string): SearchQuery | null {
  const trimmed = (term ?? "").trim();
  if (!trimmed) return null;

  const room = ROOM_PREFIX.exec(trimmed);
  if (room) return { kind: "habitacion", value: room[1] };

  if (/^[\d.\-\s/]+$/.test(trimmed)) {
    const digits = onlyDigits(trimmed);
    if (!digits) return null;
    if (/^\d{1,3}$/.test(trimmed)) return { kind: "habitacion", value: digits };
    if (digits.length === 7 || digits.length === 8) return { kind: "dni", value: digits };
    if (digits.length === 11) return { kind: "cuit", value: digits };
    if (digits.length < 2) return null;
    return { kind: "numero", value: digits };
  }

  const text = normalizeSearchText(trimmed);
  if (text.replace(/ /g, "").length < 2) return null;
  return { kind: "texto", value: text };
}

/** Lo que se compara de un cliente: su nombre, otros nombres (razón social) y documento. */
export type SearchableClient = {
  nombre: string;
  documento?: string | null;
  otrosNombres?: (string | null | undefined)[];
};

/**
 * ¿El cliente coincide con lo buscado? El DNI y el CUIT se comparan por sus dígitos
 * (con o sin puntos y guiones), y el CUIT de una persona encuentra su DNI y al revés.
 * El texto busca cada palabra, sin tildes y en cualquier orden.
 */
export function matchesClient(client: SearchableClient, query: SearchQuery): boolean {
  const docDigits = onlyDigits(client.documento);
  switch (query.kind) {
    case "habitacion":
      return false;
    case "dni":
      if (!docDigits) return false;
      return (
        docDigits === query.value ||
        (docDigits.length === 11 && docDigits.slice(2, 10) === query.value.padStart(8, "0"))
      );
    case "cuit":
      if (!docDigits) return false;
      return (
        docDigits === query.value ||
        ((docDigits.length === 7 || docDigits.length === 8) &&
          query.value.slice(2, 10) === docDigits.padStart(8, "0"))
      );
    case "numero":
      return docDigits.length > 0 && docDigits.includes(query.value);
    case "texto": {
      const haystack = [client.nombre, ...(client.otrosNombres ?? []), client.documento]
        .map(normalizeSearchText)
        .join(" ");
      return query.value.split(" ").every((word) => haystack.includes(word));
    }
  }
}

/** "7" encuentra la 7; "1" encuentra la 1, la 10, la 11... */
export function matchesRoomNumber(roomNumber: string, digits: string): boolean {
  const room = onlyDigits(roomNumber).replace(/^0+(?=\d)/, "");
  const wanted = digits.replace(/^0+(?=\d)/, "");
  return room.length > 0 && room.startsWith(wanted);
}

/** Una estadía de un cliente, como la necesita el resumen. */
export type StayRow = {
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  room_number: string | null;
};

/**
 * Reserva activa y última estadía de un cliente.
 * - Activa: la estadía en curso (checked_in); si no hay, la reserva confirmada más
 *   próxima que todavía no venció.
 * - Última estadía: el check-out más reciente.
 */
export function summarizeStays(
  rows: StayRow[],
  now: Date
): Pick<ClientSummary, "ultimaEstadia" | "reservaActiva"> {
  const nowMs = now.getTime();
  const time = (iso: string) => new Date(iso).getTime();

  const enCurso = rows
    .filter((r) => r.status === "checked_in")
    .sort((a, b) => time(b.check_in_target) - time(a.check_in_target))[0];
  const proxima = rows
    .filter((r) => r.status === "confirmed" && time(r.check_out_target) > nowMs)
    .sort((a, b) => time(a.check_in_target) - time(b.check_in_target))[0];
  const activa = enCurso ?? proxima;

  const ultima = rows
    .filter((r) => r.status === "checked_out")
    .sort((a, b) => time(b.check_out_target) - time(a.check_out_target))[0];

  return {
    reservaActiva: activa
      ? {
          estado: activa.status as "checked_in" | "confirmed",
          habitacion: activa.room_number,
          entrada: activa.check_in_target,
          salida: activa.check_out_target,
        }
      : null,
    ultimaEstadia: ultima ? { salida: ultima.check_out_target, habitacion: ultima.room_number } : null,
  };
}

/** Los datos de un cliente, sin recortar por rol. */
export type ClientFacts = {
  descuento: number;
  /** Saldo de cuenta corriente (el mismo de Cuenta corriente); null si no opera a cuenta. */
  saldoCuenta: number | null;
  ultimaEstadia: ClientSummary["ultimaEstadia"];
  reservaActiva: ClientSummary["reservaActiva"];
};

/**
 * El resumen que se muestra. `conMonto` es el admin: ve "Debe $X en cuenta corriente"
 * y el saldo; recepción ve "Debe" o "No debe" y el saldo le llega en null. Un saldo a
 * favor no es deuda. Si no opera a cuenta corriente, el resumen no la menciona.
 */
export function buildClientSummary(
  facts: ClientFacts,
  { conMonto }: { conMonto: boolean }
): ClientSummary {
  const saldo = facts.saldoCuenta;
  const debe = saldo === null ? null : saldo > 0.005;
  let saldoTexto: string | null = null;
  if (debe === true) {
    saldoTexto = conMonto ? `Debe ${formatAmount(saldo as number)} en cuenta corriente` : "Debe";
  } else if (debe === false) {
    saldoTexto = "No debe";
  }
  return {
    descuento: facts.descuento,
    debe,
    saldo: conMonto ? saldo : null,
    saldoTexto,
    ultimaEstadia: facts.ultimaEstadia,
    reservaActiva: facts.reservaActiva,
  };
}

/** Una habitación encontrada, con quién está alojado. */
export type GlobalSearchRoomMatch = {
  key: string;
  numero: string;
  estado: RoomStatus;
  alojado: { nombre: string; entrada: string; salida: string } | null;
};

/** Un cliente encontrado (huésped, empresa o pasajero), sin recortar por rol. */
export type GlobalSearchClientMatch = {
  kind: "huesped" | "empresa" | "pasajero";
  key: string;
  nombre: string;
  detalle: string | null;
  /** Lo que va en `?q=` del link del admin (documento o nombre). */
  filtro: string;
  facts: ClientFacts;
};

/** Lo que devuelve `searchGlobal`: todo, para que la acción lo recorte por rol. */
export type GlobalSearchMatches = {
  habitaciones: GlobalSearchRoomMatch[];
  huespedes: GlobalSearchClientMatch[];
  empresas: GlobalSearchClientMatch[];
  pasajeros: GlobalSearchClientMatch[];
};

export const EMPTY_GLOBAL_SEARCH: GlobalSearchResult = {
  habitaciones: [],
  huespedes: [],
  empresas: [],
  pasajeros: [],
};

const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  available: "Disponible",
  occupied: "Ocupada",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
};

function clientHref(match: GlobalSearchClientMatch): string {
  const q = encodeURIComponent(match.filtro);
  // Cuando exista la ficha única (?ficha=, F3-5b) estos links pasan a apuntar ahí.
  return match.kind === "huesped"
    ? `/admin/guests?view=directorio&q=${q}`
    : `/admin/asociados?q=${q}`;
}

/** Recorta lo encontrado según el rol: recepción, sin montos ni links. */
export function shapeGlobalSearch(
  matches: GlobalSearchMatches,
  { esAdmin }: { esAdmin: boolean }
): GlobalSearchResult {
  const toClientHit = (match: GlobalSearchClientMatch): GlobalSearchHit => {
    const hit: GlobalSearchHit = {
      kind: match.kind,
      key: match.key,
      titulo: match.nombre,
      detalle: match.detalle,
      resumen: buildClientSummary(match.facts, { conMonto: esAdmin }),
      habitacion: null,
    };
    if (esAdmin) {
      hit.href = clientHref(match);
      if (match.facts.saldoCuenta !== null) hit.hrefCuenta = "/admin/cuentas";
    }
    return hit;
  };

  return {
    habitaciones: matches.habitaciones.slice(0, GLOBAL_SEARCH_PER_GROUP).map((room) => ({
      kind: "habitacion",
      key: room.key,
      titulo: `Habitación ${room.numero}`,
      detalle: room.alojado
        ? `${ROOM_STATUS_LABEL[room.estado] ?? room.estado} · ${room.alojado.nombre}`
        : ROOM_STATUS_LABEL[room.estado] ?? room.estado,
      resumen: null,
      habitacion: { estado: room.estado, alojado: room.alojado },
    })),
    huespedes: matches.huespedes.slice(0, GLOBAL_SEARCH_PER_GROUP).map(toClientHit),
    empresas: matches.empresas.slice(0, GLOBAL_SEARCH_PER_GROUP).map(toClientHit),
    pasajeros: matches.pasajeros.slice(0, GLOBAL_SEARCH_PER_GROUP).map(toClientHit),
  };
}
