import { afterEach, describe, expect, it, vi } from "vitest";

import { focusFirst } from "./MissingFieldsNotice";

// El aviso se trae a la vista solo si entra junto con el campo enfocado; si no, el campo
// queda a la vista y no se salta a un aviso que lo deja fuera de pantalla.

function montar(alturaEntreCampoYAviso: number) {
  document.body.innerHTML =
    '<input id="campo" /><div data-missing-notice>Falta completar: Campo</div>';
  const campo = document.getElementById("campo")!;
  const aviso = document.querySelector<HTMLElement>("[data-missing-notice]")!;
  campo.getBoundingClientRect = () => ({ top: 0, bottom: 20 }) as DOMRect;
  aviso.getBoundingClientRect = () =>
    ({ top: alturaEntreCampoYAviso - 40, bottom: alturaEntreCampoYAviso }) as DOMRect;
  const scroll = vi.fn();
  aviso.scrollIntoView = scroll;
  return scroll;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("focusFirst", () => {
  it("trae el aviso a la vista si entra junto con el campo", async () => {
    const scroll = montar(300);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);

    expect(focusFirst([{ id: "campo", label: "Campo", ok: false }])).toBe("campo");

    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(document.getElementById("campo"));
  });

  it("si el aviso queda más lejos que la pantalla, no se mueve y el campo sigue a la vista", async () => {
    const scroll = montar(900);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);

    focusFirst([{ id: "campo", label: "Campo", ok: false }]);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById("campo"));
  });

  it("mide contra el cuadro que scrollea y no contra la ventana", async () => {
    document.body.innerHTML =
      '<div id="cuadro" style="overflow-y: auto"><input id="campo" /><div data-missing-notice>Falta completar: Campo</div></div>';
    const cuadro = document.getElementById("cuadro")!;
    Object.defineProperty(cuadro, "clientHeight", { configurable: true, value: 704 });
    const campo = document.getElementById("campo")!;
    const aviso = document.querySelector<HTMLElement>("[data-missing-notice]")!;
    campo.getBoundingClientRect = () => ({ top: 0, bottom: 40 }) as DOMRect;
    aviso.getBoundingClientRect = () => ({ top: 720, bottom: 760 }) as DOMRect;
    const scroll = vi.fn();
    aviso.scrollIntoView = scroll;
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);

    focusFirst([{ id: "campo", label: "Campo", ok: false }]);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo);
  });
});
