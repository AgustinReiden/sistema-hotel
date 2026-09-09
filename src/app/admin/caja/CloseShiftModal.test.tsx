import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CloseShiftModal from "./CloseShiftModal";
import type { PaymentMethod } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/app/admin/actions", () => ({
  handleExtendReservation: vi.fn(),
}));

vi.mock("@/app/login/actions", () => ({
  logout: vi.fn(),
}));

const getCloseShiftBlockersAction = vi.fn();
vi.mock("./actions", () => ({
  getCloseShiftBlockersAction: (...args: unknown[]) => getCloseShiftBlockersAction(...args),
  closeShiftAction: vi.fn(),
  openShiftAction: vi.fn(),
  reportShiftConflictAction: vi.fn(),
}));

const totalsByMethod: Record<PaymentMethod, number> = {
  cash: 0,
  mercado_pago: 0,
  bank_transfer: 0,
  credit_card: 0,
  debit_card: 0,
  vale_blanco: 0,
  cuenta_corriente: 0,
  other: 0,
};

describe("CloseShiftModal", () => {
  beforeEach(() => {
    getCloseShiftBlockersAction.mockReset();
  });

  it("busca las salidas vencidas apenas se abre, sin esperar al boton de reintentar", async () => {
    getCloseShiftBlockersAction.mockResolvedValue({
      success: true,
      data: {
        blockers: [
          {
            reservation_id: "r1",
            room_id: 5,
            room_number: "5",
            client_name: "Juan Perez",
            effective_deadline: "2026-09-09T12:00:00Z",
            hours_overdue: 3,
            balance_due: 0,
          },
        ],
        occupied_alerts_count: 0,
        unbilled_count: 0,
      },
    });

    render(
      <CloseShiftModal
        isOpen
        onClose={() => {}}
        shiftId="s1"
        shiftNumber={1}
        totalsByMethod={totalsByMethod}
        creditCharged={0}
        checkoutsCount={0}
      />
    );

    // El efecto de auto-carga (fetchBlockers via IIFE anidada) dispara la
    // accion sin que el usuario tenga que apretar "Volver a verificar".
    expect(getCloseShiftBlockersAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/Juan Perez/)).toBeInTheDocument());
  });

  it("sin bloqueos pasa directo al arqueo de caja", async () => {
    getCloseShiftBlockersAction.mockResolvedValue({
      success: true,
      data: { blockers: [], occupied_alerts_count: 0, unbilled_count: 0 },
    });

    render(
      <CloseShiftModal
        isOpen
        onClose={() => {}}
        shiftId="s1"
        shiftNumber={1}
        totalsByMethod={totalsByMethod}
        creditCharged={0}
        checkoutsCount={0}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Efectivo declarado ($)")).toBeInTheDocument()
    );
  });
});
