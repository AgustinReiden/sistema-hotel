import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GuestModal from "./GuestModal";
import type { GuestRecord } from "@/lib/types";

const H = vi.hoisted(() => ({
  loadGuestRecordAction: vi.fn(),
  updateGuestAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  loadGuestRecordAction: H.loadGuestRecordAction,
  updateGuestAction: H.updateGuestAction,
}));

const NOTA = /Pasó a Factura consolidada/;
const AVISO = /no entra en la consolidada/;

function huesped(patch: Partial<GuestRecord> = {}): GuestRecord {
  return {
    id: "huesped-1",
    full_name: "Juan Prueba",
    document_type: "DNI",
    document_id: "30123456",
    phone: null,
    address: null,
    locality: null,
    nationality: null,
    profession: null,
    discount_percent: 0,
    cuenta_corriente_habilitada: false,
    facturacion_modo: "por_checkout",
    condicion_iva: null,
    cuit: null,
    razon_social: null,
    domicilio_fiscal: null,
    robinet_id: null,
    ...patch,
  };
}

async function montar(guest: GuestRecord) {
  H.loadGuestRecordAction.mockResolvedValue({ success: true, data: guest });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<GuestModal guestId={guest.id} onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByLabelText("Cuenta corriente")).toBeTruthy());
  return { onSaved, onClose };
}

const cuentaCorriente = () => screen.getByLabelText("Cuenta corriente") as HTMLSelectElement;
const facturacion = () => screen.getByLabelText("Facturación") as HTMLSelectElement;

describe("GuestModal: cuenta corriente y modo de facturación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.updateGuestAction.mockResolvedValue({ success: true });
  });

  it("poner Cuenta corriente = Sí deja elegida 'Factura consolidada' y muestra la nota", async () => {
    await montar(huesped());
    expect(facturacion().value).toBe("por_checkout");

    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("consolidada");
    expect(screen.getByText(NOTA)).toBeTruthy();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("volver a 'por cada check-out' muestra el aviso y se guarda igual", async () => {
    await montar(huesped());
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(facturacion(), { target: { value: "por_checkout" } });

    expect(screen.getByText(AVISO)).toBeTruthy();
    expect(screen.queryByText(NOTA)).toBeNull();

    fireEvent.click(screen.getByText("Guardar Cambios"));

    await waitFor(() => expect(H.updateGuestAction).toHaveBeenCalledTimes(1));
    expect(H.updateGuestAction.mock.calls[0][1]).toMatchObject({
      cuentaCorrienteHabilitada: true,
      facturacionModo: "por_checkout",
    });
  });

  it("volver a No después del Sí deja la ficha como estaba y se guarda así", async () => {
    await montar(huesped());
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    // Nadie eligió Consolidada: deshacer el Sí deshace también el cambio automático.
    expect(facturacion().value).toBe("por_checkout");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();

    fireEvent.click(screen.getByText("Guardar Cambios"));

    await waitFor(() => expect(H.updateGuestAction).toHaveBeenCalledTimes(1));
    expect(H.updateGuestAction.mock.calls[0][1]).toMatchObject({
      cuentaCorrienteHabilitada: false,
      facturacionModo: "por_checkout",
    });
  });

  it("si Facturación se eligió a mano, volver a No no la toca", async () => {
    await montar(huesped());
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });
    fireEvent.change(facturacion(), { target: { value: "no_factura" } });
    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    expect(facturacion().value).toBe("no_factura");
    expect(screen.queryByText(NOTA)).toBeNull();
  });

  it("con Cuenta corriente = No no cambia nada", async () => {
    await montar(huesped({ cuenta_corriente_habilitada: true, facturacion_modo: "por_checkout" }));
    // La ficha ya estaba en cuenta corriente + por check-out: el aviso se ve al abrir.
    expect(screen.getByText(AVISO)).toBeTruthy();

    fireEvent.change(cuentaCorriente(), { target: { value: "no" } });

    expect(facturacion().value).toBe("por_checkout");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("habilitar la cuenta de un huésped que no se factura lo deja en 'No se factura'", async () => {
    await montar(huesped({ facturacion_modo: "no_factura" }));
    fireEvent.change(cuentaCorriente(), { target: { value: "si" } });

    expect(facturacion().value).toBe("no_factura");
    expect(screen.queryByText(NOTA)).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
  });
});
