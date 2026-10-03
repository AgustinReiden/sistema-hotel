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

vi.mock("./WalkInModal", () => ({ default: () => null }));
vi.mock("./CompanyCheckInModal", () => ({ default: () => null }));
vi.mock("./ExtraChargesModal", () => ({ default: () => "cuadro-extras" }));
vi.mock("./ChangeRoomModal", () => ({ default: () => "cuadro-cambiar" }));
vi.mock("./EditReservationModal", () => ({ default: () => "cuadro-editar" }));
vi.mock("./EarlyCheckoutModal", () => ({ default: () => "cuadro-salida-anticipada" }));
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

/** Ocupada por un particular que se va hoy y debe $43.700. */
function ocupada(overrides: Partial<Room> = {}): Room {
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
    baseTotalPrice: 43700,
    discountPercent: 0,
    discountAmount: 0,
    totalPrice: 43700,
    paidAmount: 0,
    basePrice: 43700,
    halfDayPrice: 20000,
    hasPendingArrival: false,
    arrivalIsOverdue: false,
    arrivalDateLabel: null,
    accountCreditEnabled: false,
    billedToCompany: false,
    associatedClientId: null,
    companyPassengerId: null,
    clientDni: "30123456",
    facturacionModo: "por_checkout",
    invoicePrefill: {
      razonSocial: "Juan Prueba",
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

/** De la empresa con cuenta corriente: el check-out abre con Cta. Cte. marcada. */
function deEmpresa(overrides: Partial<Room> = {}): Room {
  return ocupada({
    accountCreditEnabled: true,
    billedToCompany: true,
    associatedClientId: "emp-1",
    companyPassengerId: "pas-1",
    facturacionModo: "consolidada",
    invoicePrefill: {
      razonSocial: "Empresa Ficticia SA",
      cuit: "",
      condicionIva: "",
      domicilio: "",
      suggestA: false,
      complete: false,
    },
    ...overrides,
  });
}

function tarjeta(room: Room, isAdmin = false) {
  return (
    <RoomCard
      room={room}
      associatedClients={[empresa]}
      isAdmin={isAdmin}
      fiscalEnabled={false}
      timezone={TZ}
      standardCheckOutTime="10:00"
    />
  );
}

function abrir(room: Room, isAdmin = false) {
  const utils = render(tarjeta(room, isAdmin));
  const actualizar = (nueva: Room) => utils.rerender(tarjeta(nueva, isAdmin));
  return { ...utils, actualizar };
}

function marcados(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .filter((r) => r.checked)
    .map((r) => r.value);
}

describe("RoomCard: Cobrar a cuenta antes del check-out", () => {
  beforeEach(() => {
    H.handleCheckOut.mockReset();
    H.handleEarlyCheckOut.mockReset();
    H.registerPaymentAction.mockReset();
    H.registerPaymentAction.mockResolvedValue({ success: true, data: { paymentId: "pay-1" } });
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("con saldo, la tarjeta ocupada tiene «Cobrar» junto a Extra y Cambiar", () => {
    abrir(ocupada());

    expect(screen.getByText("Cobrar")).toBeTruthy();
    expect(screen.getByText("Extra")).toBeTruthy();
    expect(screen.getByText("Cambiar")).toBeTruthy();
  });

  it("sin saldo no hay «Cobrar»", () => {
    abrir(ocupada({ paidAmount: 43700 }));

    expect(screen.queryByText("Cobrar")).toBeNull();
  });

  it("«Cobrar» abre el cobro a cuenta con lo que falta, no el del check-out", () => {
    const { container } = abrir(ocupada({ totalPrice: 43700, paidAmount: 10000 }));

    fireEvent.click(screen.getByText("Cobrar"));

    expect(screen.getByText("Cobrar a cuenta")).toBeTruthy();
    expect(screen.getByText("Queda en tu caja. Lo que falte se cobra en el check-out.")).toBeTruthy();
    expect(screen.queryByText("Cobrar y Finalizar")).toBeNull();
    expect(screen.queryByText("Registrar y Cerrar")).toBeNull();
    // El monto arranca vacío (lo tipea quien recibió la plata). El tope es lo que
    // falta: 43.700 - 10.000 (no el total ni el saldo de una salida anticipada).
    const monto = screen.getByLabelText("Monto a abonar ($)") as HTMLInputElement;
    expect(monto.value).toBe("");
    expect(monto.placeholder).toContain("33.700,00");
    expect(monto.readOnly).toBe(false);
    expect(marcados(container)).toEqual([]);
  });

  it("en una empresa con cuenta, el cobro a cuenta no ofrece ni marca Cta. Cte.", () => {
    const { container } = abrir(deEmpresa());

    fireEvent.click(screen.getByText("Cobrar"));

    expect(screen.getByText("Cobrar a cuenta")).toBeTruthy();
    expect(screen.queryByText("Cta. Cte.")).toBeNull();
    expect(marcados(container)).toEqual([]);
  });

  it("registra el pago con la reserva, saca el recibo y no hace el check-out", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    abrir(ocupada());

    fireEvent.click(screen.getByText("Cobrar"));
    fireEvent.change(screen.getByLabelText("Monto a abonar ($)"), { target: { value: "20.000" } });
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(H.registerPaymentAction).toHaveBeenCalledTimes(1));
    expect(H.registerPaymentAction).toHaveBeenCalledWith("res-1", 20000, "cash");
    expect(H.handleCheckOut).not.toHaveBeenCalled();
    expect(H.handleEarlyCheckOut).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Cobrar a cuenta")).toBeNull());
    expect(open).toHaveBeenCalledWith(
      "/admin/recibo/pay-1?autoprint=1&copy=original",
      "recibo-pay-1",
      "width=420,height=720"
    );
  });

  it("si carga más de lo que falta, el cuadro lo dice y no registra nada", async () => {
    abrir(ocupada());

    fireEvent.click(screen.getByText("Cobrar"));
    fireEvent.change(screen.getByLabelText("Monto a abonar ($)"), { target: { value: "50.000" } });
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() =>
      expect(screen.getByText("No puede superar lo que falta ($43.700,00)")).toBeTruthy()
    );
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });

  it("después de cerrar el cobro a cuenta, «Hacer Check-Out» abre el cobro del check-out de siempre", () => {
    const { container } = abrir(deEmpresa());

    fireEvent.click(screen.getByText("Cobrar"));
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByText("Cobrar a cuenta")).toBeNull();

    fireEvent.click(screen.getByText("Hacer Check-Out"));

    expect(screen.queryByText("Cobrar a cuenta")).toBeNull();
    expect(screen.getByText("Cargar a la cuenta y cerrar")).toBeTruthy();
    expect(marcados(container)).toEqual(["cuenta_corriente"]);
  });

  it("el check-out después de una seña cobra solo lo que falta", async () => {
    H.handleCheckOut.mockResolvedValue({ success: true, data: { paymentId: null } });
    abrir(ocupada({ totalPrice: 43700, paidAmount: 20000, priorPaymentMethods: ["cash"] }));

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    expect(screen.getByText("Cobrar y Finalizar")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar y Cerrar"));

    await waitFor(() => expect(H.handleCheckOut).toHaveBeenCalledTimes(1));
    expect(H.handleCheckOut).toHaveBeenCalledWith({
      reservationId: "res-1",
      paymentAmount: 23700,
      paymentMethod: "cash",
    });
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });

  it("si Hoy se actualiza con otra reserva, el cobro a cuenta abierto se cierra", () => {
    const { actualizar } = abrir(ocupada());

    fireEvent.click(screen.getByText("Cobrar"));
    expect(screen.getByText("Cobrar a cuenta")).toBeTruthy();

    actualizar(ocupada({ reservationId: "res-2", client: "Ana Prueba" }));

    expect(screen.queryByText("Cobrar a cuenta")).toBeNull();
  });

  it("para el admin, Cobrar convive con Editar", () => {
    abrir(ocupada(), true);

    expect(screen.getByText("Cobrar")).toBeTruthy();
    expect(screen.getByText("Editar")).toBeTruthy();
  });
});
