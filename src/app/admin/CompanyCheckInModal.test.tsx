import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CompanyCheckInModal from "./CompanyCheckInModal";

// F2-9: "Hacer Check-In" no queda gris. Sin los datos del pasajero dice qué falta y
// lleva el cursor al primero.

const H = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  searchCompanyPassengersAction: vi.fn().mockResolvedValue([]),
}));

function abrir(initialPassenger?: { name: string; dni: string } | null) {
  const onConfirm = vi.fn();
  const view = render(
    <CompanyCheckInModal
      onClose={vi.fn()}
      onConfirm={onConfirm}
      companyId="empresa-1"
      companyName="Empresa Ficticia SA"
      roomNumber="4"
      initialPassenger={initialPassenger}
    />
  );
  return { onConfirm, ...view };
}

const boton = (container: HTMLElement) => {
  const el = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!el) throw new Error("No está el botón de check-in");
  return el;
};
const campo = (container: HTMLElement, id: string) => {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`No está el campo ${id}`);
  return el;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CompanyCheckInModal: el botón dice qué falta", () => {
  it("con el formulario vacío el botón está activo y al tocarlo pide nombre y DNI", () => {
    const { container, onConfirm } = abrir();
    expect(boton(container)).toBeEnabled();

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: Nombre y apellido, DNI")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo(container, "checkInPassengerName"));
    expect(campo(container, "checkInPassengerDni")).toHaveAttribute("aria-invalid", "true");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(H.toast.error).not.toHaveBeenCalled();
  });

  it("sin DNI, onConfirm no se llama y el foco va al DNI", () => {
    const { container, onConfirm } = abrir({ name: "Juan Prueba", dni: "" });

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: DNI")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo(container, "checkInPassengerDni"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("con los dos datos confirma", () => {
    const { container, onConfirm } = abrir({ name: "Juan Prueba", dni: "30123456" });

    fireEvent.click(boton(container));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      passengerName: "Juan Prueba",
      passengerDni: "30123456",
    });
    expect(screen.queryByText(/Falta completar/)).toBeNull();
  });
});
