import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WalkInModal from "./WalkInModal";
import type { AssociatedClient } from "@/lib/types";

// F2-9: "Asignar" no queda gris. Con datos faltantes dice qué falta, marca los campos y
// lleva el cursor al primero. No manda nada incompleto.

const H = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  searchGuestsAction: vi.fn().mockResolvedValue([]),
  searchCompanyPassengersAction: vi.fn().mockResolvedValue([]),
}));

const empresa: AssociatedClient = {
  id: "empresa-1",
  display_name: "Empresa Ficticia SA",
  document_id: "30-12345678-1",
  phone: null,
  discount_percent: 0,
  notes: null,
  is_active: true,
  cuenta_corriente_habilitada: false,
  condicion_iva: null,
  razon_social: null,
  domicilio: null,
  facturacion_modo: "por_checkout",
  robinet_id: null,
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-09-01T12:00:00.000Z",
};

function abrir(props: Partial<React.ComponentProps<typeof WalkInModal>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ success: true });
  const view = render(
    <WalkInModal
      isOpen
      onClose={vi.fn()}
      onSubmit={onSubmit}
      roomNumber="4"
      basePrice={50000}
      halfDayPrice={25000}
      associatedClients={[empresa]}
      {...props}
    />
  );
  return { onSubmit, ...view };
}

const botonAsignar = (container: HTMLElement) => {
  const boton = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!boton) throw new Error("No está el botón de asignar");
  return boton;
};
const campo = (container: HTMLElement, id: string) => {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`No está el campo ${id}`);
  return el;
};
const escribir = (container: HTMLElement, id: string, value: string) =>
  fireEvent.change(campo(container, id), { target: { value } });

function elegirEmpresa(container: HTMLElement) {
  fireEvent.change(campo(container, "walkinClientSearch"), { target: { value: "Empresa" } });
  fireEvent.click(screen.getByText("Empresa Ficticia SA"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WalkInModal: el botón dice qué falta", () => {
  it("con el formulario vacío 'Asignar' está activo y no hay aviso hasta tocarlo", () => {
    const { container } = abrir();

    expect(botonAsignar(container)).toBeEnabled();
    expect(screen.queryByText(/Falta completar/)).toBeNull();
  });

  it("el submit vacío muestra el aviso, marca los campos y deja el cursor en Nombre sin mandar nada", () => {
    const { container, onSubmit } = abrir();

    fireEvent.click(botonAsignar(container));

    expect(screen.getByText("Falta completar: Nombre, Apellido, DNI")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo(container, "clientFirstName"));
    for (const id of ["clientFirstName", "clientLastName", "clientDni"]) {
      expect(campo(container, id)).toHaveAttribute("aria-invalid", "true");
      expect(campo(container, id).className).toContain("border-red-500");
    }
    // El aviso es del formulario, no un toast que se va.
    expect(H.toast.error).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("el aviso queda arriba del botón y se achica a medida que se completa", () => {
    const { container } = abrir();
    fireEvent.click(botonAsignar(container));

    const aviso = container.querySelector('[role="alert"]') as HTMLElement;
    expect(aviso.compareDocumentPosition(botonAsignar(container)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    escribir(container, "clientFirstName", "Juan");
    expect(screen.getByText("Falta completar: Apellido, DNI")).toBeInTheDocument();
    expect(campo(container, "clientFirstName")).not.toHaveAttribute("aria-invalid");

    escribir(container, "clientLastName", "Prueba");
    escribir(container, "clientDni", "30123456");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("si falta solo el DNI, el cursor va al DNI", () => {
    const { container, onSubmit } = abrir();
    escribir(container, "clientFirstName", "Juan");
    escribir(container, "clientLastName", "Prueba");

    fireEvent.click(botonAsignar(container));

    expect(screen.getByText("Falta completar: DNI")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo(container, "clientDni"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("con todo cargado asigna", async () => {
    const { container, onSubmit } = abrir();
    escribir(container, "clientFirstName", "Juan");
    escribir(container, "clientLastName", "Prueba");
    escribir(container, "clientDni", "30123456");

    fireEvent.click(botonAsignar(container));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Falta completar/)).toBeNull();
  });

  it("en modo empresa sin pasajero, el foco va al nombre del pasajero", () => {
    const { container, onSubmit } = abrir();
    elegirEmpresa(container);

    fireEvent.click(botonAsignar(container));

    expect(screen.getByText("Falta completar: Nombre del pasajero, DNI del pasajero")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo(container, "walkinPassengerName"));
    expect(campo(container, "walkinPassengerDni")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("medio día sin precio: el botón está activo y el aviso dice que avise al administrador", () => {
    const { container, onSubmit } = abrir({ halfDayPrice: 0 });
    fireEvent.click(screen.getByText("Media estadía (siesta)"));
    escribir(container, "clientFirstName", "Juan");
    escribir(container, "clientLastName", "Prueba");
    escribir(container, "clientDni", "30123456");

    expect(botonAsignar(container)).toBeEnabled();
    fireEvent.click(botonAsignar(container));

    expect(
      screen.getByText("Falta el precio de medio día de esta habitación: avisale al administrador.")
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
