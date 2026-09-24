import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RoomCard from "./RoomCard";
import type { AssociatedClient } from "@/lib/types";

const H = vi.hoisted(() => ({
  handleCheckOut: vi.fn(),
  handleEarlyCheckOut: vi.fn(),
  registerPaymentAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  handleLateCheckOut: vi.fn(),
  handleMarkAvailable: vi.fn(),
  handleCancelReservation: vi.fn(),
  handleCheckOut: H.handleCheckOut,
  handleEarlyCheckOut: H.handleEarlyCheckOut,
  handleCheckIn: vi.fn(),
  handleSetMaintenance: vi.fn(),
  handleAssignWalkIn: vi.fn(),
  handleExtendReservation: vi.fn(),
}));

vi.mock("@/app/admin/finances/actions", () => ({
  registerPaymentAction: H.registerPaymentAction,
}));

// Los modales que este flujo no abre: fuera, para no cargar sus acciones.
vi.mock("./WalkInModal", () => ({ default: () => null }));
vi.mock("./CompanyCheckInModal", () => ({ default: () => null }));
vi.mock("./ExtraChargesModal", () => ({ default: () => null }));
vi.mock("./ChangeRoomModal", () => ({ default: () => null }));
vi.mock("./EditReservationModal", () => ({ default: () => null }));
vi.mock("./EarlyCheckoutModal", () => ({ default: () => null }));
vi.mock("./InvoicePromptModal", () => ({ default: () => null }));

const TZ = "America/Argentina/Buenos_Aires";

const empresa: AssociatedClient = {
  id: "emp-1",
  display_name: "Empresa Ficticia SA",
  document_id: "30123456781",
  phone: null,
  discount_percent: 0,
  notes: null,
  is_active: true,
  cuenta_corriente_habilitada: true,
  condicion_iva: null,
  razon_social: null,
  domicilio: null,
  facturacion_modo: "consolidada",
  robinet_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

type Room = React.ComponentProps<typeof RoomCard>["room"];

/**
 * Habitación ocupada que se va hoy (sin salida anticipada) y debe $80.000. Por
 * defecto es de la empresa con cuenta corriente y se factura en la consolidada, así
 * que el check-out no pregunta por la factura.
 */
function habitacion(overrides: Partial<Room> = {}): Room {
  const ahora = new Date();
  const ayer = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  return {
    id: 4,
    number: "4",
    type: "Doble",
    status: "occupied",
    client: "Juan Prueba",
    checkout: "10:00",
    check_in_target: ayer.toISOString(),
    check_out_target: ahora.toISOString(),
    isLate: false,
    hasLateCheckout: false,
    canChargeLateCheckout: false,
    reservationId: "res-1",
    reservationStatus: "checked_in",
    baseTotalPrice: 80000,
    discountPercent: 0,
    discountAmount: 0,
    totalPrice: 80000,
    paidAmount: 0,
    basePrice: 80000,
    halfDayPrice: 40000,
    hasPendingArrival: false,
    arrivalIsOverdue: false,
    arrivalDateLabel: null,
    accountCreditEnabled: true,
    billedToCompany: true,
    associatedClientId: "emp-1",
    companyPassengerId: "pas-1",
    clientDni: "30123456",
    facturacionModo: "consolidada",
    invoicePrefill: {
      razonSocial: "",
      cuit: "",
      condicionIva: "",
      domicilio: "",
      suggestA: false,
      complete: false,
    },
    priorPaymentMethods: [],
    ...overrides,
  };
}

function abrir(room: Room) {
  return render(
    <RoomCard
      room={room}
      associatedClients={[empresa]}
      timezone={TZ}
      standardCheckOutTime="10:00"
    />
  );
}

function marcados(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .filter((r) => r.checked)
    .map((r) => r.value);
}

describe("RoomCard: check-out a cuenta corriente y el remito", () => {
  beforeEach(() => {
    H.handleCheckOut.mockReset();
    H.handleCheckOut.mockResolvedValue({
      success: true,
      data: { paymentId: null, movementId: "mov-1" },
    });
    H.toast.success.mockReset();
    H.toast.error.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("en una empresa con cuenta, el cobro abre con Cta. Cte. marcada y a nombre de la empresa", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
    const { container } = abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));

    expect(marcados(container)).toEqual(["cuenta_corriente"]);
    expect(
      screen.getByText(
        "Queda a cuenta de Empresa Ficticia SA. Sale el remito para que firme el pasajero."
      )
    ).toBeTruthy();
    expect(screen.getByText("Cargar a la cuenta y cerrar")).toBeTruthy();
  });

  it("en un particular con cuenta, el cobro abre sin ningún medio marcado", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
    const { container } = abrir(
      habitacion({ billedToCompany: false, associatedClientId: null, companyPassengerId: null })
    );

    fireEvent.click(screen.getByText("Hacer Check-Out"));

    expect(screen.getByText("Cta. Cte.")).toBeTruthy();
    expect(marcados(container)).toEqual([]);
  });

  it("al fiar sale el remito, y si abre no queda ningún cuadro", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(H.handleCheckOut).toHaveBeenCalledTimes(1));
    expect(H.handleCheckOut).toHaveBeenCalledWith({
      reservationId: "res-1",
      paymentAmount: 80000,
      paymentMethod: "cuenta_corriente",
    });
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "/admin/comprobante-cc/mov-1?autoprint=1",
        "comprobante-mov-1",
        "width=420,height=720"
      )
    );
    await waitFor(() =>
      expect(H.toast.success).toHaveBeenCalledWith(
        "Check-out hecho. Queda a cuenta de Empresa Ficticia SA."
      )
    );
    expect(screen.queryByText("Imprimir remito")).toBeNull();
  });

  it("si el navegador bloquea el remito, queda un cuadro con Imprimir remito hasta que sale", async () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);
    abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(screen.getByText("Imprimir remito")).toBeTruthy());
    expect(
      screen.getByText(
        "El check-out quedó hecho y la estadía quedó a cuenta de Empresa Ficticia SA."
      )
    ).toBeTruthy();
    expect(screen.getByText(/Falta el remito: el navegador bloqueó la ventana/)).toBeTruthy();

    // Vuelve a bloquear: el cuadro sigue ahí y avisa qué hacer.
    fireEvent.click(screen.getByText("Imprimir remito"));
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Imprimir remito")).toBeTruthy();
    expect(H.toast.error).toHaveBeenCalledTimes(1);

    // Esta vez abre: el remito sale y el cuadro se va.
    open.mockReturnValue({} as Window);
    fireEvent.click(screen.getByText("Imprimir remito"));
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenLastCalledWith(
      "/admin/comprobante-cc/mov-1?autoprint=1",
      "comprobante-mov-1",
      "width=420,height=720"
    );
    expect(screen.queryByText("Imprimir remito")).toBeNull();
  });
});
