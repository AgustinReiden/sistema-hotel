import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CuentasClient from "./CuentasClient";
import type { ClientInvoiceRow, CtaCteAccount, CtaCteMovimiento } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const loadCtaCteAccountAction = vi.fn();
const loadClientInvoicesAction = vi.fn();
vi.mock("./actions", () => ({
  loadCtaCteAccountAction: (...args: unknown[]) => loadCtaCteAccountAction(...args),
  loadClientInvoicesAction: (...args: unknown[]) => loadClientInvoicesAction(...args),
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

// Una consolidada (3 estadías, una sola fila) y una factura anulada por NC: los dos
// casos que la solapa tiene que saber decir.
const invoices: ClientInvoiceRow[] = [
  {
    invoice_id: "f1",
    kind: "consolidada",
    status: "authorized",
    cbte_tipo: 1,
    pto_vta: 8,
    cbte_nro: 1,
    cbte_fch: "2026-09-17",
    imp_total: 1480000,
    anulada_at: null,
    receptor_nombre: "Acme SA",
    estadias: 3,
    created_at: "2026-09-17T13:58:59.000Z",
  },
  {
    invoice_id: "f2",
    kind: "checkout",
    status: "authorized",
    cbte_tipo: 6,
    pto_vta: 8,
    cbte_nro: 42,
    cbte_fch: "2026-08-01",
    imp_total: 50000,
    anulada_at: "2026-08-02T10:00:00.000Z",
    receptor_nombre: "Acme SA",
    estadias: 1,
    created_at: "2026-08-01T12:00:00.000Z",
  },
];

/** Abre la ficha y pasa a la solapa Facturas. */
async function abrirSolapaFacturas() {
  render(<CuentasClient accounts={accounts} />);
  fireEvent.click(screen.getByTitle("Ver ficha del cliente"));
  fireEvent.click(screen.getByRole("button", { name: "Facturas" }));
  await waitFor(() => expect(loadClientInvoicesAction).toHaveBeenCalledWith("company", "acme"));
}

describe("CuentasClient — FichaClienteModal", () => {
  beforeEach(() => {
    loadCtaCteAccountAction.mockReset();
    loadCtaCteAccountAction.mockResolvedValue({
      success: true,
      data: { movements, balance: 15000 },
    });
    loadClientInvoicesAction.mockReset();
    loadClientInvoicesAction.mockResolvedValue({ success: true, data: invoices });
  });

  it("el saldo del encabezado NO cambia al aplicar un filtro de fecha: el filtro es de vista, no de cobro", async () => {
    render(<CuentasClient accounts={accounts} />);

    fireEvent.click(screen.getByTitle("Ver ficha del cliente"));

    await waitFor(() => expect(loadCtaCteAccountAction).toHaveBeenCalledWith("company", "acme"));
    await waitFor(() => expect(screen.getByTestId("ficha-balance").textContent).toContain("15.000,00"));

    const balanceBefore = screen.getByTestId("ficha-balance").textContent;

    // Cualquier preset de rango deja movimientos afuera con este dataset.
    fireEvent.click(screen.getByRole("button", { name: "Este mes" }));

    await waitFor(() =>
      expect(screen.getByText("Hay movimientos fuera del período elegido.")).toBeTruthy()
    );

    // Lo único que puede cambiar es la línea "En el período", nunca el saldo del encabezado.
    expect(screen.getByTestId("ficha-balance").textContent).toBe(balanceBefore);
  });

  it("la solapa Facturas pinta las filas que devuelve la action, y una consolidada sale en UNA fila", async () => {
    await abrirSolapaFacturas();

    // Sólo la solapa: detrás del modal sigue estando la tabla del listado de saldos.
    await waitFor(() => expect(screen.getByTestId("solapa-facturas")).toBeTruthy());
    const solapa = within(screen.getByTestId("solapa-facturas"));

    // Letra + número armados con cbteLetra/formatCbteNumero, no a mano.
    await waitFor(() => expect(solapa.getByText("Factura A 00008-00000001")).toBeTruthy());
    expect(solapa.getByText("Factura B 00008-00000042")).toBeTruthy();

    // Las 3 estadías van como dato de la fila: una consolidada NO se repite por estadía.
    expect(solapa.getByText("Consolidada · 3 estadías")).toBeTruthy();
    expect(solapa.getAllByText("Factura A 00008-00000001")).toHaveLength(1);

    expect(solapa.getAllByRole("row")).toHaveLength(3); // encabezado + 2 comprobantes
    expect(solapa.getByText("Emitida")).toBeTruthy();
    expect(solapa.getByText("Anulada por nota de crédito")).toBeTruthy();
  });

  it("sin facturas muestra un vacío explicado, no una tabla en blanco", async () => {
    loadClientInvoicesAction.mockResolvedValue({ success: true, data: [] });

    await abrirSolapaFacturas();

    const solapa = within(screen.getByTestId("solapa-facturas"));
    await waitFor(() =>
      expect(
        solapa.getByText("Todavía no se le emitió ninguna factura a este cliente.")
      ).toBeTruthy()
    );
    // Lo que no puede pasar: encabezados de tabla sin una sola fila debajo.
    expect(solapa.queryByRole("table")).toBeNull();
    // Y tiene que decir dónde se factura, no sólo que no hay nada.
    expect(solapa.getByRole("link", { name: "Facturar" })).toBeTruthy();
  });
});
