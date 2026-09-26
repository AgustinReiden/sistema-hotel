import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InvoicePromptModal, { type InvoicePromptData } from "./InvoicePromptModal";

const H = vi.hoisted(() => ({
  declineInvoiceAction: vi.fn(),
  emitInvoiceForReservationAction: vi.fn(),
  lookupReceptorByCuitAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./fiscal/actions", () => ({
  declineInvoiceAction: H.declineInvoiceAction,
  emitInvoiceForReservationAction: H.emitInvoiceForReservationAction,
  lookupReceptorByCuitAction: H.lookupReceptorByCuitAction,
}));

const SALIR = "¿Salir sin facturar?";
const PENDIENTE = "Queda pendiente para el administrador. Vos ya no la vas a ver en tu pantalla.";
const BANCARIO = "Se cobró por medio bancario: la factura se tiene que emitir igual.";

/** Check-out en efectivo de un particular: la pregunta arranca en el SÍ/NO. */
function datos(overrides: Partial<InvoicePromptData> = {}): InvoicePromptData {
  return {
    reservationId: "res-1",
    clientName: "Juan Prueba",
    clientDni: "30123456",
    total: 80000,
    aPrefill: { razonSocial: "Juan Prueba", cuit: "", condicionIva: "", domicilio: "" },
    suggestA: false,
    mandatory: false,
    prefillComplete: false,
    ...overrides,
  };
}

function abrir(
  data: InvoicePromptData,
  props: { startAtTipo?: boolean } = {}
) {
  const onClose = vi.fn();
  const utils = render(<InvoicePromptModal data={data} onClose={onClose} {...props} />);
  return { ...utils, onClose };
}

describe("InvoicePromptModal: salir sin decidir", () => {
  beforeEach(() => {
    H.declineInvoiceAction.mockReset();
    H.declineInvoiceAction.mockResolvedValue({ success: true });
    H.emitInvoiceForReservationAction.mockReset();
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("después del check-out, la X no cierra: pregunta «¿Salir sin facturar?»", () => {
    const { onClose } = abrir(datos());

    fireEvent.click(screen.getByLabelText("Cerrar"));

    expect(screen.getByText(SALIR)).toBeTruthy();
    expect(screen.getByText(PENDIENTE)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // Efectivo: no hay rastro bancario, así que no lo menciona.
    expect(screen.queryByText(BANCARIO)).toBeNull();
  });

  it("«Salir sin facturar» cierra una vez y no registra el «no facturar»", () => {
    const { onClose } = abrir(datos());

    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getByText("Salir sin facturar"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(H.declineInvoiceAction).not.toHaveBeenCalled();
  });

  it("«Volver a la factura» deja todo como estaba: vuelve el SÍ/NO", () => {
    const { onClose } = abrir(datos());

    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getByText("Volver a la factura"));

    expect(screen.getByText("SÍ")).toBeTruthy();
    expect(screen.getByText("NO")).toBeTruthy();
    expect(screen.queryByText(SALIR)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("«Volver a la factura» vuelve al paso en que estaba, no al principio", () => {
    abrir(datos());

    fireEvent.click(screen.getByText("SÍ"));
    expect(screen.getByText("¿A quién se le factura?")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getByText("Volver a la factura"));

    expect(screen.getByText("¿A quién se le factura?")).toBeTruthy();
  });

  it("en la pregunta de salir no hay X: un doble click no cierra sin querer", () => {
    const { onClose } = abrir(datos());

    fireEvent.click(screen.getByLabelText("Cerrar"));

    expect(screen.queryByLabelText("Cerrar")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("en /admin/fiscal y en Control (startAtTipo), la X del admin cierra directo", () => {
    const { onClose } = abrir(datos(), { startAtTipo: true });

    fireEvent.click(screen.getByLabelText("Cerrar"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SALIR)).toBeNull();
  });

  it("con startAtTipo, el «Cancelar» del paso tipo también cierra directo", () => {
    const { onClose } = abrir(datos(), { startAtTipo: true });

    fireEvent.click(screen.getByText("Cancelar"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SALIR)).toBeNull();
  });

  it("cobrado por medio bancario, el «Cancelar» del paso tipo pregunta y menciona el medio bancario", () => {
    const { onClose } = abrir(datos({ mandatory: true }));

    // Sin SÍ/NO: arranca en el tipo.
    expect(screen.getByText("¿A quién se le factura?")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancelar"));

    expect(screen.getByText(SALIR)).toBeTruthy();
    expect(screen.getByText(PENDIENTE)).toBeTruthy();
    expect(screen.getByText(BANCARIO)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    // Recepción puede salir igual; la estadía le queda al admin en Por facturar.
    fireEvent.click(screen.getByText("Salir sin facturar"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(H.declineInvoiceAction).not.toHaveBeenCalled();
  });

  it("cobrado por medio bancario, «Volver a la factura» vuelve al tipo", () => {
    abrir(datos({ mandatory: true }));

    fireEvent.click(screen.getByLabelText("Cerrar"));
    expect(screen.getByText(BANCARIO)).toBeTruthy();
    fireEvent.click(screen.getByText("Volver a la factura"));

    expect(screen.getByText("¿A quién se le factura?")).toBeTruthy();
  });

  it("«No facturar» confirmado sigue cerrando directo, sin preguntar si salir", async () => {
    const { onClose } = abrir(datos());

    fireEvent.click(screen.getByText("NO"));
    fireEvent.click(screen.getByText("No facturar"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(H.declineInvoiceAction).toHaveBeenCalledWith("res-1");
    expect(screen.queryByText(SALIR)).toBeNull();
  });

  it("después de emitir sigue cerrando directo, sin preguntar si salir", async () => {
    H.emitInvoiceForReservationAction.mockResolvedValue({
      success: true,
      data: { status: "authorized", userMessage: "Factura emitida.", invoiceId: "inv-1" },
    });
    const { onClose } = abrir(datos());

    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(screen.getByText("Consumidor Final"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Confirmar y emitir"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(H.emitInvoiceForReservationAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SALIR)).toBeNull();
  });
});
