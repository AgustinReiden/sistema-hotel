import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InvoicePromptModal, { type InvoicePromptData } from "./InvoicePromptModal";
import { DNI_INVALIDO_MSG } from "@/lib/arca/amounts";

const H = vi.hoisted(() => ({
  declineInvoiceAction: vi.fn(),
  emitInvoiceForReservationAction: vi.fn(),
  fixReservationDniAction: vi.fn(),
  lookupReceptorByCuitAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./fiscal/actions", () => ({
  declineInvoiceAction: H.declineInvoiceAction,
  emitInvoiceForReservationAction: H.emitInvoiceForReservationAction,
  fixReservationDniAction: H.fixReservationDniAction,
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

  it("«Volver a la factura» con doble click no emite: el segundo click cae en «Confirmar y emitir» y se ignora", async () => {
    H.emitInvoiceForReservationAction.mockResolvedValue({
      success: true,
      data: { status: "authorized", userMessage: "Factura emitida.", invoiceId: "inv-1" },
    });
    abrir(datos());
    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(screen.getByText("Consumidor Final"));
    fireEvent.click(screen.getByText("Continuar"));

    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getByText("Volver a la factura"), { detail: 1 });
    fireEvent.click(screen.getByText("Confirmar y emitir"), { detail: 2 });

    expect(H.emitInvoiceForReservationAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Confirmar y emitir"), { detail: 1 });
    await waitFor(() => expect(H.emitInvoiceForReservationAction).toHaveBeenCalledTimes(1));
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

describe("InvoicePromptModal: si la emisión o el «no facturar» no vuelven (red cortada)", () => {
  const sinRed = () => new TypeError("Failed to fetch");
  const FACTURA_INCIERTA = "No sabemos si la factura salió porque se cortó la comunicación.";
  const NO_FACTURAR_INCIERTO =
    "No sabemos si quedó registrado el «no facturar» porque se cortó la comunicación.";

  beforeEach(() => {
    H.declineInvoiceAction.mockReset();
    H.emitInvoiceForReservationAction.mockReset();
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    H.toast.warning.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** SÍ → Consumidor Final → Continuar → Confirmar y emitir. */
  function emitirConsumidorFinal() {
    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(screen.getByText("Consumidor Final"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Confirmar y emitir"));
  }

  it("emitir: avisa que no sabemos si salió y cierra, así no queda trabado y sale el recibo que esperaba", async () => {
    H.emitInvoiceForReservationAction.mockRejectedValue(sinRed());
    const { onClose } = abrir(datos());

    emitirConsumidorFinal();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Si salió, no se imprimió: recepción le avisa al admin, que la reimprime o la emite.
    expect(H.toast.warning).toHaveBeenCalledWith(
      FACTURA_INCIERTA,
      expect.objectContaining({
        description:
          "Avisale al administrador para que la revise en Facturación: si salió, no se imprimió y la reimprime desde ahí; si no salió, la emite él.",
      })
    );
    // No hay factura que imprimir: no se sabe si existe.
    expect(window.open).not.toHaveBeenCalled();
  });

  it("emitir sin respuesta: el aviso no se va solo, queda hasta «Entendido» (el recibo abre otra ventana encima)", async () => {
    H.emitInvoiceForReservationAction.mockRejectedValue(sinRed());
    const { onClose } = abrir(datos());

    emitirConsumidorFinal();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const opciones = H.toast.warning.mock.calls[0][1] as {
      duration: number;
      action: { label: string };
    };
    expect(opciones.duration).toBe(Infinity);
    expect(opciones.action.label).toBe("Entendido");
  });

  it("emitir desde Facturación (startAtTipo): el aviso le dice al admin que revise antes de volver a emitir", async () => {
    H.emitInvoiceForReservationAction.mockRejectedValue(sinRed());
    const { onClose } = abrir(datos(), { startAtTipo: true });

    fireEvent.click(screen.getByText("Consumidor Final"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Confirmar y emitir"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(H.toast.warning).toHaveBeenCalledWith(
      FACTURA_INCIERTA,
      expect.objectContaining({
        description:
          "Antes de volver a emitirla, fijate en Facturación si quedó emitida, pendiente o rechazada.",
      })
    );
  });

  it("«No facturar»: avisa que no sabemos si quedó registrado y cierra igual", async () => {
    H.declineInvoiceAction.mockRejectedValue(sinRed());
    const { onClose } = abrir(datos());

    fireEvent.click(screen.getByText("NO"));
    fireEvent.click(screen.getByText("No facturar"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(H.toast.warning).toHaveBeenCalledWith(
      NO_FACTURAR_INCIERTO,
      expect.objectContaining({
        description: "Si no quedó, la estadía le queda al administrador en Por facturar.",
      })
    );
  });
});

describe("InvoicePromptModal: el DNI se corrige ahí mismo", () => {
  const DNI_9 = "301234567";
  const CAMPO_DNI = "DNI correcto";
  const TURNO_AJENO =
    "Esta estadía no es de tu turno: el DNI no se puede cambiar desde acá. Pedile al administrador.";
  const CUIT_MAL =
    "El CUIT del receptor no es valido (11 digitos con digito verificador). Corregilo y reintenta.";

  beforeEach(() => {
    H.declineInvoiceAction.mockReset();
    H.emitInvoiceForReservationAction.mockReset();
    H.fixReservationDniAction.mockReset();
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    H.toast.warning.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** SÍ → Consumidor Final → Continuar: queda en "Revisá antes de emitir". */
  function irAConfirmarB() {
    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(screen.getByText("Consumidor Final"));
    fireEvent.click(screen.getByText("Continuar"));
  }

  const botonEmitir = () => screen.getByText("Confirmar y emitir") as HTMLButtonElement;

  it("con un DNI de 9 dígitos aparece «Corregir DNI» y «Confirmar y emitir» está deshabilitado", () => {
    abrir(datos({ clientDni: DNI_9 }));

    irAConfirmarB();

    expect(screen.getByText("Corregir DNI")).toBeTruthy();
    expect(screen.getByLabelText(CAMPO_DNI)).toBeTruthy();
    expect(botonEmitir().disabled).toBe(true);
    // Ya no manda a un lugar al que recepción no puede ir.
    expect(screen.queryByText(/en la reserva/i)).toBeNull();
  });

  it("en los datos de la Factura B, el DNI que no sirve abre el campo y no dice «en la reserva»", () => {
    abrir(datos({ clientDni: DNI_9 }));

    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(screen.getByText("Consumidor Final"));

    expect(screen.getByLabelText(CAMPO_DNI)).toBeTruthy();
    expect(screen.getByText("Guardar DNI")).toBeTruthy();
    expect(screen.queryByText(/en la reserva/i)).toBeNull();
  });

  it("tipear 30123456 y «Guardar DNI» lo corrige, cambia el DNI a la vista y habilita emitir", async () => {
    H.fixReservationDniAction.mockResolvedValue({ success: true });
    abrir(datos({ clientDni: DNI_9 }));
    irAConfirmarB();

    fireEvent.change(screen.getByLabelText(CAMPO_DNI), { target: { value: "30123456" } });
    fireEvent.click(screen.getByText("Guardar DNI"));

    await waitFor(() =>
      expect(H.fixReservationDniAction).toHaveBeenCalledWith("res-1", "30123456")
    );
    await waitFor(() => expect(botonEmitir().disabled).toBe(false));
    expect(screen.getByText("DNI 30123456")).toBeTruthy();
    expect(H.toast.success).toHaveBeenCalledWith("DNI corregido");
    expect(screen.queryByText("Corregir DNI")).toBeNull();
    // No emite solo: la factura sale recién con "Confirmar y emitir".
    expect(H.emitInvoiceForReservationAction).not.toHaveBeenCalled();
  });

  it("el campo toma sólo dígitos, hasta 8, y no deja guardar menos de 7", () => {
    abrir(datos({ clientDni: DNI_9 }));
    irAConfirmarB();
    const campo = screen.getByLabelText(CAMPO_DNI) as HTMLInputElement;
    const guardar = () => screen.getByText("Guardar DNI") as HTMLButtonElement;

    fireEvent.change(campo, { target: { value: "12345" } });
    expect(guardar().disabled).toBe(true);

    fireEvent.change(campo, { target: { value: "30.123.456-9" } });
    expect(campo.value).toBe("30123456");
    expect(guardar().disabled).toBe(false);
  });

  it("si la estadía no es de su turno (P0023), lee «Pedile al administrador» y el DNI no cambia", async () => {
    H.fixReservationDniAction.mockResolvedValue({
      success: false,
      code: "P0023",
      error: TURNO_AJENO,
    });
    abrir(datos({ clientDni: DNI_9 }));
    irAConfirmarB();

    fireEvent.change(screen.getByLabelText(CAMPO_DNI), { target: { value: "30123456" } });
    fireEvent.click(screen.getByText("Guardar DNI"));

    expect(await screen.findByText(TURNO_AJENO)).toBeTruthy();
    expect(screen.getByText(`DNI ${DNI_9}`)).toBeTruthy();
    expect(botonEmitir().disabled).toBe(true);
    expect(H.toast.success).not.toHaveBeenCalled();
  });

  it("en los datos de la B, «¿El DNI está mal? Corregilo acá» abre el campo aunque tenga 8 dígitos", () => {
    abrir(datos());

    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(screen.getByText("Consumidor Final"));
    expect(screen.queryByLabelText(CAMPO_DNI)).toBeNull();

    fireEvent.click(screen.getByText("¿El DNI está mal? Corregilo acá"));

    expect(screen.getByLabelText(CAMPO_DNI)).toBeTruthy();
  });

  it("un DNI escrito y sin guardar no se pierde: «Continuar» avisa y no avanza", () => {
    abrir(datos());
    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(screen.getByText("Consumidor Final"));
    fireEvent.click(screen.getByText("¿El DNI está mal? Corregilo acá"));

    fireEvent.change(screen.getByLabelText(CAMPO_DNI), { target: { value: "30123457" } });
    fireEvent.click(screen.getByText("Continuar"));

    expect(H.toast.error).toHaveBeenCalledWith(
      "Tocá «Guardar DNI» antes de seguir, o borrá lo que escribiste."
    );
    expect(screen.queryByText("Revisá antes de emitir")).toBeNull();
    expect(H.fixReservationDniAction).not.toHaveBeenCalled();
  });

  it("si emitir vuelve con un P0022 de DNI, no cierra: pide el DNI y después vuelve a confirmar", async () => {
    // El check-out no trajo DNI: no se valida en pantalla y decide la base.
    H.emitInvoiceForReservationAction.mockResolvedValue({
      success: false,
      code: "P0022",
      error: DNI_INVALIDO_MSG,
    });
    H.fixReservationDniAction.mockResolvedValue({ success: true });
    const { onClose } = abrir(datos({ clientDni: null }));
    irAConfirmarB();

    fireEvent.click(botonEmitir());

    expect(await screen.findByLabelText(CAMPO_DNI)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(H.toast.error).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(CAMPO_DNI), { target: { value: "12345678" } });
    fireEvent.click(screen.getByText("Guardar DNI"));

    // Vuelve a la confirmación con el DNI nuevo, lista para emitir.
    await waitFor(() => expect(botonEmitir().disabled).toBe(false));
    expect(screen.getByText("Revisá antes de emitir")).toBeTruthy();
    expect(screen.getByText("DNI 12345678")).toBeTruthy();
    expect(H.fixReservationDniAction).toHaveBeenCalledWith("res-1", "12345678");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("si el emisor la deja pendiente por el DNI, también pide el DNI en vez de cerrar", async () => {
    H.emitInvoiceForReservationAction.mockResolvedValue({
      success: true,
      data: { status: "pending", invoiceId: "inv-1", userMessage: DNI_INVALIDO_MSG },
    });
    const { onClose } = abrir(datos());
    irAConfirmarB();

    fireEvent.click(botonEmitir());

    expect(await screen.findByLabelText(CAMPO_DNI)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(H.toast.warning).not.toHaveBeenCalled();
  });

  it("una Factura A con el CUIT mal cargado dice que el problema es el CUIT y no abre el campo de DNI", async () => {
    H.emitInvoiceForReservationAction.mockResolvedValue({
      success: false,
      code: "P0022",
      error: CUIT_MAL,
    });
    const { onClose } = abrir(
      datos({
        suggestA: true,
        prefillComplete: true,
        aPrefill: {
          razonSocial: "Empresa Ficticia SA",
          cuit: "30123456781",
          condicionIva: "responsable_inscripto",
          domicilio: "Calle Falsa 123",
        },
      })
    );

    fireEvent.click(screen.getByText("SÍ"));
    fireEvent.click(botonEmitir());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(H.toast.error).toHaveBeenCalledWith(CUIT_MAL);
    expect(screen.queryByLabelText(CAMPO_DNI)).toBeNull();
    expect(H.fixReservationDniAction).not.toHaveBeenCalled();
  });
});
