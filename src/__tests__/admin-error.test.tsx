import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const H = vi.hoisted(() => ({
  // Un solo objeto, como el router de Next (ver use-auto-refresh.test.tsx).
  router: { refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => H.router }));

import AdminError from "@/app/admin/error";

const refresh = H.router.refresh;
const reset = vi.fn();

/** El pedido al servidor que hace el reintento automático antes de recargar (por defecto, 200). */
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ status: number }>>();

let tabOculta = false;
let consoleError: MockInstance<typeof console.error>;

/** Deja correr lo que quedó esperando la respuesta del servidor, sin mover el reloj. */
const alDia = () => vi.advanceTimersByTimeAsync(0);

function cambiarVisibilidad(oculta: boolean) {
  tabOculta = oculta;
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Lo que le llega a la pantalla cuando falla una recarga de Hoy. El mensaje puede traer
 * datos (nombres, montos, lo que devolvió Supabase): no se muestra.
 */
function errorDeRecarga() {
  return Object.assign(new Error("no se pudo leer la reserva de Juan Prueba"), {
    digest: "987654321",
  });
}

function mostrarPantallaDeError() {
  return render(<AdminError error={errorDeRecarga()} reset={reset} />);
}

const botonReintentar = () => screen.getByText("Reintentar", { selector: "button" });

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  reset.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  tabOculta = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => tabOculta,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (tabOculta ? "hidden" : "visible"),
  });
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  consoleError.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Pantalla de error de /admin — lo que ve la recepcionista", () => {
  it("muestra el cartel en voseo y el botón Reintentar, sin ningún texto en inglés", () => {
    const { container } = mostrarPantallaDeError();

    expect(screen.getByText("No se pudo actualizar la pantalla.")).toBeInTheDocument();
    expect(screen.getByText("Revisá la conexión y tocá Reintentar.")).toBeInTheDocument();
    expect(botonReintentar()).toBeInTheDocument();

    // Lo que se lee en pantalla y lo que lee un lector de pantalla (aria-label, title).
    const etiquetas = Array.from(container.querySelectorAll("[aria-label], [title]")).map(
      (el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`
    );
    const todo = [container.textContent ?? "", ...etiquetas].join(" ");
    for (const ingles of [
      /something went wrong/i,
      /try again/i,
      /reload/i,
      /couldn.t load/i,
      /application error/i,
      /\berror\b/i,
      /digest/i,
    ]) {
      expect(todo).not.toMatch(ingles);
    }
  });

  it("no muestra el mensaje técnico ni el digest (pueden traer datos): van a la consola", () => {
    const { container } = mostrarPantallaDeError();

    expect(container.textContent).not.toContain("Juan Prueba");
    expect(container.textContent).not.toContain("987654321");
    expect(consoleError).toHaveBeenCalled();
  });

  it("Reintentar vuelve a pedir la pantalla (router.refresh) y la vuelve a pintar (reset)", () => {
    mostrarPantallaDeError();

    fireEvent.click(botonReintentar());

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    // El mismo orden que el retry de Next: primero se pide la pantalla nueva.
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
  });
});

describe("Pantalla de error de /admin — reintenta sola", () => {
  it("a los 30 s reintenta sola, y a los 60 s otra vez", async () => {
    mostrarPantallaDeError();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("con la pestaña oculta no reintenta; al volver a verla reintenta enseguida", async () => {
    mostrarPantallaDeError();

    cambiarVisibilidad(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();

    cambiarVisibilidad(false);
    await alDia();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("si el servidor no contesta, no reintenta sola (no cambia el cartel por la página de error de Chrome)", async () => {
    mostrarPantallaDeError();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ status: 200 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("al desmontarse (la pantalla se recuperó) no quedan timers ni reintentos", async () => {
    const { unmount } = mostrarPantallaDeError();
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("focus"));
    cambiarVisibilidad(true);
    cambiarVisibilidad(false);
    await alDia();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});
