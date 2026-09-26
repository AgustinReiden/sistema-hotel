import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreditChargesList from "./CreditChargesList";
import type { ShiftCreditChargeRow } from "@/lib/types";

const H = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

const fiado: ShiftCreditChargeRow = {
  id: "mov-1",
  amount: 80000,
  created_at: "2026-09-25T11:00:00.000Z",
  reservation_id: "res-1",
  client_name: "Empresa Ficticia SA",
  room_number: "4",
  remito_numero: 17,
};

describe("CreditChargesList", () => {
  beforeEach(() => {
    H.toast.error.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("muestra el número de remito con el formato del papel y el cliente ficticio", () => {
    render(<CreditChargesList charges={[fiado]} />);

    expect(screen.getByText("Remito R-000017")).toBeTruthy();
    expect(screen.getByText("Empresa Ficticia SA")).toBeTruthy();
    expect(screen.getByText("Hab. 4")).toBeTruthy();
    expect(screen.getByText("$80.000,00")).toBeTruthy();
    expect(screen.getByLabelText("Reimprimir remito de Empresa Ficticia SA")).toBeTruthy();
  });

  it("va en dos renglones: el cliente con el monto arriba, y la habitación, el remito y el botón abajo", () => {
    // La tarjeta es angosta: si el monto y el botón iban al lado del nombre, el
    // nombre y la habitación quedaban cortados y no se sabía de quién era cada remito.
    render(<CreditChargesList charges={[fiado]} />);

    const renglonCliente = screen.getByText("Empresa Ficticia SA").parentElement as HTMLElement;
    expect(renglonCliente.textContent).toBe("Empresa Ficticia SA$80.000,00");

    const boton = screen.getByLabelText("Reimprimir remito de Empresa Ficticia SA");
    const renglonRemito = boton.parentElement as HTMLElement;
    expect(renglonCliente.contains(boton)).toBe(false);
    expect(renglonRemito.textContent).toContain("Hab. 4");
    expect(renglonRemito.textContent).toContain("Remito R-000017");
    // Si no entra al lado del remito, el botón baja en vez de apretar el texto.
    expect(renglonRemito.className).toContain("flex-wrap");
  });

  it("Reimprimir abre el mismo remito con la leyenda de reimpresión", () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    render(<CreditChargesList charges={[fiado]} />);

    fireEvent.click(screen.getByLabelText("Reimprimir remito de Empresa Ficticia SA"));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      "/admin/comprobante-cc/mov-1?autoprint=1&reimpresion=1",
      "comprobante-cc-mov-1",
      "width=420,height=720"
    );
    expect(H.toast.error).not.toHaveBeenCalled();
  });

  it("si el navegador bloquea la ventana, avisa qué hacer", () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);
    render(<CreditChargesList charges={[fiado]} />);

    fireEvent.click(screen.getByLabelText("Reimprimir remito de Empresa Ficticia SA"));

    expect(open).toHaveBeenCalledTimes(1);
    expect(H.toast.error).toHaveBeenCalledWith(
      "El navegador bloqueó la ventana. Permití ventanas emergentes para este sitio y volvé a apretar."
    );
  });

  it("un cargo sin número de remito igual se puede reimprimir", () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    render(
      <CreditChargesList
        charges={[{ ...fiado, id: "mov-2", remito_numero: null, client_name: "Juan Prueba" }]}
      />
    );

    expect(screen.queryByText(/^Remito R-/)).toBeNull();
    // Sin número no queda un separador colgando después de la habitación.
    const boton = screen.getByLabelText("Reimprimir remito de Juan Prueba");
    expect((boton.parentElement as HTMLElement).textContent).toBe("Hab. 4Reimprimir");
    fireEvent.click(boton);
    expect(open).toHaveBeenCalledWith(
      "/admin/comprobante-cc/mov-2?autoprint=1&reimpresion=1",
      "comprobante-cc-mov-2",
      "width=420,height=720"
    );
  });
});
