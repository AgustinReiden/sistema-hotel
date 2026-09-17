import { describe, expect, it } from "vitest";

import { PAGE_SIZE, clampPage, paginate, parsePageParam } from "@/lib/pagination";

/** Lista de N elementos identificables, para chequear QUÉ filas trae cada página. */
function lista(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `fila-${i + 1}`);
}

describe("paginate — el corte de un listado ya filtrado", () => {
  it("con la lista vacía no inventa páginas ni índices", () => {
    const p = paginate([], 1);
    expect(p.rows).toEqual([]);
    expect(p.total).toBe(0);
    expect(p.totalPages).toBe(1);
    // Los índices en 0 son los que dejan escribir "Sin resultados" en vez de "1–0 de 0".
    expect(p.firstIndex).toBe(0);
    expect(p.lastIndex).toBe(0);
  });

  it("corta la primera página y cuenta el total completo, no el de la página", () => {
    const p = paginate(lista(223), 1);
    expect(p.rows).toHaveLength(PAGE_SIZE);
    expect(p.rows[0]).toBe("fila-1");
    expect(p.total).toBe(223);
    expect(p.totalPages).toBe(12);
    expect(p.firstIndex).toBe(1);
    expect(p.lastIndex).toBe(20);
  });

  it("con un múltiplo exacto no deja una página vacía al final", () => {
    const p = paginate(lista(100), 5);
    expect(p.totalPages).toBe(5);
    expect(p.rows).toHaveLength(20);
    expect(p.rows.at(-1)).toBe("fila-100");
    expect(p.lastIndex).toBe(100);
  });

  it("la última página parcial trae sólo lo que queda", () => {
    const p = paginate(lista(223), 12);
    expect(p.rows).toHaveLength(3);
    expect(p.rows).toEqual(["fila-221", "fila-222", "fila-223"]);
    expect(p.firstIndex).toBe(221);
    expect(p.lastIndex).toBe(223);
  });

  it("una página más allá del final devuelve la última REAL, no una pantalla vacía", () => {
    // Pasa de verdad: estabas en la página 7 y un filtro dejó 30 filas.
    const p = paginate(lista(30), 7);
    expect(p.page).toBe(2);
    expect(p.rows).toHaveLength(10);
    expect(p.rows[0]).toBe("fila-21");
  });

  it("páginas inválidas caen en la primera", () => {
    expect(paginate(lista(50), 0).page).toBe(1);
    expect(paginate(lista(50), -3).page).toBe(1);
    expect(paginate(lista(50), Number.NaN).page).toBe(1);
  });

  it("respeta un tamaño de página propio", () => {
    const p = paginate(lista(10), 2, 3);
    expect(p.rows).toEqual(["fila-4", "fila-5", "fila-6"]);
    expect(p.totalPages).toBe(4);
  });
});

describe("clampPage", () => {
  it("encierra la página en el rango válido", () => {
    expect(clampPage(5, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(2, 3)).toBe(2);
  });

  it("sin páginas sigue siendo la 1, no la 0", () => {
    expect(clampPage(1, 0)).toBe(1);
  });
});

describe("parsePageParam — el ?page= de la URL es texto de afuera", () => {
  it("acepta un número válido", () => {
    expect(parsePageParam("4")).toBe(4);
  });

  it("cualquier basura es la página 1", () => {
    for (const raw of ["0", "-3", "abc", "", undefined, null, "1.9e400"]) {
      expect(parsePageParam(raw)).toBe(1);
    }
  });
});
