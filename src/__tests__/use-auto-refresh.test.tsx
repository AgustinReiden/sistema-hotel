import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
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

/** Lo que mira el hook de la respuesta de `/admin/ping`. */
type Respuesta = { status: number; type?: ResponseType; redirected?: boolean };

/**
 * La pregunta a `/admin/ping` que hace el hook antes de recargar. Por defecto contesta
 * 204, como la ruta cuando el proxy leyó bien la sesión y el rol.
 */
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Respuesta>>();

/** Las cosas que cuentan como "la están usando" (mover el mouse, tocar, la rueda, una tecla). */
const ACTIVIDAD = ["pointermove", "pointerdown", "touchstart", "wheel", "keydown"] as const;

/** La recepcionista mueve el mouse, toca o aprieta una tecla sobre Hoy. */
function usar(evento: (typeof ACTIVIDAD)[number] = "pointermove") {
  document.body.dispatchEvent(new Event(evento, { bubbles: true }));
}

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
  fetchMock.mockResolvedValue({ status: 204 });
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
  // Los espías de addEventListener/removeEventListener (solo los de vi.spyOn).
  vi.restoreAllMocks();
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

  it("antes de recargar le pregunta a /admin/ping (no al ícono), sin cuerpo, sin caché y sin seguir redirecciones", async () => {
    renderHook(() => useAutoRefresh());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/admin/ping");
    expect(url).not.toContain("favicon");
    expect(init?.method).toBe("HEAD");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con 204 recarga, y la pregunta sale antes que la recarga", async () => {
    renderHook(() => useAutoRefresh());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
  });

  it("si el proxy redirige (sesión o rol que no se pudieron leer: opaqueredirect) no recarga y Hoy queda en el panel", async () => {
    // Con Supabase caído, el proxy manda a /login o a /forbidden. Con `redirect: "manual"`
    // el navegador no la sigue: llega una respuesta `opaqueredirect` con status 0.
    renderHook(() => useAutoRefresh());
    fetchMock.mockResolvedValue({ status: 0, type: "opaqueredirect" });

    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();

    // Cuando Supabase vuelve, el turno siguiente recarga.
    fetchMock.mockResolvedValue({ status: 204 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("si la respuesta vino de una redirección seguida (redirected) tampoco recarga, aunque diga 200", async () => {
    renderHook(() => useAutoRefresh());
    fetchMock.mockResolvedValue({ status: 200, redirected: true });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([302, 307, 401, 403, 404])("si contesta %i (no es 2xx) no recarga", async (status) => {
    renderHook(() => useAutoRefresh());
    fetchMock.mockResolvedValue({ status });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
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

    fetchMock.mockResolvedValue({ status: 204 });
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
    fetchMock.mockResolvedValue({ status: 204 });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("si mientras espera al servidor se abre un cuadro, no refresca", async () => {
    renderHook(() => useAutoRefresh());
    let contestar: (r: Respuesta) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          contestar = resolve;
        })
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    abrirCuadroSinAriaModal();
    contestar({ status: 204 });
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

describe("useAutoRefresh — no recarga mientras la están usando", () => {
  it.each(ACTIVIDAD)(
    "con %s hace 1 s no recarga; recarga apenas la pantalla queda quieta 2 s",
    async (evento) => {
      renderHook(() => useAutoRefresh());

      await vi.advanceTimersByTimeAsync(29_000);
      usar(evento);

      // A los 30 s toca recargar, pero la tocaron hace 1 s: espera, sin preguntar al servidor.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(999);
      expect(refresh).not.toHaveBeenCalled();

      // Quieta 2 s: recarga enseguida, sin esperar al próximo turno de los 30 s.
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);

      // Después el intervalo sigue igual: la próxima, a los 60 s.
      await vi.advanceTimersByTimeAsync(29_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    }
  );

  it("con actividad continua no recarga; cuando la dejan quieta 2 s, recarga una sola vez", async () => {
    renderHook(() => useAutoRefresh());

    // 70 s usándola (dos turnos de 30 s y una vuelta a la ventana en el medio).
    for (let t = 0; t < 70_000; t += 500) {
      usar(t % 2_000 === 0 ? "keydown" : "pointermove");
      if (t === 40_000) window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // El intervalo y una sola recarga esperando que la pantalla quede quieta.
    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("sin actividad en los últimos 2 s sigue recargando a los 30 s", async () => {
    renderHook(() => useAutoRefresh());

    await vi.advanceTimersByTimeAsync(5_000);
    usar("pointermove");
    usar("keydown");

    await vi.advanceTimersByTimeAsync(25_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("si la usan mientras espera al servidor, no recarga; vuelve a preguntar y recarga cuando queda quieta", async () => {
    renderHook(() => useAutoRefresh());
    let contestar: (r: Respuesta) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          contestar = resolve;
        })
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    usar("pointerdown");
    contestar({ status: 204 });
    await alDia();
    expect(refresh).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ status: 204 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("al volver a la ventana con el mouse en movimiento, espera a que quede quieta", async () => {
    renderHook(() => useAutoRefresh());

    usar("pointermove");
    window.dispatchEvent(new Event("focus"));
    await alDia();
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("escucha la actividad en window con listeners pasivos y al desmontar los saca todos", () => {
    const agregar = vi.spyOn(window, "addEventListener");
    const sacar = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useAutoRefresh());

    const tipos = ACTIVIDAD as readonly string[];
    const deActividad = agregar.mock.calls.filter(([tipo]) => tipos.includes(tipo));
    expect(deActividad.map(([tipo]) => tipo).sort()).toEqual([...ACTIVIDAD].sort());
    for (const [, , opciones] of deActividad) {
      expect(opciones).toMatchObject({ passive: true });
    }

    unmount();
    const enCaptura = (o: boolean | AddEventListenerOptions | EventListenerOptions | undefined) =>
      typeof o === "boolean" ? o : Boolean(o?.capture);
    for (const [tipo, listener, opciones] of agregar.mock.calls) {
      const sacado = sacar.mock.calls.some(
        ([t, l, o]) => t === tipo && l === listener && enCaptura(o) === enCaptura(opciones)
      );
      expect(sacado, `quedó escuchando ${tipo}`).toBe(true);
    }
  });

  it("al desmontar con una recarga esperando que la pantalla quede quieta, no quedan timers ni recargas", async () => {
    const { unmount } = renderHook(() => useAutoRefresh());

    await vi.advanceTimersByTimeAsync(29_000);
    usar("wheel");
    await vi.advanceTimersByTimeAsync(1_000);
    // El intervalo y la recarga que espera.
    expect(vi.getTimerCount()).toBe(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    usar("pointermove");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
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

/** La zona del hotel en los tests del aviso de Hoy. */
const TZ_HOTEL = "America/Argentina/Buenos_Aires";

/** Lo que agrega el aviso cuando el chequeo recibe una redirección del proxy. */
const AVISO_SESION =
  "Se cerró la sesión o el sistema no responde. Si sigue así, apretá F5 para volver a entrar.";

const sinActualizarDesde = (hora: string) => `Hoy no se actualiza desde las ${hora}.`;

/** Cualquier versión del aviso, diga la hora que diga. */
const avisoEnPantalla = () => screen.queryByText(/Hoy no se actualiza/);

/** Mueve el reloj y deja que React pinte lo que cambió (act). */
const avanzar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("AutoRefresh — lo que se monta en Hoy", () => {
  it("mientras anda, no pinta nada y refresca cada 30 s", async () => {
    const { container } = render(<AutoRefresh timezone={TZ_HOTEL} />);
    expect(container.innerHTML).toBe("");

    await avanzar(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
  });
});

describe("AutoRefresh — avisa cuando Hoy no se actualiza", () => {
  beforeEach(() => {
    // Las 10:00 en el hotel (UTC-3).
    vi.setSystemTime(new Date("2026-09-25T13:00:00.000Z"));
  });

  /**
   * Cada chequeo sale a los 30, 60 y 90 s. El que queda colgado falla 5 s después, así
   * que se mira a los 35, 65 y 95 s: ahí ya volvieron los tres.
   */
  it.each<[string, () => void]>([
    ["internet cortado (el pedido falla)", () => fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))],
    ["el servidor contesta 502", () => fetchMock.mockResolvedValue({ status: 502 })],
    ["la ruta contesta 404", () => fetchMock.mockResolvedValue({ status: 404 })],
    ["el servidor no contesta en 5 s", servidorColgado],
    ["la PC sin red (ni se pregunta)", () => (sinConexion = true)],
  ])(
    "con %s: 1 o 2 chequeos fallidos no muestran nada; al 3.º aparece la línea con la hora del hotel",
    async (_causa, caer) => {
      render(<AutoRefresh timezone={TZ_HOTEL} />);
      caer();

      await avanzar(35_000);
      expect(avisoEnPantalla()).toBeNull();

      await avanzar(30_000);
      expect(avisoEnPantalla()).toBeNull();

      await avanzar(30_000);
      expect(screen.getByText(sinActualizarDesde("10:00"))).toBeInTheDocument();
      // No es una redirección: no habla de la sesión.
      expect(screen.queryByText(AVISO_SESION)).toBeNull();
      expect(refresh).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["America/Argentina/Buenos_Aires", "10:00"],
    ["America/Bogota", "08:00"],
    ["Europe/Madrid", "15:00"],
  ])("la hora sale en la zona del hotel (%s → %s), no en la de la PC", async (timezone, hora) => {
    render(<AutoRefresh timezone={timezone} />);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await avanzar(90_000);
    expect(screen.getByText(sinActualizarDesde(hora))).toBeInTheDocument();
  });

  it("la hora es la de la última vez que Hoy se puso al día, no la del primer chequeo que falló", async () => {
    render(<AutoRefresh timezone={TZ_HOTEL} />);

    // Hasta las 10:05 anda: diez recargas, la última a las 10:05:00.
    await avanzar(300_000);
    expect(refresh).toHaveBeenCalledTimes(10);

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await avanzar(90_000);
    expect(screen.getByText(sinActualizarDesde("10:05"))).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(10);
  });

  it.each<[string, Respuesta]>([
    ["opaqueredirect (el proxy manda a /login o a /forbidden)", { status: 0, type: "opaqueredirect" }],
    ["una redirección seguida (redirected)", { status: 200, redirected: true }],
    ["un 302", { status: 302 }],
    ["un 307", { status: 307 }],
  ])(
    "con %s, al 3.º chequeo la línea dice además que se cerró la sesión o el sistema no responde",
    async (_causa, respuesta) => {
      render(<AutoRefresh timezone={TZ_HOTEL} />);
      fetchMock.mockResolvedValue(respuesta);

      await avanzar(60_000);
      expect(avisoEnPantalla()).toBeNull();
      expect(screen.queryByText(AVISO_SESION)).toBeNull();

      await avanzar(30_000);
      expect(screen.getByText(sinActualizarDesde("10:00"))).toBeInTheDocument();
      expect(screen.getByText(AVISO_SESION)).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    }
  );

  it("cuentan los 3 seguidos aunque cambie la causa; el texto de la sesión sale si el último fue una redirección", async () => {
    render(<AutoRefresh timezone={TZ_HOTEL} />);

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await avanzar(30_000);
    fetchMock.mockResolvedValue({ status: 502 });
    await avanzar(30_000);
    expect(avisoEnPantalla()).toBeNull();

    fetchMock.mockResolvedValue({ status: 0, type: "opaqueredirect" });
    await avanzar(30_000);
    expect(screen.getByText(sinActualizarDesde("10:00"))).toBeInTheDocument();
    expect(screen.getByText(AVISO_SESION)).toBeInTheDocument();

    // El siguiente falla por la red: la línea sigue, sin lo de la sesión.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await avanzar(30_000);
    expect(screen.getByText(sinActualizarDesde("10:00"))).toBeInTheDocument();
    expect(screen.queryByText(AVISO_SESION)).toBeNull();
  });

  it("la línea se va sola cuando un chequeo vuelve a andar, y Hoy se pone al día", async () => {
    render(<AutoRefresh timezone={TZ_HOTEL} />);
    fetchMock.mockResolvedValue({ status: 0, type: "opaqueredirect" });

    await avanzar(90_000);
    expect(screen.getByText(AVISO_SESION)).toBeInTheDocument();

    fetchMock.mockResolvedValue({ status: 204 });
    await avanzar(30_000);
    expect(avisoEnPantalla()).toBeNull();
    expect(screen.queryByText(AVISO_SESION)).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("un chequeo bueno en el medio vuelve a contar desde cero", async () => {
    render(<AutoRefresh timezone={TZ_HOTEL} />);

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await avanzar(60_000);
    fetchMock.mockResolvedValue({ status: 204 });
    await avanzar(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await avanzar(60_000);
    expect(avisoEnPantalla()).toBeNull();

    // El tercero seguido desde el que anduvo (10:01:30).
    await avanzar(30_000);
    expect(screen.getByText(sinActualizarDesde("10:01"))).toBeInTheDocument();
  });

  it("no cuenta como falla cuando no recarga a propósito (cuadro abierto, campo con el foco, pestaña oculta)", async () => {
    render(<AutoRefresh timezone={TZ_HOTEL} />);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { capa } = abrirCuadroSinAriaModal();
    await avanzar(120_000);
    capa.remove();

    const campo = document.createElement("input");
    document.body.appendChild(campo);
    campo.focus();
    await avanzar(120_000);
    campo.blur();

    cambiarVisibilidad(true);
    await avanzar(120_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(avisoEnPantalla()).toBeNull();
  });

  it("es una sola línea chica en el flujo, que no tapa la grilla", async () => {
    const { container } = render(<AutoRefresh timezone={TZ_HOTEL} />);
    fetchMock.mockResolvedValue({ status: 0, type: "opaqueredirect" });

    await avanzar(90_000);
    const linea = container.firstElementChild as HTMLElement;
    expect(linea.getAttribute("role")).toBe("status");
    expect(linea.textContent).toBe(`${sinActualizarDesde("10:00")} ${AVISO_SESION}`);
    // En el flujo (no fija ni encima de nada) y sin la capa de los cuadros, que frenaría el refresco.
    expect(linea.className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
  });
});

describe("useAutoRefresh — lo que devuelve para el aviso", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-09-25T13:00:00.000Z"));
  });

  it("null mientras anda; después de 3 chequeos fallidos, desde cuándo no se actualiza y por qué", async () => {
    const { result } = renderHook(() => useAutoRefresh());
    const montado = Date.now();
    expect(result.current).toBeNull();

    fetchMock.mockResolvedValue({ status: 502 });
    await avanzar(60_000);
    expect(result.current).toBeNull();

    await avanzar(30_000);
    expect(result.current).toEqual({ since: montado, reason: "failed" });

    fetchMock.mockResolvedValue({ status: 0, type: "opaqueredirect" });
    await avanzar(30_000);
    expect(result.current).toEqual({ since: montado, reason: "redirect" });

    fetchMock.mockResolvedValue({ status: 204 });
    await avanzar(30_000);
    expect(result.current).toBeNull();
  });
});
