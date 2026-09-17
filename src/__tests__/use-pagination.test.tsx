import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePagination } from "@/app/admin/usePagination";

function lista(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `fila-${i + 1}`);
}

describe("usePagination — la paginación de las pantallas que ya tienen las filas", () => {
  it("arranca en la primera página", () => {
    const { result } = renderHook(() => usePagination(lista(50)));
    expect(result.current.page).toBe(1);
    expect(result.current.rows[0]).toBe("fila-1");
    expect(result.current.total).toBe(50);
  });

  it("cambia de página sin tocar el total", () => {
    const { result } = renderHook(() => usePagination(lista(50)));
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    expect(result.current.rows[0]).toBe("fila-21");
    // El total sigue siendo el del listado completo: es lo que leen el CSV y los
    // contadores de cada pantalla.
    expect(result.current.total).toBe(50);
  });

  it("vuelve a la página 1 cuando cambia el filtro", () => {
    // El caso real: estás en la página 3 y escribís algo en el buscador. Sin este
    // reset, la pantalla queda vacía y se lee "no hay nada" cuando sí hay.
    const { result, rerender } = renderHook(
      ({ items, key }: { items: string[]; key: string }) => usePagination(items, key),
      { initialProps: { items: lista(100), key: "" } }
    );

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    rerender({ items: lista(100), key: "perez" });
    expect(result.current.page).toBe(1);
    expect(result.current.rows[0]).toBe("fila-1");
  });

  it("no resetea si las filas cambian pero el filtro es el mismo", () => {
    // Un router.refresh() detrás de una acción no tiene por qué sacarte de la página.
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => usePagination(items, "mismo-filtro"),
      { initialProps: { items: lista(100) } }
    );

    act(() => result.current.setPage(3));
    rerender({ items: lista(100) });
    expect(result.current.page).toBe(3);
  });

  it("si la lista se achica, se recuesta en la última página real", () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => usePagination(items, "mismo-filtro"),
      { initialProps: { items: lista(100) } }
    );

    act(() => result.current.setPage(5));
    expect(result.current.page).toBe(5);

    // Se borraron filas: la página 5 ya no existe.
    rerender({ items: lista(30) });
    expect(result.current.page).toBe(2);
    expect(result.current.rows).toHaveLength(10);
  });

  it("con la lista vacía no explota ni deja una página fantasma", () => {
    const { result } = renderHook(() => usePagination([] as string[]));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.rows).toEqual([]);
    expect(result.current.firstIndex).toBe(0);
  });
});
