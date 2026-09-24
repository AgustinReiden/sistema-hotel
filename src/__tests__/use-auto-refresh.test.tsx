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

let tabOculta = false;

/** Simula que la recepcionista cambia de pestaña (oculta) o vuelve a Hoy (visible). */
function cambiarVisibilidad(oculta: boolean) {
  tabOculta = oculta;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  tabOculta = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => tabOculta,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (tabOculta ? "hidden" : "visible"),
  });
});

afterEach(() => {
  // El jsdom se comparte entre los tests del archivo: lo que quede montado o con foco
  // en uno cambiaría lo que ve el siguiente.
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useAutoRefresh — Hoy se pone al día solo", () => {
  it("a los 30 s refresca una vez y a los 60 s dos", () => {
    renderHook(() => useAutoRefresh());

    vi.advanceTimersByTime(29_999);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("con paused no refresca, y cuando se despausa vuelve a hacerlo", () => {
    const { rerender } = renderHook(
      ({ paused }: { paused: boolean }) => useAutoRefresh({ paused }),
      { initialProps: { paused: true } }
    );

    vi.advanceTimersByTime(90_000);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();

    rerender({ paused: false });
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("respeta otro intervalo (mantenimiento lo usa cada 60 s)", () => {
    renderHook(() => useAutoRefresh({ intervalMs: 60_000 }));

    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con un cuadro abierto (aria-modal) no refresca; al cerrarlo vuelve a refrescar", () => {
    renderHook(() => useAutoRefresh());
    const cuadro = document.createElement("div");
    cuadro.setAttribute("aria-modal", "true");
    document.body.appendChild(cuadro);

    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    cuadro.remove();
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con el foco en un campo no refresca (no se pierde lo tipeado); al salir del campo vuelve", () => {
    renderHook(() => useAutoRefresh());
    const campo = document.createElement("input");
    document.body.appendChild(campo);
    campo.focus();
    expect(document.activeElement).toBe(campo);

    vi.advanceTimersByTime(60_000);
    // Volver a la ventana tampoco refresca si el cursor quedó en el campo.
    window.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();

    campo.blur();
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("al volver a la ventana (focus) refresca en el momento", () => {
    renderHook(() => useAutoRefresh());

    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con la pestaña oculta no refresca; al volver a verla se pone al día enseguida", () => {
    renderHook(() => useAutoRefresh());

    cambiarVisibilidad(true);
    vi.advanceTimersByTime(90_000);
    expect(refresh).not.toHaveBeenCalled();

    cambiarVisibilidad(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("al volver a la pestaña llegan visibilitychange y focus juntos: refresca una sola vez", () => {
    renderHook(() => useAutoRefresh());
    cambiarVisibilidad(true);

    cambiarVisibilidad(false);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);

    // El intervalo sigue su curso normal después.
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("una recarga por volver a la ventana no demora la del intervalo (30 s como máximo)", () => {
    renderHook(() => useAutoRefresh());

    vi.advanceTimersByTime(29_000);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);

    // Un segundo después toca la del intervalo: no se saltea por la de recién.
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("al desmontar no quedan intervalos ni listeners", () => {
    const { unmount } = renderHook(() => useAutoRefresh());
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event("focus"));
    cambiarVisibilidad(true);
    cambiarVisibilidad(false);
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
  it("no pinta nada y refresca cada 30 s", () => {
    const { container } = render(<AutoRefresh />);
    expect(container.innerHTML).toBe("");

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
