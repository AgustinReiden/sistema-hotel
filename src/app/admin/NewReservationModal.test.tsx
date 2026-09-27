import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import NewReservationModal from "./NewReservationModal";
import type { Room } from "@/lib/types";

// Reserva nueva (F0-10): primero las fechas y después la habitación, y un aviso junto al
// selector cuando la habitación elegida deja de estar libre para esas fechas. El botón
// final (noches y salida) lo cubre NewReservationModal.boton-final.test.tsx.

const H = vi.hoisted(() => ({
  fetchAvailableRoomsAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("./actions", () => ({
  fetchAvailableRoomsAction: H.fetchAvailableRoomsAction,
  searchGuestsAction: vi.fn().mockResolvedValue([]),
}));

function habitacion(id: number, numero: string): Room {
  return {
    id,
    category_id: null,
    room_number: numero,
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
}

const hab5 = habitacion(5, "5");
const hab7 = habitacion(7, "7");
// Habitación renombrada: el id no es el número que ve la recepcionista.
const hab12 = habitacion(20, "12");

function abrir(initialValues: React.ComponentProps<typeof NewReservationModal>["initialValues"]) {
  return render(
    <NewReservationModal
      isOpen
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      rooms={[hab5, hab7, hab12]}
      associatedClients={[]}
      initialValues={initialValues}
    />
  );
}

const selector = () => screen.getByLabelText("Habitación") as HTMLSelectElement;

function botonCrear(container: HTMLElement): HTMLButtonElement {
  const boton = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!boton) throw new Error("No está el botón de crear la reserva");
  return boton;
}

// Cambia la Salida con el calendario al día `dia` del mes que muestra (octubre 2026).
function cambiarSalida(dia: string) {
  fireEvent.click(screen.getByLabelText("Salida"));
  fireEvent.click(screen.getByText(dia));
  fireEvent.click(screen.getByText("Aceptar"));
}

function completarHuesped() {
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Juan" } });
  fireEvent.change(screen.getByLabelText("Apellido"), { target: { value: "Prueba" } });
  fireEvent.change(screen.getByLabelText("DNI o CUIT"), { target: { value: "30123456" } });
}

function expectAntes(primero: Element, despues: Element) {
  expect(primero.compareDocumentPosition(despues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

beforeAll(() => {
  // jsdom no implementa scrollIntoView, y el calendario de las fechas lo usa al abrirse.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  H.fetchAvailableRoomsAction.mockReset();
});

describe("NewReservationModal: primero las fechas", () => {
  it("el formulario va en orden: cliente, fechas, habitación y pasajeros", () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([hab5, hab7]);
    const { container } = abrir({ checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });

    const cliente = container.querySelector("#clientSearch");
    if (!cliente) throw new Error("No está el buscador de cliente");
    const entrada = screen.getByLabelText("Entrada");
    const salida = screen.getByLabelText("Salida");
    const pasajeros = screen.getByLabelText("Cantidad de pasajeros");

    expectAntes(cliente, entrada);
    expectAntes(entrada, salida);
    expectAntes(salida, selector());
    expectAntes(selector(), pasajeros);
  });
});

describe("NewReservationModal: aviso cuando la habitación elegida deja de estar libre", () => {
  it("entrando desde el calendario con la Hab. 5 ocupada en esas fechas: aviso junto al selector y selector vacío", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([hab7]);
    const { container } = abrir({ roomId: 5, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });

    const texto = await screen.findByText(
      "La Hab. 5 no está libre del 12 oct al 14 oct. Elegí otra o cambiá las fechas."
    );
    const aviso = texto.closest('[role="alert"]');
    expect(aviso).not.toBeNull();
    // Pegado al selector: viene justo después y el selector lo anuncia.
    expectAntes(selector(), aviso as Element);
    expectAntes(aviso as Element, screen.getByLabelText("Cantidad de pasajeros"));
    expect(selector()).toHaveAttribute("aria-describedby", (aviso as Element).id);

    expect(selector().value).toBe("");
    expect(botonCrear(container)).toBeDisabled();
  });

  it("con la Hab. 12 elegida, cambiar la salida a un día en que está ocupada: aviso y selector vacío", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValueOnce([hab12, hab7]).mockResolvedValue([hab7]);
    abrir({ roomId: 20, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });

    // Libre del 12 al 14: queda elegida y sin aviso.
    await waitFor(() => expect(selector().value).toBe("20"));
    expect(screen.queryByText(/no está libre/)).toBeNull();

    // La salida pasa al 16 de octubre y la 12 deja de estar libre.
    fireEvent.click(screen.getByLabelText("Salida"));
    fireEvent.click(screen.getByText("16"));
    fireEvent.click(screen.getByText("Aceptar"));

    expect(
      await screen.findByText("La Hab. 12 no está libre del 12 oct al 16 oct. Elegí otra o cambiá las fechas.")
    ).toBeInTheDocument();
    expect(selector().value).toBe("");
    expect(H.fetchAvailableRoomsAction).toHaveBeenCalledTimes(2);
  });

  it("al elegir otra habitación el aviso se va y la reserva se puede crear", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([hab7]);
    const { container } = abrir({ roomId: 5, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });

    await screen.findByText(/La Hab\. 5 no está libre/);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Juan" } });
    fireEvent.change(screen.getByLabelText("Apellido"), { target: { value: "Prueba" } });
    fireEvent.change(screen.getByLabelText("DNI o CUIT"), { target: { value: "30123456" } });
    // Con el huésped completo, lo único que falta es la habitación.
    expect(botonCrear(container)).toBeDisabled();

    fireEvent.change(selector(), { target: { value: "7" } });

    expect(screen.queryByText(/no está libre/)).toBeNull();
    expect(selector()).not.toHaveAttribute("aria-describedby");
    expect(selector().value).toBe("7");
    expect(botonCrear(container)).toBeEnabled();
  });

  it("si la habitación elegida sigue libre, no hay aviso", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([hab5, hab7]);
    abrir({ roomId: 5, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });

    await waitFor(() => expect(selector().value).toBe("5"));
    expect(screen.queryByText(/no está libre/)).toBeNull();
  });
});

describe("NewReservationModal: el aviso sigue a las fechas que están en pantalla", () => {
  it("si con las fechas nuevas la Hab. 5 está libre, vuelve a quedar elegida y el aviso se va", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValueOnce([hab7]).mockResolvedValue([hab5, hab7]);
    const { container } = abrir({ roomId: 5, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });
    await screen.findByText(/La Hab\. 5 no está libre del 12 oct al 14 oct/);

    // Hace lo que dice el aviso: la salida pasa al 13, donde la 5 está libre.
    cambiarSalida("13");

    await waitFor(() => expect(selector().value).toBe("5"));
    expect(screen.queryByText(/no está libre/)).toBeNull();
    expect(selector()).not.toHaveAttribute("aria-describedby");
    expect(H.fetchAvailableRoomsAction).toHaveBeenCalledTimes(2);

    completarHuesped();
    expect(botonCrear(container)).toBeEnabled();
  });

  it("si con las fechas nuevas sigue ocupada, el aviso dice las fechas nuevas y no las viejas", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([hab7]);
    abrir({ roomId: 5, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });
    await screen.findByText(/La Hab\. 5 no está libre del 12 oct al 14 oct/);

    cambiarSalida("16");
    // Mientras se consulta, no queda a la vista el aviso con las fechas de antes.
    expect(screen.queryByText(/al 14 oct/)).toBeNull();

    expect(
      await screen.findByText("La Hab. 5 no está libre del 12 oct al 16 oct. Elegí otra o cambiá las fechas.")
    ).toBeInTheDocument();
    expect(selector().value).toBe("");
    expect(H.fetchAvailableRoomsAction).toHaveBeenCalledTimes(2);
  });

  it("con la salida antes de la entrada no queda el aviso de las fechas anteriores", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([hab7]);
    abrir({ roomId: 5, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });
    await screen.findByText(/La Hab\. 5 no está libre/);

    cambiarSalida("10");

    expect(screen.getByText("Elegí primero las fechas")).toBeInTheDocument();
    expect(screen.queryByText(/no está libre/)).toBeNull();
    expect(selector()).not.toHaveAttribute("aria-describedby");
    expect(selector().value).toBe("");
  });

  it("si la consulta de disponibilidad falla, no dice que la habitación está ocupada", async () => {
    // null = no se pudo consultar (distinto de [] = no hay ninguna libre).
    H.fetchAvailableRoomsAction.mockResolvedValueOnce(null).mockResolvedValue([hab5, hab7]);
    const { container } = abrir({ roomId: 5, checkIn: "2026-10-12T14:00", checkOut: "2026-10-14T10:00" });

    await waitFor(() => expect(H.fetchAvailableRoomsAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(selector()).toBeEnabled());
    expect(screen.queryByText(/no está libre/)).toBeNull();
    expect(selector().value).toBe("");
    expect(botonCrear(container)).toBeDisabled();

    // La consulta siguiente anda y la 5 está libre: vuelve a quedar elegida.
    cambiarSalida("13");
    await waitFor(() => expect(selector().value).toBe("5"));
    expect(screen.queryByText(/no está libre/)).toBeNull();
  });
});
