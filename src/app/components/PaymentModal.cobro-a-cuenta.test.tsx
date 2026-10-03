import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PaymentModal from "./PaymentModal";

const H = vi.hoisted(() => ({
  registerPaymentAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("@/app/admin/finances/actions", () => ({
  registerPaymentAction: H.registerPaymentAction,
}));

const AYUDA = "Queda en tu caja. Lo que falte se cobra en el check-out.";

/** Los radios de los medios. Se buscan en el DOM y no con getByRole (ver PR #131). */
function medios(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
    (r) => r.value
  );
}

/**
 * Cobro a cuenta (una seña o un pago antes del check-out): sin onSubmitPayment, con la
 * reserva. Debe $43.700: total $43.700 sin nada pagado.
 */
function abrirCobroACuenta(props: Partial<React.ComponentProps<typeof PaymentModal>> = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const utils = render(
    <PaymentModal
      isOpen
      partial
      onClose={onClose}
      onSuccess={onSuccess}
      clientName="Juan Prueba"
      totalPrice={43700}
      paidAmount={0}
      reservationId="res-1"
      {...props}
    />
  );
  return { ...utils, onClose, onSuccess };
}

function cargarMonto(texto: string) {
  fireEvent.change(screen.getByLabelText("Monto a abonar ($)"), { target: { value: texto } });
}

describe("PaymentModal: cobro a cuenta antes del check-out", () => {
  beforeEach(() => {
    H.registerPaymentAction.mockReset();
    H.registerPaymentAction.mockResolvedValue({ success: true, data: { paymentId: null } });
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    // El recibo sale por una ventana nueva: sin esto jsdom tira "not implemented".
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("se titula «Cobrar a cuenta» y explica que lo que falte se cobra en el check-out", () => {
    abrirCobroACuenta();

    expect(screen.getByText("Cobrar a cuenta")).toBeTruthy();
    expect(screen.getByText(AYUDA)).toBeTruthy();
    // No es el pago suelto de Huéspedes ni el cobro del check-out.
    expect(screen.queryByText("Cargar Pago")).toBeNull();
    expect(screen.queryByText("Cobrar y Finalizar")).toBeNull();
    expect(
      screen.queryByText("Podés registrar un pago parcial o total para esta reserva.")
    ).toBeNull();
  });

  it("el medio arranca vacío", () => {
    const { container } = abrirCobroACuenta();

    const marcados = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ).filter((r) => r.checked);
    expect(marcados).toEqual([]);
  });

  it("no ofrece Vale Blanco aunque no haya pagos previos", () => {
    const { container } = abrirCobroACuenta({ paidAmount: 0 });

    expect(screen.queryByText("Vale Blanco")).toBeNull();
    expect(medios(container)).not.toContain("vale_blanco");
    // Los medios de siempre sí están.
    expect(medios(container)).toEqual(
      expect.arrayContaining(["cash", "mercado_pago", "bank_transfer", "credit_card"])
    );
  });

  it("tampoco ofrece Cta. Cte., aunque el cliente tenga cuenta", () => {
    const { container } = abrirCobroACuenta({
      accountCreditEnabled: true,
      defaultMethod: "cuenta_corriente",
    });

    expect(screen.queryByText("Cta. Cte.")).toBeNull();
    expect(medios(container)).not.toContain("cuenta_corriente");
  });

  it("si el monto supera lo que falta, lo dice y no registra nada", async () => {
    abrirCobroACuenta({ totalPrice: 43700, paidAmount: 0 });

    cargarMonto("50.000");
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() =>
      expect(screen.getByText("No puede superar lo que falta ($43.700,00)")).toBeTruthy()
    );
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });

  it("el tope es lo que falta, no el total: con $20.000 pagados, $23.700,01 no pasa", async () => {
    abrirCobroACuenta({ totalPrice: 43700, paidAmount: 20000 });

    cargarMonto("23.700,01");
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() =>
      expect(screen.getByText("No puede superar lo que falta ($23.700,00)")).toBeTruthy()
    );
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });

  it("un monto menor a lo que falta se registra con el medio elegido", async () => {
    const { onSuccess, onClose } = abrirCobroACuenta();

    cargarMonto("20.000");
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(H.registerPaymentAction).toHaveBeenCalledTimes(1));
    expect(H.registerPaymentAction).toHaveBeenCalledWith("res-1", 20000, "cash");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No puede superar/)).toBeNull();
  });

  it("justo lo que falta también se acepta", async () => {
    abrirCobroACuenta({ totalPrice: 43700, paidAmount: 20000 });

    cargarMonto("23.700");
    fireEvent.click(screen.getByLabelText("Tarjeta"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(H.registerPaymentAction).toHaveBeenCalledTimes(1));
    expect(H.registerPaymentAction).toHaveBeenCalledWith("res-1", 23700, "credit_card");
  });

  it("sin medio elegido no registra nada, como en los demás cobros", async () => {
    abrirCobroACuenta();

    cargarMonto("20.000");
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() =>
      expect(
        screen.getByText("Elegí cómo paga: efectivo, tarjeta, transferencia o Mercado Pago")
      ).toBeTruthy()
    );
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });

  it("si la acción devuelve el pago, abre el recibo original con auto-impresión", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    H.registerPaymentAction.mockResolvedValue({ success: true, data: { paymentId: "pay-7" } });
    abrirCobroACuenta();

    cargarMonto("20.000");
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0][0]).toBe("/admin/recibo/pay-7?autoprint=1&copy=original");
  });

  it("con la caja cerrada (P0003) avisa «Caja cerrada» con el enlace a Caja", async () => {
    H.registerPaymentAction.mockResolvedValue({
      success: false,
      error: "Debes abrir la caja antes de cobrar.",
      code: "P0003",
    });
    const { container, onSuccess } = abrirCobroACuenta();

    cargarMonto("20.000");
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(screen.getByText("Caja cerrada")).toBeTruthy());
    expect(screen.getByText("Ir a Caja")).toBeTruthy();
    expect(container.querySelector('a[href="/admin/caja"]')).not.toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("se abre encima del detalle del calendario (z-[60])", () => {
    const { container } = abrirCobroACuenta();

    const fondo = container.firstElementChild as HTMLElement;
    expect(fondo.classList.contains("fixed")).toBe(true);
    expect(fondo.classList.contains("z-[65]")).toBe(true);
  });
});

describe("PaymentModal: el pago suelto de Huéspedes no cambia", () => {
  beforeEach(() => {
    H.registerPaymentAction.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin el modo a cuenta sigue con su título, su ayuda, Vale Blanco y sin tope propio", () => {
    render(
      <PaymentModal
        isOpen
        onClose={vi.fn()}
        clientName="Juan Prueba"
        totalPrice={43700}
        paidAmount={0}
        reservationId="res-1"
      />
    );

    expect(screen.getByText("Cargar Pago")).toBeTruthy();
    expect(
      screen.getByText("Podés registrar un pago parcial o total para esta reserva.")
    ).toBeTruthy();
    expect(screen.getByText("Vale Blanco")).toBeTruthy();
    expect(screen.queryByText("Cobrar a cuenta")).toBeNull();
    expect(screen.queryByText(AYUDA)).toBeNull();
  });
});
