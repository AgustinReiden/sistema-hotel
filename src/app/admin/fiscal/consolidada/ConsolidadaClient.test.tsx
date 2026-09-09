import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConsolidadaClient from "./ConsolidadaClient";
import type { CcAccountStayRow, CtaCteAccount, InvoiceReceptorPrefill } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const loadCcAccountStaysAction = vi.fn();
vi.mock("./actions", () => ({
  loadCcAccountStaysAction: (...args: unknown[]) => loadCcAccountStaysAction(...args),
  emitConsolidatedInvoiceAction: vi.fn(),
}));

function makeRow(reservationId: string, roomNumber: string): CcAccountStayRow {
  return {
    reservation_id: reservationId,
    movimiento_id: `mov-${reservationId}`,
    room_number: roomNumber,
    passenger: "Huesped de prueba",
    fch_desde: "2026-09-01",
    fch_hasta: "2026-09-03",
    amount: 10000,
    total_price: 10000,
    actual_check_out: "2026-09-03T10:00:00Z",
    mixed_payment: false,
    facturable: true,
    estado: "pendiente",
    invoice_id: null,
    invoice_kind: null,
    invoice_status: null,
    cbte_tipo: null,
    pto_vta: null,
    cbte_nro: null,
    cbte_fch: null,
    external_ref: null,
  };
}

const accounts: CtaCteAccount[] = [
  { kind: "company", id: "acme", name: "Acme SA", document_id: "20111111112", balance: 10000 },
  { kind: "guest", id: "g1", name: "Juan Perez", document_id: "30222222", balance: 5000 },
];

const billingProfiles: Record<string, InvoiceReceptorPrefill> = {
  "company:acme": {
    razonSocial: "Acme SA",
    cuit: "20111111112",
    condicionIva: "responsable_inscripto",
    domicilio: "Calle Falsa 123",
    suggestA: true,
    complete: true,
  },
  "guest:g1": {
    razonSocial: "Juan Perez",
    cuit: "",
    condicionIva: "monotributo",
    domicilio: "Otra Calle 456",
    suggestA: false,
    complete: false,
  },
};

describe("ConsolidadaClient", () => {
  beforeEach(() => {
    loadCcAccountStaysAction.mockReset();
    loadCcAccountStaysAction.mockImplementation((kind: string, id: string) =>
      Promise.resolve({ success: true, data: [makeRow(`${kind}-${id}-1`, "5")] })
    );
  });

  it("con cliente preseleccionado, precarga los datos fiscales de esa ficha sin esperar a elegirla de nuevo", async () => {
    render(
      <ConsolidadaClient
        enabled
        accounts={accounts}
        billingProfiles={billingProfiles}
        preselectKind="company"
        preselectId="acme"
      />
    );

    expect(loadCcAccountStaysAction).toHaveBeenCalledWith("company", "acme");
    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Acme SA"));
    expect(screen.getByLabelText("CUIT")).toHaveValue("20111111112");
    expect(screen.getByLabelText("Domicilio")).toHaveValue("Calle Falsa 123");
  });

  it("al cambiar de cliente, reemplaza los datos fiscales por los de la nueva ficha (no los mezcla)", async () => {
    render(
      <ConsolidadaClient
        enabled
        accounts={accounts}
        billingProfiles={billingProfiles}
        preselectKind="company"
        preselectId="acme"
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Acme SA"));

    fireEvent.change(screen.getByLabelText("Cliente de cuenta corriente"), {
      target: { value: "guest:g1" },
    });

    expect(loadCcAccountStaysAction).toHaveBeenCalledWith("guest", "g1");
    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Juan Perez"));
    expect(screen.getByLabelText("Domicilio")).toHaveValue("Otra Calle 456");
    expect(screen.getByLabelText("CUIT")).toHaveValue("");
  });
});
