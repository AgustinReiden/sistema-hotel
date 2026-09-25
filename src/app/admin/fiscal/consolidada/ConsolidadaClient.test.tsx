import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConsolidadaClient, { type ConsolidadaFiscal } from "./ConsolidadaClient";
import { CONFIRMAR_ESPERA_MS } from "./ConsolidadaConfirmModal";
import ConsolidadaPage from "./page";
import type {
  CcAccountStayRow,
  CtaCteAccount,
  CtaCteClientKind,
  InvoiceReceptorPrefill,
} from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const loadCcAccountStaysAction = vi.fn();
const emitConsolidatedInvoiceAction = vi.fn();
vi.mock("./actions", () => ({
  loadCcAccountStaysAction: (...args: unknown[]) => loadCcAccountStaysAction(...args),
  emitConsolidatedInvoiceAction: (...args: unknown[]) => emitConsolidatedInvoiceAction(...args),
}));

// Para los tests de page.tsx: el redirect de Next corta la ejecución tirando un error,
// y los datos vienen de la base, que acá no hay.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
const getCurrentUserRole = vi.fn();
const getCtaCteAccounts = vi.fn();
const getCtaCteBillingProfile = vi.fn();
const getFiscalSettings = vi.fn();
const getHotelSettings = vi.fn();
vi.mock("@/lib/data", () => ({
  getCurrentUserRole: () => getCurrentUserRole(),
  getCtaCteAccounts: () => getCtaCteAccounts(),
  getCtaCteBillingProfile: (...args: unknown[]) => getCtaCteBillingProfile(...args),
  getFiscalSettings: () => getFiscalSettings(),
  getHotelSettings: () => getHotelSettings(),
}));

function makeRow(
  reservationId: string,
  roomNumber: string,
  opts: { amount?: number; facturable?: boolean; desde?: string; hasta?: string } = {}
): CcAccountStayRow {
  const facturable = opts.facturable ?? true;
  return {
    reservation_id: reservationId,
    movimiento_id: `mov-${reservationId}`,
    room_number: roomNumber,
    passenger: "Huesped de prueba",
    fch_desde: opts.desde ?? "2026-09-01",
    fch_hasta: opts.hasta ?? "2026-09-03",
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
  // CUIT ficticio con dígito verificador válido.
  {
    kind: "company",
    id: "ficticia",
    name: "Empresa Ficticia SA",
    document_id: "30123456781",
    balance: 45000,
  },
  // Huéspedes sin ficha de facturación: consumidor final, Factura B con el DNI.
  { kind: "guest", id: "g-dni-ok", name: "Juan Prueba", document_id: "30123456", balance: 8000 },
  { kind: "guest", id: "g-dni-mal", name: "Ana Prueba", document_id: "123", balance: 8000 },
  // Huésped con ficha de facturación en Responsable Inscripto (CUIT ficticio válido).
  { kind: "guest", id: "g-ri", name: "Pedro Prueba", document_id: "30123457", balance: 8000 },
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
  "company:ficticia": {
    razonSocial: "Empresa Ficticia SA",
    cuit: "30123456781",
    condicionIva: "responsable_inscripto",
    domicilio: "Calle Inventada 100",
    suggestA: true,
    complete: true,
  },
  "guest:g-ri": {
    razonSocial: "Pedro Prueba Servicios",
    cuit: "20301234563",
    condicionIva: "responsable_inscripto",
    domicilio: "Calle Inventada 200",
    suggestA: true,
    complete: true,
  },
};

const FISCAL_PROD: ConsolidadaFiscal = {
  environment: "produccion",
  punto_venta: 3,
  dias_vto_cuenta_corriente: 30,
};
const FISCAL_PRUEBA: ConsolidadaFiscal = { ...FISCAL_PROD, environment: "homologacion" };

/**
 * La pantalla con un cliente puesto. Se usa también con `rerender`: si la URL cambia
 * de cliente sin salir de la página, Next no desmonta el componente, le cambia las props.
 */
function clientElement(
  preselectId = "acme",
  preselectKind: CtaCteClientKind = "company",
  fiscal: ConsolidadaFiscal = FISCAL_PROD
) {
  return (
    <ConsolidadaClient
      enabled
      accounts={accounts}
      billingProfiles={billingProfiles}
      preselectKind={preselectKind}
      preselectId={preselectId}
      todayKey="2026-09-16"
      fiscal={fiscal}
    />
  );
}

function renderClient(...args: Parameters<typeof clientElement>) {
  return render(clientElement(...args));
}

/** El checkbox de una fila, por el nombre accesible que le pone la lista. */
const filaCheckbox = (habitacion: string) =>
  screen.getByLabelText(`Incluir estadía de habitación ${habitacion}`) as HTMLInputElement;

/** La fila entera: para clickearla en cualquier parte, no sobre el checkbox. */
const fila = (habitacion: string) => filaCheckbox(habitacion).closest("li") as HTMLLIElement;

/** Mismo formato que usa la pantalla, para no depender del ICU de la máquina. */
const plata = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Los botones y la barra se buscan por su texto o su aria-label, no con getByRole sobre
// toda la pantalla: getByRole calcula el nombre accesible de cada botón y llama a
// getComputedStyle de jsdom por cada ancestro, y esta pantalla es grande. Fue lo que
// hizo pasar los 5 s a CuentasClient.test.tsx con la suite entera en paralelo. Adentro
// de la barra (within) sí se usa getByRole: ahí el árbol es chico.
const BARRA = "Resumen de la factura consolidada";
const CUADRO = "Revisá antes de emitir";
const REVISAR = "Revisar y emitir factura consolidada";
const CONFIRMAR = "Confirmar y emitir en ARCA";

/**
 * Aprieta el botón de la barra y devuelve el cuadro de revisión que abre.
 *
 * Desde acá la espera de "Confirmar" (CONFIRMAR_ESPERA_MS) corre con reloj falso: con el
 * reloj real, cada confirmarListo() gastaba medio segundo de verdad contra el segundo que
 * da waitFor, y con la suite entera en paralelo el test más largo rozaba los 5 s. Se
 * falsean sólo setTimeout y clearTimeout, y el reloj falso sigue avanzando solo
 * (shouldAdvanceTime): waitFor y las acciones simuladas andan como con el real. El
 * afterEach de abajo vuelve al reloj real.
 */
function abrirCuadro() {
  if (!vi.isFakeTimers()) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  }
  fireEvent.click(screen.getByText(REVISAR));
  return screen.getByLabelText(CUADRO);
}

/** El botón "Confirmar y emitir en ARCA" del cuadro. */
const botonConfirmar = (cuadro: HTMLElement) =>
  within(cuadro).getByText(CONFIRMAR).closest("button") as HTMLButtonElement;

/** Deja pasar la espera de "Confirmar" (reloj falso: ver abrirCuadro). */
const pasarEsperaConfirmar = () =>
  act(() => {
    vi.advanceTimersByTime(CONFIRMAR_ESPERA_MS);
  });

/**
 * "Confirmar" arranca deshabilitado un instante después de abrir el cuadro (así un doble
 * toque sobre la barra no emite): deja pasar esa espera y devuelve el botón ya habilitado.
 */
async function confirmarListo(cuadro: HTMLElement) {
  const boton = botonConfirmar(cuadro);
  pasarEsperaConfirmar();
  expect(boton).toBeEnabled();
  return boton;
}

/** El botón "Revisar y emitir…" de la barra. */
const botonRevisar = () => screen.getByText(REVISAR).closest("button") as HTMLButtonElement;

/** El payload con el que se llamó a la acción de emitir. */
type EmitPayload = {
  kind?: CtaCteClientKind;
  cuit?: string;
  condicionIva?: string;
  razonSocial?: string;
  domicilio?: string;
  detalle?: { reservationId: string; descripcion: string }[];
  conceptoUnico?: string;
  nota?: string;
};
const payloadEmitido = () => emitConsolidatedInvoiceAction.mock.calls[0][0] as EmitPayload;

/** El aviso fijo de una emisión con resultado incierto. */
const AVISO_INCIERTO = "No sabemos si la factura salió";

// abrirCuadro() pasa al reloj falso; cada test arranca con el real.
afterEach(() => {
  vi.useRealTimers();
});

describe("ConsolidadaClient", () => {
  beforeEach(() => {
    // Los avisos de un test no cuentan para el siguiente: sin esto, un "se llamó con"
    // pasaría por un toast que dejó otro test.
    vi.mocked(toast.error).mockClear();
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

  it("se entra con el cliente puesto: su nombre, si es empresa y el saldo, sin selector y con un link a Control", async () => {
    const { container } = renderClient();
    await screen.findByLabelText(BARRA);

    expect(screen.getByText("Acme SA")).toBeInTheDocument();
    expect(screen.getByText(`Empresa · saldo $${plata(10000)}`)).toBeInTheDocument();
    // Ya no hay selector de cliente: a la consolidada se entra desde Control, Cuentas o
    // la ficha, siempre con el cliente puesto.
    expect(container.querySelector("#consolidada-cliente")).toBeNull();
    expect(screen.queryByText("Elegí un cliente…")).not.toBeInTheDocument();
    expect(screen.getByText("Elegir otro cliente").closest("a")).toHaveAttribute(
      "href",
      "/admin/fiscal/control"
    );
  });

  it("al cambiar de cliente, reemplaza los datos fiscales por los de la nueva ficha (no los mezcla)", async () => {
    const { rerender } = renderClient();

    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Acme SA"));

    // Otra URL de la misma página: Next le cambia las props, no la desmonta.
    rerender(clientElement("g1", "guest"));

    expect(loadCcAccountStaysAction).toHaveBeenCalledWith("guest", "g1", undefined, undefined);
    await waitFor(() => expect(screen.getByLabelText("Razón social")).toHaveValue("Juan Perez"));
    expect(screen.getByLabelText("Domicilio")).toHaveValue("Otra Calle 456");
    expect(screen.getByLabelText("CUIT")).toHaveValue("");
  });

  it("entre dos clientes SIN ficha de facturación, tampoco arrastra los datos fiscales del anterior", async () => {
    const { rerender } = renderClient("sf1");
    await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue(""));

    // Sin ficha cargada, el admin completa el receptor a mano.
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111112" } });
    fireEvent.change(screen.getByLabelText("Razón social"), { target: { value: "Sin Ficha Uno" } });
    fireEvent.change(screen.getByLabelText("Domicilio"), { target: { value: "Calle Uno 1" } });

    rerender(clientElement("sf2"));

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
    fireEvent.click(screen.getByText("Todas"));

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

    fireEvent.click(screen.getByText("Este año"));

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
    const barra = screen.getByLabelText(BARRA);
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

    const barra = await screen.findByLabelText(BARRA);
    expect(barra.textContent).toContain(`2 estadías · Total $${plata(35000)}`);

    // Al destildar una, el total acompaña.
    fireEvent.click(fila("2"));
    expect(barra.textContent).toContain(`1 estadía · Total $${plata(10000)}`);

    // Sin nada seleccionado no hay barra, así que tampoco hay botón de emitir.
    fireEvent.click(fila("1"));
    expect(screen.queryByLabelText(BARRA)).not.toBeInTheDocument();
  });

  it("con el receptor incompleto, el botón queda deshabilitado y la barra dice qué falta", async () => {
    renderClient();

    const barra = await screen.findByLabelText(BARRA);
    const revisar = within(barra).getByRole("button", { name: /Revisar y emitir factura consolidada/ });

    // La ficha de Acme viene completa: se puede emitir.
    expect(revisar).toBeEnabled();
    expect(within(barra).queryByText(/Falta:/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "" } });
    expect(revisar).toBeDisabled();
    expect(within(barra).getByText(/Falta: CUIT/)).toBeInTheDocument();

    // Dos faltantes se enumeran en castellano, no como lista técnica.
    fireEvent.change(screen.getByLabelText("Domicilio"), { target: { value: "  " } });
    expect(within(barra).getByText(/Falta: CUIT y domicilio/)).toBeInTheDocument();
    expect(revisar).toBeDisabled();

    // Un CUIT cargado pero con el dígito verificador mal no es lo mismo que uno
    // vacío: con el botón deshabilitado, el toast del motivo ya no se dispara.
    fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20111111113" } });
    expect(within(barra).getByText(/Falta: CUIT válido y domicilio/)).toBeInTheDocument();
  });

  describe("cuadro «Revisá antes de emitir»", () => {
    beforeEach(() => {
      // Emitir abre la ventana del impreso; en jsdom no está implementada.
      vi.spyOn(window, "open").mockImplementation(() => null);
    });

    it("«Revisar y emitir» no emite: muestra la letra, la razón social, el CUIT con guiones, las estadías, el período, el total y el vencimiento", async () => {
      loadCcAccountStaysAction.mockImplementation(() =>
        Promise.resolve({
          success: true,
          data: [
            makeRow("r1", "1", { amount: 10000, desde: "2026-09-01", hasta: "2026-09-03" }),
            makeRow("r2", "2", { amount: 20000, desde: "2026-09-05", hasta: "2026-09-08" }),
            makeRow("r3", "3", { amount: 15000, desde: "2026-09-10", hasta: "2026-09-12" }),
          ],
        })
      );
      renderClient("ficticia");
      await screen.findByLabelText(BARRA);

      const cuadro = abrirCuadro();

      expect(emitConsolidatedInvoiceAction).not.toHaveBeenCalled();
      expect(within(cuadro).getByText("Factura A")).toBeInTheDocument();
      expect(within(cuadro).getByText("Empresa Ficticia SA")).toBeInTheDocument();
      expect(within(cuadro).getByText("CUIT 30-12345678-1")).toBeInTheDocument();
      expect(within(cuadro).getByText("Responsable Inscripto")).toBeInTheDocument();
      expect(
        within(cuadro).getByText("3 estadías · del 01/09/2026 al 12/09/2026")
      ).toBeInTheDocument();
      expect(within(cuadro).getByText(`$${plata(45000)}`)).toBeInTheDocument();
      expect(
        within(cuadro).getByText("Condición de venta: cuenta corriente · vence a 30 días")
      ).toBeInTheDocument();
      expect(within(cuadro).getByText(/una línea por estadía/)).toBeInTheDocument();
      expect(within(cuadro).getByText("Punto de venta 3")).toBeInTheDocument();
    });

    it("«Volver» cierra sin emitir, y la selección y los textos editados siguen ahí", async () => {
      loadCcAccountStaysAction.mockImplementation(() =>
        Promise.resolve({
          success: true,
          data: [makeRow("r1", "1"), makeRow("r2", "2")],
        })
      );
      renderClient();
      await waitFor(() => expect(filaCheckbox("2")).toBeChecked());

      fireEvent.click(fila("2"));
      fireEvent.change(screen.getByLabelText("Descripción de la estadía de habitación 1"), {
        target: { value: "Convención anual" },
      });
      fireEvent.change(screen.getByLabelText(/Nota al pie/), {
        target: { value: "Orden de compra 99" },
      });

      const cuadro = abrirCuadro();
      // Lo que se va a imprimir también se repasa en el cuadro.
      expect(within(cuadro).getByText("Nota al pie: «Orden de compra 99»")).toBeInTheDocument();

      fireEvent.click(within(cuadro).getByText("Volver"));

      expect(screen.queryByLabelText(CUADRO)).not.toBeInTheDocument();
      expect(emitConsolidatedInvoiceAction).not.toHaveBeenCalled();
      expect(filaCheckbox("1")).toBeChecked();
      expect(filaCheckbox("2")).not.toBeChecked();
      expect(screen.getByLabelText("Descripción de la estadía de habitación 1")).toHaveValue(
        "Convención anual"
      );
      expect(screen.getByLabelText(/Nota al pie/)).toHaveValue("Orden de compra 99");
    });

    it("el foco arranca en «Volver» sin desplazar el cuadro: en un celular chico, el título y la banda de PRODUCCIÓN quedan a la vista", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      const focus = vi.spyOn(HTMLElement.prototype, "focus");
      try {
        const cuadro = abrirCuadro();

        expect(document.activeElement).toBe(within(cuadro).getByText("Volver").closest("button"));
        // «Volver» está al fondo del cuadro: un focus() común (el de autoFocus) baja el
        // cuadro hasta ahí y deja arriba, fuera de la vista, el título y la banda.
        expect(focus).toHaveBeenCalled();
        expect(focus.mock.calls.every(([opciones]) => opciones?.preventScroll === true)).toBe(true);
      } finally {
        focus.mockRestore();
      }
    });

    it("el cuadro dice cómo sale el detalle: las líneas con texto escrito a mano salen tal cual, sin prometer habitación y fechas", async () => {
      loadCcAccountStaysAction.mockImplementation(() =>
        Promise.resolve({
          success: true,
          data: [makeRow("r1", "1"), makeRow("r2", "2"), makeRow("r3", "3")],
        })
      );
      renderClient();
      await waitFor(() => expect(filaCheckbox("3")).toBeChecked());
      const linea = (habitacion: string) =>
        screen.getByLabelText(`Descripción de la estadía de habitación ${habitacion}`);
      const detalleDelCuadro = () => {
        const cuadro = abrirCuadro();
        const texto = within(cuadro).getByText(/^Detalle:/).textContent;
        fireEvent.click(within(cuadro).getByText("Volver"));
        return texto;
      };

      // Sin tocar nada, cada línea lleva su habitación y sus fechas.
      expect(detalleDelCuadro()).toBe(
        "Detalle: una línea por estadía, con su habitación y sus fechas."
      );

      // La de la hab. 1 se reemplaza. La de la hab. 2 se vacía: esa no cuenta, porque el
      // servidor le pone el texto automático.
      fireEvent.change(linea("1"), { target: { value: "Convención anual" } });
      fireEvent.change(linea("2"), { target: { value: "  " } });
      expect(detalleDelCuadro()).toBe(
        "Detalle: una línea por estadía. Una sale con el texto que escribiste en «Detalle del comprobante»; las demás, con su habitación y sus fechas."
      );

      fireEvent.change(linea("2"), { target: { value: "Salón" } });
      expect(detalleDelCuadro()).toBe(
        "Detalle: una línea por estadía. 2 salen con el texto que escribiste en «Detalle del comprobante»; las demás, con su habitación y sus fechas."
      );

      fireEvent.change(linea("3"), { target: { value: "Catering" } });
      expect(detalleDelCuadro()).toBe(
        "Detalle: una línea por estadía, con el texto que escribiste en «Detalle del comprobante»."
      );
      expect(emitConsolidatedInvoiceAction).not.toHaveBeenCalled();
    });

    it("«Confirmar y emitir en ARCA» emite una sola vez aunque se haga doble click, y abre el impreso", async () => {
      let responder: (value: unknown) => void = () => {};
      emitConsolidatedInvoiceAction.mockImplementation(
        () =>
          new Promise((resolve) => {
            responder = resolve;
          })
      );
      renderClient();
      await screen.findByLabelText(BARRA);

      const cuadro = abrirCuadro();
      const confirmar = await confirmarListo(cuadro);
      fireEvent.click(confirmar);
      fireEvent.click(confirmar);

      expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1);
      expect(confirmar).toBeDisabled();

      responder({
        success: true,
        data: { status: "authorized", invoiceId: "inv-1", numero: "0003-00000001", count: 1 },
      });

      await waitFor(() =>
        expect(window.open).toHaveBeenCalledWith(
          "/admin/factura/inv-1?autoprint=1",
          "factura-inv-1",
          "width=420,height=720"
        )
      );
      expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByLabelText(CUADRO)).not.toBeInTheDocument());
    });

    it("un doble toque sobre la barra no emite: «Confirmar» recién responde un instante después de abrir el cuadro", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      // En el celular el cuadro sale desde abajo y «Confirmar» queda donde estaba el
      // botón de la barra: el segundo toque cae ahí apenas se abre.
      const cuadro = abrirCuadro();
      const confirmar = botonConfirmar(cuadro);
      expect(confirmar).toBeDisabled();
      fireEvent.click(confirmar);
      expect(emitConsolidatedInvoiceAction).not.toHaveBeenCalled();

      // Pasado el instante, sí emite.
      fireEvent.click(await confirmarListo(cuadro));
      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1));
    });

    it("si la emisión falla, el cuadro se cierra, dice por qué y se puede volver a intentar", async () => {
      emitConsolidatedInvoiceAction.mockResolvedValueOnce({
        success: false,
        error: "ARCA no respondió. Probá de nuevo en unos minutos.",
      });
      renderClient();
      await screen.findByLabelText(BARRA);

      fireEvent.click(await confirmarListo(abrirCuadro()));

      await waitFor(() => expect(screen.queryByLabelText(CUADRO)).not.toBeInTheDocument());
      expect(toast.error).toHaveBeenCalledWith("ARCA no respondió. Probá de nuevo en unos minutos.");
      await waitFor(() => expect(botonRevisar()).toBeEnabled());

      fireEvent.click(await confirmarListo(abrirCuadro()));
      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(2));
    });

    it("si la llamada se corta sin respuesta, el cuadro no queda trabado: avisa que no se sabe si salió y recarga la lista", async () => {
      // Se corta la red o hubo un deploy con la pantalla abierta: la acción no devuelve
      // { success: false }, directamente falla.
      emitConsolidatedInvoiceAction.mockRejectedValueOnce(new Error("Failed to fetch"));
      renderClient();
      await screen.findByLabelText(BARRA);
      expect(loadCcAccountStaysAction).toHaveBeenCalledTimes(1);

      fireEvent.click(await confirmarListo(abrirCuadro()));

      await waitFor(() => expect(screen.queryByLabelText(CUADRO)).not.toBeInTheDocument());
      // Recarga la lista: si salió, la estadía deja de figurar en «Pendientes de facturar».
      await waitFor(() => expect(loadCcAccountStaysAction).toHaveBeenCalledTimes(2));
      // El aviso sale cuando terminó la recarga: recién ahí se sabe qué lista quedó a la vista.
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("No sabemos si la factura salió"),
          expect.anything()
        )
      );
      // Acá no salió (la estadía sigue pendiente), pero queda sin tildar: se elige a mano.
      await waitFor(() => expect(filaCheckbox("5")).not.toBeChecked());
      expect(screen.queryByLabelText(BARRA)).not.toBeInTheDocument();

      // Nada quedó trabado: se vuelve a tildar y el cuadro abre con los dos botones andando.
      fireEvent.click(fila("5"));
      await waitFor(() => expect(botonRevisar()).toBeEnabled());
      const cuadro = abrirCuadro();
      expect(within(cuadro).getByText("Volver").closest("button")).toBeEnabled();
      await confirmarListo(cuadro);
    });

    it("si no se sabe si la factura salió, queda un aviso fijo arriba de la lista (el toast se va solo) con el enlace a Facturación, hasta cerrarlo", async () => {
      emitConsolidatedInvoiceAction.mockRejectedValueOnce(new Error("Failed to fetch"));
      renderClient();
      await screen.findByLabelText(BARRA);
      expect(screen.queryByLabelText(AVISO_INCIERTO)).not.toBeInTheDocument();

      fireEvent.click(await confirmarListo(abrirCuadro()));

      const aviso = await screen.findByLabelText(AVISO_INCIERTO);
      // Que falten en «Pendientes» sólo prueba que se generó un comprobante, que puede
      // haber quedado emitido, pendiente o rechazado: no se afirma que "salió".
      expect(aviso.textContent).toContain(
        "Si las estadías que ibas a facturar ya no están en «Pendientes de facturar», la factura se generó: no la emitas de nuevo y fijate en Facturación si quedó emitida, pendiente o rechazada."
      );
      expect(aviso.textContent).not.toContain("la factura salió:");
      expect(within(aviso).getByText("Ir a Facturación").closest("a")).toHaveAttribute(
        "href",
        "/admin/fiscal"
      );

      // Sigue ahí mientras se trabaja con la lista: no depende de haber visto el toast.
      await waitFor(() => expect(filaCheckbox("5")).not.toBeChecked());
      fireEvent.click(fila("5"));
      fireEvent.click(screen.getByText("Todas"));
      expect(screen.getByLabelText(AVISO_INCIERTO)).toBeInTheDocument();

      fireEvent.click(within(aviso).getByText("Cerrar el aviso"));
      expect(screen.queryByLabelText(AVISO_INCIERTO)).not.toBeInTheDocument();
    });

    it("el aviso de la emisión incierta se va con la próxima emisión", async () => {
      emitConsolidatedInvoiceAction.mockRejectedValueOnce(new Error("Failed to fetch"));
      renderClient();
      await screen.findByLabelText(BARRA);

      fireEvent.click(await confirmarListo(abrirCuadro()));
      await screen.findByLabelText(AVISO_INCIERTO);

      // Seguía pendiente: se vuelve a tildar y se emite. Esta vez sale bien.
      await waitFor(() => expect(filaCheckbox("5")).not.toBeChecked());
      fireEvent.click(fila("5"));
      await waitFor(() => expect(botonRevisar()).toBeEnabled());
      fireEvent.click(await confirmarListo(abrirCuadro()));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByLabelText(AVISO_INCIERTO)).not.toBeInTheDocument());
    });

    it("si la llamada se corta y la factura salió, lo que se había dejado afuera NO queda tildado y la lista vuelve a «Pendientes de facturar»", async () => {
      // Cinco pendientes; se destildan las hab. 4 y 5 porque van el mes que viene.
      const pendientes = ["1", "2", "3", "4", "5"].map((n) => makeRow(`r${n}`, n));
      // La factura salió: las tres emitidas quedan «en proceso» (dejan de ser facturables)
      // y siguen pendientes sólo las dos que se habían dejado afuera.
      const enProceso = (n: string): CcAccountStayRow => ({
        ...makeRow(`r${n}`, n, { facturable: false }),
        estado: "en_proceso",
      });
      loadCcAccountStaysAction
        .mockImplementationOnce(() => Promise.resolve({ success: true, data: pendientes }))
        .mockImplementationOnce(() =>
          Promise.resolve({
            success: true,
            data: [enProceso("1"), enProceso("2"), enProceso("3"), pendientes[3], pendientes[4]],
          })
        );
      emitConsolidatedInvoiceAction.mockRejectedValueOnce(new Error("Failed to fetch"));
      renderClient();
      await waitFor(() => expect(filaCheckbox("5")).toBeChecked());

      fireEvent.click(fila("4"));
      fireEvent.click(fila("5"));
      // Parado en «Todas»: igual vuelve a «Pendientes», que es donde se ve qué salió.
      fireEvent.click(screen.getByText("Todas"));

      const cuadro = abrirCuadro();
      expect(within(cuadro).getByText(/^3 estadías/)).toBeInTheDocument();
      fireEvent.click(await confirmarListo(cuadro));

      await waitFor(() => expect(loadCcAccountStaysAction).toHaveBeenCalledTimes(2));
      // El aviso habla de lo que queda a la vista, no de un estado que el filtro esconde.
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("«Pendientes de facturar»"),
          expect.anything()
        )
      );
      // Y no promete que salió: que falten sólo dice que se generó un comprobante.
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "ya no están ahí, la factura se generó: no la emitas de nuevo y fijate en Facturación si quedó emitida, pendiente o rechazada."
        ),
        expect.anything()
      );
      await waitFor(() =>
        expect(screen.getByText("Pendientes de facturar")).toHaveAttribute("aria-pressed", "true")
      );
      expect(screen.queryByLabelText("Incluir estadía de habitación 1")).not.toBeInTheDocument();
      // Las dos que se habían dejado afuera a propósito siguen ahí, sin tildar, y no hay
      // barra con «Revisar y emitir» lista para mandar una segunda factura.
      await waitFor(() => expect(filaCheckbox("4")).not.toBeChecked());
      expect(filaCheckbox("5")).not.toBeChecked();
      expect(screen.queryByLabelText(BARRA)).not.toBeInTheDocument();
      expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1);
    });

    it("si la recarga también se corta, la lista no queda en «Cargando…»: nada tildado, se puede volver a cargar y el aviso no promete una lista que no está", async () => {
      // Tres pendientes; la hab. 3 se deja afuera a propósito.
      const pendientes = ["1", "2", "3"].map((n) => makeRow(`r${n}`, n));
      const enProceso = (n: string): CcAccountStayRow => ({
        ...makeRow(`r${n}`, n, { facturable: false }),
        estado: "en_proceso",
      });
      loadCcAccountStaysAction
        .mockImplementationOnce(() => Promise.resolve({ success: true, data: pendientes }))
        // La red sigue cortada: la recarga tampoco contesta.
        .mockImplementationOnce(() => Promise.reject(new Error("Failed to fetch")))
        // Vuelve la conexión: la factura había salido y sólo queda pendiente la hab. 3.
        .mockImplementationOnce(() =>
          Promise.resolve({
            success: true,
            data: [enProceso("1"), enProceso("2"), pendientes[2]],
          })
        );
      emitConsolidatedInvoiceAction.mockRejectedValueOnce(new Error("Failed to fetch"));
      renderClient();
      await waitFor(() => expect(filaCheckbox("3")).toBeChecked());

      fireEvent.click(fila("3"));
      const cuadro = abrirCuadro();
      expect(within(cuadro).getByText(/^2 estadías/)).toBeInTheDocument();
      fireEvent.click(await confirmarListo(cuadro));

      await waitFor(() => expect(loadCcAccountStaysAction).toHaveBeenCalledTimes(2));
      // La lista dice que no se pudo cargar (no que el cliente no tiene estadías, que se
      // leería como "la factura salió"), sin «Cargando…» y con «Recargar» andando.
      await waitFor(() =>
        expect(screen.getByText(/No pudimos cargar la lista/)).toBeInTheDocument()
      );
      expect(screen.queryByText("Cargando…")).not.toBeInTheDocument();
      expect(screen.queryByText(/no tiene estadías cargadas/)).not.toBeInTheDocument();
      expect(screen.getByTitle("Recargar")).toBeEnabled();
      // Nada tildado: no queda una barra con «2 estadías» ofreciendo lo que no se sabe si salió.
      expect(screen.queryByLabelText(BARRA)).not.toBeInTheDocument();
      // El aviso no promete la lista en «Pendientes»: dice que no se pudo comprobar y qué hacer.
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("tampoco pudimos volver a cargar la lista"),
          expect.anything()
        )
      );
      expect(toast.error).not.toHaveBeenCalledWith(
        expect.stringContaining("Te dejamos la lista"),
        expect.anything()
      );
      // El aviso fijo dice lo mismo que el toast, sin mandar a mirar una lista que no está.
      const aviso = screen.getByLabelText(AVISO_INCIERTO);
      expect(aviso.textContent).toContain("tampoco pudimos volver a cargar la lista");
      expect(aviso.textContent).not.toContain("«Pendientes de facturar»");

      // Vuelve la conexión y se vuelve a cargar: la factura había salido. Lo que se había
      // dejado afuera aparece, pero sin tildar: no hay «Revisar y emitir» listo para
      // mandar una segunda factura.
      fireEvent.click(screen.getByText("Volver a cargar la lista"));
      await waitFor(() => expect(filaCheckbox("3")).not.toBeChecked());
      expect(screen.queryByLabelText("Incluir estadía de habitación 1")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(BARRA)).not.toBeInTheDocument();
      expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1);
      // Con la lista a la vista, el aviso sigue y ahora sí dice cómo leerla.
      expect(screen.getByLabelText(AVISO_INCIERTO).textContent).toContain(
        "ya no están en «Pendientes de facturar», la factura se generó"
      );
    });

    it("si la recarga contesta con error, la lista dice que no se pudo cargar y el aviso no dice «Te dejamos la lista»", async () => {
      loadCcAccountStaysAction
        .mockImplementationOnce(() =>
          Promise.resolve({ success: true, data: [makeRow("r1", "1")] })
        )
        .mockImplementationOnce(() =>
          Promise.resolve({ success: false, error: "No se pudo leer la cuenta." })
        );
      emitConsolidatedInvoiceAction.mockRejectedValueOnce(new Error("Failed to fetch"));
      renderClient();
      await screen.findByLabelText(BARRA);

      fireEvent.click(await confirmarListo(abrirCuadro()));

      // Una lista vacía con "no tiene estadías cargadas" se leería como "la factura salió".
      await waitFor(() =>
        expect(screen.getByText(/No pudimos cargar la lista/)).toBeInTheDocument()
      );
      expect(screen.queryByText(/no tiene estadías cargadas/)).not.toBeInTheDocument();
      expect(toast.error).toHaveBeenCalledWith("No se pudo leer la cuenta.");
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("tampoco pudimos volver a cargar la lista"),
          expect.anything()
        )
      );
      expect(toast.error).not.toHaveBeenCalledWith(
        expect.stringContaining("Te dejamos la lista"),
        expect.anything()
      );
    });

    it("si la carga no contesta, no queda en «Cargando…»: avisa y se puede volver a cargar (sin emisión de por medio, vuelve a tildar lo pendiente)", async () => {
      loadCcAccountStaysAction
        .mockImplementationOnce(() => Promise.reject(new Error("Failed to fetch")))
        .mockImplementationOnce(() =>
          Promise.resolve({ success: true, data: [makeRow("r1", "1")] })
        );
      renderClient();

      await waitFor(() =>
        expect(screen.getByText(/No pudimos cargar la lista/)).toBeInTheDocument()
      );
      expect(screen.queryByText("Cargando…")).not.toBeInTheDocument();
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("No pudimos cargar la lista"));

      fireEvent.click(screen.getByTitle("Recargar"));
      await waitFor(() => expect(filaCheckbox("1")).toBeChecked());
      expect(screen.queryByText(/No pudimos cargar la lista/)).not.toBeInTheDocument();
    });

    it("mientras la lista se recarga, «Revisar y emitir» no abre el cuadro (la recarga cambia la selección)", async () => {
      const filas = [makeRow("r1", "1"), makeRow("r2", "2"), makeRow("r3", "3")];
      let responderRecarga: (value: unknown) => void = () => {};
      loadCcAccountStaysAction
        .mockImplementationOnce(() => Promise.resolve({ success: true, data: filas }))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              responderRecarga = resolve;
            })
        );
      renderClient();
      await waitFor(() => expect(filaCheckbox("2")).toBeChecked());

      // Se destilda la hab. 2 a propósito y se aprieta "Recargar".
      fireEvent.click(fila("2"));
      fireEvent.click(screen.getByTitle("Recargar"));

      expect(botonRevisar()).toBeDisabled();
      fireEvent.click(botonRevisar());
      expect(screen.queryByLabelText(CUADRO)).not.toBeInTheDocument();

      // La recarga vuelve a tildar todo lo pendiente: recién ahí se puede revisar, y el
      // cuadro dice lo que va de verdad.
      await act(async () => {
        responderRecarga({ success: true, data: filas });
      });
      await waitFor(() => expect(botonRevisar()).toBeEnabled());
      expect(within(abrirCuadro()).getByText(/^3 estadías/)).toBeInTheDocument();
    });

    it("en producción muestra la banda PRODUCCIÓN", async () => {
      renderClient("acme", "company", FISCAL_PROD);
      await screen.findByLabelText(BARRA);

      const cuadro = abrirCuadro();

      expect(
        within(cuadro).getByText(
          "PRODUCCIÓN: es una factura real ante ARCA. Si sale mal, se anula con nota de crédito."
        )
      ).toBeInTheDocument();
      expect(within(cuadro).queryByText(/PRUEBA/)).not.toBeInTheDocument();
    });

    it("en homologación muestra la banda PRUEBA", async () => {
      renderClient("acme", "company", FISCAL_PRUEBA);
      await screen.findByLabelText(BARRA);

      const cuadro = abrirCuadro();

      expect(within(cuadro).getByText(/^PRUEBA/)).toBeInTheDocument();
      expect(within(cuadro).queryByText(/PRODUCCIÓN/)).not.toBeInTheDocument();
    });

    it("un huésped consumidor final se factura con el DNI de su ficha", async () => {
      renderClient("g-dni-ok", "guest");
      await screen.findByLabelText(BARRA);

      const cuadro = abrirCuadro();

      expect(within(cuadro).getByText("Factura B")).toBeInTheDocument();
      expect(within(cuadro).getByText("Juan Prueba")).toBeInTheDocument();
      expect(within(cuadro).getByText("DNI 30123456")).toBeInTheDocument();
      expect(within(cuadro).getByText("Consumidor Final")).toBeInTheDocument();
      await confirmarListo(cuadro);
    });

    it("un huésped con DNI inválido ve el aviso y no puede confirmar", async () => {
      renderClient("g-dni-mal", "guest");
      await screen.findByLabelText(BARRA);

      const cuadro = abrirCuadro();

      expect(within(cuadro).getByText(/no sirve para facturar/)).toBeInTheDocument();
      // Pasada la espera anti doble toque, sigue deshabilitado: lo traba el DNI.
      await pasarEsperaConfirmar();
      const confirmar = botonConfirmar(cuadro);
      expect(confirmar).toBeDisabled();
      fireEvent.click(confirmar);
      expect(emitConsolidatedInvoiceAction).not.toHaveBeenCalled();
    });

    it("si el receptor queda incompleto con el cuadro abierto, «Confirmar» se traba: la RPC completaría lo vacío con la ficha y saldría otra cosa que la del cuadro", async () => {
      renderClient("ficticia");
      await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue("30123456781"));

      const cuadro = abrirCuadro();
      const confirmar = await confirmarListo(cuadro);

      // El formulario de atrás sigue ahí: cada campo que se vacía traba «Confirmar».
      const campos: [string, string][] = [
        ["Condición frente al IVA", "responsable_inscripto"],
        ["CUIT", "30123456781"],
        ["Razón social", "Empresa Ficticia SA"],
        ["Domicilio", "Calle Inventada 100"],
      ];
      for (const [campo, valor] of campos) {
        fireEvent.change(screen.getByLabelText(campo), { target: { value: "" } });
        expect(confirmar).toBeDisabled();
        fireEvent.click(confirmar);
        expect(emitConsolidatedInvoiceAction).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText(campo), { target: { value: valor } });
        expect(confirmar).toBeEnabled();
      }

      // Completo de nuevo, se emite lo que muestra el cuadro.
      fireEvent.click(confirmar);
      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1));
      expect(payloadEmitido()).toMatchObject({
        condicionIva: "responsable_inscripto",
        cuit: "30123456781",
        razonSocial: "Empresa Ficticia SA",
        domicilio: "Calle Inventada 100",
      });
    });

    it("Tab y Shift+Tab no sacan el foco del cuadro: el formulario de atrás no se puede tocar con el teclado", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      const cuadro = abrirCuadro();
      const volver = within(cuadro).getByText("Volver").closest("button") as HTMLButtonElement;
      expect(document.activeElement).toBe(volver);

      // Mientras «Confirmar» espera, «Volver» es lo único enfocable: Tab no se va.
      expect(fireEvent.keyDown(volver, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(volver);

      const confirmar = await confirmarListo(cuadro);
      // Shift+Tab desde el primero da la vuelta al último, y Tab desde el último, al primero.
      expect(fireEvent.keyDown(volver, { key: "Tab", shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(confirmar);
      expect(fireEvent.keyDown(confirmar, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(volver);
      // Adentro del cuadro, Tab sigue su curso normal.
      expect(fireEvent.keyDown(volver, { key: "Tab" })).toBe(true);

      // Si el foco quedó afuera, Tab lo trae de vuelta al cuadro.
      const domicilio = screen.getByLabelText("Domicilio");
      domicilio.focus();
      expect(fireEvent.keyDown(domicilio, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(volver);
      expect(emitConsolidatedInvoiceAction).not.toHaveBeenCalled();
    });
  });

  // Decisión del 24/09 (misma regla que la mig 112 en el check-out): la ficha precarga la
  // pantalla, pero el comprobante lo decide lo que se eligió en la pantalla. Sin condición
  // en el payload, la RPC cae en la de la ficha del huésped y emite con su CUIT aunque el
  // cuadro haya dicho Factura B con DNI.
  describe("condición frente al IVA que se manda: la ficha precarga, no decide", () => {
    beforeEach(() => {
      vi.spyOn(window, "open").mockImplementation(() => null);
    });

    it("huésped con ficha en Responsable Inscripto y «Consumidor final» elegido: el cuadro dice B con DNI y se manda 'consumidor_final' sin CUIT", async () => {
      renderClient("g-ri", "guest");
      await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue("20301234563"));

      // La pantalla arranca con la condición de la ficha; el que factura elige consumidor final.
      fireEvent.change(screen.getByLabelText("Condición frente al IVA"), { target: { value: "" } });

      const cuadro = abrirCuadro();
      expect(within(cuadro).getByText("Factura B")).toBeInTheDocument();
      expect(within(cuadro).getByText("Pedro Prueba")).toBeInTheDocument();
      expect(within(cuadro).getByText("DNI 30123457")).toBeInTheDocument();
      expect(within(cuadro).getByText("Consumidor Final")).toBeInTheDocument();
      fireEvent.click(await confirmarListo(cuadro));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1));
      const payload = payloadEmitido();
      expect(payload.kind).toBe("guest");
      expect(payload.condicionIva).toBe("consumidor_final");
      expect(payload.cuit).toBeUndefined();
      expect(payload.razonSocial).toBeUndefined();
      expect(payload.domicilio).toBeUndefined();
    });

    it("huésped sin ficha de facturación (consumidor final de entrada): también manda 'consumidor_final'", async () => {
      renderClient("g-dni-ok", "guest");
      await screen.findByLabelText(BARRA);

      fireEvent.click(await confirmarListo(abrirCuadro()));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1));
      const payload = payloadEmitido();
      expect(payload.condicionIva).toBe("consumidor_final");
      expect(payload.cuit).toBeUndefined();
    });

    it("huésped que se factura con CUIT: sigue mandando su condición y su CUIT, como antes", async () => {
      renderClient("g-ri", "guest");
      await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue("20301234563"));

      const cuadro = abrirCuadro();
      expect(within(cuadro).getByText("Factura A")).toBeInTheDocument();
      expect(within(cuadro).getByText("CUIT 20-30123456-3")).toBeInTheDocument();
      fireEvent.click(await confirmarListo(cuadro));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1));
      expect(payloadEmitido()).toMatchObject({
        kind: "guest",
        condicionIva: "responsable_inscripto",
        cuit: "20301234563",
        razonSocial: "Pedro Prueba Servicios",
        domicilio: "Calle Inventada 200",
      });
    });

    it("empresa: manda su condición y su CUIT, sin cambios", async () => {
      renderClient("ficticia");
      await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue("30123456781"));

      fireEvent.click(await confirmarListo(abrirCuadro()));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalledTimes(1));
      expect(payloadEmitido()).toMatchObject({
        kind: "company",
        condicionIva: "responsable_inscripto",
        cuit: "30123456781",
        razonSocial: "Empresa Ficticia SA",
        domicilio: "Calle Inventada 100",
      });
    });
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
      expect(screen.getByText("Pendientes de facturar")).toHaveAttribute(
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

      fireEvent.click(screen.getByText("Todas"));

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

      fireEvent.click(screen.getByText("Ver todas"));

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

      fireEvent.click(screen.getByText("Siguiente"));

      // La fila 1 quedó en la página anterior: no está a la vista, pero el
      // aviso dice que sigue tildada.
      expect(screen.queryByLabelText("Incluir estadía de habitación 1")).not.toBeInTheDocument();
      expect(screen.getByText(/1 estadía tildada en otras páginas/)).toBeInTheDocument();

      const barra = screen.getByLabelText(BARRA);
      expect(barra.textContent).toContain("1 estadía");

      const cuadro = abrirCuadro();
      // El aviso se repite en el cuadro: es lo último que se mira antes de emitir.
      expect(within(cuadro).getByText(/1 estadía tildada en otras páginas/)).toBeInTheDocument();

      fireEvent.click(await confirmarListo(cuadro));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().detalle).toHaveLength(1);
      expect(payloadEmitido().detalle?.[0].reservationId).toBe("r1");
    });
  });

  describe("forma del detalle impreso (mig 102)", () => {
    beforeEach(() => {
      // emitConfirmado() abre la ventana del impreso; en jsdom no está implementada.
      vi.spyOn(window, "open").mockImplementation(() => null);
    });

    /** Emitir ahora son dos pasos: revisar y confirmar. */
    const emitir = async () => {
      fireEvent.click(await confirmarListo(abrirCuadro()));
    };

    it("con «un solo concepto», manda el texto y NO las líneas por estadía", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      fireEvent.click(screen.getByText("Un solo concepto"));

      // Arranca en "Alojamiento" y es editable.
      const campo = screen.getByLabelText("Texto del concepto único");
      expect(campo).toHaveValue("Alojamiento");
      fireEvent.change(campo, { target: { value: "Servicios de alojamiento" } });

      // Las líneas por estadía desaparecen: en este modo no se imprimen.
      expect(
        screen.queryByLabelText("Descripción de la estadía de habitación 5")
      ).not.toBeInTheDocument();

      // El cuadro dice la forma elegida antes de emitir.
      expect(
        within(abrirCuadro()).getByText(/un solo concepto, «Servicios de alojamiento»/)
      ).toBeInTheDocument();
      fireEvent.click(await confirmarListo(screen.getByLabelText(CUADRO)));

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().conceptoUnico).toBe("Servicios de alojamiento");
      // Lo importante: no van las dos formas juntas. Con `detalle` también en el
      // payload, el comprobante guardaría un detalle que nadie eligió ni va a ver.
      expect(payloadEmitido().detalle).toBeUndefined();
    });

    it("en «detallado» (el default) sigue mandando el array por estadía, como antes", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      // No se toca el interruptor: el modo de siempre es el default.
      await emitir();

      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().conceptoUnico).toBeUndefined();
      expect(payloadEmitido().detalle).toEqual([
        { reservationId: "company-acme-1", descripcion: "Hab. 5 - 01/09/2026 al 03/09/2026" },
      ]);
    });

    it("ir a «un solo concepto» y volver no pierde los textos editados por estadía", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      const linea = () => screen.getByLabelText("Descripción de la estadía de habitación 5");
      fireEvent.change(linea(), { target: { value: "Convención anual" } });

      fireEvent.click(screen.getByText("Un solo concepto"));
      fireEvent.click(screen.getByText("Detallado"));

      expect(linea()).toHaveValue("Convención anual");

      await emitir();
      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().detalle?.[0].descripcion).toBe("Convención anual");
    });

    it("si se borra el texto del concepto, se emite el default que muestra el placeholder", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      fireEvent.click(screen.getByText("Un solo concepto"));
      fireEvent.change(screen.getByLabelText("Texto del concepto único"), {
        target: { value: "   " },
      });

      await emitir();

      // Mandar vacío sería peor: en el servidor NULL significa "detallado", así que
      // el impreso saldría distinto de lo que la pantalla venía mostrando.
      await waitFor(() => expect(emitConsolidatedInvoiceAction).toHaveBeenCalled());
      expect(payloadEmitido().conceptoUnico).toBe("Alojamiento");
      expect(payloadEmitido().detalle).toBeUndefined();
    });

    it("«Restaurar» también devuelve el texto del concepto a «Alojamiento»", async () => {
      renderClient();
      await screen.findByLabelText(BARRA);

      fireEvent.click(screen.getByText("Un solo concepto"));
      fireEvent.change(screen.getByLabelText("Texto del concepto único"), {
        target: { value: "Otra cosa" },
      });
      fireEvent.click(screen.getByText("Restaurar"));

      expect(screen.getByLabelText("Texto del concepto único")).toHaveValue("Alojamiento");
    });
  });
});

describe("page.tsx: a la consolidada se entra siempre con el cliente puesto", () => {
  beforeEach(() => {
    redirect.mockClear();
    getCurrentUserRole.mockResolvedValue("admin");
    getCtaCteAccounts.mockResolvedValue(accounts);
    getCtaCteBillingProfile.mockReset();
    getCtaCteBillingProfile.mockImplementation((kind: string, id: string) =>
      Promise.resolve(billingProfiles[`${kind}:${id}`] ?? null)
    );
    getFiscalSettings.mockResolvedValue({
      id: 1,
      enabled: true,
      environment: "produccion",
      cuit: null,
      razon_social: null,
      domicilio_fiscal: null,
      iibb: null,
      inicio_actividades: null,
      punto_venta: 3,
      cbte_tipo: 6,
      concepto: 2,
      iva_pct: 21,
      prefijo_archivos: null,
      dias_vto_cuenta_corriente: 45,
    });
    getHotelSettings.mockResolvedValue(null);
    loadCcAccountStaysAction.mockReset();
    loadCcAccountStaysAction.mockImplementation((kind: string, id: string) =>
      Promise.resolve({ success: true, data: [makeRow(`${kind}-${id}-1`, "5")] })
    );
  });

  const abrir = (params: { kind?: string; id?: string }) =>
    ConsolidadaPage({ searchParams: Promise.resolve(params) });

  it.each([
    ["sin parámetros", {}],
    ["sin id", { kind: "company" }],
    ["sin kind", { id: "acme" }],
    ["con un kind que no existe", { kind: "otra", id: "acme" }],
    ["con un cliente que no es de cuenta corriente", { kind: "company", id: "no-existe" }],
  ])("%s, lleva a Control", async (_caso, params) => {
    await expect(abrir(params)).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin/fiscal/control");
    // El id de la URL recién va a la base con el cliente validado.
    expect(getCtaCteBillingProfile).not.toHaveBeenCalled();
  });

  it("con cliente, abre la pantalla con su nombre y el cuadro lleva el ambiente, el punto de venta y el plazo", async () => {
    render(await abrir({ kind: "company", id: "acme" }));

    expect(redirect).not.toHaveBeenCalled();
    expect(getCtaCteBillingProfile).toHaveBeenCalledWith("company", "acme");
    expect(screen.getByText("Acme SA")).toBeInTheDocument();
    await screen.findByLabelText(BARRA);

    const cuadro = abrirCuadro();
    expect(within(cuadro).getByText(/^PRODUCCIÓN: es una factura real/)).toBeInTheDocument();
    expect(within(cuadro).getByText("Punto de venta 3")).toBeInTheDocument();
    expect(
      within(cuadro).getByText("Condición de venta: cuenta corriente · vence a 45 días")
    ).toBeInTheDocument();
  });

  // La pantalla manda 'consumidor_final' cuando no ve una condición: si la ficha del
  // cliente de la URL no llegara (antes se leían sólo las fichas con la cuenta corriente
  // prendida), un huésped en Responsable Inscripto se vería como consumidor final y
  // saldría Factura B con DNI. La página lee la ficha de ese cliente, sin más filtro.
  it("precarga la ficha del cliente de la URL: un huésped en Responsable Inscripto ve Factura A con su CUIT", async () => {
    render(await abrir({ kind: "guest", id: "g-ri" }));

    expect(getCtaCteBillingProfile).toHaveBeenCalledWith("guest", "g-ri");
    await waitFor(() => expect(screen.getByLabelText("CUIT")).toHaveValue("20301234563"));
    expect(screen.getByLabelText("Condición frente al IVA")).toHaveValue("responsable_inscripto");

    const cuadro = abrirCuadro();
    expect(within(cuadro).getByText("Factura A")).toBeInTheDocument();
    expect(within(cuadro).getByText("CUIT 20-30123456-3")).toBeInTheDocument();
  });

  it("si no se puede leer la ficha, la página no abre en lugar de mostrarlo como consumidor final", async () => {
    getCtaCteBillingProfile.mockRejectedValue(new Error("no se pudo leer la ficha"));

    await expect(abrir({ kind: "guest", id: "g-ri" })).rejects.toThrow("no se pudo leer la ficha");
    expect(redirect).not.toHaveBeenCalled();
  });
});
