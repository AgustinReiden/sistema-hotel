import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RegisterPaymentModal from "./RegisterPaymentModal";
import type { CcOpenInvoiceRow, CcOpenStayRow, CtaCteAccount } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const loadClientOpenInvoicesAction = vi.fn();
const loadClientOpenStaysAction = vi.fn();
const registerAccountPaymentAction = vi.fn();
vi.mock("./actions", () => ({
  loadClientOpenInvoicesAction: (...args: unknown[]) => loadClientOpenInvoicesAction(...args),
  loadClientOpenStaysAction: (...args: unknown[]) => loadClientOpenStaysAction(...args),
  registerAccountPaymentAction: (...args: unknown[]) => registerAccountPaymentAction(...args),
}));

const account: CtaCteAccount = {
  kind: "company",
  id: "acme",
  name: "Acme SA",
  document_id: "20111111112",
  balance: 100000,
};

/** Tres facturas con saldo, cargadas a propósito en desorden. */
const facturas: CcOpenInvoiceRow[] = [
  {
    invoice_id: "nueva",
    kind: "consolidada",
    cbte_tipo: 6,
    pto_vta: 8,
    cbte_nro: 30,
    cbte_fch: "2026-09-01",
    imp_total: 50000,
    imputado: 0,
    saldo: 50000,
    created_at: "2026-09-01T12:00:00.000Z",
  },
  {
    invoice_id: "vieja",
    kind: "checkout",
    cbte_tipo: 6,
    pto_vta: 8,
    cbte_nro: 10,
    cbte_fch: "2026-07-01",
    imp_total: 60000,
    // Ya cobró una parte: el saldo es lo que falta, no el total.
    imputado: 20000,
    saldo: 40000,
    created_at: "2026-07-01T12:00:00.000Z",
  },
];

/**
 * Una estadia cerrada en JUNIO y todavia sin facturar (mig 114): mas vieja que las
 * dos facturas, que es lo que hace visible el orden del reparto automatico.
 */
const estadias: CcOpenStayRow[] = [
  {
    cargo_movimiento_id: "cargo-junio",
    reservation_id: "r-junio",
    room_number: "3",
    passenger: "Ana Gomez",
    fch_desde: "2026-06-10",
    fch_hasta: "2026-06-12",
    amount: 30000,
    imputado: 0,
    saldo: 30000,
  },
];

const etiquetaVieja = "Factura B 00008-00000010";
const etiquetaNueva = "Factura B 00008-00000030";
const etiquetaEstadia = "Estadía Hab. 3 · 10/06/2026 al 12/06/2026";

function montoDe(etiqueta: string): HTMLInputElement {
  return screen.getByLabelText(`Importe imputado a ${etiqueta}`) as HTMLInputElement;
}

async function abrir(onSaved = vi.fn()) {
  render(<RegisterPaymentModal account={account} onClose={vi.fn()} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`)).toBeTruthy());
  return onSaved;
}

const resumen = () => screen.getByTestId("pago-resumen").textContent ?? "";
const problemas = () => screen.queryByTestId("pago-problemas")?.textContent ?? "";
const botonGuardar = () =>
  screen.getByRole("button", { name: /Registrar e imprimir/ }) as HTMLButtonElement;

describe("RegisterPaymentModal", () => {
  beforeEach(() => {
    loadClientOpenInvoicesAction.mockReset();
    loadClientOpenInvoicesAction.mockResolvedValue({ success: true, data: facturas });
    loadClientOpenStaysAction.mockReset();
    // Por defecto no hay estadias sin facturar: los tests de siempre miran las
    // facturas y no tienen por que cambiar de resultado por la mig 114.
    loadClientOpenStaysAction.mockResolvedValue({ success: true, data: [] });
    registerAccountPaymentAction.mockReset();
    registerAccountPaymentAction.mockResolvedValue({
      success: true,
      data: { movementId: "mov-1", reciboCcNumero: 7 },
    });
    // El recibo sale por una ventana nueva: sin esto jsdom tira "not implemented".
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  it("el resumen en vivo separa lo que cancela de lo que entra, antes de guardar", async () => {
    await abrir();

    // Arranca con el saldo de la cuenta y sin retenciones: cancela = entra.
    expect(resumen()).toContain("$100.000,00");

    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Ingresos Brutos"), { target: { value: "1500" } });

    // Lo que cancela NO baja por la retención (es plata que el cliente le pagó a ARCA
    // en nombre del hotel); lo que entra, sí.
    expect(resumen()).toContain("Cancela $100.000,00");
    expect(resumen()).toContain("entran $96.500,00");
    expect(resumen()).toContain("$3.500,00 de retenciones");
  });

  it("aplicar a lo más viejo primero salda la vieja antes de tocar la nueva", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: /Aplicar a lo más viejo primero/ }));

    // $100.000 contra $90.000 de saldo: $40.000 a la vieja y $50.000 a la nueva, que
    // son sus saldos enteros. Los $10.000 que sobran quedan a cuenta, sin forzarlos
    // a ninguna factura.
    expect(montoDe(etiquetaVieja).value).toBe("40.000,00");
    expect(montoDe(etiquetaNueva).value).toBe("50.000,00");
    expect(resumen()).toContain("Aplicado a 2 facturas");
    expect(resumen()).toContain("$10.000,00 quedan a cuenta");
    expect(problemas()).toBe("");
  });

  it("no deja mandar una imputación que se pasa del saldo de la factura", async () => {
    await abrir();

    fireEvent.click(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`));
    fireEvent.change(montoDe(etiquetaVieja), { target: { value: "45000" } });

    // El mensaje dice qué corregir y con cuánto, no "error de validación".
    await waitFor(() => expect(problemas()).toContain(etiquetaVieja));
    expect(problemas()).toContain("$40.000,00");
    expect(problemas()).toContain("$5.000,00 de más");
    expect(botonGuardar().disabled).toBe(true);

    // Corregido al saldo exacto, se puede guardar: el caso límite tiene que entrar.
    fireEvent.change(montoDe(etiquetaVieja), { target: { value: "40000" } });
    await waitFor(() => expect(botonGuardar().disabled).toBe(false));
  });

  it("no deja imputar más de lo que entra en el pago", async () => {
    await abrir();

    fireEvent.change(screen.getByLabelText("Monto que cancela"), { target: { value: "50000" } });
    fireEvent.click(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`));
    fireEvent.change(montoDe(etiquetaVieja), { target: { value: "40000" } });
    fireEvent.click(screen.getByLabelText(`Aplicar a ${etiquetaNueva}`));
    fireEvent.change(montoDe(etiquetaNueva), { target: { value: "30000" } });

    await waitFor(() => expect(problemas()).toContain("$20.000,00 más de lo que entra"));
    expect(botonGuardar().disabled).toBe(true);
  });

  it("un pago sin imputar a ninguna factura se sigue registrando", async () => {
    // La regresión que no se puede permitir: es lo que se hace hoy.
    const onSaved = await abrir();

    fireEvent.click(botonGuardar());

    await waitFor(() => expect(registerAccountPaymentAction).toHaveBeenCalledTimes(1));
    expect(registerAccountPaymentAction.mock.calls[0][0]).toMatchObject({
      kind: "company",
      clientId: "acme",
      amount: 100000,
      imputaciones: [],
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("al guardar abre el recibo con auto-impresión", async () => {
    await abrir();

    fireEvent.click(botonGuardar());

    await waitFor(() => expect(window.open).toHaveBeenCalled());
    const [url, , features] = (window.open as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/admin/recibo-cc/mov-1?autoprint=1&copy=original");
    // Misma firma de ventana que el resto de los impresos de comandera.
    expect(features).toBe("width=420,height=720");
  });

  it("si el navegador bloquea la ventana, el pago NO se da por terminado", async () => {
    // El cobro ya está asentado y el papel no salió: ese estado no se puede perder
    // de vista con un aviso que se desvanece solo.
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));
    const onSaved = await abrir();

    fireEvent.click(botonGuardar());

    await waitFor(() => expect(screen.getByText(/El pago quedó registrado/)).toBeTruthy());
    expect(screen.getByText(/recibo N° 000007/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Abrir el recibo/ })).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sin nada con saldo, el cobro se carga igual y lo dice", async () => {
    loadClientOpenInvoicesAction.mockResolvedValue({ success: true, data: [] });
    render(<RegisterPaymentModal account={account} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/no tiene facturas ni estadías con saldo/)).toBeTruthy()
    );
    expect(botonGuardar().disabled).toBe(false);
  });
});

describe("RegisterPaymentModal — imputar a una estadía sin facturar (mig 114)", () => {
  beforeEach(() => {
    loadClientOpenInvoicesAction.mockReset();
    loadClientOpenInvoicesAction.mockResolvedValue({ success: true, data: facturas });
    loadClientOpenStaysAction.mockReset();
    loadClientOpenStaysAction.mockResolvedValue({ success: true, data: estadias });
    registerAccountPaymentAction.mockReset();
    registerAccountPaymentAction.mockResolvedValue({
      success: true,
      data: { movementId: "mov-1", reciboCcNumero: 7 },
    });
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  it("ofrece las estadías sin facturar además de las facturas", async () => {
    await abrir();

    expect(screen.getByText("Estadías sin facturar")).toBeTruthy();
    expect(screen.getByLabelText(`Aplicar a ${etiquetaEstadia}`)).toBeTruthy();
    // Y dice que no hay que hacer nada cuando salga la factura: la plata se muda sola.
    expect(screen.getByText(/se pasa sola al comprobante/)).toBeTruthy();
  });

  it("la estadía viaja como el id de su CARGO, no como el de la reserva", async () => {
    // Es lo que entiende la RPC: el cargo es la fila que representa esa deuda.
    const onSaved = await abrir();

    fireEvent.change(screen.getByLabelText("Monto que cancela"), { target: { value: "30000" } });
    fireEvent.click(screen.getByLabelText(`Aplicar a ${etiquetaEstadia}`));
    fireEvent.click(botonGuardar());

    await waitFor(() => expect(registerAccountPaymentAction).toHaveBeenCalledTimes(1));
    expect(registerAccountPaymentAction.mock.calls[0][0].imputaciones).toEqual([
      { cargoMovimientoId: "cargo-junio", amount: 30000 },
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("lo más viejo primero mezcla estadías y facturas por fecha", async () => {
    // Decisión de Agustín: una sola fila de antigüedad. La estadía de junio se salda
    // antes que la factura de julio.
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: /Aplicar a lo más viejo primero/ }));

    expect(montoDe(etiquetaEstadia).value).toBe("30.000,00");
    expect(montoDe(etiquetaVieja).value).toBe("40.000,00");
    expect(montoDe(etiquetaNueva).value).toBe("30.000,00"); // lo que quedó de los $100.000
    expect(resumen()).toContain("Aplicado a 2 facturas y 1 estadía");
    expect(problemas()).toBe("");
  });

  it("no deja imputarle a la estadía más de lo que debe", async () => {
    // El techo por estadía (P0043), avisado antes de mandar.
    await abrir();

    fireEvent.click(screen.getByLabelText(`Aplicar a ${etiquetaEstadia}`));
    fireEvent.change(montoDe(etiquetaEstadia), { target: { value: "45000" } });

    await waitFor(() => expect(problemas()).toContain("Estadía Hab. 3"));
    expect(problemas()).toContain("$15.000,00 de más");
    expect(botonGuardar().disabled).toBe(true);
  });
});
