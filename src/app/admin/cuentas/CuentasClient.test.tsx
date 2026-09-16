import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CuentasClient from "./CuentasClient";
import type { CtaCteAccount, CtaCteMovimiento } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const loadCtaCteAccountAction = vi.fn();
vi.mock("./actions", () => ({
  loadCtaCteAccountAction: (...args: unknown[]) => loadCtaCteAccountAction(...args),
  registerAccountPaymentAction: vi.fn(),
}));

const accounts: CtaCteAccount[] = [
  { kind: "company", id: "acme", name: "Acme SA", document_id: "20111111112", balance: 15000 },
];

// Un cargo viejo (fuera de "este mes") y un pago reciente: cualquier filtro de
// período deja algo afuera, así que sirve también para probar el aviso.
const movements: CtaCteMovimiento[] = [
  {
    id: "m1",
    tipo: "cargo",
    amount: 20000,
    reservation_id: "r1",
    payment_method: null,
    notes: null,
    created_at: "2020-01-05T12:00:00Z",
  },
  {
    id: "m2",
    tipo: "pago",
    amount: 5000,
    reservation_id: null,
    payment_method: "cash",
    notes: null,
    created_at: new Date().toISOString(),
  },
];

describe("CuentasClient — MovementsModal", () => {
  beforeEach(() => {
    loadCtaCteAccountAction.mockReset();
    loadCtaCteAccountAction.mockResolvedValue({
      success: true,
      data: { movements, balance: 15000 },
    });
  });

  it("el saldo del encabezado NO cambia al aplicar un filtro de fecha: el filtro es de vista, no de cobro", async () => {
    render(<CuentasClient accounts={accounts} />);

    fireEvent.click(screen.getByTitle("Ver movimientos"));

    await waitFor(() => expect(loadCtaCteAccountAction).toHaveBeenCalledWith("company", "acme"));
    await waitFor(() => expect(screen.getByTestId("mov-modal-balance").textContent).toContain("15.000,00"));

    const balanceBefore = screen.getByTestId("mov-modal-balance").textContent;

    // Cualquier preset de rango deja movimientos afuera con este dataset.
    fireEvent.click(screen.getByRole("button", { name: "Este mes" }));

    await waitFor(() =>
      expect(screen.getByText("Hay movimientos fuera del período elegido.")).toBeTruthy()
    );

    // Lo único que puede cambiar es la línea "En el período", nunca el saldo del encabezado.
    expect(screen.getByTestId("mov-modal-balance").textContent).toBe(balanceBefore);
  });
});
