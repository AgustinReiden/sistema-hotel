import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FiscalClient from "./FiscalClient";
import { DNI_INVALIDO_MSG } from "@/lib/arca/amounts";
import type { PendingInvoiceRow } from "@/lib/types";

const H = vi.hoisted(() => ({
  retryInvoiceAction: vi.fn(),
  fixInvoiceDniAndRetryAction: vi.fn(),
  discardInvoiceAction: vi.fn(),
  emitCreditNoteAction: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("next/navigation", () => ({ useRouter: () => H.router }));

vi.mock("./actions", () => ({
  retryInvoiceAction: H.retryInvoiceAction,
  fixInvoiceDniAndRetryAction: H.fixInvoiceDniAndRetryAction,
  discardInvoiceAction: H.discardInvoiceAction,
  emitCreditNoteAction: H.emitCreditNoteAction,
}));

// La pregunta de factura tiene su propio test; acá no se abre.
vi.mock("../InvoicePromptModal", () => ({ default: () => null }));

const DNI_VIEJO =
  "El DNI de la reserva no es valido para facturar (7 u 8 digitos). Corregilo en la reserva y reintenta.";
const CAMPO_DNI = "DNI del huésped (7 u 8 dígitos)";
const AVISO_DNI = "Corregí el DNI acá abajo y se reintenta solo.";

function fila(over: Partial<PendingInvoiceRow> = {}): PendingInvoiceRow {
  return {
    invoice_id: "inv-1",
    reservation_id: "res-1",
    status: "rejected",
    room_number: "4",
    receptor_nombre: "Juan Prueba",
    imp_total: 80000,
    attempt_count: 1,
    last_error: DNI_VIEJO,
    last_attempt_at: null,
    created_at: "2026-09-26T12:00:00Z",
    ...over,
  };
}

/** Facturación › Pendientes y con error, como la ve recepción. */
function abrir(pending: PendingInvoiceRow[]) {
  return render(
    <FiscalClient
      enabled
      pending={pending}
      authorized={[]}
      from="2026-09-01"
      to="2026-09-27"
      today="2026-09-27"
      isAdmin={false}
      view="pendientes"
      tipo=""
      q=""
    />
  );
}

describe("FiscalClient › Pendientes y con error: el DNI que no sirve", () => {
  beforeEach(() => {
    H.retryInvoiceAction.mockReset();
    H.fixInvoiceDniAndRetryAction.mockReset();
    H.router.refresh.mockReset();
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    H.toast.warning.mockReset();
  });

  it("una factura trabada por DNI dice «Usá «Corregir DNI»» y no manda a la reserva", () => {
    abrir([fila()]);

    expect(screen.getByText(/Usá «Corregir DNI»\./)).toBeTruthy();
    expect(screen.queryByText(/en la reserva/i)).toBeNull();
    // El botón está en la misma fila.
    expect(screen.getByText("Corregir DNI")).toBeTruthy();
  });

  it("si el reintento vuelve con el error de DNI, se abre el campo de esa fila", async () => {
    H.retryInvoiceAction.mockResolvedValue({
      success: true,
      data: { status: "pending", invoiceId: "inv-1", userMessage: DNI_INVALIDO_MSG },
    });
    abrir([fila({ last_error: null })]);
    expect(screen.queryByPlaceholderText(CAMPO_DNI)).toBeNull();

    fireEvent.click(screen.getByText("Reintentar"));

    expect(await screen.findByPlaceholderText(CAMPO_DNI)).toBeTruthy();
    expect(H.retryInvoiceAction).toHaveBeenCalledWith("inv-1");
    expect(H.toast.warning).toHaveBeenCalledWith(AVISO_DNI, expect.anything());
  });

  it("con el campo abierto, «Corregir y reintentar» corrige y reintenta de una", async () => {
    H.fixInvoiceDniAndRetryAction.mockResolvedValue({
      success: true,
      data: { status: "authorized", invoiceId: "inv-1", userMessage: "Factura B emitida." },
    });
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
    abrir([fila()]);

    fireEvent.click(screen.getByText("Corregir DNI"));
    fireEvent.change(screen.getByPlaceholderText(CAMPO_DNI), { target: { value: "30123456" } });
    fireEvent.click(screen.getByText("Corregir y reintentar"));

    await waitFor(() =>
      expect(H.fixInvoiceDniAndRetryAction).toHaveBeenCalledWith("inv-1", "res-1", "30123456")
    );
    await waitFor(() => expect(H.toast.success).toHaveBeenCalledWith("Factura B emitida."));
    vi.unstubAllGlobals();
  });

  it("un reintento que falla por otra cosa avisa como siempre y no abre el campo", async () => {
    const caido = "ARCA no está respondiendo. La factura quedó pendiente — reintentá desde Facturación.";
    H.retryInvoiceAction.mockResolvedValue({
      success: true,
      data: { status: "pending", invoiceId: "inv-1", userMessage: caido },
    });
    abrir([fila({ last_error: null })]);

    fireEvent.click(screen.getByText("Reintentar"));

    await waitFor(() => expect(H.toast.warning).toHaveBeenCalledWith(caido, expect.anything()));
    expect(screen.queryByPlaceholderText(CAMPO_DNI)).toBeNull();
    expect(H.router.refresh).toHaveBeenCalled();
  });

  it("la consolidada no tiene «Corregir DNI»: su error queda como viene", () => {
    const consolidada =
      "El DNI del receptor no es valido. Corregilo en la ficha y volve a generar el comprobante.";
    abrir([
      fila({ reservation_id: null, room_number: "CONSOLIDADA", last_error: consolidada }),
    ]);

    expect(screen.getByText(new RegExp(consolidada.replace(/\./g, "\\.")))).toBeTruthy();
    expect(screen.queryByText("Corregir DNI")).toBeNull();
    expect(screen.queryByText(/Usá «Corregir DNI»/)).toBeNull();
  });
});
