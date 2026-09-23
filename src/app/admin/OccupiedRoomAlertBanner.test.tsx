import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OccupiedRoomAlertBanner from "./OccupiedRoomAlertBanner";
import type { AssignWalkInPayload, RoomOccupancyAlert } from "@/lib/types";

const H = vi.hoisted(() => ({
  regularizeOccupiedRoomAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  regularizeOccupiedRoomAction: H.regularizeOccupiedRoomAction,
}));

/**
 * El modal del walk-in de siempre, reducido a un botón que manda lo que mandaría
 * el formulario. Lo que se prueba acá es qué hace el banner con eso.
 */
vi.mock("./WalkInModal", () => ({
  default: ({
    isOpen,
    onSubmit,
  }: {
    isOpen: boolean;
    onSubmit: (data: AssignWalkInPayload) => Promise<unknown>;
  }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() =>
          onSubmit({
            mode: "person",
            roomId: 2,
            clientFirstName: "Pasajero",
            clientLastName: "De Prueba",
            clientDni: "30111222",
            nights: 1,
            stayType: "night",
          })
        }
      >
        Confirmar walk-in
      </button>
    ) : null,
}));

const TZ = "America/Argentina/Buenos_Aires";

const pricingByRoomId = {
  2: { roomNumber: "2", basePrice: 50000, halfDayPrice: 25000 },
  5: { roomNumber: "5", basePrice: 60000, halfDayPrice: 30000 },
};

function alerta(overrides: Partial<RoomOccupancyAlert>): RoomOccupancyAlert {
  return {
    alert_id: 1,
    room_id: 2,
    room_number: "2",
    message: "Habitacion marcada ocupada sin reserva activa",
    created_at: "2026-09-23T14:05:00.000Z",
    // 11:00 en Argentina: el rastro es de la noche anterior.
    detected_at: "2026-09-23T14:00:00.000Z",
    reported_by_name: "Limpieza",
    resolved_at: null,
    decision: null,
    resolved_notes: null,
    resolved_by_name: null,
    ...overrides,
  };
}

const abierta = alerta({ alert_id: 10 });
const cobrada = alerta({
  alert_id: 11,
  room_id: 5,
  room_number: "5",
  resolved_at: "2026-09-23T15:00:00.000Z",
  decision: "regularizada",
  resolved_by_name: "Administracion",
});
const sinCobrar = alerta({
  alert_id: 12,
  room_id: 7,
  room_number: "7",
  resolved_at: "2026-09-23T16:00:00.000Z",
  decision: null,
  resolved_by_name: "Administracion",
  resolved_notes: "Uso interno",
});

function renderBanner(alerts: RoomOccupancyAlert[], isAdmin: boolean) {
  return render(
    <OccupiedRoomAlertBanner
      alerts={alerts}
      pricingByRoomId={pricingByRoomId}
      associatedClients={[]}
      timezone={TZ}
      isAdmin={isAdmin}
    />
  );
}

beforeEach(() => {
  H.regularizeOccupiedRoomAction.mockReset();
  H.toast.success.mockReset();
  H.toast.warning.mockReset();
});

describe("OccupiedRoomAlertBanner", () => {
  it("sin avisos no dibuja nada", () => {
    const { container } = renderBanner([], true);
    expect(container).toBeEmptyDOMElement();
  });

  it("al recepcionista le muestra el aviso pero no el botón de cobrar", () => {
    renderBanner([abierta], false);

    expect(screen.getByText("Hay 1 habitación usada sin estadía cargada")).toBeInTheDocument();
    expect(screen.getByText("Lo resuelve el administrador")).toBeInTheDocument();
    expect(screen.queryByText("Cargar la estadía")).not.toBeInTheDocument();
    // La fecha desde la que se cobraría es parte de la decisión: tampoco se muestra.
    expect(screen.queryByText(/se cargaría desde el/)).not.toBeInTheDocument();
  });

  it("al admin le ofrece cargar la estadía desde la noche anterior a la detección", () => {
    renderBanner([abierta], true);

    expect(screen.getByText("Cargar la estadía")).toBeInTheDocument();
    expect(screen.queryByText("Lo resuelve el administrador")).not.toBeInTheDocument();
    expect(screen.getByText(/se cargaría desde el 22\/09\/2026/)).toBeInTheDocument();
  });

  it("los cerrados van aparte, con su desenlace, y no cuentan como abiertos", () => {
    renderBanner([abierta, cobrada, sinCobrar], false);

    expect(screen.getByText("Hay 1 habitación usada sin estadía cargada")).toBeInTheDocument();
    expect(
      screen.getByText("Habitaciones usadas sin estadía · resueltas hace poco")
    ).toBeInTheDocument();
    expect(screen.getByText(/se cargó la estadía/)).toBeInTheDocument();
    expect(screen.getByText(/se cerró sin cobrar/)).toBeInTheDocument();
    expect(screen.getByText(/Uso interno/)).toBeInTheDocument();
  });

  it("con todo resuelto no queda el cartel rojo", () => {
    renderBanner([cobrada], true);

    expect(screen.queryByText(/sin estadía cargada/)).not.toBeInTheDocument();
    expect(screen.queryByText("Cargar la estadía")).not.toBeInTheDocument();
    expect(screen.getByText(/se cargó la estadía/)).toBeInTheDocument();
  });

  it("al confirmar manda el aviso y la fecha retroactiva a la acción", async () => {
    H.regularizeOccupiedRoomAction.mockResolvedValue({
      success: true,
      data: { reservationId: "r-1", alertPendiente: false },
    });
    renderBanner([abierta], true);

    fireEvent.click(screen.getByText("Cargar la estadía"));
    fireEvent.click(screen.getByText("Confirmar walk-in"));

    await waitFor(() => expect(H.toast.success).toHaveBeenCalled());
    expect(H.regularizeOccupiedRoomAction).toHaveBeenCalledWith({
      alertId: 10,
      walkIn: expect.objectContaining({ roomId: 2, checkInDate: "2026-09-22" }),
    });
  });

  it("si la estadía entró pero el aviso no se cerró, avisa que no la vuelvan a cargar", async () => {
    H.regularizeOccupiedRoomAction.mockResolvedValue({
      success: true,
      data: { reservationId: "r-1", alertPendiente: true },
    });
    renderBanner([abierta], true);

    fireEvent.click(screen.getByText("Cargar la estadía"));
    fireEvent.click(screen.getByText("Confirmar walk-in"));

    await waitFor(() => expect(H.toast.warning).toHaveBeenCalled());
    expect(H.toast.warning.mock.calls[0][0]).toContain("no la vuelvas a cargar");
    expect(H.toast.success).not.toHaveBeenCalled();
  });
});
