"use client";

import { useMemo, useState } from "react";

import { PAGE_SIZE, paginate, type PageSlice } from "@/lib/pagination";

/**
 * Paginación en memoria para las pantallas que ya tienen todas las filas cargadas.
 *
 * `items` es la lista COMPLETA ya filtrada: el CSV, los contadores y los totales la
 * siguen leyendo entera. Esto decide nada más qué filas se pintan.
 *
 * `resetKey` es la huella de los filtros y la búsqueda (ej. `${desde}|${hasta}|${cliente}`).
 * Cuando cambia, vuelve a la página 1: filtrar con la página 7 abierta dejaría la
 * pantalla vacía, y el empleado leería "no hay nada" cuando en realidad hay filas.
 */
export function usePagination<T>(
  items: readonly T[],
  resetKey = "",
  pageSize: number = PAGE_SIZE
): PageSlice<T> & { setPage: (page: number) => void } {
  const [page, setPage] = useState(1);
  const [keyVista, setKeyVista] = useState(resetKey);

  // Ajuste de estado durante el render (el patrón que documenta React para derivar
  // estado de props). Con useEffect se pintaría un frame con la página vieja.
  if (resetKey !== keyVista) {
    setKeyVista(resetKey);
    setPage(1);
  }

  const slice = useMemo(() => paginate(items, page, pageSize), [items, page, pageSize]);

  // `paginate` ya recortó la página al rango válido; se sincroniza el estado para que
  // "Siguiente" no quede muerto después de que la lista se achique.
  if (slice.page !== page) setPage(slice.page);

  return { ...slice, setPage };
}
