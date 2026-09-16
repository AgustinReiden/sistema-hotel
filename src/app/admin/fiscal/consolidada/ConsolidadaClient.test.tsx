import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function makeRow(
  reservationId: string,
  roomNumber: string,
  opts: { amount?: number; facturable?: boolean } = {}
): CcAccountStayRow {
  const facturable = opts.facturable ?? true;
  return {
    reservation_id: reservationId,
    movimiento_id: `mov-${reservationId}`,
    room_number: roomNumber,
    passenger: "Huesped de prueba",
    fch_desde: "2026-09-01",
    fch_hasta: "2026-09-03",
    amount: opts.amount ?? 10000,
    total_price: opts.amount ?? 10000,
    actual_check_out: "2026-09-03T10:00:00Z",
    mixed_payment: false,
    facturable,
    estado: facturable ? "pendiente" : "facturado_externo",
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

function renderClient() {
  return render(
    <ConsolidadaClient
      enabled
      accounts={accounts}
      billingProfiles={billingProfiles}
      preselectKind="company"
      preselectId="acme"
      todayKey="2026-09-16"
    />
  );
}

/** El checkbox de una fila, por el nombre accesible que le pone la lista. */
const filaCheckbox = (habitacion: string) =>
  screen.getByLabelText(`Incluir estadía de habitación ${habitacion}`) as HTMLInputElement;

/** La fila entera: para clickearla en cualquier parte, no sobre el checkbox. */
const fila = (habitacion: string) => filaCheckbox(habitacion).closest("li") as HTMLLIElement;

/** Mismo formato que usa la pantalla, para no depender del ICU de la máquina. */
const plata = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BARRA = "Resumen de la factura consolidada";

describe("ConsolidadaClient", () => {
  beforeEach(() => {
    loadCcAccountStaysAction.mockReset();
    loadCcAccountStaysAction.mockImplementation((kind: string, id: string) =>
      Promise.resolve({ success: true, data: [makeRow(`${kind}-${id}-1`, "5")] })
    );
  });

  it("con cliente preseleccionado, precarga los datos fiscales de esa ficha sin esperar a elegirla de nuevo", async () => {
    renderClient();

    // El rango arranca en "Todo": from/to van undefined, no cadena vacía.
    expect(loadCcAccountStaysAction).toHaveBeenCalledWith("company", "acme", undefined, undefined);
    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Acme SA"));
    expect(screen.getByLabelText("CUIT")).toHaveValue("20111111112");
    expect(screen.getByLabelText("Domicilio")).toHaveValue("Calle Falsa 123");
  });

  it("al cambiar de cliente, reemplaza los datos fiscales por los de la nueva ficha (no los mezcla)", async () => {
    renderClient();

    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Acme SA"));

    fireEvent.change(screen.getByLabelText("Cliente de cuenta corriente"), {
      target: { value: "guest:g1" },
    });

    expect(loadCcAccountStaysAction).toHaveBeenCalledWith("guest", "g1", undefined, undefined);
    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Juan Perez"));
    expect(screen.getByLabelText("Domicilio")).toHaveValue("Otra Calle 456");
    expect(screen.getByLabelText("CUIT")).toHaveValue("");
  });

  it("clickear cualquier parte de la fila marca/desmarca UNA sola vez", async () => {
    renderClient();
    await waitFor(() => expect(filaCheckbox("5")).toBeChecked());

    // Click en la fila, lejos del checkbox: un solo toggle.
    fireEvent.click(fila("5"));
    expect(filaCheckbox("5")).not.toBeChecked();

    fireEvent.click(fila("5"));
    expect(filaCheckbox("5")).toBeChecked();

    // Click sobre el checkbox: burbujea al <li> y tiene que contar UNA vez. Con
    // dos handlers contaría dos y la fila quedaría como estaba.
    fireEvent.click(filaCheckbox("5"));
    expect(filaCheckbox("5")).not.toBeChecked();
  });

  it("shift+click marca el tramo intermedio y saltea las no facturables", async () => {
    loadCcAccountStaysAction.mockImplementation(() =>
      Promise.resolve({
        success: true,
        data: [
          makeRow("r1", "1"),
          makeRow("r2", "2"),
          makeRow("r3", "3", { facturable: false }),
          makeRow("r4", "4"),
        ],
      })
    );
    renderClient();
    await waitFor(() => expect(filaCheckbox("1")).toBeChecked());

    // Arrancar de cero: por defecto viene todo lo pendiente tildado.
    fireEvent.click(screen.getByLabelText("Seleccionar todas las estadías"));
    expect(filaCheckbox("1")).not.toBeChecked();

    fireEvent.click(fila("1"));
    fireEvent.click(fila("4"), { shiftKey: true });

    expect(filaCheckbox("1")).toBeChecked();
    expect(filaCheckbox("2")).toBeChecked();
    expect(filaCheckbox("4")).toBeChecked();
    // La no facturable queda afuera del tramo, y encima deshabilitada.
    expect(filaCheckbox("3")).not.toBeChecked();
    expect(filaCheckbox("3")).toBeDisabled();
  });

  it("shift+click sobre el propio checkbox también extiende (mismo camino que el Espacio del teclado)", async () => {
    loadCcAccountStaysAction.mockImplementation(() =>
      Promise.resolve({
        success: true,
        data: [makeRow("r1", "1"), makeRow("r2", "2"), makeRow("r3", "3")],
      })
    );
    renderClient();
    await waitFor(() => expect(filaCheckbox("1")).toBeChecked());

    fireEvent.click(screen.getByLabelText("Seleccionar todas las estadías"));
    fireEvent.click(filaCheckbox("1"));
    fireEvent.click(filaCheckbox("3"), { shiftKey: true });

    expect(filaCheckbox("1")).toBeChecked();
    expect(filaCheckbox("2")).toBeChecked();
    expect(filaCheckbox("3")).toBeChecked();
  });

  it("el filtro por período acota la lista y el contador dice cuántas quedaron afuera", async () => {
    // Primera carga (sin rango) = la cuenta entera: 3 estadías.
    loadCcAccountStaysAction.mockImplementation((_k: string, _i: string, from?: string) =>
      Promise.resolve({
        success: true,
        data: from
          ? [makeRow("r3", "3")]
          : [makeRow("r1", "1"), makeRow("r2", "2"), makeRow("r3", "3")],
      })
    );
    renderClient();

    await waitFor(() => expect(screen.getByText(/Mostrando 3 de 3 estadías/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Este año" }));

    await waitFor(() =>
      expect(loadCcAccountStaysAction).toHaveBeenCalledWith(
        "company",
        "acme",
        "2026-01-01",
        "2026-09-16"
      )
    );
    // El contador avisa que hay un período puesto: si no, parecería que el
    // cliente no debe nada.
    await waitFor(() => expect(screen.getByText(/Mostrando 1 de 3 estadías/)).toBeInTheDocument());

    // INVARIANTE: lo que salió de la lista deja de estar seleccionado solo, así
    // que no puede terminar en el comprobante.
    const barra = screen.getByRole("region", { name: BARRA });
    expect(barra.textContent).toContain(`1 estadía · Total $${plata(10000)}`);
    expect(screen.queryByLabelText("Incluir estadía de habitación 1")).not.toBeInTheDocument();
  });

  it("la barra flotante aparece con la selección y muestra el total de lo seleccionado", async () => {
    loadCcAccountStaysAction.mockImplementation(() =>
      Promise.resolve({
        success: true,
        data: [makeRow("r1", "1", { amount: 10000 }), makeRow("r2", "2", { amount: 25000 })],
      })
    );
    renderClient();

    const barra = await screen.findByRole("region", { name: BARRA });
    expect(barra.textContent).toContain(`2 estadías · Total $${plata(35000)}`);

    // Al destildar una, el total acompaña.
    fireEvent.click(fila("2"));
    expect(barra.textContent).toContain(`1 estadía · Total $${plata(10000)}`);

    // Sin nada seleccionado no hay barra, así que tampoco hay botón de emitir.
    fireEvent.click(fila("1"));
    expect(screen.queryByRole("region", { name: BARRA })).not.toBeInTheDocument();
  });

  it("con el receptor incompleto, el botón queda deshabilitado y la barra dice qué falta", async () => {
    renderClient();

    const barra = await screen.findByRole("region", { name: BARRA });
    const emitir = within(barra).getByRole("button", { name: /Emitir factura consolidada/ });

    // La ficha de Acme viene completa: se puede emitir.
    expect(emitir).toBeEnabled();
    expect(within(barra).queryByText(/Falta:/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "" } });
    expect(emitir).toBeDisabled();
    expect(within(barra).getByText(/Falta: CUIT/)).toBeInTheDocument();

    // Dos faltantes se enumeran en castellano, no como lista técnica.
    fireEvent.change(screen.getByLabelText("Domicilio"), { target: { value: "  " } });
    expect(within(barra).getByText(/Falta: CUIT y domicilio/)).toBeInTheDocument();
    expect(emitir).toBeDisabled();

    // Un CUIT cargado pero con el dígito verificador mal no es lo mismo que uno
    // vacío: con el botón deshabilitado, el toast del motivo ya no se dispara.
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111113" } });
    expect(within(barra).getByText(/Falta: CUIT válido y domicilio/)).toBeInTheDocument();
  });
});
