import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
let sinConexion = false;
let consoleError: MockInstance<typeof console.error>;

/** Deja correr lo que quedó esperando la respuesta del servidor, sin mover el reloj. */
const alDia = () => vi.advanceTimersByTimeAsync(0);

/** Lo mismo, dejando que el cartel se vuelva a pintar con lo que cambió (act). */
const alDiaEnPantalla = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

/** Un servidor que no contesta: el pedido queda colgado hasta que alguien lo corta. */
function servidorColgado() {
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("abortado")));
      })
  );
}

const SIN_CONEXION = "Todavía no hay conexión. Lo vuelve a intentar sola.";
const SIGUE_SIN_ANDAR = "Sigue sin andar. Probá de nuevo en un rato.";

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

/** El botón, diga lo que diga ("Reintentar" o "Reintentando…"). */
const boton = (container: HTMLElement) => container.querySelector("button") as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  reset.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  tabOculta = false;
  sinConexion = false;
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
    get: () => !sinConexion,
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

  it("Reintentar primero pregunta al servidor y, si contesta, vuelve a pedir la pantalla (router.refresh) y la vuelve a pintar (reset)", async () => {
    mostrarPantallaDeError();

    fireEvent.click(botonReintentar());
    // Todavía no recargó: antes pregunta, con el mismo pedido que el reintento automático.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^\/favicon\.ico\?/);
    expect(init?.method).toBe("HEAD");
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();

    await alDiaEnPantalla();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    // El mismo orden que el retry de Next: primero se pide la pantalla nueva.
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
  });
});

describe("Pantalla de error de /admin — el botón Reintentar", () => {
  it("si el servidor no contesta, no recarga (no cambia el cartel por la página de error de Chrome) y avisa que lo vuelve a intentar sola", async () => {
    const { container } = mostrarPantallaDeError();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    fireEvent.click(botonReintentar());
    await alDiaEnPantalla();

    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByText(SIN_CONEXION)).toBeInTheDocument();
    expect(boton(container).disabled).toBe(false);
    expect(botonReintentar()).toBeInTheDocument();
  });

  it("con un error 5xx del servidor (por ejemplo, durante un deploy) tampoco recarga", async () => {
    mostrarPantallaDeError();
    fetchMock.mockResolvedValue({ status: 502 });

    fireEvent.click(botonReintentar());
    await alDiaEnPantalla();

    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByText(SIN_CONEXION)).toBeInTheDocument();
  });

  it("con la PC sin red no le pregunta al servidor ni recarga, y avisa", async () => {
    mostrarPantallaDeError();
    sinConexion = true;

    fireEvent.click(botonReintentar());
    await alDiaEnPantalla();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByText(SIN_CONEXION)).toBeInTheDocument();
  });

  it("si el servidor no contesta en 5 s, corta el pedido, no recarga y avisa", async () => {
    mostrarPantallaDeError();
    servidorColgado();

    fireEvent.click(botonReintentar());
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(signal?.aborted).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByText(SIN_CONEXION)).toBeInTheDocument();
    // Solo queda el reintento automático.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("mientras reintenta dice Reintentando…, no se puede volver a tocar y el ícono gira; después vuelve a Reintentar", async () => {
    const { container } = mostrarPantallaDeError();
    let contestar: (r: { status: number }) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          contestar = resolve;
        })
    );

    fireEvent.click(botonReintentar());

    expect(boton(container).textContent).toContain("Reintentando…");
    expect(boton(container).disabled).toBe(true);
    expect(boton(container).querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
    // Tocarlo de nuevo no manda otro pedido.
    fireEvent.click(boton(container));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      contestar({ status: 200 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    // Con `reset` de mentira el cartel queda: el botón vuelve a estar listo.
    expect(boton(container).textContent).toContain("Reintentar");
    expect(boton(container).textContent).not.toContain("Reintentando");
    expect(boton(container).disabled).toBe(false);
    expect(boton(container).querySelector("svg")?.getAttribute("class")).not.toContain("animate-spin");
  });

  it("al tocarlo de nuevo se va el aviso de antes mientras prueba", async () => {
    mostrarPantallaDeError();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    fireEvent.click(botonReintentar());
    await alDiaEnPantalla();
    expect(screen.getByText(SIN_CONEXION)).toBeInTheDocument();

    fetchMock.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(botonReintentar());
    expect(screen.queryByText(SIN_CONEXION)).toBeNull();
  });

  it("si la recarga vuelve a fallar, el cartel nuevo dice que sigue sin andar", async () => {
    // Si la recarga vuelve a fallar, Next arma el cartel de nuevo desde cero con el error
    // nuevo: el cartel nuevo se pinta antes de que se desmonte el viejo (key distinta).
    const { rerender } = render(<AdminError key="1" error={errorDeRecarga()} reset={reset} />);
    expect(screen.queryByText(SIGUE_SIN_ANDAR)).toBeNull();

    fireEvent.click(botonReintentar());
    await alDiaEnPantalla();
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(<AdminError key="2" error={errorDeRecarga()} reset={reset} />);
    expect(screen.getByText(SIGUE_SIN_ANDAR)).toBeInTheDocument();
    expect(screen.queryByText(SIN_CONEXION)).toBeNull();
  });

  it("un cartel que no viene de tocar Reintentar no dice que sigue sin andar (falló el reintento automático)", async () => {
    const { rerender } = render(<AdminError key="1" error={errorDeRecarga()} reset={reset} />);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(<AdminError key="2" error={errorDeRecarga()} reset={reset} />);
    expect(screen.queryByText(SIGUE_SIN_ANDAR)).toBeNull();
  });

  it("si el reintento salió bien, el próximo cartel (otro error, más tarde) no dice que sigue sin andar", async () => {
    const { unmount } = mostrarPantallaDeError();
    fireEvent.click(botonReintentar());
    await alDiaEnPantalla();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Volvió la pantalla: el cartel se desmonta.
    unmount();

    mostrarPantallaDeError();
    expect(screen.queryByText(SIGUE_SIN_ANDAR)).toBeNull();
  });

  it("si la pantalla se recupera sola mientras el botón espera al servidor, corta el pedido y no recarga", async () => {
    const { unmount } = mostrarPantallaDeError();
    servidorColgado();

    fireEvent.click(botonReintentar());
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await alDia();
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
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
