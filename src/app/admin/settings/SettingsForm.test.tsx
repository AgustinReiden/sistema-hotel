import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import SettingsForm from "./SettingsForm";
import type { HotelSettings } from "@/lib/types";

const updateHotelSettings = vi.fn();
vi.mock("./actions", () => ({
  updateHotelSettings: (...a: unknown[]) => updateHotelSettings(...a),
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

describe("SettingsForm: cambios sin guardar", () => {
  beforeEach(() => {
    updateHotelSettings.mockReset();
  });

  it("al abrir no hay cambios", () => {
    const onDirtyChange = vi.fn();
    const { queryByText } = render(<SettingsForm settings={settings} onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    expect(queryByText("Cambios sin guardar")).toBeNull();
  });

  it("tipear avisa que hay cambios y muestra la leyenda", () => {
    const onDirtyChange = vi.fn();
    const { container, getByText } = render(<SettingsForm settings={settings} onDirtyChange={onDirtyChange} />);
    const address = container.querySelector('input[name="address"]') as HTMLInputElement;
    fireEvent.change(address, { target: { value: "Otra calle 456" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(getByText("Cambios sin guardar")).toBeTruthy();
  });

  it("volver al valor original saca el aviso", () => {
    const onDirtyChange = vi.fn();
    const { container, queryByText } = render(<SettingsForm settings={settings} onDirtyChange={onDirtyChange} />);
    const address = container.querySelector('input[name="address"]') as HTMLInputElement;
    fireEvent.change(address, { target: { value: "Otra calle 456" } });
    fireEvent.change(address, { target: { value: "Calle Falsa 123" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(queryByText("Cambios sin guardar")).toBeNull();
  });

  it("cambiar el mensaje de confirmación también cuenta, y Restaurar sugerido", () => {
    const onDirtyChange = vi.fn();
    const { container, getByText } = render(<SettingsForm settings={settings} onDirtyChange={onDirtyChange} />);
    const mensaje = container.querySelector('textarea[name="confirmation_message_template"]') as HTMLTextAreaElement;
    fireEvent.change(mensaje, { target: { value: "Otro mensaje" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(mensaje, { target: { value: "Hola {nombre}" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(getByText("Restaurar sugerido"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("guardar bien deja el formulario limpio", async () => {
    updateHotelSettings.mockResolvedValue({ success: true });
    const onDirtyChange = vi.fn();
    const { container, getByText, queryByText } = render(
      <SettingsForm settings={settings} onDirtyChange={onDirtyChange} />
    );
    const address = container.querySelector('input[name="address"]') as HTMLInputElement;
    fireEvent.change(address, { target: { value: "Otra calle 456" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(updateHotelSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(queryByText("Cambios sin guardar")).toBeNull();
    // La transición termina un instante después: el botón vuelve a decir Guardar.
    await waitFor(() => expect(getByText("Guardar Ajustes")).toBeTruthy());
  });

  it("si guardar falla, los cambios siguen marcados", async () => {
    updateHotelSettings.mockResolvedValue({ success: false, error: "No se pudo" });
    const onDirtyChange = vi.fn();
    const { container, getByText } = render(<SettingsForm settings={settings} onDirtyChange={onDirtyChange} />);
    const address = container.querySelector('input[name="address"]') as HTMLInputElement;
    fireEvent.change(address, { target: { value: "Otra calle 456" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(updateHotelSettings).toHaveBeenCalledTimes(1));
    expect(onDirtyChange).not.toHaveBeenLastCalledWith(false);
    expect(getByText("Cambios sin guardar")).toBeTruthy();
  });
});
