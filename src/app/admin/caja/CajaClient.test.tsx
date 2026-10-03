import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CajaClient from "./CajaClient";
import type { PaymentMethod, ShiftSummary } from "@/lib/types";

/**
 * La Caja muestra el remito de cada fiado del turno y el botón para reimprimirlo, y
 * lo ven recepción y el admin. Recepción es la que rinde el turno: si la lista quedara
 * detrás del rol (o del arqueo a ciegas), rendiría sin el papel firmado.
 */

const H = vi.hoisted(() => ({
  role: "receptionist" as string,
  summary: null as ShiftSummary | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Los cuadros de abrir y cerrar el turno no son el tema de estos tests.
vi.mock("./OpenShiftModal", () => ({ default: () => null }));
vi.mock("./CloseShiftModal", () => ({ default: () => null }));

vi.mock("@/lib/data", () => ({
  getCurrentUserRole: async () => H.role,
  getHotelSettings: async () => ({ timezone: "America/Argentina/Buenos_Aires" }),
  getActiveOpenShift: async () => H.summary?.shift ?? null,
  getShiftSummary: async () => H.summary,
}));

import CajaPage from "./page";

const totalsByMethod: Record<PaymentMethod, number> = {
  cash: 10000,
  mercado_pago: 0,
  bank_transfer: 0,
  credit_card: 0,
  debit_card: 0,
  vale_blanco: 0,
  cuenta_corriente: 0,
  other: 0,
};

function resumenConFiado(): ShiftSummary {
  return {
    shift: {
      id: "turno-1",
      shift_number: 12,
      opened_at: "2026-09-25T09:00:00.000Z",
      closed_at: null,
      opened_by: "usuario-1",
      closed_by: null,
      opening_cash: 0,
      expected_cash: null,
      actual_cash: null,
      discrepancy: null,
      notes: null,
      status: "open",
    },
    paymentsCount: 1,
    checkoutsCount: 1,
    totalsByMethod,
    totalIncome: 10000,
    cashIncome: 10000,
    creditCharged: 80000,
    creditCharges: [
      {
        id: "mov-1",
        amount: 80000,
        created_at: "2026-09-25T11:00:00.000Z",
        reservation_id: "res-1",
        client_name: "Empresa Ficticia SA",
        room_number: "4",
        remito_numero: 17,
      },
    ],
    payments: [
      {
        id: "pago-1",
        amount: 10000,
        payment_method: "cash",
        notes: null,
        created_at: "2026-09-25T10:00:00.000Z",
        reservation_id: "res-2",
        client_name: "Juan Prueba",
        room_number: "7",
      },
    ],
    openedByName: "Recepción Prueba",
    closedByName: null,
  };
}

function veElRemitoYElBoton() {
  expect(screen.getByText("Cuenta corriente (fiado)")).toBeTruthy();
  expect(screen.getByText("Remito R-000017")).toBeTruthy();
  expect(screen.getByLabelText("Reimprimir remito de Empresa Ficticia SA")).toBeTruthy();
}

describe("CajaClient: el fiado del turno con su remito", () => {
  it("recepción (arqueo a ciegas) ve el remito y el botón Reimprimir", () => {
    render(
      <CajaClient
        summary={resumenConFiado()}
        isAdmin={false}
        canSeeCash={false}
        hotelTimezone="America/Argentina/Buenos_Aires"
      />
    );

    veElRemitoYElBoton();
  });

  it("el admin también", () => {
    render(
      <CajaClient
        summary={resumenConFiado()}
        isAdmin
        canSeeCash
        hotelTimezone="America/Argentina/Buenos_Aires"
      />
    );

    veElRemitoYElBoton();
  });

  it("sin fiado en el turno no hay lista ni botón", () => {
    render(
      <CajaClient
        summary={{ ...resumenConFiado(), creditCharged: 0, creditCharges: [] }}
        isAdmin={false}
        canSeeCash={false}
        hotelTimezone="America/Argentina/Buenos_Aires"
      />
    );

    expect(screen.queryByText("Cuenta corriente (fiado)")).toBeNull();
    expect(screen.queryByText("Reimprimir")).toBeNull();
  });
});

describe("Caja (la página): el remito llega según el rol", () => {
  beforeEach(() => {
    H.summary = resumenConFiado();
  });

  it("a recepción le llega el fiado aunque el efectivo se le oculte", async () => {
    H.role = "receptionist";

    render(await CajaPage());

    // Es la vista de recepción: el efectivo no viaja, pero el fiado sí.
    expect(screen.getByText(/Arqueo a ciegas:/)).toBeTruthy();
    veElRemitoYElBoton();
  });

  it("al admin también", async () => {
    H.role = "admin";

    render(await CajaPage());

    expect(screen.queryByText(/Arqueo a ciegas:/)).toBeNull();
    veElRemitoYElBoton();
  });
});
