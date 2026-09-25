import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  // Un solo objeto, como el router de Next: si cambiara en cada render, el efecto se
  // volvería a armar y los tests no dirían nada del hook real.
  router: { refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => H.router }));

import AutoRefresh from "@/app/admin/AutoRefresh";
import { shouldSkipRefresh, useAutoRefresh } from "@/app/admin/useAutoRefresh";

const refresh = H.router.refresh;

/** El pedido al servidor que hace el hook antes de recargar (por defecto, contesta 200). */
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ status: number }>>();

let tabOculta = false;
let sinConexion = false;

/**
 * Deja correr lo que quedó esperando la respuesta del servidor, sin mover el reloj.
 * La recarga sale después de esa respuesta, así que los avisos (`focus`,
 * `visibilitychange`) necesitan esto antes de mirar `router.refresh`.
 */
const alDia = () => vi.advanceTimersByTimeAsync(0);

/** Simula que la recepcionista cambia de pestaña (oculta) o vuelve a Hoy (visible). */
function cambiarVisibilidad(oculta: boolean) {
  tabOculta = oculta;
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Un cuadro de Hoy como los de RoomCard (cancelar reserva, check-in de empresa, cobro):
 * la capa oscura `fixed inset-0` y adentro un campo y un botón, sin `aria-modal`.
 */
function abrirCuadroSinAriaModal() {
  const capa = document.createElement("div");
  capa.className = "fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50";
  const motivo = document.createElement("textarea");
  const confirmar = document.createElement("button");
  confirmar.textContent = "Sí, Cancelar";
  capa.append(motivo, confirmar);
  document.body.appendChild(capa);
  return { capa, motivo, confirmar };
}

/** Un servidor que no contesta: el pedido queda colgado hasta que el hook lo corta. */
function servidorColgado() {
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("abortado")));
      })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetchMock);
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
  // El jsdom se comparte entre los tests del archivo: lo que quede montado o con foco
  // en uno cambiaría lo que ve el siguiente.
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useAutoRefresh — Hoy se pone al día solo", () => {
  it("a los 30 s refresca una vez y a los 60 s dos", async () => {
    renderHook(() => useAutoRefresh());

    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("con paused no refresca, y cuando se despausa vuelve a hacerlo", async () => {
    const { rerender } = renderHook(
      ({ paused }: { paused: boolean }) => useAutoRefresh({ paused }),
      { initialProps: { paused: true } }
    );

    await vi.advanceTimersByTimeAsync(90_000);
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(refresh).not.toHaveBeenCalled();

    rerender({ paused: false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("respeta otro intervalo (mantenimiento lo usa cada 60 s)", async () => {
    renderHook(() => useAutoRefresh({ intervalMs: 60_000 }));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con onRefresh llama a eso y no a router.refresh (así reintenta la pantalla de error)", async () => {
    const reintentar = vi.fn();
    renderHook(() => useAutoRefresh({ onRefresh: reintentar }));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(reintentar).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("si onRefresh cambia entre renders, usa el último y no rearma el intervalo", async () => {
    const primero = vi.fn();
    const segundo = vi.fn();
    const { rerender } = renderHook(
      ({ onRefresh }: { onRefresh: () => void }) => useAutoRefresh({ onRefresh }),
      { initialProps: { onRefresh: primero } }
    );

    await vi.advanceTimersByTimeAsync(20_000);
    rerender({ onRefresh: segundo });

    // Si el render hubiera rearmado el intervalo, la recarga saldría recién a los 50 s.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(primero).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("con un cuadro abierto (aria-modal) no refresca; al cerrarlo vuelve a refrescar", async () => {
    renderHook(() => useAutoRefresh());
    const cuadro = document.createElement("div");
    cuadro.setAttribute("aria-modal", "true");
    document.body.appendChild(cuadro);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();

    cuadro.remove();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con un cuadro abierto sin aria-modal y el foco fuera del campo no refresca; al cerrarlo vuelve", async () => {
    // Escribió el motivo, tocó fuera del campo y el foco quedó en el botón: si la tarjeta
    // se recargara abajo, el cuadro podría pasar a apuntar a otra reserva.
    renderHook(() => useAutoRefresh());
    const { capa, motivo, confirmar } = abrirCuadroSinAriaModal();
    motivo.focus();
    confirmar.focus();
    expect(document.activeElement).toBe(confirmar);

    await vi.advanceTimersByTimeAsync(90_000);
    window.dispatchEvent(new Event("focus"));
    cambiarVisibilidad(true);
    cambiarVisibilidad(false);
    await alDia();
    expect(refresh).not.toHaveBeenCalled();

    capa.remove();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("sin red en la PC no refresca ni le pregunta al servidor; al volver la red, sí", async () => {
    renderHook(() => useAutoRefresh());
    sinConexion = true;

    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    sinConexion = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("antes de recargar le pregunta al servidor pidiendo el ícono, sin cuerpo y sin caché", async () => {
    renderHook(() => useAutoRefresh());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.startsWith("/favicon.ico?")).toBe(true);
    expect(init?.method).toBe("HEAD");
    expect(init?.cache).toBe("no-store");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con internet cortado y la red local arriba (el pedido falla) no refresca; cuando vuelve, sí", async () => {
    // navigator.onLine sigue en true: el router está prendido. Si recargara, Next cambiaría
    // Hoy por la página de error de Chrome.
    renderHook(() => useAutoRefresh());
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ status: 200 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([502, 503, 500])("si el servidor contesta %i (por ejemplo, durante un deploy) no refresca", async (status) => {
    renderHook(() => useAutoRefresh());
    fetchMock.mockResolvedValue({ status });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("un 404 del ícono no frena el refresco (el servidor está, aunque falte el archivo)", async () => {
    renderHook(() => useAutoRefresh());
    fetchMock.mockResolvedValue({ status: 404 });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("si el servidor no contesta en 5 s, corta el pedido, no refresca y en el turno siguiente vuelve a probar", async () => {
    renderHook(() => useAutoRefresh());
    servidorColgado();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    // El intervalo y el plazo del pedido.
    expect(vi.getTimerCount()).toBe(2);

    // Mientras espera, volver a la ventana no arranca otro pedido.
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(signal?.aborted).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    // Si el pedido colgado no se cortara, Hoy quedaría trabado: ninguna recarga más
    // saldría. Cuando el servidor vuelve, el turno siguiente pregunta y recarga.
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200 });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("si mientras espera al servidor se abre un cuadro, no refresca", async () => {
    renderHook(() => useAutoRefresh());
    let contestar: (r: { status: number }) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          contestar = resolve;
        })
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    abrirCuadroSinAriaModal();
    contestar({ status: 200 });
    await alDia();
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("con el foco en un campo no refresca (no se pierde lo tipeado); al salir del campo vuelve", async () => {
    renderHook(() => useAutoRefresh());
    const campo = document.createElement("input");
    document.body.appendChild(campo);
    campo.focus();
    expect(document.activeElement).toBe(campo);

    await vi.advanceTimersByTimeAsync(60_000);
    // Volver a la ventana tampoco refresca si el cursor quedó en el campo.
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(refresh).not.toHaveBeenCalled();

    campo.blur();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("al volver a la ventana (focus) refresca en el momento", async () => {
    renderHook(() => useAutoRefresh());

    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con la pestaña oculta no refresca; al volver a verla se pone al día enseguida", async () => {
    renderHook(() => useAutoRefresh());

    cambiarVisibilidad(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(refresh).not.toHaveBeenCalled();

    cambiarVisibilidad(false);
    await alDia();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("al volver a la pestaña llegan visibilitychange y focus juntos: refresca una sola vez", async () => {
    renderHook(() => useAutoRefresh());
    cambiarVisibilidad(true);

    cambiarVisibilidad(false);
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Si el focus llega un poco después de la recarga, el margen de 2 s lo frena igual.
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(refresh).toHaveBeenCalledTimes(1);

    // El intervalo sigue su curso normal después.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("una recarga por volver a la ventana no demora la del intervalo (30 s como máximo)", async () => {
    renderHook(() => useAutoRefresh());

    await vi.advanceTimersByTimeAsync(29_000);
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Un segundo después toca la del intervalo: no se saltea por la de recién.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("al desmontar no quedan intervalos ni listeners", async () => {
    const { unmount } = renderHook(() => useAutoRefresh());
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
  });

  it("si se desmonta mientras espera al servidor, corta el pedido y no refresca", async () => {
    const { unmount } = renderHook(() => useAutoRefresh());
    servidorColgado();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await alDia();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("shouldSkipRefresh — cuándo no conviene recargar", () => {
  it("con la pantalla libre, se puede refrescar", () => {
    expect(shouldSkipRefresh(document)).toBe(false);
  });

  it("saltea con la pestaña oculta", () => {
    tabOculta = true;
    expect(shouldSkipRefresh(document)).toBe(true);
  });

  it("saltea con un aria-modal en el documento, pero no con aria-modal=\"false\"", () => {
    const cuadro = document.createElement("div");
    cuadro.setAttribute("aria-modal", "false");
    document.body.appendChild(cuadro);
    expect(shouldSkipRefresh(document)).toBe(false);

    cuadro.setAttribute("aria-modal", "true");
    expect(shouldSkipRefresh(document)).toBe(true);
  });

  it("saltea con un cuadro sin aria-modal (la capa fixed inset-0), aunque el foco esté en un botón", () => {
    const { confirmar } = abrirCuadroSinAriaModal();
    confirmar.focus();
    expect(document.activeElement).toBe(confirmar);
    expect(shouldSkipRefresh(document)).toBe(true);
  });

  it("no saltea por otra cosa fija o por una capa absolute inset-0", () => {
    const barraFija = document.createElement("div");
    barraFija.className = "fixed bottom-4 right-4";
    const capaInterna = document.createElement("div");
    capaInterna.className = "absolute inset-0";
    document.body.append(barraFija, capaInterna);
    expect(shouldSkipRefresh(document)).toBe(false);
  });

  it("saltea sin red en la PC", () => {
    sinConexion = true;
    expect(shouldSkipRefresh(document)).toBe(true);
  });

  it.each(["input", "textarea", "select"] as const)("saltea con el foco en un %s", (tag) => {
    const campo = document.createElement(tag);
    document.body.appendChild(campo);
    campo.focus();
    expect(document.activeElement).toBe(campo);
    expect(shouldSkipRefresh(document)).toBe(true);
  });

  it("saltea con el foco en algo editable (contenteditable)", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.tabIndex = 0;
    document.body.appendChild(editable);
    editable.focus();
    expect(document.activeElement).toBe(editable);
    expect(shouldSkipRefresh(document)).toBe(true);
  });

  it("no saltea con el foco en un botón (después de apretarlo el foco queda ahí)", () => {
    const boton = document.createElement("button");
    document.body.appendChild(boton);
    boton.focus();
    expect(document.activeElement).toBe(boton);
    expect(shouldSkipRefresh(document)).toBe(false);
  });

  it("no saltea con contenteditable=\"false\"", () => {
    const noEditable = document.createElement("div");
    noEditable.setAttribute("contenteditable", "false");
    noEditable.tabIndex = 0;
    document.body.appendChild(noEditable);
    noEditable.focus();
    expect(document.activeElement).toBe(noEditable);
    expect(shouldSkipRefresh(document)).toBe(false);
  });
});

describe("AutoRefresh — lo que se monta en Hoy", () => {
  it("no pinta nada y refresca cada 30 s", async () => {
    const { container } = render(<AutoRefresh />);
    expect(container.innerHTML).toBe("");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
