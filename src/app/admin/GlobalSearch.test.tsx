import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GlobalSearch from "./GlobalSearch";
import { EMPTY_GLOBAL_SEARCH } from "@/lib/global-search";
import type { ActionResult, GlobalSearchHit, GlobalSearchResult } from "@/lib/types";

const H = vi.hoisted(() => ({ globalSearchAction: vi.fn() }));

vi.mock("./search-actions", () => ({ globalSearchAction: H.globalSearchAction }));

const PLACEHOLDER = "Buscar huésped, DNI, CUIT o habitación";

function persona(overrides: Partial<GlobalSearchHit> = {}): GlobalSearchHit {
  return {
    kind: "huesped",
    key: "h-1",
    titulo: "Juan Prueba",
    detalle: "DNI 30.123.456",
    resumen: {
      descuento: 10,
      debe: true,
      saldo: null,
      saldoTexto: "Debe",
      ultimaEstadia: { salida: "2026-09-20T15:00:00.000Z", habitacion: "4" },
      reservaActiva: {
        estado: "confirmed",
        habitacion: "7",
        entrada: "2026-10-05T17:00:00.000Z",
        salida: "2026-10-08T15:00:00.000Z",
      },
    },
    habitacion: null,
    ...overrides,
  };
}

function respuesta(partes: Partial<GlobalSearchResult>): ActionResult<GlobalSearchResult> {
  return { success: true, data: { ...EMPTY_GLOBAL_SEARCH, ...partes } };
}

function input(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>(`input[placeholder="${PLACEHOLDER}"]`)!;
}

async function escribir(container: HTMLElement, texto: string) {
  fireEvent.change(input(container), { target: { value: texto } });
}

async function pasar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  H.globalSearchAction.mockReset();
  H.globalSearchAction.mockResolvedValue(respuesta({}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("atajo / del buscador", () => {
  it("con el foco en el body enfoca el buscador", () => {
    const { container } = render(<GlobalSearch placement="desktop" />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(input(container));
  });

  it("dentro de otro campo (una fecha, un texto) no mueve el foco", () => {
    const { container } = render(
      <>
        <GlobalSearch placement="desktop" />
        <input aria-label="Fecha" />
        <textarea aria-label="Nota" />
      </>
    );
    for (const label of ["Fecha", "Nota"]) {
      const otro = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
      otro.focus();
      fireEvent.keyDown(otro, { key: "/" });
      expect(document.activeElement).toBe(otro);
    }
  });

  it("con Ctrl, Meta o Alt apretado no hace nada", () => {
    const { container } = render(<GlobalSearch placement="desktop" />);
    fireEvent.keyDown(document.body, { key: "/", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "/", metaKey: true });
    fireEvent.keyDown(document.body, { key: "/", altKey: true });
    expect(document.activeElement).not.toBe(input(container));
  });
});

describe("búsqueda con espera", () => {
  it("tipear 'per' llama la acción una sola vez, a los 250 ms", async () => {
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "p");
    await pasar(100);
    await escribir(container, "pe");
    await pasar(100);
    await escribir(container, "per");
    await pasar(249);
    expect(H.globalSearchAction).not.toHaveBeenCalled();
    await pasar(1);
    expect(H.globalSearchAction).toHaveBeenCalledTimes(1);
    expect(H.globalSearchAction).toHaveBeenCalledWith("per");
  });

  it("con menos de lo que alcanza para buscar no llama a la acción", async () => {
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "p");
    await pasar(500);
    expect(H.globalSearchAction).not.toHaveBeenCalled();
  });

  it("una respuesta vieja que llega tarde no pisa la nueva", async () => {
    let resolverVieja: (r: ActionResult<GlobalSearchResult>) => void = () => {};
    H.globalSearchAction
      .mockImplementationOnce(() => new Promise((resolve) => (resolverVieja = resolve)))
      .mockResolvedValueOnce(
        respuesta({ huespedes: [persona({ key: "nuevo", titulo: "Pedro Nuevo" })] })
      );
    const { container } = render(<GlobalSearch placement="desktop" />);

    await escribir(container, "per");
    await pasar(250);
    await escribir(container, "pere");
    await pasar(250);
    expect(container.textContent).toContain("Pedro Nuevo");

    await act(async () => {
      resolverVieja(respuesta({ huespedes: [persona({ key: "viejo", titulo: "Persona Vieja" })] }));
    });
    expect(container.textContent).toContain("Pedro Nuevo");
    expect(container.textContent).not.toContain("Persona Vieja");
  });

  it("si la búsqueda falla lo dice y deja reintentar", async () => {
    H.globalSearchAction.mockResolvedValueOnce({ success: false, error: "No se pudo buscar." });
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "per");
    await pasar(250);
    expect(container.textContent).toContain("No se pudo buscar.");
    expect(container.textContent).toContain("Reintentar");
  });
});

describe("resultados y tarjeta", () => {
  it("una habitación aparece con su estado y quién está alojado", async () => {
    H.globalSearchAction.mockResolvedValue(
      respuesta({
        habitaciones: [
          {
            kind: "habitacion",
            key: "r-7",
            titulo: "Habitación 7",
            detalle: "Ocupada · Juan Prueba",
            resumen: null,
            habitacion: {
              estado: "occupied",
              alojado: {
                nombre: "Juan Prueba",
                entrada: "2026-10-01T17:00:00.000Z",
                salida: "2026-10-04T15:00:00.000Z",
              },
            },
          },
        ],
      })
    );
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "7");
    await pasar(250);
    expect(H.globalSearchAction).toHaveBeenCalledWith("7");
    expect(container.textContent).toContain("Habitaciones");
    expect(container.textContent).toContain("Habitación 7");
    expect(container.textContent).toContain("Ocupada · Juan Prueba");
  });

  it("recepción: la tarjeta muestra descuento, si debe, última estadía y reserva activa, sin links ni botones", async () => {
    H.globalSearchAction.mockResolvedValue(respuesta({ huespedes: [persona()] }));
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "30123456");
    await pasar(250);

    const tarjeta = container.querySelector<HTMLElement>("[data-search-card]")!;
    expect(tarjeta).not.toBeNull();
    expect(tarjeta.textContent).toContain("Descuento: 10%");
    expect(tarjeta.textContent).toContain("Debe");
    expect(tarjeta.textContent).not.toContain("$");
    expect(tarjeta.textContent).toContain("Última estadía");
    expect(tarjeta.textContent).toContain("Hab. 4");
    expect(tarjeta.textContent).toContain("Reserva activa");
    expect(tarjeta.textContent).toContain("Hab. 7");
    expect(tarjeta.querySelector("a")).toBeNull();
    expect(tarjeta.querySelector("button")).toBeNull();
  });

  it("admin: con href la tarjeta suma el monto y los links", async () => {
    H.globalSearchAction.mockResolvedValue(
      respuesta({
        empresas: [
          persona({
            kind: "empresa",
            key: "e-1",
            titulo: "Empresa Ficticia SA",
            href: "/admin/asociados?q=30-12345678-1",
            hrefCuenta: "/admin/cuentas",
            resumen: {
              descuento: 0,
              debe: true,
              saldo: 150000,
              saldoTexto: "Debe $150.000,00 en cuenta corriente",
              ultimaEstadia: null,
              reservaActiva: null,
            },
          }),
        ],
      })
    );
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "empresa");
    await pasar(250);

    const tarjeta = container.querySelector<HTMLElement>("[data-search-card]")!;
    expect(tarjeta.textContent).toContain("Debe $150.000,00 en cuenta corriente");
    const links = Array.from(tarjeta.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/admin/asociados?q=30-12345678-1", "/admin/cuentas"]);
  });

  it("↑ ↓ cambian el resultado de la tarjeta", async () => {
    H.globalSearchAction.mockResolvedValue(
      respuesta({
        huespedes: [
          persona({ key: "a", titulo: "Ana Ficticia" }),
          persona({
            key: "b",
            titulo: "Beto Ficticio",
            resumen: {
              descuento: 25,
              debe: false,
              saldo: null,
              saldoTexto: "No debe",
              ultimaEstadia: null,
              reservaActiva: null,
            },
          }),
        ],
      })
    );
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "ficticio");
    await pasar(250);
    const tarjeta = () => container.querySelector<HTMLElement>("[data-search-card]")!.textContent;
    expect(tarjeta()).toContain("Descuento: 10%");

    fireEvent.keyDown(input(container), { key: "ArrowDown" });
    expect(tarjeta()).toContain("Descuento: 25%");
    expect(tarjeta()).toContain("No debe");

    fireEvent.keyDown(input(container), { key: "ArrowUp" });
    expect(tarjeta()).toContain("Descuento: 10%");
  });

  it("sin resultados avisa que no encontró nada", async () => {
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "zzzz");
    await pasar(250);
    expect(container.textContent).toContain("No encontramos nada");
  });
});

describe("Esc", () => {
  it("limpia lo escrito y cierra los resultados", async () => {
    H.globalSearchAction.mockResolvedValue(respuesta({ huespedes: [persona()] }));
    const { container } = render(<GlobalSearch placement="desktop" />);
    await escribir(container, "juan");
    await pasar(250);
    expect(container.textContent).toContain("Juan Prueba");

    fireEvent.keyDown(input(container), { key: "Escape" });
    expect(input(container).value).toBe("");
    expect(container.textContent).not.toContain("Juan Prueba");
    expect(container.querySelector("[data-search-card]")).toBeNull();
  });
});

describe("celular", () => {
  it("la lupa abre el buscador a pantalla completa y se cierra", async () => {
    const { container } = render(<GlobalSearch placement="mobile" />);
    expect(input(container)).toBeNull();
    fireEvent.click(container.querySelector('[aria-label="Buscar"]')!);
    expect(input(container)).not.toBeNull();
    expect(container.querySelector("[data-search-overlay]")).toHaveClass("fixed", "inset-0");
    expect(document.activeElement).toBe(input(container));

    fireEvent.click(container.querySelector('[aria-label="Cerrar búsqueda"]')!);
    expect(input(container)).toBeNull();
  });
});
