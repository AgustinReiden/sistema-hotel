import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OccupiedRoomAlertBanner from "./OccupiedRoomAlertBanner";
import type { AssignWalkInPayload, RoomOccupancyAlert } from "@/lib/types";

const H = vi.hoisted(() => ({
  regularizeOccupiedRoomAction: vi.fn(),
  closeOccupancyAlertAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  regularizeOccupiedRoomAction: H.regularizeOccupiedRoomAction,
  closeOccupancyAlertAction: H.closeOccupancyAlertAction,
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
  H.closeOccupancyAlertAction.mockReset();
  H.toast.success.mockReset();
  H.toast.warning.mockReset();
  H.toast.error.mockReset();
  // La estadía que falta asociar se guarda en la pestaña: cada test arranca sin nada.
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Carga la estadía desde el aviso abierto y la acción contesta que el aviso quedó sin cerrar. */
async function cargarConAvisoSinCerrar() {
  H.regularizeOccupiedRoomAction.mockResolvedValue({
    success: true,
    data: { reservationId: "r-1", alertPendiente: true },
  });
  fireEvent.click(screen.getByText("Cargar la estadía"));
  fireEvent.click(screen.getByText("Confirmar walk-in"));
  await waitFor(() => expect(H.toast.warning).toHaveBeenCalled());
}

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
    renderBanner([abierta], true);

    await cargarConAvisoSinCerrar();

    const aviso = H.toast.warning.mock.calls[0][0] as string;
    expect(aviso).toContain("no la vuelvas a cargar");
    // Refrescar pierde la reserva que hay que cerrar: el camino es el botón.
    expect(aviso).toContain("Cerrar el aviso");
    expect(aviso).not.toMatch(/refresc/i);
    expect(H.toast.success).not.toHaveBeenCalled();
  });

  it("después de eso la fila ofrece cerrar el aviso y ya no cargar la estadía", async () => {
    renderBanner([abierta], true);

    await cargarConAvisoSinCerrar();

    expect(screen.getByText("Cerrar el aviso")).toBeInTheDocument();
    expect(screen.queryByText("Cargar la estadía")).not.toBeInTheDocument();
    expect(screen.getByText(/La estadía ya está cargada; falta cerrar el aviso/)).toBeInTheDocument();
    // Ya no "se cargaría": se cargó.
    expect(screen.queryByText(/se cargaría desde el/)).not.toBeInTheDocument();
  });

  it("cerrar el aviso reintenta solo el cierre, contra la estadía que se cargó", async () => {
    H.closeOccupancyAlertAction.mockResolvedValue({ success: true });
    renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();

    fireEvent.click(screen.getByText("Cerrar el aviso"));

    await waitFor(() => expect(H.toast.success).toHaveBeenCalled());
    expect(H.closeOccupancyAlertAction).toHaveBeenCalledWith(10, "r-1");
    // La estadía se cargó una sola vez.
    expect(H.regularizeOccupiedRoomAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
  });

  it("si el cierre vuelve a fallar, muestra el motivo y deja el botón para reintentar", async () => {
    H.closeOccupancyAlertAction.mockResolvedValue({
      success: false,
      error: "La estadia tiene que estar con el huesped adentro para cerrar el aviso.",
      code: "22023",
    });
    renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();

    fireEvent.click(screen.getByText("Cerrar el aviso"));

    await waitFor(() =>
      expect(H.toast.error).toHaveBeenCalledWith(
        "La estadia tiene que estar con el huesped adentro para cerrar el aviso."
      )
    );
    expect(screen.getByText("Cerrar el aviso")).toBeInTheDocument();
    expect(screen.queryByText("Cargar la estadía")).not.toBeInTheDocument();
  });

  it("si la acción ni contesta (red), no pierde la estadía que hay que cerrar", async () => {
    H.closeOccupancyAlertAction.mockRejectedValue(new Error("Failed to fetch"));
    renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();

    fireEvent.click(screen.getByText("Cerrar el aviso"));

    await waitFor(() => expect(H.toast.error).toHaveBeenCalled());
    expect(H.toast.error.mock.calls[0][0]).toContain("La estadía sigue cargada");
    expect(screen.getByText("Cerrar el aviso")).toBeInTheDocument();
  });

  it("cuando el aviso llega cerrado (el refresco de la acción), sale de los abiertos", async () => {
    const { rerender } = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();

    rerender(
      <OccupiedRoomAlertBanner
        alerts={[{ ...abierta, resolved_at: "2026-09-23T15:00:00.000Z", decision: "regularizada" }]}
        pricingByRoomId={pricingByRoomId}
        associatedClients={[]}
        timezone={TZ}
        isAdmin
      />
    );

    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
    expect(screen.getByText(/se cargó la estadía/)).toBeInTheDocument();
  });

  it("si el aviso se cerró en el primer intento, no queda nada para cerrar", async () => {
    H.regularizeOccupiedRoomAction.mockResolvedValue({
      success: true,
      data: { reservationId: "r-1", alertPendiente: false },
    });
    renderBanner([abierta], true);

    fireEvent.click(screen.getByText("Cargar la estadía"));
    fireEvent.click(screen.getByText("Confirmar walk-in"));

    await waitFor(() => expect(H.toast.success).toHaveBeenCalled());
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
    expect(screen.getByText("Cargar la estadía")).toBeInTheDocument();
  });
});

/**
 * Pedido de Agustín (26/09): la estadía que falta asociar al aviso no se pierde si la
 * pantalla se vuelve a armar de cero. Pasa si una recarga de Hoy termina en la pantalla de
 * error y vuelve, con un deploy (Next recarga la página entera) o con F5 en la misma
 * pestaña. En los tests, eso es desmontar el aviso y montarlo de nuevo.
 */
describe("OccupiedRoomAlertBanner — la estadía sin asociar sobrevive a que la pantalla se vuelva a armar", () => {
  it("después de volver a armarse, sigue ofreciendo cerrar el aviso contra la misma estadía", async () => {
    H.closeOccupancyAlertAction.mockResolvedValue({ success: true });
    const primera = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();
    primera.unmount();

    renderBanner([abierta], true);
    expect(screen.getByText("Cerrar el aviso")).toBeInTheDocument();
    expect(screen.queryByText("Cargar la estadía")).not.toBeInTheDocument();
    expect(screen.getByText(/La estadía ya está cargada; falta cerrar el aviso/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cerrar el aviso"));
    await waitFor(() => expect(H.toast.success).toHaveBeenCalled());
    expect(H.closeOccupancyAlertAction).toHaveBeenCalledWith(10, "r-1");
    expect(H.regularizeOccupiedRoomAction).toHaveBeenCalledTimes(1);
  });

  it("si el cierre falla, sigue guardada: otra vuelta a armarse la vuelve a ofrecer", async () => {
    H.closeOccupancyAlertAction.mockResolvedValue({ success: false, error: "No se pudo." });
    const primera = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();
    fireEvent.click(screen.getByText("Cerrar el aviso"));
    await waitFor(() => expect(H.toast.error).toHaveBeenCalled());
    primera.unmount();

    renderBanner([abierta], true);
    expect(screen.getByText("Cerrar el aviso")).toBeInTheDocument();
  });

  it("cuando el aviso se cierra, la olvida: al volver a armarse ya no ofrece cerrarlo", async () => {
    H.closeOccupancyAlertAction.mockResolvedValue({ success: true });
    const primera = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();
    fireEvent.click(screen.getByText("Cerrar el aviso"));
    await waitFor(() => expect(H.toast.success).toHaveBeenCalled());
    primera.unmount();

    // Aunque la lista todavía lo traiga abierto (la recarga de la acción no llegó).
    renderBanner([abierta], true);
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
    expect(screen.getByText("Cargar la estadía")).toBeInTheDocument();
  });

  it("cuando el aviso llega resuelto (lo cerró otro admin, por ejemplo desde Mantenimiento), la olvida", async () => {
    const { rerender, unmount } = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();

    rerender(
      <OccupiedRoomAlertBanner
        alerts={[{ ...abierta, resolved_at: "2026-09-23T15:00:00.000Z", decision: "regularizada" }]}
        pricingByRoomId={pricingByRoomId}
        associatedClients={[]}
        timezone={TZ}
        isAdmin
      />
    );
    unmount();

    renderBanner([abierta], true);
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
    expect(screen.getByText("Cargar la estadía")).toBeInTheDocument();
  });

  it("si la lista de avisos vino vacía (no se pudo leer), no la olvida", async () => {
    const { rerender, unmount } = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();

    // La página deja la lista vacía si falla la lectura de los avisos: no es que se resolvió.
    rerender(
      <OccupiedRoomAlertBanner
        alerts={[]}
        pricingByRoomId={pricingByRoomId}
        associatedClients={[]}
        timezone={TZ}
        isAdmin
      />
    );
    unmount();

    renderBanner([abierta], true);
    expect(screen.getByText("Cerrar el aviso")).toBeInTheDocument();
  });

  it("no se la aplica a otro aviso", async () => {
    const primera = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();
    primera.unmount();

    renderBanner([alerta({ alert_id: 20 })], true);
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
    expect(screen.getByText("Cargar la estadía")).toBeInTheDocument();
  });

  it("a recepción no le ofrece cerrarlo aunque esté guardada (decidir es del admin)", async () => {
    const primera = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();
    primera.unmount();

    renderBanner([abierta], false);
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
    expect(screen.getByText("Lo resuelve el administrador")).toBeInTheDocument();
  });

  it("si lo guardado en la pestaña está roto, lo ignora y ofrece cargar la estadía", async () => {
    const primera = renderBanner([abierta], true);
    await cargarConAvisoSinCerrar();
    primera.unmount();
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const clave = window.sessionStorage.key(i);
      if (clave) window.sessionStorage.setItem(clave, "{roto");
    }

    renderBanner([abierta], true);
    expect(screen.getByText("Cargar la estadía")).toBeInTheDocument();
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
  });

  it("si la pestaña no deja guardar (almacenamiento bloqueado), funciona como antes mientras no se vuelva a armar", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    H.closeOccupancyAlertAction.mockResolvedValue({ success: true });
    renderBanner([abierta], true);

    await cargarConAvisoSinCerrar();
    expect(screen.getByText("Cerrar el aviso")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cerrar el aviso"));
    await waitFor(() => expect(H.toast.success).toHaveBeenCalled());
    expect(H.closeOccupancyAlertAction).toHaveBeenCalledWith(10, "r-1");
    expect(screen.queryByText("Cerrar el aviso")).not.toBeInTheDocument();
  });
});
