import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  return screen.getByLabelText(`Importe aplicado a ${etiqueta}`) as HTMLInputElement;
}

/** El primer campo (F2-11): lo que dice el extracto del banco, sin retenciones. */
const LO_QUE_ENTRO = "Lo que entró (a la cuenta o en mano)";

const campoEntro = () => screen.getByLabelText(LO_QUE_ENTRO) as HTMLInputElement;
const selectMetodo = () => screen.getByLabelText("Cómo entró") as HTMLSelectElement;

function elegirMetodo(value = "bank_transfer") {
  fireEvent.change(selectMetodo(), { target: { value } });
}

/** Monta el modal y espera a que lleguen las deudas, sin tocar ningún campo. */
async function montar(onSaved = vi.fn(), cuenta: CtaCteAccount = account) {
  render(<RegisterPaymentModal account={cuenta} onClose={vi.fn()} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`)).toBeTruthy());
  return onSaved;
}

/**
 * Monta el modal y carga un pago de $100.000 por transferencia. Desde F2-11 el modal
 * no precarga el saldo ni el medio: los tests de imputación parten del mismo pago que
 * antes, pero tipeado a mano como lo hace el admin.
 */
async function abrir(onSaved = vi.fn()) {
  await montar(onSaved);
  elegirMetodo();
  fireEvent.change(campoEntro(), { target: { value: "100000" } });
  return onSaved;
}

const resumen = () => screen.getByTestId("pago-resumen").textContent ?? "";
const problemas = () => screen.queryByTestId("pago-problemas")?.textContent ?? "";
// Los botones se buscan por su texto, no con getByRole: getByRole calcula el nombre
// accesible de cada botón y llama a getComputedStyle de jsdom por cada ancestro, y
// botonGuardar() corre adentro de waitFor, una vez por reintento. Fue lo que hizo
// pasar los 5 s a CuentasClient.test.tsx con la suite entera en paralelo.
const botonGuardar = () =>
  screen.getByText("Registrar e imprimir") as HTMLButtonElement;

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

    // Sin retenciones: cancela = entra.
    expect(resumen()).toContain("$100.000,00");

    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Ingresos Brutos"), { target: { value: "1500" } });

    // Desde F2-11 se tipea lo que ENTRÓ: la retención se SUMA a lo que cancela (es
    // plata que el cliente le pagó a ARCA en nombre del hotel) y lo que entra queda
    // como se escribió.
    expect(resumen()).toContain("Cancela $103.500,00");
    expect(resumen()).toContain("entran $100.000,00");
    expect(resumen()).toContain("$3.500,00 de retenciones");
  });

  it("aplicar a lo más viejo primero salda la vieja antes de tocar la nueva", async () => {
    await abrir();

    fireEvent.click(screen.getByText("Aplicar a lo más viejo primero"));

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

    fireEvent.change(campoEntro(), { target: { value: "50000" } });
    fireEvent.click(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`));
    fireEvent.change(montoDe(etiquetaVieja), { target: { value: "40000" } });
    fireEvent.click(screen.getByLabelText(`Aplicar a ${etiquetaNueva}`));
    fireEvent.change(montoDe(etiquetaNueva), { target: { value: "30000" } });

    await waitFor(() => expect(problemas()).toContain("$20.000,00 más de lo que cancela este pago"));
    expect(problemas()).toContain("Subí lo que entró");
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
    expect(screen.getByText("Abrir el recibo").tagName).toBe("BUTTON");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sin nada con saldo, el cobro se carga igual y lo dice", async () => {
    loadClientOpenInvoicesAction.mockResolvedValue({ success: true, data: [] });
    render(<RegisterPaymentModal account={account} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/no tiene facturas ni estadías con saldo/)).toBeTruthy()
    );
    elegirMetodo();
    fireEvent.change(campoEntro(), { target: { value: "100000" } });
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

    fireEvent.change(campoEntro(), { target: { value: "30000" } });
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

    fireEvent.click(screen.getByText("Aplicar a lo más viejo primero"));

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

describe("RegisterPaymentModal — se carga lo que entró (F2-11)", () => {
  beforeEach(() => {
    loadClientOpenInvoicesAction.mockReset();
    loadClientOpenInvoicesAction.mockResolvedValue({ success: true, data: facturas });
    loadClientOpenStaysAction.mockReset();
    loadClientOpenStaysAction.mockResolvedValue({ success: true, data: [] });
    registerAccountPaymentAction.mockReset();
    registerAccountPaymentAction.mockResolvedValue({
      success: true,
      data: { movementId: "mov-1", reciboCcNumero: 7 },
    });
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  const cancelaDeDeuda = () => screen.getByTestId("pago-cancela").textContent ?? "";

  it("arranca vacío: sin lo que entró precargado y sin medio elegido", async () => {
    await montar();

    expect(campoEntro().value).toBe("");
    expect(selectMetodo().value).toBe("");
    expect(within(selectMetodo()).getByText("Elegí…")).toBeTruthy();
    // Las etiquetas salen de la tabla única de medios de pago.
    expect(within(selectMetodo()).getByText("Transferencia")).toBeTruthy();
    expect(botonGuardar().disabled).toBe(true);
  });

  it("entraron $90.000 y retuvieron $10.000 de Ganancias: cancela $100.000 y eso viaja", async () => {
    const onSaved = await montar();

    elegirMetodo("bank_transfer");
    fireEvent.change(campoEntro(), { target: { value: "90.000" } });
    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "10.000" } });

    // El número que se calcula, en grande y de solo lectura, al lado de lo tipeado.
    expect(cancelaDeDeuda()).toContain("$100.000,00");
    expect(resumen()).toContain("Cancela $100.000,00 de deuda");
    expect(resumen()).toContain("entran $90.000,00");

    fireEvent.click(botonGuardar());

    await waitFor(() => expect(registerAccountPaymentAction).toHaveBeenCalledTimes(1));
    // amount sigue siendo lo que CANCELA (mig 109): lo que entró + las retenciones.
    expect(registerAccountPaymentAction.mock.calls[0][0]).toMatchObject({
      amount: 100000,
      method: "bank_transfer",
      retencionGanancias: 10000,
      retencionIibb: 0,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("'Paga todo el saldo' completa lo que tuvo que entrar, descontando las retenciones", async () => {
    await montar(vi.fn(), { ...account, balance: 150000 });

    fireEvent.change(screen.getByLabelText("Ingresos Brutos"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Paga todo el saldo"));

    expect(campoEntro().value).toBe("145.000,00");
    expect(cancelaDeDeuda()).toContain("$150.000,00");
  });

  it("'Paga todo el saldo' sigue al día si las retenciones se cargan DESPUÉS del chip", async () => {
    // El chip está arriba y se aprieta primero: no puede dejar al cliente con plata a
    // favor porque la retención llegó un campo más abajo.
    await montar(vi.fn(), { ...account, balance: 150000 });

    fireEvent.click(screen.getByText("Paga todo el saldo"));
    expect(campoEntro().value).toBe("150.000,00");

    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "10.000" } });
    expect(campoEntro().value).toBe("140.000,00");
    expect(cancelaDeDeuda()).toContain("$150.000,00");

    // Si el admin lo toca a mano, el campo vuelve a ser suyo.
    fireEvent.change(campoEntro(), { target: { value: "120.000" } });
    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "5.000" } });
    expect(campoEntro().value).toBe("120.000");
    expect(cancelaDeDeuda()).toContain("$125.000,00");
  });

  it("lo que entró ilegible no se guarda aunque haya retenciones", async () => {
    // "$ 90.000,00" no se entiende: antes valía 0 y quedaba un cobro de la sola retención.
    await montar();
    elegirMetodo("bank_transfer");

    fireEvent.change(campoEntro(), { target: { value: "$ 90.000,00" } });
    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "10.000" } });

    expect(problemas()).toContain("No se entiende lo que entró");
    expect(botonGuardar().disabled).toBe(true);
    expect(registerAccountPaymentAction).not.toHaveBeenCalled();
  });

  it("lo que entró vacío con una retención cargada pide escribirlo (o un 0)", async () => {
    await montar();
    elegirMetodo("bank_transfer");

    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "8.000" } });

    expect(problemas()).toContain("Escribí lo que entró");
    expect(botonGuardar().disabled).toBe(true);

    // Un 0 escrito es deliberado: el pago absorbido entero por la retención es válido.
    fireEvent.change(campoEntro(), { target: { value: "0" } });
    expect(problemas()).not.toContain("Escribí lo que entró");
    expect(botonGuardar().disabled).toBe(false);
  });

  it("una retención ilegible no se ignora en silencio", async () => {
    await montar();
    elegirMetodo("bank_transfer");

    fireEvent.change(campoEntro(), { target: { value: "90.000" } });
    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "$10.000" } });

    expect(problemas()).toContain("No se entiende la retención de Ganancias");
    expect(botonGuardar().disabled).toBe(true);
  });

  it("'Paga todo el saldo' no propone un negativo si la retención se come el saldo", async () => {
    await montar(vi.fn(), { ...account, balance: 3000 });

    fireEvent.change(screen.getByLabelText("Ganancias"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Paga todo el saldo"));

    expect(campoEntro().value).toBe("0,00");
  });

  it("sin medio elegido lo pide en la lista amarilla y no manda nada", async () => {
    const { container } = render(
      <RegisterPaymentModal account={account} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`)).toBeTruthy());

    fireEvent.change(campoEntro(), { target: { value: "90000" } });

    expect(problemas()).toContain("Elegí cómo entró el pago");
    expect(botonGuardar().disabled).toBe(true);

    // Ni siquiera con Enter dentro de un campo (que manda el formulario aunque el
    // botón esté deshabilitado).
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(registerAccountPaymentAction).not.toHaveBeenCalled();

    elegirMetodo("cash");
    expect(problemas()).not.toContain("Elegí cómo entró el pago");
    expect(botonGuardar().disabled).toBe(false);
  });

  it("no se puede mandar dos veces: el segundo envío mientras guarda no sale", async () => {
    // Q6: Agustín va a cargar a mano los cobros atrasados. Un doble click o un Enter
    // repetido no puede asentar el mismo pago dos veces.
    let terminar: (v: unknown) => void = () => {};
    registerAccountPaymentAction.mockReturnValue(
      new Promise((resolve) => {
        terminar = resolve;
      })
    );
    const { container } = render(
      <RegisterPaymentModal account={account} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`)).toBeTruthy());
    elegirMetodo();
    fireEvent.change(campoEntro(), { target: { value: "90000" } });

    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(botonGuardar());

    expect(registerAccountPaymentAction).toHaveBeenCalledTimes(1);
    terminar({ success: true, data: { movementId: "mov-1", reciboCcNumero: 7 } });
    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    expect(registerAccountPaymentAction).toHaveBeenCalledTimes(1);
  });

  it("si la acción falla se puede volver a intentar", async () => {
    registerAccountPaymentAction.mockResolvedValueOnce({ success: false, error: "Se cortó." });
    const { container } = render(
      <RegisterPaymentModal account={account} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByLabelText(`Aplicar a ${etiquetaVieja}`)).toBeTruthy());
    elegirMetodo();
    fireEvent.change(campoEntro(), { target: { value: "90000" } });

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(botonGuardar().disabled).toBe(false));
    fireEvent.click(botonGuardar());

    await waitFor(() => expect(registerAccountPaymentAction).toHaveBeenCalledTimes(2));
  });
});
