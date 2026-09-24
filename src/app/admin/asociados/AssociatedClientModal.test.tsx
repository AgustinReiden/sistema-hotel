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

  it("volver a No después del Sí no toca Facturación y la nota se va", () => {
    montar();
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    // Deshabilitar no cambia el modo: queda lo que se veía elegido.
    expect(facturacion().value).toBe("consolidada");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
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
