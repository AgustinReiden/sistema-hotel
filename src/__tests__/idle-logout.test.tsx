import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("@/app/login/actions", () => ({ logout: H.logout }));

import IdleLogout from "@/app/admin/IdleLogout";

const MINUTO = 60_000;

/**
 * Hoy se desplaza en un div interno (`overflow-auto`), donde `scroll` no burbujea. Es el
 * que genera la propia recarga de Hoy cada 30 s cuando cambia el alto de algo arriba.
 */
function desplazarSolo() {
  const panel = document.createElement("div");
  document.body.appendChild(panel);
  panel.dispatchEvent(new Event("scroll", { bubbles: false }));
  panel.remove();
}

/** La recepcionista hace algo sobre la pantalla (desde un elemento, como en el navegador). */
function usar(evento: string) {
  document.body.dispatchEvent(new Event(evento, { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  H.logout.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("IdleLogout — cierre de sesión por inactividad", () => {
  it("sin usar la pantalla, cierra la sesión a los 30 minutos, no antes", async () => {
    render(<IdleLogout />);

    await vi.advanceTimersByTimeAsync(30 * MINUTO - 1);
    expect(H.logout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(H.logout).toHaveBeenCalledTimes(1);
  });

  it("el desplazamiento que genera la recarga de Hoy (scroll cada 30 s) no posterga el cierre", async () => {
    render(<IdleLogout />);

    for (let t = 0; t < 30 * MINUTO; t += 30_000) {
      await vi.advanceTimersByTimeAsync(30_000);
      desplazarSolo();
    }
    expect(H.logout).toHaveBeenCalledTimes(1);
  });

  it.each(["wheel", "touchmove", "keydown", "pointermove", "pointerdown", "touchstart"])(
    "%s cuenta como usarla: el cierre se corre 30 minutos desde ahí",
    async (evento) => {
      render(<IdleLogout />);

      await vi.advanceTimersByTimeAsync(20 * MINUTO);
      usar(evento);

      // A los 30 minutos de montarse ya no cierra: la usaron a los 20.
      await vi.advanceTimersByTimeAsync(10 * MINUTO);
      expect(H.logout).not.toHaveBeenCalled();

      // Cierra a los 30 minutos de ese uso (50 desde que se montó).
      await vi.advanceTimersByTimeAsync(20 * MINUTO - 1);
      expect(H.logout).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(H.logout).toHaveBeenCalledTimes(1);
    }
  );

  it("la rueda sobre la lista cuenta aunque no llegue burbujeando a la ventana (un cuadro que corta la propagación)", async () => {
    render(<IdleLogout />);
    const lista = document.createElement("div");
    document.body.appendChild(lista);

    await vi.advanceTimersByTimeAsync(20 * MINUTO);
    lista.dispatchEvent(new Event("wheel", { bubbles: false }));

    await vi.advanceTimersByTimeAsync(10 * MINUTO);
    expect(H.logout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20 * MINUTO);
    expect(H.logout).toHaveBeenCalledTimes(1);
  });

  it("al desmontar no queda el conteo ni los listeners", async () => {
    const { unmount } = render(<IdleLogout />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);

    usar("keydown");
    await vi.advanceTimersByTimeAsync(60 * MINUTO);
    expect(H.logout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
