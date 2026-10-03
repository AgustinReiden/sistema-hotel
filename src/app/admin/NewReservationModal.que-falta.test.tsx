import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import NewReservationModal from "./NewReservationModal";
import type { AssociatedClient, Room } from "@/lib/types";

// F2-9: "Crear reserva" no queda gris. Dice qué falta (fechas, habitación, cliente), marca
// los campos y lleva el cursor al primero que se pueda tocar.

const H = vi.hoisted(() => ({
  fetchAvailableRoomsAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  fetchAvailableRoomsAction: H.fetchAvailableRoomsAction,
  searchGuestsAction: vi.fn().mockResolvedValue([]),
}));

const hab5: Room = {
  id: 5,
  category_id: null,
  room_number: "5",
  room_type: "Doble",
  status: "available",
  capacity: 2,
  capacity_adults: 2,
  capacity_children: 0,
  beds_configuration: "1 cama doble",
  amenities: [],
  description: null,
  image_url: null,
  base_price: 50000,
  half_day_price: 25000,
  is_active: true,
};

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

function abrir(initialValues?: React.ComponentProps<typeof NewReservationModal>["initialValues"]) {
  const onSubmit = vi.fn().mockResolvedValue({ success: true });
  const view = render(
    <NewReservationModal
      isOpen
      onClose={vi.fn()}
      onSubmit={onSubmit}
      rooms={[hab5]}
      associatedClients={[empresa]}
      initialValues={initialValues}
    />
  );
  return { onSubmit, ...view };
}

const boton = (container: HTMLElement) => {
  const el = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!el) throw new Error("No está el botón de crear la reserva");
  return el;
};
const campo = (container: HTMLElement, id: string) => {
  const el = container.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`No está el campo ${id}`);
  return el;
};
const escribir = (container: HTMLElement, id: string, value: string) =>
  fireEvent.change(campo(container, id), { target: { value } });

const FECHAS = { checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" };

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  H.fetchAvailableRoomsAction.mockResolvedValue([hab5]);
});

describe("NewReservationModal: el botón dice qué falta", () => {
  it("con las fechas cargadas y nada más: el botón está activo y pide habitación y cliente", async () => {
    const { container, onSubmit } = abrir(FECHAS);
    await waitFor(() => expect(campo(container, "roomId")).toBeEnabled());
    expect(boton(container)).toBeEnabled();

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: Habitación, Nombre, Apellido, DNI")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo(container, "roomId"));
    expect(campo(container, "roomId")).toHaveAttribute("aria-invalid", "true");
    expect(campo(container, "clientFirstName")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(H.toast.error).not.toHaveBeenCalled();
  });

  it("con la habitación elegida y sin huésped, el foco va al nombre", async () => {
    const { container, onSubmit } = abrir({ ...FECHAS, roomId: 5 });
    await waitFor(() => expect(campo(container, "roomId")).toBeEnabled());
    await waitFor(() => expect((campo(container, "roomId") as HTMLSelectElement).value).toBe("5"));

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: Nombre, Apellido, DNI")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo(container, "clientFirstName"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("la salida antes de la entrada se avisa con su frase y el foco va a la salida", async () => {
    const { container, onSubmit } = abrir({ checkIn: "2026-10-14T14:00", checkOut: "2026-10-12T10:00" });
    escribir(container, "clientFirstName", "Juan");
    escribir(container, "clientLastName", "Prueba");
    escribir(container, "clientDni", "30123456");

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: Habitación. La salida tiene que ser después de la entrada.")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo(container, "checkOut"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("en modo empresa no pide pasajero: con habitación elegida crea la reserva", async () => {
    const { container, onSubmit } = abrir({ ...FECHAS, roomId: 5 });
    await waitFor(() => expect((campo(container, "roomId") as HTMLSelectElement).value).toBe("5"));
    fireEvent.change(campo(container, "clientSearch"), { target: { value: "Empresa" } });
    fireEvent.click(screen.getByText("Empresa Ficticia SA"));

    fireEvent.click(boton(container));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Falta completar/)).toBeNull();
  });

  it("con todo cargado crea la reserva", async () => {
    const { container, onSubmit } = abrir({ ...FECHAS, roomId: 5 });
    await waitFor(() => expect((campo(container, "roomId") as HTMLSelectElement).value).toBe("5"));
    escribir(container, "clientFirstName", "Juan");
    escribir(container, "clientLastName", "Prueba");
    escribir(container, "clientDni", "30123456");

    fireEvent.click(boton(container));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
