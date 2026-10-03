import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NewReservationModal from "./NewReservationModal";
import type { Room } from "@/lib/types";

// El botón final de "Nueva reserva" repite las noches y el día de salida (F0-6). El resto
// del modal (orden de los campos, aviso de habitación ocupada) lo cubre
// NewReservationModal.test.tsx, que crea F0-10.

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

const habitacion: Room = {
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

function abrir(initialValues: React.ComponentProps<typeof NewReservationModal>["initialValues"]) {
  return render(
    <NewReservationModal
      isOpen
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      rooms={[habitacion]}
      associatedClients={[]}
      initialValues={initialValues}
    />
  );
}

describe("NewReservationModal: el botón final dice noches y salida", () => {
  it("entrada el 24/09 a las 14:00 y salida el 26/09 a las 10:00: 'Crear reserva · 2 noches · sale el 26/09'", async () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([habitacion]);
    abrir({ roomId: 5, checkIn: "2026-09-24T14:00", checkOut: "2026-09-26T10:00" });

    expect(screen.getByText("Crear reserva · 2 noches · sale el 26/09")).toBeInTheDocument();
    // La habitación sigue libre después de consultar la disponibilidad: el texto no cambia.
    await waitFor(() => expect(H.fetchAvailableRoomsAction).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Buscando disponibilidad…")).toBeNull());
    expect(screen.getByText("Crear reserva · 2 noches · sale el 26/09")).toBeInTheDocument();
  });

  it("una sola noche: 'Crear reserva · 1 noche · sale el 25/09'", () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([habitacion]);
    abrir({ roomId: 5, checkIn: "2026-09-24T14:00", checkOut: "2026-09-25T10:00" });

    expect(screen.getByText("Crear reserva · 1 noche · sale el 25/09")).toBeInTheDocument();
  });

  it("sin habitación elegida no hay precio, y el botón dice solo 'Crear reserva'", () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([habitacion]);
    abrir({ checkIn: "2026-09-24T14:00", checkOut: "2026-09-26T10:00" });

    expect(screen.getByText("Crear reserva")).toBeInTheDocument();
    expect(screen.queryByText(/Crear reserva ·/)).toBeNull();
  });

  it("la ayuda de pasajeros dice 'habitación' con tilde", () => {
    H.fetchAvailableRoomsAction.mockResolvedValue([habitacion]);
    abrir({ checkIn: "2026-09-24T14:00", checkOut: "2026-09-26T10:00" });

    expect(
      screen.getByText("Opcional. No afecta el precio (se calcula por habitación).")
    ).toBeInTheDocument();
  });
});
