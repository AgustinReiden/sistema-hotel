import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RoomCard from "./RoomCard";
import type { AssociatedClient } from "@/lib/types";

const H = vi.hoisted(() => ({
  handleCheckOut: vi.fn(),
  handleEarlyCheckOut: vi.fn(),
  handleCheckIn: vi.fn(),
  handleSetMaintenance: vi.fn(),
  handleMarkAvailable: vi.fn(),
  handleCancelReservation: vi.fn(),
  handleLateCheckOut: vi.fn(),
  handleExtendReservation: vi.fn(),
  registerPaymentAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  handleLateCheckOut: H.handleLateCheckOut,
  handleMarkAvailable: H.handleMarkAvailable,
  handleCancelReservation: H.handleCancelReservation,
  handleCheckOut: H.handleCheckOut,
  handleEarlyCheckOut: H.handleEarlyCheckOut,
  handleCheckIn: H.handleCheckIn,
  handleSetMaintenance: H.handleSetMaintenance,
  handleAssignWalkIn: vi.fn(),
  handleExtendReservation: H.handleExtendReservation,
}));

vi.mock("@/app/admin/finances/actions", () => ({
  registerPaymentAction: H.registerPaymentAction,
}));

// Los cuadros que abre la tarjeta y tienen acciones propias: en su lugar, un texto que
// dice que están abiertos (para ver que se cierran cuando cambia la reserva).
vi.mock("./WalkInModal", () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? "cuadro-walk-in" : null),
}));
vi.mock("./CompanyCheckInModal", () => ({ default: () => "cuadro-checkin-empresa" }));
vi.mock("./ExtraChargesModal", () => ({ default: () => "cuadro-extras" }));
vi.mock("./ChangeRoomModal", () => ({ default: () => "cuadro-cambiar" }));
vi.mock("./EditReservationModal", () => ({ default: () => "cuadro-editar" }));
vi.mock("./EarlyCheckoutModal", () => ({ default: () => "cuadro-salida-anticipada" }));
// La pregunta de factura tiene su propio test: acá alcanza con saber si está abierta y
// poder cerrarla (que es cuando sale lo que quedó en la cola de impresión).
vi.mock("./InvoicePromptModal", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ data, onClose }: { data: unknown; onClose: () => void }) =>
      data
        ? createElement("button", { type: "button", onClick: onClose }, "Cerrar la pregunta de factura")
        : null,
  };
});

const TZ = "America/Argentina/Buenos_Aires";

const empresa: AssociatedClient = {
  id: "emp-1",
  display_name: "Empresa Ficticia SA",
  document_id: "30123456781",
  phone: null,
  discount_percent: 0,
  notes: null,
  is_active: true,
  cuenta_corriente_habilitada: true,
  condicion_iva: null,
  razon_social: null,
  domicilio: null,
  facturacion_modo: "consolidada",
  robinet_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

type Room = React.ComponentProps<typeof RoomCard>["room"];

/**
 * Habitación ocupada que se va hoy (sin salida anticipada) y debe $80.000. Por
 * defecto es de la empresa con cuenta corriente y se factura en la consolidada, así
 * que el check-out no pregunta por la factura.
 */
function habitacion(overrides: Partial<Room> = {}): Room {
  const ahora = new Date();
  const ayer = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  return {
    id: 4,
    number: "4",
    type: "Doble",
    status: "occupied",
    client: "Juan Prueba",
    checkout: "10:00",
    check_in_target: ayer.toISOString(),
    check_out_target: ahora.toISOString(),
    isLate: false,
    hasLateCheckout: false,
    canChargeLateCheckout: false,
    reservationId: "res-1",
    reservationStatus: "checked_in",
    baseTotalPrice: 80000,
    discountPercent: 0,
    discountAmount: 0,
    totalPrice: 80000,
    paidAmount: 0,
    basePrice: 80000,
    halfDayPrice: 40000,
    hasPendingArrival: false,
    arrivalIsOverdue: false,
    arrivalDateLabel: null,
    accountCreditEnabled: true,
    billedToCompany: true,
    associatedClientId: "emp-1",
    companyPassengerId: "pas-1",
    clientDni: "30123456",
    facturacionModo: "consolidada",
    // Como lo arma el contexto de facturación de la reserva (data.ts): sin razón
    // social cargada, el nombre de la empresa.
    invoicePrefill: {
      razonSocial: "Empresa Ficticia SA",
      cuit: "",
      condicionIva: "",
      domicilio: "",
      suggestA: false,
      complete: false,
    },
    priorPaymentMethods: [],
    ...overrides,
  };
}

/** Particular que paga en caja y se factura en cada check-out. */
function particular(overrides: Partial<Room> = {}): Room {
  return habitacion({
    accountCreditEnabled: false,
    billedToCompany: false,
    associatedClientId: null,
    companyPassengerId: null,
    facturacionModo: "por_checkout",
    invoicePrefill: {
      razonSocial: "Juan Prueba",
      cuit: "",
      condicionIva: "",
      domicilio: "",
      suggestA: false,
      complete: false,
    },
    ...overrides,
  });
}

/** Habitación libre, sin reserva a la vista. */
function libre(overrides: Partial<Room> = {}): Room {
  return habitacion({
    status: "available",
    client: null,
    checkout: null,
    check_in_target: null,
    check_out_target: null,
    reservationId: null,
    reservationStatus: null,
    baseTotalPrice: 0,
    totalPrice: 0,
    accountCreditEnabled: false,
    billedToCompany: false,
    associatedClientId: null,
    companyPassengerId: null,
    clientDni: null,
    facturacionModo: "por_checkout",
    ...overrides,
  });
}

/** Libre con una llegada de hoy esperando el check-in (particular). */
function llegada(overrides: Partial<Room> = {}): Room {
  return libre({
    client: "Juan Prueba",
    checkout: "10:00",
    reservationId: "res-1",
    reservationStatus: "confirmed",
    hasPendingArrival: true,
    clientDni: "30123456",
    ...overrides,
  });
}

/** Lo que ve la tarjeta cuando Hoy se actualiza después del check-out. */
function cerrada(): Room {
  return libre({ status: "cleaning" });
}

type Opciones = {
  isAdmin?: boolean;
  fiscalEnabled?: boolean;
  associatedClients?: AssociatedClient[];
};

function tarjeta(room: Room, opciones: Opciones = {}) {
  return (
    <RoomCard
      room={room}
      associatedClients={opciones.associatedClients ?? [empresa]}
      isAdmin={opciones.isAdmin}
      fiscalEnabled={opciones.fiscalEnabled}
      timezone={TZ}
      standardCheckOutTime="10:00"
    />
  );
}

function abrir(room: Room, opciones: Opciones = {}) {
  const utils = render(tarjeta(room, opciones));
  /** Hoy se actualizó: la misma tarjeta recibe la habitación como quedó. */
  const actualizar = (nueva: Room) => utils.rerender(tarjeta(nueva, opciones));
  return { ...utils, actualizar };
}

const AVISO_INCIERTO =
  "No sabemos si se hizo: esperá a que Hoy se actualice (o recargá la página con F5) y revisá la tarjeta antes de repetirlo.";

/** El renglón que suma el aviso en un check-out: nombra solo lo que no llegó a salir. */
const RENGLON = {
  reciboYFactura:
    "Si la tarjeta ya figura en Limpieza, el check-out entró pero no salieron el recibo ni la pregunta de factura: avisale al administrador (la estadía le queda en Por facturar).",
  recibo:
    "Si la tarjeta ya figura en Limpieza, el check-out entró pero no salió el recibo, y no hay otro lugar desde donde imprimirlo.",
  factura:
    "Si la tarjeta ya figura en Limpieza, el check-out entró pero no salió la pregunta de factura: avisale al administrador (la estadía le queda en Por facturar).",
  remito:
    "Si la tarjeta ya figura en Limpieza, el check-out entró pero no salió el remito: pedile a un administrador que lo reimprima desde la ficha del cliente (solapa Movimientos) para que lo firme el pasajero.",
  remitoYFactura:
    "Si la tarjeta ya figura en Limpieza, el check-out entró pero no salió el remito: pedile a un administrador que lo reimprima desde la ficha del cliente (solapa Movimientos) para que lo firme el pasajero. Tampoco salió la pregunta de factura: avisale al administrador (la estadía le queda en Por facturar).",
};

/** Cualquiera de los renglones del check-out. */
const ALGUN_RENGLON = /^Si la tarjeta ya figura en Limpieza/;

function marcados(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .filter((r) => r.checked)
    .map((r) => r.value);
}

describe("RoomCard: check-out a cuenta corriente y el remito", () => {
  beforeEach(() => {
    H.handleCheckOut.mockReset();
    H.handleCheckOut.mockResolvedValue({
      success: true,
      data: { paymentId: null, movementId: "mov-1" },
    });
    H.toast.success.mockReset();
    H.toast.error.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("en una empresa con cuenta, el cobro abre con Cta. Cte. marcada y a nombre de la empresa", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
    const { container } = abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));

    expect(marcados(container)).toEqual(["cuenta_corriente"]);
    expect(
      screen.getByText(
        "Queda a cuenta de Empresa Ficticia SA. Sale el remito para que firme el pasajero."
      )
    ).toBeTruthy();
    expect(screen.getByText("Cargar a la cuenta y cerrar")).toBeTruthy();
  });

  it("en un particular con cuenta, el cobro abre sin ningún medio marcado", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
    const { container } = abrir(
      habitacion({ billedToCompany: false, associatedClientId: null, companyPassengerId: null })
    );

    fireEvent.click(screen.getByText("Hacer Check-Out"));

    expect(screen.getByText("Cta. Cte.")).toBeTruthy();
    expect(marcados(container)).toEqual([]);
  });

  it("al fiar sale el remito, y si abre no queda ningún cuadro", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(H.handleCheckOut).toHaveBeenCalledTimes(1));
    expect(H.handleCheckOut).toHaveBeenCalledWith({
      reservationId: "res-1",
      paymentAmount: 80000,
      paymentMethod: "cuenta_corriente",
    });
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "/admin/comprobante-cc/mov-1?autoprint=1",
        "comprobante-mov-1",
        "width=420,height=720"
      )
    );
    await waitFor(() =>
      expect(H.toast.success).toHaveBeenCalledWith(
        "Check-out hecho. Queda a cuenta de Empresa Ficticia SA."
      )
    );
    expect(screen.queryByText("Imprimir remito")).toBeNull();
  });

  it("si el navegador bloquea el remito, queda un cuadro con Imprimir remito hasta que sale", async () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);
    abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(screen.getByText("Imprimir remito")).toBeTruthy());
    expect(
      screen.getByText(
        "El check-out quedó hecho y la estadía quedó a cuenta de Empresa Ficticia SA."
      )
    ).toBeTruthy();
    expect(screen.getByText(/Falta el remito: el navegador bloqueó la ventana/)).toBeTruthy();
    // Recepción no entra a Cuenta Corriente: el cuadro dice quién lo reimprime si se
    // cierra, y el botón de cerrar dice que el papel no sale.
    expect(
      screen.getByText(
        /Si lo cerrás sin imprimir, lo tiene que reimprimir un administrador desde la ficha del cliente/
      )
    ).toBeTruthy();
    expect(screen.getByText("Cerrar sin imprimir")).toBeTruthy();
    // El foco arranca en «Imprimir remito»: un Enter imprime, no cierra sin imprimir.
    expect(document.activeElement).toBe(screen.getByText("Imprimir remito").closest("button"));

    // Vuelve a bloquear: el cuadro sigue ahí y avisa qué hacer.
    fireEvent.click(screen.getByText("Imprimir remito"));
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Imprimir remito")).toBeTruthy();
    expect(H.toast.error).toHaveBeenCalledTimes(1);

    // Esta vez abre: el remito sale y el cuadro se va.
    open.mockReturnValue({} as Window);
    fireEvent.click(screen.getByText("Imprimir remito"));
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenLastCalledWith(
      "/admin/comprobante-cc/mov-1?autoprint=1",
      "comprobante-mov-1",
      "width=420,height=720"
    );
    expect(screen.queryByText("Imprimir remito")).toBeNull();
  });

  it("el cuadro del remito solo se va sin imprimir si se aprieta «Cerrar sin imprimir»", async () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);
    abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(screen.getByText("Cerrar sin imprimir")).toBeTruthy());
    fireEvent.click(screen.getByText("Cerrar sin imprimir"));

    expect(screen.queryByText("Imprimir remito")).toBeNull();
    // Cerrar no intenta abrir el remito de nuevo: fue una decisión, no un reintento.
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("el cuadro del remito sobrevive a que Hoy se actualice con la estadía ya cerrada", async () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));
    const { actualizar } = abrir(habitacion());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));
    await waitFor(() => expect(screen.getByText("Imprimir remito")).toBeTruthy());

    // El check-out deja la reserva en null: el papel que falta no se pierde por eso.
    actualizar(cerrada());

    expect(screen.getByText("Imprimir remito")).toBeTruthy();
    expect(
      screen.getByText(
        "El check-out quedó hecho y la estadía quedó a cuenta de Empresa Ficticia SA."
      )
    ).toBeTruthy();
  });

  it("con la empresa desactivada, lo fiado sigue a nombre de la empresa y no del pasajero", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
    // La lista de empresas activas ya no la trae; el contexto de facturación de la
    // reserva, sí.
    abrir(habitacion(), { associatedClients: [] });

    fireEvent.click(screen.getByText("Hacer Check-Out"));

    expect(
      screen.getByText(
        "Queda a cuenta de Empresa Ficticia SA. Sale el remito para que firme el pasajero."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Queda a cuenta de Juan Prueba/)).toBeNull();
  });

  it("con la empresa activa, lo fiado queda con el nombre de la cuenta, el que imprime el remito, y no con la razón social", async () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));
    // Dos áreas de la misma empresa son dos cuentas (mig 94): comparten la razón
    // social y se distinguen por el nombre de la ficha, que es el que va en el remito.
    const area: AssociatedClient = {
      ...empresa,
      display_name: "Ficticia Obras",
      razon_social: "Empresa Ficticia SA",
    };
    abrir(habitacion(), { associatedClients: [area] });

    fireEvent.click(screen.getByText("Hacer Check-Out"));

    expect(
      screen.getByText(
        "Queda a cuenta de Ficticia Obras. Sale el remito para que firme el pasajero."
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() =>
      expect(H.toast.success).toHaveBeenCalledWith(
        "Check-out hecho. Queda a cuenta de Ficticia Obras."
      )
    );
    // El remito bloqueado dice el mismo nombre.
    await waitFor(() =>
      expect(
        screen.getByText("El check-out quedó hecho y la estadía quedó a cuenta de Ficticia Obras.")
      ).toBeTruthy()
    );
    expect(screen.queryByText(/a cuenta de Empresa Ficticia SA/)).toBeNull();
  });
});

describe("RoomCard: el recibo sale después de decidir la factura", () => {
  const RECIBO: [string, string, string] = [
    "/admin/recibo/pay-1?autoprint=1&copy=original",
    "recibo-pay-1",
    "width=420,height=720",
  ];

  beforeEach(() => {
    H.handleCheckOut.mockReset();
    H.handleCheckOut.mockResolvedValue({
      success: true,
      data: { paymentId: "pay-1", movementId: null },
    });
    H.toast.success.mockReset();
    H.toast.error.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Cobra el check-out en efectivo desde la tarjeta. */
  function cobrarEnEfectivo() {
    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar y Cerrar"));
  }

  it("mientras la pregunta de factura está abierta el recibo no sale; sale al cerrarla", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    abrir(particular(), { fiscalEnabled: true });

    cobrarEnEfectivo();

    await waitFor(() => expect(screen.getByText("Cerrar la pregunta de factura")).toBeTruthy());
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Cerrar la pregunta de factura"));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(...RECIBO);
    expect(screen.queryByText("Cerrar la pregunta de factura")).toBeNull();
  });

  it("la pregunta y la cola sobreviven a que Hoy se actualice con la estadía cerrada", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    const { actualizar } = abrir(particular(), { fiscalEnabled: true });

    cobrarEnEfectivo();
    await waitFor(() => expect(screen.getByText("Cerrar la pregunta de factura")).toBeTruthy());

    actualizar(cerrada());

    expect(screen.getByText("Cerrar la pregunta de factura")).toBeTruthy();
    fireEvent.click(screen.getByText("Cerrar la pregunta de factura"));
    expect(open).toHaveBeenCalledWith(...RECIBO);
  });

  it("sin pregunta de factura (fiscal apagado), el recibo sale enseguida, como antes", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    abrir(particular(), { fiscalEnabled: false });

    cobrarEnEfectivo();

    await waitFor(() => expect(open).toHaveBeenCalledWith(...RECIBO));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Cerrar la pregunta de factura")).toBeNull();
  });

  it("con vale blanco no hay pregunta de factura y el recibo sale enseguida", async () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    abrir(particular(), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByLabelText("Vale Blanco"));
    fireEvent.click(screen.getByText("Registrar y Cerrar"));

    await waitFor(() => expect(open).toHaveBeenCalledWith(...RECIBO));
    expect(screen.queryByText("Cerrar la pregunta de factura")).toBeNull();
  });

  it("a cuenta corriente con factura por check-out, el remito también espera a la pregunta", async () => {
    H.handleCheckOut.mockResolvedValue({
      success: true,
      data: { paymentId: null, movementId: "mov-1" },
    });
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    abrir(habitacion({ facturacionModo: "por_checkout" }), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(screen.getByText("Cerrar la pregunta de factura")).toBeTruthy());
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Cerrar la pregunta de factura"));

    expect(open).toHaveBeenCalledWith(
      "/admin/comprobante-cc/mov-1?autoprint=1",
      "comprobante-mov-1",
      "width=420,height=720"
    );
  });

  it("a cuenta corriente en la consolidada, con fiscal prendido, no hay pregunta y el remito sale enseguida", async () => {
    H.handleCheckOut.mockResolvedValue({
      success: true,
      data: { paymentId: null, movementId: "mov-1" },
    });
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);
    // La habitación de la empresa se factura en la consolidada (el valor por defecto).
    abrir(habitacion(), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "/admin/comprobante-cc/mov-1?autoprint=1",
        "comprobante-mov-1",
        "width=420,height=720"
      )
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Cerrar la pregunta de factura")).toBeNull();
  });

  it("si al cerrar la pregunta el navegador bloquea el recibo, queda el cuadro para imprimirlo", async () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);
    abrir(particular(), { fiscalEnabled: true });

    cobrarEnEfectivo();
    await waitFor(() => expect(screen.getByText("Cerrar la pregunta de factura")).toBeTruthy());
    fireEvent.click(screen.getByText("Cerrar la pregunta de factura"));

    expect(screen.getByText("El check-out quedó hecho y el pago quedó registrado.")).toBeTruthy();
    expect(screen.getByText(/Falta el recibo: el navegador bloqueó la ventana/)).toBeTruthy();
    // Cerrarlo no tiene vuelta: el recibo no se reimprime desde ningún otro lado.
    expect(
      screen.getByText(/Si lo cerrás sin imprimir, no hay otro lugar desde donde imprimirlo\.$/)
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText("Imprimir recibo").closest("button"));

    // El botón es un click del usuario: esta vez abre, y el cuadro se va.
    open.mockReturnValue({} as Window);
    fireEvent.click(screen.getByText("Imprimir recibo"));

    expect(open).toHaveBeenLastCalledWith(...RECIBO);
    expect(screen.queryByText("Imprimir recibo")).toBeNull();
  });
});

describe("RoomCard: los cuadros se cierran si cambia la reserva", () => {
  const enTresDias = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const casos: {
    cuadro: string;
    boton: string;
    abierto: string | RegExp;
    desde: () => Room;
    hacia: () => Room;
    opciones?: Opciones;
  }[] = [
    {
      cuadro: "el cobro (Cobrar y Finalizar)",
      boton: "Hacer Check-Out",
      abierto: "Cobrar y Finalizar",
      desde: () => particular(),
      hacia: () => particular({ reservationId: "res-2", client: "Ana Ficticia" }),
    },
    {
      cuadro: "la confirmación del check-out sin saldo",
      boton: "Hacer Check-Out",
      abierto: "Confirmar Check-Out",
      desde: () => particular({ paidAmount: 80000 }),
      hacia: () => particular({ reservationId: "res-2", client: "Ana Ficticia", paidAmount: 80000 }),
    },
    {
      cuadro: "la salida anticipada",
      boton: "Hacer Check-Out",
      abierto: "cuadro-salida-anticipada",
      desde: () => particular({ check_out_target: enTresDias() }),
      hacia: () => particular({ reservationId: "res-2", check_out_target: enTresDias() }),
    },
    {
      cuadro: "Extras",
      boton: "Extra",
      abierto: "cuadro-extras",
      desde: () => particular(),
      hacia: () => particular({ reservationId: "res-2" }),
    },
    {
      cuadro: "Cambiar habitación",
      boton: "Cambiar",
      abierto: "cuadro-cambiar",
      desde: () => particular(),
      hacia: () => particular({ reservationId: "res-2" }),
    },
    {
      cuadro: "Editar",
      boton: "Editar",
      abierto: "cuadro-editar",
      desde: () => particular(),
      hacia: () => particular({ reservationId: "res-2" }),
      opciones: { isAdmin: true },
    },
    {
      cuadro: "Cancelar Reserva",
      boton: "Cancelar Reserva",
      abierto: "Motivo",
      desde: () => particular(),
      hacia: () => particular({ reservationId: "res-2" }),
      opciones: { isAdmin: true },
    },
    {
      cuadro: "Ampliar Reserva",
      boton: "Ampliar Reserva",
      abierto: "Noches Adicionales",
      desde: () => particular(),
      hacia: () => particular({ reservationId: "res-2" }),
    },
    {
      cuadro: "el check-in de empresa",
      boton: "Hacer Check-In",
      abierto: "cuadro-checkin-empresa",
      desde: () =>
        llegada({ billedToCompany: true, associatedClientId: "emp-1", companyPassengerId: null }),
      hacia: () =>
        llegada({
          reservationId: "res-2",
          billedToCompany: true,
          associatedClientId: "emp-1",
          companyPassengerId: null,
        }),
    },
    {
      cuadro: "la confirmación del check-in automático",
      boton: "Hacer Check-In Automático",
      abierto: /^¿Seguro\?/,
      desde: () => llegada(),
      hacia: () => llegada({ reservationId: "res-2", client: "Ana Ficticia" }),
    },
    {
      cuadro: "el walk-in",
      boton: "Hacer Check-In",
      abierto: "cuadro-walk-in",
      desde: () => libre(),
      hacia: () => llegada({ reservationId: "res-9" }),
    },
    {
      cuadro: "la confirmación de mantenimiento",
      boton: "Poner en Mantenimiento",
      abierto: /^¿Seguro\?/,
      desde: () => libre(),
      hacia: () => llegada({ reservationId: "res-9" }),
      opciones: { isAdmin: true },
    },
    {
      cuadro: "la confirmación de Cobrar Medio Día",
      boton: "Cobrar Medio Día",
      abierto: /^¿Seguro\?/,
      desde: () => particular({ canChargeLateCheckout: true }),
      hacia: () =>
        particular({ reservationId: "res-2", client: "Ana Ficticia", canChargeLateCheckout: true }),
    },
  ];

  it.each(casos)("$cuadro se cierra cuando Hoy trae otra reserva", ({ boton, abierto, desde, hacia, opciones }) => {
    const { actualizar } = abrir(desde(), opciones);

    fireEvent.click(screen.getByText(boton));
    expect(screen.getByText(abierto)).toBeTruthy();

    actualizar(hacia());

    expect(screen.queryByText(abierto)).toBeNull();
  });

  it("con la misma reserva, una actualización no cierra el cuadro abierto", () => {
    const { actualizar } = abrir(particular());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    // Un extra cargado desde otra pantalla sube el total, pero la reserva es la misma.
    actualizar(particular({ totalPrice: 90000 }));

    expect(screen.getByText("Cobrar y Finalizar")).toBeTruthy();
  });
});

describe("RoomCard: confirmar antes de actuar", () => {
  beforeEach(() => {
    H.handleCheckIn.mockReset();
    H.handleCheckIn.mockResolvedValue({ success: true });
    H.handleSetMaintenance.mockReset();
    H.handleSetMaintenance.mockResolvedValue({ success: true });
    H.handleMarkAvailable.mockReset();
    H.handleMarkAvailable.mockResolvedValue({ success: true });
    H.handleLateCheckOut.mockReset();
    H.handleLateCheckOut.mockResolvedValue({ success: true, data: { halfDayCharged: true } });
    H.toast.success.mockReset();
  });

  it("«Hacer Check-In Automático» pregunta antes, y «Volver» no hace nada", async () => {
    abrir(llegada());

    fireEvent.click(screen.getByText("Hacer Check-In Automático"));

    expect(
      screen.getByText("¿Seguro? Vas a hacer el check-in de Juan Prueba en la Hab. 4.")
    ).toBeTruthy();
    expect(H.handleCheckIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Volver"));
    expect(screen.queryByText(/^¿Seguro\?/)).toBeNull();
    expect(H.handleCheckIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Hacer Check-In Automático"));
    fireEvent.click(screen.getByText("Sí, hacer el check-in"));

    await waitFor(() => expect(H.handleCheckIn).toHaveBeenCalledTimes(1));
    expect(H.handleCheckIn).toHaveBeenCalledWith("res-1", undefined);
    await waitFor(() => expect(screen.queryByText(/^¿Seguro\?/)).toBeNull());
  });

  it("«Poner en Mantenimiento» pregunta antes de sacar la habitación de servicio", async () => {
    abrir(libre(), { isAdmin: true });

    fireEvent.click(screen.getByText("Poner en Mantenimiento"));

    expect(screen.getByText("¿Seguro? Vas a poner en mantenimiento la Hab. 4.")).toBeTruthy();
    expect(H.handleSetMaintenance).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Sí, poner en mantenimiento"));

    await waitFor(() => expect(H.handleSetMaintenance).toHaveBeenCalledWith(4));
  });

  it("«Marcar Lista» pregunta antes de dejarla para alquilar", async () => {
    abrir(libre({ status: "cleaning" }), { isAdmin: true });

    fireEvent.click(screen.getByText("Marcar Lista"));

    expect(screen.getByText("¿Seguro? Vas a marcar lista la Hab. 4.")).toBeTruthy();
    expect(H.handleMarkAvailable).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Volver"));
    expect(H.handleMarkAvailable).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Marcar Lista"));
    fireEvent.click(screen.getByText("Sí, marcar lista"));

    await waitFor(() => expect(H.handleMarkAvailable).toHaveBeenCalledWith(4));
    await waitFor(() =>
      expect(H.toast.success).toHaveBeenCalledWith("Habitación marcada como disponible.")
    );
  });

  it("«Cobrar Medio Día» pregunta antes, y sin el «Sí» no cobra", async () => {
    abrir(particular({ canChargeLateCheckout: true }));

    fireEvent.click(screen.getByText("Cobrar Medio Día"));

    expect(
      screen.getByText("¿Seguro? Vas a cobrar medio día a Juan Prueba en la Hab. 4.")
    ).toBeTruthy();
    // Antes de confirmar se ve cuánto se cobra (halfDayPrice = 40000 en la tarjeta de prueba).
    expect(screen.getByText(/Se cobra \$40\.000,00 de medio día/)).toBeTruthy();
    expect(H.handleLateCheckOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Volver"));
    expect(screen.queryByText(/^¿Seguro\?/)).toBeNull();
    expect(H.handleLateCheckOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Cobrar Medio Día"));
    fireEvent.click(screen.getByText("Sí, cobrar medio día"));

    await waitFor(() => expect(H.handleLateCheckOut).toHaveBeenCalledTimes(1));
    expect(H.handleLateCheckOut).toHaveBeenCalledWith("res-1");
    await waitFor(() => expect(H.toast.success).toHaveBeenCalledWith("Medio día cobrado."));
    expect(screen.queryByText(/^¿Seguro\?/)).toBeNull();
  });

  const dobleClick: {
    boton: string;
    si: string;
    accion: () => ReturnType<typeof vi.fn>;
    room: () => Room;
    opciones?: Opciones;
  }[] = [
    { boton: "Hacer Check-In Automático", si: "Sí, hacer el check-in", accion: () => H.handleCheckIn, room: () => llegada() },
    { boton: "Poner en Mantenimiento", si: "Sí, poner en mantenimiento", accion: () => H.handleSetMaintenance, room: () => libre(), opciones: { isAdmin: true } },
    { boton: "Marcar Lista", si: "Sí, marcar lista", accion: () => H.handleMarkAvailable, room: () => libre({ status: "cleaning" }), opciones: { isAdmin: true } },
    { boton: "Cobrar Medio Día", si: "Sí, cobrar medio día", accion: () => H.handleLateCheckOut, room: () => particular({ canChargeLateCheckout: true }) },
  ];

  it.each(dobleClick)(
    "un doble click en $boton no confirma: el segundo click que cae en «Sí» no cuenta",
    async ({ boton, si, accion, room, opciones }) => {
      abrir(room(), opciones);

      // El primer click pinta el cuadro; el segundo del doble click cae en «Sí».
      fireEvent.click(screen.getByText(boton), { detail: 1 });
      fireEvent.click(screen.getByText(si), { detail: 2 });

      expect(screen.getByText(/^¿Seguro\?/)).toBeTruthy();
      expect(accion()).not.toHaveBeenCalled();

      // Un click suelto en «Sí», después de leer, confirma.
      fireEvent.click(screen.getByText(si), { detail: 1 });
      await waitFor(() => expect(accion()).toHaveBeenCalledTimes(1));
    }
  );

  it("la confirmación es un diálogo con su título y toma el foco en «Volver»", () => {
    const { container } = abrir(particular({ canChargeLateCheckout: true }));

    fireEvent.click(screen.getByText("Cobrar Medio Día"));

    const dialogo = container.querySelector('[role="dialog"]');
    expect(dialogo).not.toBeNull();
    expect(dialogo?.getAttribute("aria-modal")).toBe("true");
    const titulo = screen.getByText("¿Seguro? Vas a cobrar medio día a Juan Prueba en la Hab. 4.");
    expect(titulo.id).not.toBe("");
    expect(dialogo?.getAttribute("aria-labelledby")).toBe(titulo.id);
    // El foco entra al diálogo, en el botón que no hace nada: un Enter de pasada no cobra.
    expect(document.activeElement).toBe(screen.getByText("Volver"));
    expect(dialogo?.contains(document.activeElement)).toBe(true);
  });
});

describe("RoomCard: textos con tilde y voseo", () => {
  it("la tarjeta ocupada dice «Huésped» y «Cobrar Medio Día»", () => {
    abrir(particular({ canChargeLateCheckout: true }));

    expect(screen.getByText("Huésped")).toBeTruthy();
    expect(screen.getByText("Cobrar Medio Día")).toBeTruthy();
  });

  it("cancelar una reserva pide «Indicá el motivo»", () => {
    abrir(particular(), { isAdmin: true });

    fireEvent.click(screen.getByText("Cancelar Reserva"));

    expect(screen.getByText(/^Indicá el motivo de cancelación/)).toBeTruthy();
  });
});

describe("RoomCard: si la acción no vuelve (red cortada)", () => {
  const sinRed = () => new TypeError("Failed to fetch");

  beforeEach(() => {
    H.handleCheckOut.mockReset();
    H.handleCheckIn.mockReset();
    H.handleLateCheckOut.mockReset();
    H.toast.success.mockReset();
    H.toast.error.mockReset();
    vi.stubGlobal("open", vi.fn().mockReturnValue({} as Window));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("check-out sin saldo y sin factura: avisa que no sabemos si se hizo, sin renglón, y el aviso no se va solo", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    abrir(particular({ paidAmount: 80000 }));

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    // Sin cobro no hay recibo, y con fiscal apagado no hay pregunta: no faltaba nada.
    expect(screen.queryByText(ALGUN_RENGLON)).toBeNull();
    // El cuadro que lanzó la acción se cierra: repetirla ya no es un click.
    expect(screen.queryByText("Confirmar Check-Out")).toBeNull();
    expect(H.handleCheckOut).toHaveBeenCalledTimes(1);

    // Se va solo con «Entendido».
    fireEvent.click(screen.getByText("Entendido"));
    expect(screen.queryByText(AVISO_INCIERTO)).toBeNull();
  });

  it("check-out sin saldo con factura: el renglón nombra la pregunta y no el recibo", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    abrir(particular({ paidAmount: 80000 }), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Confirmar"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.getByText(RENGLON.factura)).toBeTruthy();
    expect(screen.queryByText(/recibo/)).toBeNull();
  });

  it("el aviso sobrevive a que Hoy se actualice con la reserva cambiada, que es lo que pide esperar", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    const { actualizar } = abrir(particular({ paidAmount: 80000 }));

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Confirmar"));
    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());

    // El check-out sí había entrado: Hoy trae la habitación sin reserva, y eso cierra
    // los cuadros de la tarjeta. El aviso no es uno de ellos.
    actualizar(cerrada());

    expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy();
    fireEvent.click(screen.getByText("Entendido"));
    expect(screen.queryByText(AVISO_INCIERTO)).toBeNull();
  });

  it("cobro del check-out con factura: se cierra el cobro y el renglón nombra el recibo y la pregunta", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    abrir(particular(), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar y Cerrar"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.getByText(RENGLON.reciboYFactura)).toBeTruthy();
    expect(screen.queryByText("Cobrar y Finalizar")).toBeNull();
  });

  it("cobro del check-out con fiscal apagado: el renglón nombra solo el recibo, sin Por facturar", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    abrir(particular());

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByLabelText("Efectivo"));
    fireEvent.click(screen.getByText("Registrar y Cerrar"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.getByText(RENGLON.recibo)).toBeTruthy();
    expect(screen.queryByText(/Por facturar/)).toBeNull();
  });

  it("vale blanco con fiscal prendido: no hay pregunta de factura, el renglón nombra solo el recibo", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    abrir(particular(), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByLabelText("Vale Blanco"));
    fireEvent.click(screen.getByText("Registrar y Cerrar"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.getByText(RENGLON.recibo)).toBeTruthy();
    expect(screen.queryByText(/Por facturar/)).toBeNull();
  });

  it("Cta. Cte. en la consolidada: el renglón nombra el remito para que firme el pasajero, sin recibo ni Por facturar", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    abrir(habitacion(), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.getByText(RENGLON.remito)).toBeTruthy();
    expect(screen.queryByText(/recibo/)).toBeNull();
    expect(screen.queryByText(/Por facturar/)).toBeNull();
  });

  it("Cta. Cte. con factura por check-out: el renglón nombra el remito y la pregunta", async () => {
    H.handleCheckOut.mockRejectedValue(sinRed());
    abrir(habitacion({ facturacionModo: "por_checkout" }), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-Out"));
    fireEvent.click(screen.getByText("Cargar a la cuenta y cerrar"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.getByText(RENGLON.remitoYFactura)).toBeTruthy();
  });

  it("check-in: queda el aviso en lugar de la pantalla de error, sin el renglón del check-out", async () => {
    H.handleCheckIn.mockRejectedValue(sinRed());
    abrir(llegada(), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Hacer Check-In Automático"));
    fireEvent.click(screen.getByText("Sí, hacer el check-in"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.queryByText(ALGUN_RENGLON)).toBeNull();
  });

  it("Cobrar Medio Día: queda el aviso en lugar de la pantalla de error", async () => {
    H.handleLateCheckOut.mockRejectedValue(sinRed());
    abrir(particular({ canChargeLateCheckout: true }), { fiscalEnabled: true });

    fireEvent.click(screen.getByText("Cobrar Medio Día"));
    fireEvent.click(screen.getByText("Sí, cobrar medio día"));

    await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    expect(screen.queryByText(ALGUN_RENGLON)).toBeNull();
  });

  describe("Ampliar Reserva, que repetida suma las noches otra vez", () => {
    const RENGLON_AMPLIAR =
      "Hasta que la tarjeta muestre otra salida o recargues la página (F5), «Ampliar Reserva» queda frenado: ampliar de nuevo sumaría las noches otra vez.";
    const SALIDA = "2026-10-01T13:00:00.000Z";

    beforeEach(() => {
      H.handleExtendReservation.mockReset();
      H.handleExtendReservation.mockRejectedValue(sinRed());
    });

    /** Ampliar Reserva → una noche → Ampliar, sin respuesta. */
    async function ampliarSinRespuesta() {
      fireEvent.click(screen.getByText("Ampliar Reserva"));
      fireEvent.click(screen.getByText("Ampliar"));
      await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
    }

    it("sin respuesta, el aviso dice que ampliar queda frenado y no deja volver a ampliar a ciegas", async () => {
      abrir(particular({ check_out_target: SALIDA }));

      await ampliarSinRespuesta();
      expect(screen.getByText(RENGLON_AMPLIAR)).toBeTruthy();
      expect(screen.queryByText("Noches Adicionales")).toBeNull();
      fireEvent.click(screen.getByText("Entendido"));

      // La tarjeta sigue con la salida de antes: no se sabe si entró.
      fireEvent.click(screen.getByText("Ampliar Reserva"));

      expect(screen.queryByText("Noches Adicionales")).toBeNull();
      expect(screen.getByText(RENGLON_AMPLIAR)).toBeTruthy();
      expect(H.handleExtendReservation).toHaveBeenCalledTimes(1);
    });

    it("una actualización con los mismos datos no lo destraba", async () => {
      const { actualizar } = abrir(particular({ check_out_target: SALIDA }));

      await ampliarSinRespuesta();
      fireEvent.click(screen.getByText("Entendido"));
      actualizar(particular({ check_out_target: SALIDA }));

      fireEvent.click(screen.getByText("Ampliar Reserva"));
      expect(screen.queryByText("Noches Adicionales")).toBeNull();
      expect(screen.getByText(RENGLON_AMPLIAR)).toBeTruthy();
    });

    it("cuando la tarjeta muestra otra salida (la ampliación entró), se puede volver a ampliar", async () => {
      const { actualizar } = abrir(particular({ check_out_target: SALIDA }));

      await ampliarSinRespuesta();
      fireEvent.click(screen.getByText("Entendido"));
      actualizar(
        particular({ check_out_target: "2026-10-02T13:00:00.000Z", totalPrice: 160000 })
      );

      fireEvent.click(screen.getByText("Ampliar Reserva"));
      expect(screen.getByText("Noches Adicionales")).toBeTruthy();
    });

    it("recargar la página (la tarjeta se monta de cero) también lo destraba", async () => {
      const { unmount } = abrir(particular({ check_out_target: SALIDA }));

      await ampliarSinRespuesta();
      unmount();
      abrir(particular({ check_out_target: SALIDA }));

      fireEvent.click(screen.getByText("Ampliar Reserva"));
      expect(screen.getByText("Noches Adicionales")).toBeTruthy();
    });

    it("el medio día (que no se cobra dos veces) no frena la ampliación", async () => {
      H.handleLateCheckOut.mockRejectedValue(sinRed());
      abrir(particular({ check_out_target: SALIDA }));

      fireEvent.click(screen.getByText("Ampliar Reserva"));
      fireEvent.click(screen.getByText("Medio día"));
      fireEvent.click(screen.getByText("Ampliar"));
      await waitFor(() => expect(screen.getByText(AVISO_INCIERTO)).toBeTruthy());
      expect(screen.queryByText(RENGLON_AMPLIAR)).toBeNull();
      fireEvent.click(screen.getByText("Entendido"));

      fireEvent.click(screen.getByText("Ampliar Reserva"));
      expect(screen.getByText("Noches Adicionales")).toBeTruthy();
    });
  });
});

describe("RoomCard: ampliar la reserva", () => {
  it("el botón dice las noches y el nuevo día de salida, y amplía las noches del stepper", async () => {
    const { handleExtendReservation } = await import("./actions");
    vi.mocked(handleExtendReservation).mockResolvedValue({
      success: true,
      data: { halfDayRemoved: false, halfDayAmount: 0 },
    });
    // Entró el 24/09 y sale el 25/09 a las 10:00.
    abrir(
      habitacion({
        check_in_target: "2026-09-24T17:00:00.000Z",
        check_out_target: "2026-09-25T13:00:00.000Z",
      })
    );

    fireEvent.click(screen.getByText("Ampliar Reserva"));
    expect(screen.getByText("Ampliar 1 noche · sale el 26/09")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Noches adicionales: sumar 1"));
    expect(screen.getByText("Ampliar 2 noches · sale el 27/09")).toBeTruthy();

    fireEvent.click(screen.getByText("Ampliar 2 noches · sale el 27/09"));
    await waitFor(() => expect(handleExtendReservation).toHaveBeenCalledWith("res-1", 2));
  });

  it("un número que se pasa de 30 queda en 30 al tipearlo, y se amplía lo que decía el botón", async () => {
    const { handleExtendReservation } = await import("./actions");
    vi.mocked(handleExtendReservation).mockClear();
    vi.mocked(handleExtendReservation).mockResolvedValue({
      success: true,
      data: { halfDayRemoved: false, halfDayAmount: 0 },
    });
    // Sale el 25/09 a las 10:00.
    abrir(
      habitacion({
        check_in_target: "2026-09-24T17:00:00.000Z",
        check_out_target: "2026-09-25T13:00:00.000Z",
      })
    );

    fireEvent.click(screen.getByText("Ampliar Reserva"));
    const campo = screen.getByLabelText("Noches adicionales") as HTMLInputElement;
    // Quería 4 y se le escapó un 5.
    act(() => campo.focus());
    fireEvent.change(campo, { target: { value: "4" } });
    fireEvent.change(campo, { target: { value: "45" } });
    expect(campo.value).toBe("30");
    const boton = screen.getByText("Ampliar 30 noches · sale el 25/10");

    // En el navegador el mousedown sobre el botón saca el foco del campo antes del click.
    act(() => campo.blur());
    expect(boton.textContent).toBe("Ampliar 30 noches · sale el 25/10");
    fireEvent.click(boton);
    await waitFor(() => expect(handleExtendReservation).toHaveBeenCalledWith("res-1", 30));
    expect(handleExtendReservation).toHaveBeenCalledTimes(1);
  });
});
