import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminAlertsBell from "./AdminAlertsBell";
import OpenAlertsButton from "./OpenAlertsButton";
import type { AdminAlert } from "@/lib/types";

const H = vi.hoisted(() => ({
  listAdminAlertsAction: vi.fn(),
  resolveAdminAlertAction: vi.fn(),
  authorizeOldTariffAction: vi.fn(),
  rejectOldTariffAction: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: H.refresh, push: vi.fn() }),
}));
vi.mock("./mantenimiento/actions", () => ({
  listAdminAlertsAction: H.listAdminAlertsAction,
  resolveAdminAlertAction: H.resolveAdminAlertAction,
  authorizeOldTariffAction: H.authorizeOldTariffAction,
  rejectOldTariffAction: H.rejectOldTariffAction,
}));

const TZ = "America/Argentina/Tucuman";

function aviso(overrides: Partial<AdminAlert> = {}): AdminAlert {
  return {
    id: 1,
    kind: "reservation_overpayment",
    message: "Se cobró de más en la Hab. 4",
    related_room_id: 4,
    related_room_number: "4",
    related_cleaning_log_id: null,
    related_reservation_id: null,
    decision: null,
    payload: null,
    created_at: "2026-09-26T17:30:00.000Z",
    resolved_at: null,
    resolved_by: null,
    resolved_notes: null,
    ...overrides,
  };
}

const TARIFA = aviso({
  id: 11,
  kind: "room_change_keep_old_tariff_request",
  message: "Pedido de mantener la tarifa en la Hab. 2",
});
const OCUPADA = aviso({
  id: 12,
  kind: "room_occupied_without_active_reservation",
  message: "Hab. 5 marcada ocupada sin estadía",
});
const PAGO = aviso({ id: 13 });

function conAvisos(alerts: AdminAlert[]) {
  H.listAdminAlertsAction.mockResolvedValue({ success: true, data: { alerts, timezone: TZ } });
}

// La campana dice "Avisos" o "Avisos: N sin revisar"; el panel abierto, "Avisos sin revisar".
const campana = () => screen.getByLabelText(/^Avisos(:|$)/);
const badge = (container: HTMLElement) => container.querySelector("[data-alerts-badge]");

async function abrir() {
  await act(async () => {
    fireEvent.click(campana());
  });
  await waitFor(() => expect(H.listAdminAlertsAction).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  conAvisos([TARIFA, OCUPADA, PAGO]);
  H.resolveAdminAlertAction.mockResolvedValue({ success: true });
  H.authorizeOldTariffAction.mockResolvedValue({ success: true });
  H.rejectOldTariffAction.mockResolvedValue({ success: true });
});

describe("campana de avisos del admin: el número", () => {
  it("con 3 avisos sin revisar muestra 3", () => {
    const { container } = render(<AdminAlertsBell initialCount={3} />);
    expect(badge(container)).toHaveTextContent("3");
    expect(campana()).toHaveAttribute("aria-label", "Avisos: 3 sin revisar");
  });

  it("sin avisos no hay número", () => {
    const { container } = render(<AdminAlertsBell initialCount={0} />);
    expect(badge(container)).toBeNull();
    expect(campana()).toHaveAttribute("aria-label", "Avisos");
  });

  it("de 100 para arriba dice 99+ (la lista trae como mucho 100)", () => {
    const { container } = render(<AdminAlertsBell initialCount={100} />);
    expect(badge(container)).toHaveTextContent("99+");
  });

  it("si cambia el número que trae el servidor (después de un refresco), lo sigue", () => {
    const { container, rerender } = render(<AdminAlertsBell initialCount={3} />);
    rerender(<AdminAlertsBell initialCount={1} />);
    expect(badge(container)).toHaveTextContent("1");
  });
});

describe("campana de avisos del admin: el panel", () => {
  it("abrir pide la lista una vez y el número pasa a ser el largo de la lista", async () => {
    conAvisos([TARIFA, OCUPADA]);
    const { container } = render(<AdminAlertsBell initialCount={5} />);
    await abrir();

    expect(H.listAdminAlertsAction).toHaveBeenCalledTimes(1);
    const panel = container.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(await screen.findByText("Pedido de mantener la tarifa en la Hab. 2")).toBeInTheDocument();
    expect(badge(container)).toHaveTextContent("2");
  });

  it("vacía dice que no hay nada y el número desaparece", async () => {
    conAvisos([]);
    const { container } = render(<AdminAlertsBell initialCount={1} />);
    await abrir();
    expect(await screen.findByText("No hay avisos sin revisar.")).toBeInTheDocument();
    expect(badge(container)).toBeNull();
  });

  it("si la lista no se puede leer lo dice y deja el número como estaba", async () => {
    H.listAdminAlertsAction.mockResolvedValue({ success: false, error: "Sin conexión." });
    const { container } = render(<AdminAlertsBell initialCount={2} />);
    await abrir();
    expect(await screen.findByText("Sin conexión.")).toBeInTheDocument();
    expect(badge(container)).toHaveTextContent("2");
  });

  it("cada aviso lleva su rótulo y la fecha en la hora del hotel", async () => {
    const { container } = render(<AdminAlertsBell initialCount={3} />);
    await abrir();
    expect(await screen.findByText("Tarifa para autorizar")).toBeInTheDocument();
    expect(screen.getByText("Habitación usada sin estadía")).toBeInTheDocument();
    expect(screen.getByText("Pago de más")).toBeInTheDocument();
    // 17:30 UTC = 14:30 en Tucumán, una vez por aviso.
    const texto = container.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(texto.split("26/09/2026, 02:30 p.\xa0m.")).toHaveLength(4);
  });

  it("Escape lo cierra", async () => {
    const { container } = render(<AdminAlertsBell initialCount={3} />);
    await abrir();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("al cerrar el foco vuelve a la campana", async () => {
    const { container } = render(<AdminAlertsBell initialCount={3} />);
    await abrir();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("button[aria-haspopup]"));
  });

  it("Tab no se escapa del diálogo", async () => {
    conAvisos([PAGO]);
    const { container } = render(<AdminAlertsBell initialCount={1} />);
    await abrir();
    await screen.findByText("Pago de más");
    const dialog = container.querySelector('[role="dialog"]')!;
    const botones = Array.from(dialog.querySelectorAll("button"));
    botones[botones.length - 1].focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(botones[0]);
  });

  it("si la lista no se pudo leer, Reintentar la vuelve a pedir", async () => {
    H.listAdminAlertsAction.mockResolvedValueOnce({ success: false, error: "Sin conexión." });
    render(<AdminAlertsBell initialCount={1} />);
    await abrir();
    await screen.findByText("Sin conexión.");
    conAvisos([PAGO]);
    await act(async () => {
      fireEvent.click(screen.getByText("Reintentar"));
    });
    expect(await screen.findByText("Pago de más")).toBeInTheDocument();
  });
});

describe("campana de avisos del admin: las acciones", () => {
  it("autorizar la tarifa anterior llama la acción, baja el número sin recargar y refresca", async () => {
    const { container } = render(<AdminAlertsBell initialCount={3} />);
    await abrir();
    await act(async () => {
      fireEvent.click(await screen.findByText("Autorizar tarifa anterior"));
    });

    expect(H.authorizeOldTariffAction).toHaveBeenCalledWith(11);
    await waitFor(() => expect(badge(container)).toHaveTextContent("2"));
    expect(screen.queryByText("Pedido de mantener la tarifa en la Hab. 2")).toBeNull();
    expect(H.toast.success).toHaveBeenCalled();
    expect(H.refresh).toHaveBeenCalled();
  });

  it("rechazar el pedido de tarifa llama su acción", async () => {
    render(<AdminAlertsBell initialCount={3} />);
    await abrir();
    await act(async () => {
      fireEvent.click(await screen.findByText("Rechazar"));
    });
    expect(H.rejectOldTariffAction).toHaveBeenCalledWith(11);
  });

  it("si la acción falla, el aviso queda y sale el error", async () => {
    H.authorizeOldTariffAction.mockResolvedValue({ success: false, error: "No se pudo." });
    const { container } = render(<AdminAlertsBell initialCount={3} />);
    await abrir();
    await act(async () => {
      fireEvent.click(await screen.findByText("Autorizar tarifa anterior"));
    });
    expect(H.toast.error).toHaveBeenCalledWith("No se pudo.");
    expect(screen.getByText("Pedido de mantener la tarifa en la Hab. 2")).toBeInTheDocument();
    expect(badge(container)).toHaveTextContent("3");
  });

  it("los demás se marcan leídos, sin nota", async () => {
    render(<AdminAlertsBell initialCount={3} />);
    await abrir();
    await act(async () => {
      fireEvent.click(await screen.findByText("Marcar leída"));
    });
    expect(H.resolveAdminAlertAction).toHaveBeenCalledWith(13);
  });

  it("la habitación ocupada ofrece Regularizar en Hoy y no ofrece Marcar leída", async () => {
    conAvisos([OCUPADA]);
    render(<AdminAlertsBell initialCount={1} />);
    await abrir();
    const link = await screen.findByText("Regularizar en Hoy");
    expect(link.closest("a")).toHaveAttribute("href", "/admin");
    expect(screen.getByText("Cerrar sin cargar")).toBeInTheDocument();
    expect(screen.queryByText("Marcar leída")).toBeNull();
  });

  it("Cerrar sin cargar no confirma sin nota; con nota llama la acción con la nota", async () => {
    conAvisos([OCUPADA]);
    render(<AdminAlertsBell initialCount={1} />);
    await abrir();
    fireEvent.click(await screen.findByText("Cerrar sin cargar"));

    const confirmar = screen.getByText("Confirmar cierre").closest("button")!;
    expect(confirmar).toBeDisabled();
    const nota = screen.getByLabelText("Por qué se cierra sin cargar la estadía");
    fireEvent.change(nota, { target: { value: "   " } });
    expect(confirmar).toBeDisabled();
    fireEvent.click(confirmar);
    expect(H.resolveAdminAlertAction).not.toHaveBeenCalled();

    fireEvent.change(nota, { target: { value: "nota" } });
    expect(confirmar).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirmar);
    });
    expect(H.resolveAdminAlertAction).toHaveBeenCalledWith(12, "nota");
  });

  it("con una nota escrita, Escape y el fondo no cierran el panel", async () => {
    conAvisos([OCUPADA]);
    const { container } = render(<AdminAlertsBell initialCount={1} />);
    await abrir();
    fireEvent.click(await screen.findByText("Cerrar sin cargar"));
    const nota = screen.getByLabelText("Por qué se cierra sin cargar la estadía");
    fireEvent.change(nota, { target: { value: "nota a medias" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    fireEvent.click(container.querySelector('button[tabindex="-1"]')!);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    // Vaciada la nota, Escape vuelve a cerrar.
    fireEvent.change(nota, { target: { value: "" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("campana de avisos del admin: Ver avisos", () => {
  it("el botón Ver avisos abre la campana desde otra parte de la pantalla", async () => {
    const { container } = render(
      <>
        <AdminAlertsBell initialCount={3} />
        <OpenAlertsButton />
      </>
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText("Ver avisos"));
    });
    await waitFor(() => expect(H.listAdminAlertsAction).toHaveBeenCalledTimes(1));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
