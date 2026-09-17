/**
 * Paginación de listados. Módulo puro: sin red y sin React, para poder testear los
 * bordes (lista vacía, última página parcial, página fuera de rango) sin montar nada.
 *
 * El corte se hace sobre un array que ya está en memoria, no con un LIMIT en SQL.
 * Es a propósito: en estas pantallas el CSV y los contadores tienen que seguir viendo
 * TODO lo filtrado, no la página. Si el servidor mandara 20 filas, cada pantalla
 * necesitaría una segunda consulta sólo para exportar — dos caminos que el día que
 * uno se toca dejan de decir lo mismo, y uno de ellos es el libro de IVA ventas.
 */

/** Filas por página, en todas las pantallas. Un solo número, un solo lugar. */
export const PAGE_SIZE = 20;

export type PageSlice<T> = {
  /** Las filas de esta página. */
  rows: T[];
  /** Página efectiva, ya recortada al rango válido: nunca 0 ni mayor que totalPages. */
  page: number;
  totalPages: number;
  /** Total de filas del listado COMPLETO, no de la página. */
  total: number;
  /** Índices 1-based para el "Mostrando 1–20 de 223". Los dos en 0 si no hay filas. */
  firstIndex: number;
  lastIndex: number;
};

/** Encierra una página en el rango válido. Cualquier cosa rara cae en la 1. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, totalPages));
}

/** `?page=` de la URL: "0", "-3", "abc" o nada son la página 1. */
export function parsePageParam(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Corta un array YA filtrado en la página pedida.
 *
 * Si la página quedó más allá del final —porque se borró una fila o cambió un
 * filtro— devuelve la última página real en vez de una pantalla en blanco: que el
 * listado se vea vacío cuando en realidad tiene filas es peor que mostrar otra página.
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number = PAGE_SIZE
): PageSlice<T> {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = clampPage(page, totalPages);
  const from = (safePage - 1) * size;

  return {
    rows: items.slice(from, from + size),
    page: safePage,
    totalPages,
    total,
    firstIndex: total === 0 ? 0 : from + 1,
    lastIndex: Math.min(from + size, total),
  };
}
