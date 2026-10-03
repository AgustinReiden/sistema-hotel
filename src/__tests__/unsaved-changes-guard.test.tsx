import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { UNSAVED_CHANGES_MESSAGE, useUnsavedChangesGuard } from "@/app/admin/settings/useUnsavedChangesGuard";

function Probe({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard(dirty);
  return (
    <div>
      <a href="/admin">Hoy</a>
      <a href="/admin/settings?tab=arca">ARCA</a>
      <a href="/admin/settings">Hotel</a>
      <a href="/admin/rooms" target="_blank">
        Habitaciones en otra pestaña
      </a>
      <a href="#abajo">Ancla</a>
    </div>
  );
}

// jsdom no navega: este listener (en burbuja, después del guard) evita el aviso de
// "navigation not implemented" cuando el guard deja pasar el clic.
const frenarNavegacion = (e: Event) => e.preventDefault();

function clic(container: HTMLElement, texto: string, init: MouseEventInit = {}) {
  const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === texto)!;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  link.dispatchEvent(event);
  return event;
}

describe("useUnsavedChangesGuard", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.pushState({}, "", "/admin/settings");
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    document.addEventListener("click", frenarNavegacion);
  });

  afterEach(() => {
    document.removeEventListener("click", frenarNavegacion);
    confirmSpy.mockRestore();
  });

  it("el mensaje es el que pide la ficha", () => {
    expect(UNSAVED_CHANGES_MESSAGE).toBe("Tenés cambios sin guardar. ¿Salir igual?");
  });

  it("con cambios, cerrar o recargar la pestaña pide confirmación", () => {
    render(<Probe dirty />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("sin cambios, cerrar la pestaña no pregunta", () => {
    render(<Probe dirty={false} />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("con cambios, un clic a otra pantalla pregunta y, si se cancela, no sigue", () => {
    confirmSpy.mockReturnValue(false);
    const { container } = render(<Probe dirty />);
    const propagado = vi.fn();
    document.body.addEventListener("click", propagado);
    const event = clic(container, "Hoy");
    document.body.removeEventListener("click", propagado);
    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(event.defaultPrevented).toBe(true);
    // Tampoco le llega al Link de Next, que escucha más abajo.
    expect(propagado).not.toHaveBeenCalled();
  });

  it("con cambios, si dice que sí, el clic sigue su camino", () => {
    confirmSpy.mockReturnValue(true);
    const { container } = render(<Probe dirty />);
    const propagado = vi.fn();
    document.body.addEventListener("click", propagado);
    clic(container, "Hoy");
    document.body.removeEventListener("click", propagado);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(propagado).toHaveBeenCalledTimes(1);
  });

  it("cambiar de pestaña dentro de Configuración no pregunta", () => {
    const { container } = render(<Probe dirty />);
    const propagado = vi.fn();
    document.body.addEventListener("click", propagado);
    clic(container, "ARCA");
    clic(container, "Hotel");
    document.body.removeEventListener("click", propagado);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(propagado).toHaveBeenCalledTimes(2);
  });

  it("un ancla de la misma página, un link que abre otra pestaña o un clic con Ctrl no preguntan", () => {
    const { container } = render(<Probe dirty />);
    clic(container, "Ancla");
    clic(container, "Habitaciones en otra pestaña");
    clic(container, "Hoy", { ctrlKey: true });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("sin cambios nunca pregunta", () => {
    const { container } = render(<Probe dirty={false} />);
    clic(container, "Hoy");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("al guardar (dirty vuelve a false) deja de preguntar", () => {
    const { container, rerender } = render(<Probe dirty />);
    rerender(<Probe dirty={false} />);
    clic(container, "Hoy");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
