import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CuentasClient from "./CuentasClient";
import type {
  CcAccountStayRow,
  CcClientPaymentRow,
  ClientInvoiceRow,
  CtaCteAccount,
  CtaCteMovimiento,
} from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const loadCtaCteAccountAction = vi.fn();
const loadClientInvoicesAction = vi.fn();
const loadClientPaymentsAction = vi.fn();
const loadCcAccountStaysAction = vi.fn();
vi.mock("./actions", () => ({
  loadCtaCteAccountAction: (...args: unknown[]) => loadCtaCteAccountAction(...args),
  loadClientInvoicesAction: (...args: unknown[]) => loadClientInvoicesAction(...args),
  loadClientPaymentsAction: (...args: unknown[]) => loadClientPaymentsAction(...args),
  loadCcAccountStaysAction: (...args: unknown[]) => loadCcAccountStaysAction(...args),
  loadClientOpenInvoicesAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
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
    // Un cargo nunca lleva retenciones (la base lo fuerza a 0, mig 109) y se numera
    // como remito; el recibo de cobranza es del pago.
    retencion_ganancias: 0,
    retencion_iibb: 0,
    retencion_certificado: null,
    remito_numero: 17,
    recibo_cc_numero: null,
  },
  {
    id: "m2",
    tipo: "pago",
    amount: 5000,
    reservation_id: null,
    payment_method: "cash",
    notes: null,
    created_at: new Date().toISOString(),
    retencion_ganancias: 0,
    retencion_iibb: 0,
    retencion_certificado: null,
    remito_numero: null,
    recibo_cc_numero: 1,
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
    loadClientPaymentsAction.mockReset();
    loadClientPaymentsAction.mockResolvedValue({ success: true, data: [] });
    // La solapa Movimientos pide aparte el estado de cobro de cada estadía: es una
    // lectura decorativa, así que por defecto no devuelve ninguna.
    loadCcAccountStaysAction.mockReset();
    loadCcAccountStaysAction.mockResolvedValue({ success: true, data: [] });
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

/** Un cobro con las dos retenciones, imputado a la consolidada y con vuelto a cuenta. */
const pagos: CcClientPaymentRow[] = [
  {
    movimiento_id: "m2",
    created_at: "2026-09-15T13:00:00.000Z",
    amount: 100000,
    payment_method: "bank_transfer",
    retencion_ganancias: 2000,
    retencion_iibb: 1500,
    retencion_certificado: "RG-4444",
    neto_recibido: 96500,
    sin_imputar: 40000,
    recibo_cc_numero: 7,
    notes: null,
    imputaciones: [
      {
        imputacion_id: "i1",
        invoice_id: "f1",
        cbte_tipo: 1,
        pto_vta: 8,
        cbte_nro: 1,
        cbte_fch: "2026-09-17",
        kind: "consolidada",
        anulada: false,
        imp_total: 1480000,
        imputado: 60000,
        revertida: false,
        revertida_at: null,
        revertida_motivo: null,
      },
      {
        // Desimputada (mig 111): se sigue mostrando, tachada, y su plata ya no
        // cancela nada — por eso los $40.000 figuran a cuenta.
        imputacion_id: "i2",
        invoice_id: "f2",
        cbte_tipo: 6,
        pto_vta: 8,
        cbte_nro: 42,
        cbte_fch: "2026-08-01",
        kind: "checkout",
        anulada: false,
        imp_total: 50000,
        imputado: 40000,
        revertida: true,
        revertida_at: "2026-09-16T10:00:00.000Z",
        revertida_motivo: "Se imputó a la factura equivocada",
      },
    ],
  },
];

/** La estadía del cargo m1: facturada en consolidada y cobrada a medias. */
const estadias: CcAccountStayRow[] = [
  {
    reservation_id: "r1",
    movimiento_id: "m1",
    room_number: "5",
    passenger: "Juan Pérez",
    fch_desde: "2020-01-03",
    fch_hasta: "2020-01-05",
    amount: 20000,
    total_price: 20000,
    actual_check_out: "2020-01-05T14:00:00.000Z",
    mixed_payment: false,
    facturable: false,
    estado: "facturado_consolidado",
    invoice_id: "f1",
    invoice_kind: "consolidada",
    invoice_status: "authorized",
    cbte_tipo: 1,
    pto_vta: 8,
    cbte_nro: 1,
    cbte_fch: "2026-09-17",
    external_ref: null,
    imp_total: 100000,
    imputado: 60000,
    cobro_estado: "facturada_impaga",
  },
];

/** Abre la ficha y pasa a la solapa Pagos. */
async function abrirSolapaPagos() {
  render(<CuentasClient accounts={accounts} />);
  fireEvent.click(screen.getByTitle("Ver ficha del cliente"));
  fireEvent.click(screen.getByRole("button", { name: "Pagos" }));
  await waitFor(() => expect(loadClientPaymentsAction).toHaveBeenCalledWith("company", "acme"));
}

describe("CuentasClient — solapa Pagos", () => {
  beforeEach(() => {
    loadCtaCteAccountAction.mockReset();
    loadCtaCteAccountAction.mockResolvedValue({
      success: true,
      data: { movements, balance: 15000 },
    });
    loadClientInvoicesAction.mockReset();
    loadClientInvoicesAction.mockResolvedValue({ success: true, data: [] });
    loadClientPaymentsAction.mockReset();
    loadClientPaymentsAction.mockResolvedValue({ success: true, data: pagos });
    loadCcAccountStaysAction.mockReset();
    loadCcAccountStaysAction.mockResolvedValue({ success: true, data: estadias });
    vi.stubGlobal("open", vi.fn());
  });

  it("desglosa las retenciones y el neto: el monto grande es lo que CANCELA de deuda", async () => {
    await abrirSolapaPagos();

    const fila = within(await screen.findByTestId("fila-pago"));
    // Lo que cancela (100.000) y lo que entró (96.500) son números distintos, y los
    // dos tienen que estar: hasta ahora sólo se veía uno.
    expect(fila.getByText("$100.000,00")).toBeTruthy();
    expect(fila.getByText("cancela de deuda")).toBeTruthy();
    expect(fila.getByText("−$2.000,00")).toBeTruthy();
    expect(fila.getByText("−$1.500,00")).toBeTruthy();
    expect(fila.getByText("RG-4444")).toBeTruthy();
    expect(fila.getByText("$96.500,00")).toBeTruthy();
    // Número de recibo y a qué factura se imputó.
    expect(fila.getByText("000007")).toBeTruthy();
    expect(fila.getByText(/Factura A 00008-00000001/)).toBeTruthy();
    expect(fila.getByText("$60.000,00")).toBeTruthy();
    expect(fila.getByText(/\$40\.000,00 quedaron a cuenta/)).toBeTruthy();
    // La imputación soltada se muestra marcada, no se esconde: un recibo reimpreso
    // dice lo mismo que el día que salió. Lo que no hace es seguir sumando.
    expect(fila.getByText(/desimputada: Se imputó a la factura equivocada/)).toBeTruthy();
  });

  it("reimprime el recibo en la misma ventana que el resto de los impresos", async () => {
    await abrirSolapaPagos();

    fireEvent.click(await screen.findByLabelText("Reimprimir el recibo de cobranza"));

    expect(window.open).toHaveBeenCalledWith(
      "/admin/recibo-cc/m2?autoprint=1",
      "recibo-cc-m2",
      "width=420,height=720"
    );
  });

  it("sin pagos explica dónde se cargan, en vez de una lista vacía", async () => {
    loadClientPaymentsAction.mockResolvedValue({ success: true, data: [] });
    await abrirSolapaPagos();

    const solapa = within(await screen.findByTestId("solapa-pagos"));
    expect(
      solapa.getByText("Este cliente todavía no registró ningún pago a cuenta.")
    ).toBeTruthy();
  });

  it("en Movimientos, cada estadía dice DOS cosas: si se facturó y si se cobró", async () => {
    render(<CuentasClient accounts={accounts} />);
    fireEvent.click(screen.getByTitle("Ver ficha del cliente"));

    const pastillas = within(await screen.findByTestId("pastillas-estadia"));
    expect(pastillas.getByText("En consolidada")).toBeTruthy();
    // Cobrada a medias: ni "pagada" ni "impaga", y con los importes de la factura,
    // que es la unidad de cobro.
    expect(pastillas.getByText("Pago parcial")).toBeTruthy();
    expect(pastillas.getByText("· $60.000,00 de $100.000,00")).toBeTruthy();
  });
});
