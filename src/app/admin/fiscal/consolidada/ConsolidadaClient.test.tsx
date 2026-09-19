import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConsolidadaClient from "./ConsolidadaClient";
import type { CcAccountStayRow, CtaCteAccount, InvoiceReceptorPrefill } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const loadCcAccountStaysAction = vi.fn();
const emitConsolidatedInvoiceAction = vi.fn();
vi.mock("./actions", () => ({
  loadCcAccountStaysAction: (...args: unknown[]) => loadCcAccountStaysAction(...args),
  emitConsolidatedInvoiceAction: (...args: unknown[]) => emitConsolidatedInvoiceAction(...args),
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
    // Estado de cobro (mig 109). Sin factura viva no hay nada que cobrar, y
    // `sin_facturar` sale exactamente cuando `estado` da `pendiente`.
    imp_total: null,
    imputado: null,
    cobro_estado: facturable ? "sin_facturar" : "facturado_externo",
    // Plata apuntada a la estadía misma (mig 114): ninguna en este fixture. El saldo
    // sólo existe mientras la estadía sea facturable.
    imputado_estadia: 0,
    saldo_estadia: facturable ? (opts.amount ?? 10000) : null,
  };
}

const accounts: CtaCteAccount[] = [
  { kind: "company", id: "acme", name: "Acme SA", document_id: "20111111112", balance: 10000 },
  { kind: "guest", id: "g1", name: "Juan Perez", document_id: "30222222", balance: 5000 },
  // A propósito fuera de `billingProfiles`: los dos resuelven a `profile` null.
  { kind: "company", id: "sf1", name: "Sin Ficha Uno", document_id: null, balance: 1000 },
  { kind: "company", id: "sf2", name: "Sin Ficha Dos", document_id: null, balance: 2000 },
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

function renderClient(preselectId = "acme") {
  return render(
    <ConsolidadaClient
      enabled
      accounts={accounts}
      billingProfiles={billingProfiles}
      preselectKind="company"
      preselectId={preselectId}
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

/** El payload con el que se llamó a la acción de emitir. */
type EmitPayload = {
  detalle?: { reservationId: string; descripcion: string }[];
  conceptoUnico?: string;
};
const payloadEmitido = () => emitConsolidatedInvoiceAction.mock.calls[0][0] as EmitPayload;

describe("ConsolidadaClient", () => {
  beforeEach(() => {
    loadCcAccountStaysAction.mockReset();
    loadCcAccountStaysAction.mockImplementation((kind: string, id: string) =>
      Promise.resolve({ success: true, data: [makeRow(`${kind}-${id}-1`, "5")] })
    );
    emitConsolidatedInvoiceAction.mockReset();
    emitConsolidatedInvoiceAction.mockResolvedValue({
      success: true,
      data: { status: "authorized", invoiceId: "inv-1", numero: "0003-00000001", count: 1 },
    });
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

  it("entre dos clientes SIN ficha de facturación, tampoco arrastra los datos fiscales del anterior", async () => {
    renderClient("sf1");
    await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue(""));

    // Sin ficha cargada, el admin completa el receptor a mano.
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111112" } });
    fireEvent.change(screen.getByLabelText("Razón social"), { target: { value: "Sin Ficha Uno" } });
    fireEvent.change(screen.getByLabelText("Domicilio"), { target: { value: "Calle Uno 1" } });

    fireEvent.change(screen.getByLabelText("Cliente de cuenta corriente"), {
      target: { value: "company:sf2" },
    });

    // Los dos dan `profile` null: comparando por identidad el cambio pasaba
    // desapercibido y se le podía emitir al segundo con el CUIT del primero.
    await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue(""));
    expect(screen.getByLabelText("Razón social")).toHaveValue("");
    expect(screen.getByLabelText("Domicilio")).toHaveValue("");
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

    // La no facturable ni siquiera se pinta en "Pendientes": para el tramo hay
    // que verla en pantalla, así que se pasa a "Todas".
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));

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

  describe("filtro de estado y paginación de la lista", () => {
    it("abre mostrando sólo lo pendiente de facturar", async () => {
      loadCcAccountStaysAction.mockImplementation(() =>
        Promise.resolve({
          success: true,
          data: [makeRow("r1", "1"), makeRow("r2", "2", { facturable: false })],
        })
      );
      renderClient();

      await waitFor(() => expect(filaCheckbox("1")).toBeChecked());
      expect(screen.getByRole("button", { name: "Pendientes de facturar" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      // La ya facturada existe en la cuenta pero no se pinta en "Pendientes".
      expect(screen.queryByLabelText("Incluir estadía de habitación 2")).not.toBeInTheDocument();
    });

    it("una estadía ya facturada aparece recién al poner «Todas»", async () => {
      loadCcAccountStaysAction.mockImplementation(() =>
        Promise.resolve({
          success: true,
          data: [makeRow("r1", "1"), makeRow("r2", "2", { facturable: false })],
        })
      );
      renderClient();
      await waitFor(() => expect(filaCheckbox("1")).toBeChecked());
      expect(screen.queryByLabelText("Incluir estadía de habitación 2")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Todas" }));

      const yaFacturada = screen.getByLabelText("Incluir estadía de habitación 2");
      expect(yaFacturada).toBeInTheDocument();
      expect(yaFacturada).toBeDisabled();
      expect(yaFacturada).not.toBeChecked();
    });

    it("con «Pendientes» y cero pendientes, explica que ya está todo facturado y ofrece pasar a «Todas»", async () => {
      loadCcAccountStaysAction.mockImplementation(() =>
        Promise.resolve({
          success: true,
          data: [makeRow("r1", "1", { facturable: false })],
        })
      );
      renderClient();

      await screen.findByText(/ya están cubiertas/);
      expect(screen.queryByLabelText("Incluir estadía de habitación 1")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Ver todas" }));

      expect(screen.getByLabelText("Incluir estadía de habitación 1")).toBeInTheDocument();
    });

    it("una estadía tildada en la página 1 sigue tildada y se emite estando parado en la página 2", async () => {
      vi.spyOn(window, "open").mockImplementation(() => null);
      const rows25 = Array.from({ length: 25 }, (_, i) =>
        makeRow(`r${i + 1}`, `${i + 1}`, { amount: 1000 })
      );
      loadCcAccountStaysAction.mockImplementation(() =>
        Promise.resolve({ success: true, data: rows25 })
      );
      renderClient();
      await waitFor(() => expect(filaCheckbox("1")).toBeChecked());

      // Arranca de cero: por defecto viene todo lo pendiente tildado, y con las
      // 25 tildadas el aviso de "fuera de página" no diría nada sobre esta.
      fireEvent.click(screen.getByLabelText("Seleccionar todas las estadías"));
      fireEvent.click(fila("1"));

      fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));

      // La fila 1 quedó en la página anterior: no está a la vista, pero el
      // aviso dice que sigue tildada.
      expect(screen.queryByLabelText("Incluir estadía de habitación 1")).not.toBeInTheDocument();
      expect(screen.getByText(/1 estadía tildada en otras páginas/)).toBeInTheDocument();

      const barra = screen.getByRole("region", { name: BARRA });
      expect(barra.textContent).toContain("1 estadía");

      fireEvent.click(screen.getByRole("button", { name: /Emitir factura consolidada/ }));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().detalle).toHaveLength(1);
      expect(payloadEmitido().detalle?.[0].reservationId).toBe("r1");
    });
  });

  describe("forma del detalle impreso (mig 102)", () => {
    beforeEach(() => {
      // emit() abre la ventana del impreso; en jsdom no está implementada.
      vi.spyOn(window, "open").mockImplementation(() => null);
    });

    const emitir = () =>
      fireEvent.click(screen.getByRole("button", { name: /Emitir factura consolidada/ }));

    it("con «un solo concepto», manda el texto y NO las líneas por estadía", async () => {
      renderClient();
      await screen.findByRole("region", { name: BARRA });

      fireEvent.click(screen.getByRole("button", { name: "Un solo concepto" }));

      // Arranca en "Alojamiento" y es editable.
      const campo = screen.getByLabelText("Texto del concepto único");
      expect(campo).toHaveValue("Alojamiento");
      fireEvent.change(campo, { target: { value: "Servicios de alojamiento" } });

      // Las líneas por estadía desaparecen: en este modo no se imprimen.
      expect(
        screen.queryByLabelText("Descripción de la estadía de habitación 5")
      ).not.toBeInTheDocument();

      emitir();

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().conceptoUnico).toBe("Servicios de alojamiento");
      // Lo importante: no van las dos formas juntas. Con `detalle` también en el
      // payload, el comprobante guardaría un detalle que nadie eligió ni va a ver.
      expect(payloadEmitido().detalle).toBeUndefined();
    });

    it("en «detallado» (el default) sigue mandando el array por estadía, como antes", async () => {
      renderClient();
      await screen.findByRole("region", { name: BARRA });

      // No se toca el interruptor: el modo de siempre es el default.
      emitir();

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().conceptoUnico).toBeUndefined();
      expect(payloadEmitido().detalle).toEqual([
        { reservationId: "company-acme-1", descripcion: "Hab. 5 - 01/09/2026 al 03/09/2026" },
      ]);
    });

    it("ir a «un solo concepto» y volver no pierde los textos editados por estadía", async () => {
      renderClient();
      await screen.findByRole("region", { name: BARRA });

      const linea = () => screen.getByLabelText("Descripción de la estadía de habitación 5");
      fireEvent.change(linea(), { target: { value: "Convención anual" } });

      fireEvent.click(screen.getByRole("button", { name: "Un solo concepto" }));
      fireEvent.click(screen.getByRole("button", { name: "Detallado" }));

      expect(linea()).toHaveValue("Convención anual");

      emitir();
      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().detalle?.[0].descripcion).toBe("Convención anual");
    });

    it("si se borra el texto del concepto, se emite el default que muestra el placeholder", async () => {
      renderClient();
      await screen.findByRole("region", { name: BARRA });

      fireEvent.click(screen.getByRole("button", { name: "Un solo concepto" }));
      fireEvent.change(screen.getByLabelText("Texto del concepto único"), {
        target: { value: "   " },
      });

      emitir();

      // Mandar vacío sería peor: en el servidor NULL significa "detallado", así que
      // el impreso saldría distinto de lo que la pantalla venía mostrando.
      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().conceptoUnico).toBe("Alojamiento");
      expect(payloadEmitido().detalle).toBeUndefined();
    });

    it("«Restaurar» también devuelve el texto del concepto a «Alojamiento»", async () => {
      renderClient();
      await screen.findByRole("region", { name: BARRA });

      fireEvent.click(screen.getByRole("button", { name: "Un solo concepto" }));
      fireEvent.change(screen.getByLabelText("Texto del concepto único"), {
        target: { value: "Otra cosa" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Restaurar/ }));

      expect(screen.getByLabelText("Texto del concepto único")).toHaveValue("Alojamiento");
    });
  });
});
