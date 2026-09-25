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

const MENSAJE_SIN_MEDIO = "Elegí cómo paga: efectivo, tarjeta, transferencia o Mercado Pago";

/** Los radios de los medios. Se buscan en el DOM y no con getByRole (ver PR #131). */
function radios(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
}

function marcados(container: HTMLElement): string[] {
  return radios(container)
    .filter((r) => r.checked)
    .map((r) => r.value);
}

/** Pago suelto ("Cargar Pago" de Huéspedes): sin onSubmitPayment, con la reserva. */
function abrirPagoSuelto() {
  const onClose = vi.fn();
  const utils = render(
    <PaymentModal
      isOpen
      onClose={onClose}
      clientName="Juan Prueba"
      totalPrice={50000}
      paidAmount={0}
      reservationId="res-1"
    />
  );
  return { ...utils, onClose };
}

/** Cobro del check-out: el padre manda onSubmitPayment. */
function abrirCheckout(
  props: Partial<React.ComponentProps<typeof PaymentModal>> = {}
) {
  const onSubmitPayment = vi.fn().mockResolvedValue({
    success: true,
    data: { paymentId: null },
  });
  const utils = render(
    <PaymentModal
      isOpen
      onClose={vi.fn()}
      clientName="Juan Prueba"
      totalPrice={80000}
      paidAmount={0}
      onSubmitPayment={onSubmitPayment}
      {...props}
    />
  );
  return { ...utils, onSubmitPayment };
}

describe("PaymentModal: el medio de pago arranca vacío", () => {
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

  it("al montar sin defaultMethod, ningún medio está marcado", () => {
    const { container } = abrirPagoSuelto();

    // Hay medios para elegir, pero ninguno viene elegido: ni siquiera Efectivo.
    expect(radios(container).length).toBeGreaterThan(0);
    expect(marcados(container)).toEqual([]);
  });

  it("en el check-out de un particular tampoco viene ningún medio marcado", () => {
    const { container } = abrirCheckout();

    expect(radios(container).length).toBeGreaterThan(0);
    expect(marcados(container)).toEqual([]);
  });

  it("cobrar sin elegir medio muestra el aviso, enfoca los medios y no registra nada", async () => {
    const { container } = abrirPagoSuelto();

    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(screen.getByText(MENSAJE_SIN_MEDIO)).toBeTruthy());
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
    // El foco queda en el grupo de medios, para que se vea qué falta.
    const grupo = container.querySelector('[role="radiogroup"]');
    expect(grupo).not.toBeNull();
    expect(document.activeElement).toBe(grupo);
  });

  it("en el check-out, cobrar sin elegir medio no llama a onSubmitPayment", async () => {
    const { onSubmitPayment } = abrirCheckout();

    fireEvent.click(screen.getByText("Registrar y Cerrar"));

    await waitFor(() => expect(screen.getByText(MENSAJE_SIN_MEDIO)).toBeTruthy());
    expect(onSubmitPayment).not.toHaveBeenCalled();
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });

  it("al elegir un medio se va el aviso de que falta", async () => {
    abrirPagoSuelto();

    fireEvent.click(screen.getByText("Registrar Pago"));
    await waitFor(() => expect(screen.getByText(MENSAJE_SIN_MEDIO)).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Tarjeta"));

    expect(screen.queryByText(MENSAJE_SIN_MEDIO)).toBeNull();
  });

  it("con Transferencia elegida, registra el pago con bank_transfer", async () => {
    abrirPagoSuelto();

    fireEvent.click(screen.getByLabelText("Transferencia"));
    fireEvent.click(screen.getByText("Registrar Pago"));

    await waitFor(() => expect(H.registerPaymentAction).toHaveBeenCalledTimes(1));
    expect(H.registerPaymentAction).toHaveBeenCalledWith("res-1", 50000, "bank_transfer");
  });

  it("la tarjeta tiene scroll propio: en un celular el botón de cobrar no queda fuera de pantalla", () => {
    const { container } = abrirCheckout({
      defaultMethod: "cuenta_corriente",
      accountCreditEnabled: true,
      accountHolderName: "Empresa Ficticia SA",
    });

    // jsdom no mide alturas: se comprueba que la tarjeta que contiene el formulario
    // tope su alto y scrollee, en vez de recortarse (antes era overflow-hidden).
    const tarjeta = container.querySelector("#payment-form")?.closest(".overflow-y-auto");
    expect(tarjeta).not.toBeNull();
    expect(tarjeta?.classList.contains("max-h-[92dvh]")).toBe(true);
    expect(tarjeta?.classList.contains("overflow-hidden")).toBe(false);
  });
});

describe("PaymentModal: Cta. Cte. en el check-out de una empresa con cuenta", () => {
  beforeEach(() => {
    H.registerPaymentAction.mockReset();
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("viene marcada, lo dice claro y el aviso nombra a la empresa", async () => {
    const { container, onSubmitPayment } = abrirCheckout({
      defaultMethod: "cuenta_corriente",
      accountCreditEnabled: true,
      accountHolderName: "Empresa Ficticia SA",
    });

    expect(marcados(container)).toEqual(["cuenta_corriente"]);
    expect(screen.getByText("Monto a cuenta corriente")).toBeTruthy();
    expect(
      screen.getByText(
        "Queda a cuenta de Empresa Ficticia SA. Sale el remito para que firme el pasajero."
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(onSubmitPayment).toHaveBeenCalledTimes(1));
    expect(onSubmitPayment).toHaveBeenCalledWith({
      amount: 80000,
      paymentMethod: "cuenta_corriente",
    });
    await waitFor(() => expect(H.toast.success).toHaveBeenCalledTimes(1));
    expect(H.toast.success.mock.calls[0][0]).toContain("Queda a cuenta de Empresa Ficticia SA");
    expect(H.registerPaymentAction).not.toHaveBeenCalled();
  });

  it("si el pasajero paga de su bolsillo, al cambiar el medio vuelve el texto de siempre", () => {
    abrirCheckout({
      defaultMethod: "cuenta_corriente",
      accountCreditEnabled: true,
      accountHolderName: "Empresa Ficticia SA",
    });

    fireEvent.click(screen.getByLabelText("Efectivo"));

    expect(screen.queryByText("Cargar a la cuenta y cerrar")).toBeNull();
    expect(screen.getByText("Registrar y Cerrar")).toBeTruthy();
    expect(screen.queryByText(/Queda a cuenta de/)).toBeNull();
  });

  it("con accountCreditEnabled=false, aunque venga el defaultMethod, no hay ningún medio marcado", () => {
    const { container } = abrirCheckout({
      defaultMethod: "cuenta_corriente",
      accountCreditEnabled: false,
      accountHolderName: "Empresa Ficticia SA",
    });

    expect(radios(container).length).toBeGreaterThan(0);
    expect(marcados(container)).toEqual([]);
    expect(screen.queryByText("Cta. Cte.")).toBeNull();
  });

  it("fuera del check-out, aunque venga el defaultMethod, no se ofrece ni se marca Cta. Cte.", () => {
    const { container } = render(
      <PaymentModal
        isOpen
        onClose={vi.fn()}
        clientName="Juan Prueba"
        totalPrice={50000}
        paidAmount={0}
        reservationId="res-1"
        defaultMethod="cuenta_corriente"
        accountCreditEnabled
      />
    );

    expect(marcados(container)).toEqual([]);
    expect(screen.queryByText("Cta. Cte.")).toBeNull();
  });
});
