import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CalendarClient from "./CalendarClient";
import type { Reservation, Room, UserRole } from "@/lib/types";

const H = vi.hoisted(() => ({
  refresh: vi.fn(),
  registerPaymentAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: H.refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("../actions", () => ({
  handleCancelReservation: vi.fn(),
  handleCheckIn: vi.fn(),
  handleCreateReservation: vi.fn(),
}));

vi.mock("@/app/admin/finances/actions", () => ({
  registerPaymentAction: H.registerPaymentAction,
}));

// Los cuadros con acciones propias no hacen falta acá.
vi.mock("../NewReservationModal", () => ({ default: () => null }));
vi.mock("../EditReservationModal", () => ({ default: () => null }));
vi.mock("../CompanyCheckInModal", () => ({ default: () => null }));

const TZ = "America/Argentina/Buenos_Aires";
const NOW_ISO = "2026-10-02T15:00:00.000Z";
const BOTON = "Cobrar seña / a cuenta";

const habitacion: Room = {
  id: 4,
  category_id: null,
  room_number: "4",
  room_type: "Doble",
  status: "available",
  capacity: 2,
  capacity_adults: 2,
  capacity_children: 0,
  beds_configuration: "1 matrimonial",
  amenities: [],
  description: null,
  image_url: null,
  base_price: 43700,
  half_day_price: 20000,
  is_active: true,
};

/** Reserva confirmada que entra en dos días y debe $43.700. */
function reserva(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "res-1",
    associated_client_id: null,
    company_passenger_id: null,
    client_name: "Juan Prueba",
    client_phone: null,
    client_dni: "30123456",
    check_in_target: "2026-10-04T17:00:00.000Z",
    check_out_target: "2026-10-05T13:00:00.000Z",
    late_check_out_until: null,
    room_id: 4,
    status: "confirmed",
    actual_check_in: null,
    actual_check_out: null,
    base_total_price: 43700,
    discount_percent: 0,
    discount_amount: 0,
    total_price: 43700,
    paid_amount: 0,
    guest_count: 1,
    notes: null,
    whatsapp_notified: false,
    ...overrides,
  };
}

function calendario(reservas: Reservation[], role: UserRole = "receptionist") {
  return render(
    <CalendarClient
      rooms={[habitacion]}
      reservations={reservas}
      startDateKey="2026-10-01"
      nowIso={NOW_ISO}
      timezone={TZ}
      daysCount={14}
      role={role}
      associatedClients={[]}
      standardCheckInTime="14:00"
      standardCheckOutTime="10:00"
    />
  );
}

function abrirDetalle(nombre = "Juan Prueba") {
  fireEvent.click(screen.getByLabelText(`Ver detalle de la reserva de ${nombre}`));
  expect(screen.getByText("Detalle de Reserva")).toBeTruthy();
}

describe("Calendario: cobrar una seña o a cuenta desde el detalle", () => {
  beforeEach(() => {
    H.refresh.mockReset();
    H.registerPaymentAction.mockReset();
    H.registerPaymentAction.mockResolvedValue({ success: true, data: { paymentId: "pay-1" } });
    H.toast.success.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("una reserva confirmada con saldo tiene «Cobrar seña / a cuenta»", () => {
    calendario([reserva()]);
    abrirDetalle();

    expect(screen.getByText(BOTON)).toBeTruthy();
  });

  it("una estadía en curso (checked_in) con saldo también", () => {
    calendario([
      reserva({
        status: "checked_in",
        check_in_target: "2026-10-01T17:00:00.000Z",
        actual_check_in: "2026-10-01T17:10:00.000Z",
        total_price: 43700,
        paid_amount: 20000,
      }),
    ]);
    abrirDetalle();

    expect(screen.getByText(BOTON)).toBeTruthy();
  });

  it("sin saldo no aparece", () => {
    calendario([reserva({ paid_amount: 43700 })]);
    abrirDetalle();

    expect(screen.queryByText(BOTON)).toBeNull();
  });

  it("en una solicitud pendiente no aparece", () => {
    calendario([reserva({ status: "pending" })]);
    abrirDetalle();

    expect(screen.queryByText(BOTON)).toBeNull();
  });

  it("en una estadía finalizada no aparece", () => {
    calendario([
      reserva({
        status: "checked_out",
        check_in_target: "2026-09-28T17:00:00.000Z",
        check_out_target: "2026-10-01T13:00:00.000Z",
        actual_check_out: "2026-10-01T12:00:00.000Z",
      }),
    ]);
    abrirDetalle();

    expect(screen.queryByText(BOTON)).toBeNull();
  });

  it("mantenimiento no cobra", () => {
    calendario([reserva()], "maintenance");
    abrirDetalle();

    expect(screen.queryByText(BOTON)).toBeNull();
  });

  it("abre el cobro a cuenta encima del detalle, con lo que falta", () => {
    const { container } = calendario([reserva({ total_price: 43700, paid_amount: 10000 })]);
    abrirDetalle();

    fireEvent.click(screen.getByText(BOTON));

    expect(screen.getByText("Cobrar a cuenta")).toBeTruthy();
    expect(screen.getByText("Queda en tu caja. Lo que falte se cobra en el check-out.")).toBeTruthy();
    // El monto arranca vacío (lo tipea quien recibió la plata); lo que falta es el tope.
    const monto = screen.getByLabelText("Monto a abonar ($)") as HTMLInputElement;
    expect(monto.value).toBe("");
    expect(monto.placeholder).toContain("33.700,00");
    // El detalle es z-[60]: el cobro tiene que quedar encima.
    const fondoCobro = container.querySelector("#payment-form")?.closest(".fixed");
    expect(fondoCobro?.classList.contains("z-[65]")).toBe(true);
    // No hay Vale Blanco: tiene que cubrir el total de una vez.
    expect(screen.queryByText("Vale Blanco")).toBeNull();
  });

  it("con Escape no se cierra el detalle de abajo mientras se cobra", () => {
    calendario([reserva()]);
    abrirDetalle();
    fireEvent.click(screen.getByText(BOTON));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByText("Cobrar a cuenta")).toBeTruthy();
    expect(screen.getByText("Detalle de Reserva")).toBeTruthy();
  });

  it("al registrar el pago refresca el calendario y cierra el detalle, que mostraba el saldo viejo", async () => {
    calendario([reserva()]);
    abrirDetalle();
    fireEvent.click(screen.getByText(BOTON));

    fireEvent.change(screen.getByLabelText("Monto a abonar ($)"), { target: { value: "20.000" } });
    fireEvent.click(screen.getByLabelText("Transferencia"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(H.registerPaymentAction).toHaveBeenCalledTimes(1));
    expect(H.registerPaymentAction).toHaveBeenCalledWith("res-1", 20000, "bank_transfer");
    await waitFor(() => expect(H.refresh).toHaveBeenCalled());
    expect(screen.queryByText("Cobrar a cuenta")).toBeNull();
    expect(screen.queryByText("Detalle de Reserva")).toBeNull();
  });

  it("si la respuesta no vuelve (red cortada), cierra el detalle con el saldo viejo y no refresca", async () => {
    H.registerPaymentAction.mockRejectedValue(new Error("network"));
    calendario([reserva()]);
    abrirDetalle();
    fireEvent.click(screen.getByText(BOTON));

    fireEvent.change(screen.getByLabelText("Monto a abonar ($)"), { target: { value: "20.000" } });
    fireEvent.click(screen.getByLabelText("Transferencia"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(H.toast.warning).toHaveBeenCalled());
    expect(screen.queryByText("Cobrar a cuenta")).toBeNull();
    expect(screen.queryByText("Detalle de Reserva")).toBeNull();
    expect(screen.queryByText(BOTON)).toBeNull();
    expect(H.refresh).not.toHaveBeenCalled();
  });

  it("si cancela el cobro, vuelve al detalle", () => {
    calendario([reserva()]);
    abrirDetalle();
    fireEvent.click(screen.getByText(BOTON));

    fireEvent.click(screen.getByText("Cancelar"));

    expect(screen.queryByText("Cobrar a cuenta")).toBeNull();
    expect(screen.getByText("Detalle de Reserva")).toBeTruthy();
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });
});
