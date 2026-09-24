import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AssociatedClientModal from "./AssociatedClientModal";
import type { AssociatedClient } from "@/lib/types";

const H = vi.hoisted(() => ({
  findCompaniesByDocumentAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  findCompaniesByDocumentAction: H.findCompaniesByDocumentAction,
}));

const NOTA = /Pasó a Factura consolidada/;
const AVISO = /no entra en la consolidada/;
const NOTA_CUIT = /La consolidada de una empresa pide CUIT/;

// Ficticios: el CUIT pasa isValidCuit; el DNI tiene 8 dígitos, así que no es CUIT.
const CUIT_FICTICIO = "30-12345678-1";
const DNI_FICTICIO = "12345678";

function empresa(patch: Partial<AssociatedClient> = {}): AssociatedClient {
  return {
    id: "empresa-1",
    display_name: "Empresa Ficticia SA",
    document_id: "30-12345678-1",
    phone: null,
    discount_percent: 0,
    notes: null,
    is_active: true,
    cuenta_corriente_habilitada: false,
    condicion_iva: null,
    razon_social: null,
    domicilio: null,
    facturacion_modo: "por_checkout",
    robinet_id: null,
    created_at: "2026-09-01T12:00:00.000Z",
    updated_at: "2026-09-01T12:00:00.000Z",
    ...patch,
  };
}

function montar(initialClient: AssociatedClient | null = null) {
  const onSubmit = vi.fn().mockResolvedValue({ success: true });
  const onClose = vi.fn();
  render(
    <AssociatedClientModal
      isOpen
      onClose={onClose}
      onSubmit={onSubmit}
      initialClient={initialClient}
      title={initialClient ? "Editar empresa" : "Nueva empresa"}
    />
  );
  return { onSubmit, onClose };
}

const cuentaCorriente = () => screen.getByLabelText("Cuenta corriente") as HTMLSelectElement;
const facturacion = () => screen.getByLabelText("Facturación") as HTMLSelectElement;
const cargarDocumento = (valor: string) =>
  fireEvent.change(screen.getByLabelText("DNI o CUIT"), { target: { value: valor } });
/** El recuadro de una nota o un aviso: el color vive en su clase (emerald o amber). */
const recuadro = (texto: RegExp) => screen.getByText(texto).closest("p") as HTMLElement;

describe("AssociatedClientModal: cuenta corriente y modo de facturación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.findCompaniesByDocumentAction.mockResolvedValue({ success: true, data: [] });
  });

  it("una empresa nueva arranca en 'por cada check-out', sin nota ni aviso", () => {
    montar();
    expect(cuentaCorriente().value).toBe("no");
    expect(facturacion().value).toBe("por_checkout");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("poner Cuenta corriente = Sí deja elegida 'Factura consolidada' y muestra la nota", () => {
    montar();
    cargarDocumento(CUIT_FICTICIO);
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("consolidada");
    expect(screen.getByText(NOTA)).toBeTruthy();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("volver a 'por cada check-out' muestra el aviso ámbar y saca la nota", () => {
    montar();
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(facturacion(), { target: { value: "por_checkout" } });

    expect(facturacion().value).toBe("por_checkout");
    expect(screen.getByText(AVISO)).toBeTruthy();
    expect(screen.queryByText(NOTA)).toBeNull();
  });

  it("el aviso no bloquea: se guarda igual con cuenta corriente y factura por check-out", async () => {
    const { onSubmit } = montar();
    fireEvent.change(screen.getByLabelText("Nombre de la Empresa / Convenio"), {
      target: { value: "Empresa Ficticia SA" },
    });
    fireEvent.change(screen.getByLabelText("DNI o CUIT"), {
      target: { value: "30-12345678-1" },
    });
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(facturacion(), { target: { value: "por_checkout" } });

    fireEvent.click(screen.getByText("Crear Empresa / Convenio"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cuentaCorrienteHabilitada: true,
      facturacionModo: "por_checkout",
    });
  });

  it("volver a No después del Sí deshace el cambio automático y la nota se va", () => {
    montar();
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    // Nadie eligió Consolidada: deshacer el Sí deja la ficha como estaba. Una ficha
    // en consolidada sin cuenta corriente saca sus check-outs de "Por facturar".
    expect(facturacion().value).toBe("por_checkout");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("Sí y No al editar una empresa se guarda con 'por cada check-out'", async () => {
    const { onSubmit } = montar(empresa());
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    fireEvent.click(screen.getByText("Guardar Cambios"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cuentaCorrienteHabilitada: false,
      facturacionModo: "por_checkout",
    });
  });

  it("Sí, No y otra vez Sí vuelve a Consolidada con la nota", () => {
    montar();
    cargarDocumento(CUIT_FICTICIO);
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("consolidada");
    expect(screen.getByText(NOTA)).toBeTruthy();
  });

  it("si Facturación se eligió a mano, volver a No no la toca", () => {
    montar();
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(facturacion(), { target: { value: "no_factura" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    expect(facturacion().value).toBe("no_factura");
    expect(screen.queryByText(NOTA)).toBeNull();
  });

  it("con Cuenta corriente = No no cambia nada", () => {
    montar(empresa({ cuenta_corriente_habilitada: true, facturacion_modo: "por_checkout" }));
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    expect(facturacion().value).toBe("por_checkout");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("habilitar la cuenta de una empresa que no se factura la deja en 'No se factura'", () => {
    montar(empresa({ facturacion_modo: "no_factura" }));
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("no_factura");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("al editar una ficha que ya tiene cuenta corriente y factura por check-out, el aviso se ve al abrir", () => {
    montar(empresa({ cuenta_corriente_habilitada: true, facturacion_modo: "por_checkout" }));

    expect(facturacion().value).toBe("por_checkout");
    expect(screen.getByText(AVISO)).toBeTruthy();
    expect(screen.queryByText(NOTA)).toBeNull();
  });
});

// Decisión del 24/09: pasa igual a Consolidada y avisa. La consolidada de una empresa
// sale con CUIT; si el documento cargado no lo es, la nota sale en ámbar y lo pide.
describe("AssociatedClientModal: la consolidada de una empresa pide CUIT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.findCompaniesByDocumentAction.mockResolvedValue({ success: true, data: [] });
  });

  it("con un DNI, poner Sí deja Consolidada y la nota sale en ámbar pidiendo el CUIT", () => {
    montar(empresa({ document_id: DNI_FICTICIO }));
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("consolidada");
    expect(screen.getByText(NOTA_CUIT).textContent).toBe(
      "La consolidada de una empresa pide CUIT: cargalo en DNI o CUIT o elegí Factura por cada check-out."
    );
    expect(recuadro(NOTA_CUIT).className).toContain("amber");
    expect(recuadro(NOTA_CUIT).className).not.toContain("emerald");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("con un CUIT válido sale la nota verde de siempre", () => {
    montar(empresa({ document_id: CUIT_FICTICIO }));
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("consolidada");
    expect(recuadro(NOTA).className).toContain("emerald");
    expect(recuadro(NOTA).className).not.toContain("amber");
    expect(screen.queryByText(NOTA_CUIT)).toBeNull();
  });

  it("una empresa nueva sin documento cargado también sale con el aviso ámbar", () => {
    montar();
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("consolidada");
    expect(recuadro(NOTA_CUIT).className).toContain("amber");
    expect(screen.queryByText(NOTA)).toBeNull();
  });

  it("corregir el documento a un CUIT válido cambia el aviso ámbar por la nota verde", () => {
    montar(empresa({ document_id: DNI_FICTICIO }));
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    expect(screen.getByText(NOTA_CUIT)).toBeTruthy();

    cargarDocumento(CUIT_FICTICIO);

    expect(facturacion().value).toBe("consolidada");
    expect(screen.queryByText(NOTA_CUIT)).toBeNull();
    expect(recuadro(NOTA).className).toContain("emerald");
  });

  it("volver a No saca el aviso del CUIT junto con el cambio automático", () => {
    montar(empresa({ document_id: DNI_FICTICIO }));
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    expect(facturacion().value).toBe("por_checkout");
    expect(screen.queryByText(NOTA_CUIT)).toBeNull();
    expect(screen.queryByText(NOTA)).toBeNull();
  });

  it("es solo un aviso: se guarda en Consolidada con el DNI, como antes", async () => {
    const { onSubmit } = montar(empresa({ document_id: DNI_FICTICIO }));
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    fireEvent.click(screen.getByText("Guardar Cambios"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      documentId: DNI_FICTICIO,
      cuentaCorrienteHabilitada: true,
      facturacionModo: "consolidada",
    });
  });
});
