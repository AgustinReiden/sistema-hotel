import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GuestModal from "./GuestModal";

// F2-9: "Guardar Cambios" no queda gris. Sin nombre dice qué falta y lleva el cursor.

const H = vi.hoisted(() => ({
  loadGuestRecordAction: vi.fn(),
  updateGuestAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  loadGuestRecordAction: H.loadGuestRecordAction,
  updateGuestAction: H.updateGuestAction,
}));

async function montar(fullName: string) {
  H.loadGuestRecordAction.mockResolvedValue({
    success: true,
    data: {
      id: "huesped-1",
      full_name: fullName,
      document_type: "DNI",
      document_id: "30123456",
      phone: null,
      address: null,
      locality: null,
      nationality: null,
      profession: null,
      discount_percent: 0,
      cuenta_corriente_habilitada: false,
      facturacion_modo: "por_checkout",
      condicion_iva: null,
      cuit: null,
      razon_social: null,
      domicilio_fiscal: null,
      robinet_id: null,
    },
  });
  const { container } = render(<GuestModal guestId="huesped-1" onClose={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Cuenta corriente")).toBeTruthy());
  return { container };
}

const boton = (container: HTMLElement) => {
  const el = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!el) throw new Error("No está el botón de guardar");
  return el;
};

beforeEach(() => {
  vi.clearAllMocks();
  H.updateGuestAction.mockResolvedValue({ success: true });
});

describe("GuestModal: el botón dice qué falta", () => {
  it("sin nombre el botón está activo; al tocarlo avisa y el foco va al nombre", async () => {
    const { container } = await montar("");
    expect(boton(container)).toBeEnabled();

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: Nombre completo")).toBeInTheDocument();
    const nombre = container.querySelector<HTMLInputElement>("#guest-full-name")!;
    expect(document.activeElement).toBe(nombre);
    expect(nombre).toHaveAttribute("aria-invalid", "true");
    expect(H.updateGuestAction).not.toHaveBeenCalled();
    expect(H.toast.error).not.toHaveBeenCalled();
  });

  it("con nombre guarda", async () => {
    const { container } = await montar("Juan Prueba");

    fireEvent.click(boton(container));

    await waitFor(() => expect(H.updateGuestAction).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Falta completar/)).toBeNull();
  });
});
