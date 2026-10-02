import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import SettingsPanels from "./SettingsPanels";
import type { HotelSettings } from "@/lib/types";

vi.mock("./actions", () => ({
  updateHotelSettings: vi.fn(),
  listManageableUsersAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
  updateProfileAction: vi.fn(),
}));
vi.mock("../fiscal/actions", () => ({
  arcaHealthAction: vi.fn(),
  updateFiscalSettingsAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const settings = {
  name: "Hotel de Prueba",
  currency: "ARS",
  standard_check_in_time: "14:00:00",
  standard_check_out_time: "10:00:00",
  late_check_out_time: "18:00:00",
  timezone: "America/Argentina/Tucuman",
  hero_title: "Titulo",
  hero_subtitle: "Subtitulo",
  address: "Calle Falsa 123",
  confirmation_message_template: "Hola {nombre}",
} as unknown as HotelSettings;

const panel = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-settings-panel="${id}"]`) as HTMLElement;

describe("SettingsPanels", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  const frenarNavegacion = (e: Event) => e.preventDefault();

  beforeEach(() => {
    window.history.pushState({}, "", "/admin/settings");
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    document.addEventListener("click", frenarNavegacion);
  });

  afterEach(() => {
    document.removeEventListener("click", frenarNavegacion);
    confirmSpy.mockRestore();
  });

  it("muestra solo el panel de la pestaña y deja los otros escondidos pero montados", () => {
    const { container } = render(<SettingsPanels tab="arca" settings={settings} fiscalSettings={null} />);
    expect(panel(container, "hotel").hidden).toBe(true);
    expect(panel(container, "arca").hidden).toBe(false);
    expect(panel(container, "usuarios").hidden).toBe(true);
    expect(container.querySelector('input[name="address"]')).not.toBeNull();
  });

  it("lo tipeado en Hotel sigue ahí después de pasar a ARCA y volver", () => {
    const { container, rerender } = render(<SettingsPanels tab="hotel" settings={settings} fiscalSettings={null} />);
    const mensaje = () =>
      container.querySelector('textarea[name="confirmation_message_template"]') as HTMLTextAreaElement;
    fireEvent.change(mensaje(), { target: { value: "Mensaje nuevo" } });

    rerender(<SettingsPanels tab="arca" settings={settings} fiscalSettings={null} />);
    expect(panel(container, "hotel").hidden).toBe(true);
    rerender(<SettingsPanels tab="hotel" settings={settings} fiscalSettings={null} />);

    expect(panel(container, "hotel").hidden).toBe(false);
    expect(mensaje().value).toBe("Mensaje nuevo");
  });

  it("con cambios sin guardar, irse a otra pantalla pregunta; pasar de pestaña no", () => {
    const { container } = render(
      <div>
        <SettingsPanels tab="hotel" settings={settings} fiscalSettings={null} />
        <a href="/admin">Hoy</a>
        <a href="/admin/settings?tab=arca">ARCA</a>
      </div>
    );
    const link = (texto: string) => Array.from(container.querySelectorAll("a")).find((a) => a.textContent === texto)!;

    const sinCambios = new MouseEvent("click", { bubbles: true, cancelable: true });
    link("Hoy").dispatchEvent(sinCambios);
    expect(confirmSpy).not.toHaveBeenCalled();

    const address = container.querySelector('input[name="address"]') as HTMLInputElement;
    fireEvent.change(address, { target: { value: "Otra calle 456" } });

    link("ARCA").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(confirmSpy).not.toHaveBeenCalled();

    const conCambios = new MouseEvent("click", { bubbles: true, cancelable: true });
    link("Hoy").dispatchEvent(conCambios);
    expect(confirmSpy).toHaveBeenCalledWith("Tenés cambios sin guardar. ¿Salir igual?");
    expect(conCambios.defaultPrevented).toBe(true);
  });
});
