import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CloseShiftModal from "./CloseShiftModal";
import type { PaymentMethod } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/app/admin/actions", () => ({
  handleExtendReservation: vi.fn(),
}));

vi.mock("@/app/login/actions", () => ({
  logout: vi.fn(),
}));

const getCloseShiftBlockersAction = vi.fn();
const closeShiftAction = vi.fn();
vi.mock("./actions", () => ({
  getCloseShiftBlockersAction: (...args: unknown[]) => getCloseShiftBlockersAction(...args),
  closeShiftAction: (...args: unknown[]) => closeShiftAction(...args),
  openShiftAction: vi.fn(),
  reportShiftConflictAction: vi.fn(),
}));

const totalsByMethod: Record<PaymentMethod, number> = {
  cash: 0,
  mercado_pago: 0,
  bank_transfer: 0,
  credit_card: 0,
  debit_card: 0,
  vale_blanco: 0,
  cuenta_corriente: 0,
  other: 0,
};

describe("CloseShiftModal", () => {
  beforeEach(() => {
    getCloseShiftBlockersAction.mockReset();
  });

  it("busca las salidas vencidas apenas se abre, sin esperar al boton de reintentar", async () => {
    getCloseShiftBlockersAction.mockResolvedValue({
      success: true,
      data: {
        blockers: [
          {
            reservation_id: "r1",
            room_id: 5,
            room_number: "5",
            client_name: "Juan Perez",
            effective_deadline: "2026-09-09T12:00:00Z",
            hours_overdue: 3,
            balance_due: 0,
          },
        ],
        occupied_alerts_count: 0,
        unbilled_count: 0,
      },
    });

    render(
      <CloseShiftModal
        isOpen
        onClose={() => {}}
        shiftId="s1"
        shiftNumber={1}
        totalsByMethod={totalsByMethod}
        creditCharged={0}
        creditCharges={[]}
        checkoutsCount={0}
      />
    );

    // El efecto de auto-carga (fetchBlockers via IIFE anidada) dispara la
    // accion sin que el usuario tenga que apretar "Volver a verificar".
    expect(getCloseShiftBlockersAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/Juan Perez/)).toBeInTheDocument());
  });

  it("sin bloqueos pasa directo al arqueo de caja", async () => {
    getCloseShiftBlockersAction.mockResolvedValue({
      success: true,
      data: { blockers: [], occupied_alerts_count: 0, unbilled_count: 0 },
    });

    render(
      <CloseShiftModal
        isOpen
        onClose={() => {}}
        shiftId="s1"
        shiftNumber={1}
        totalsByMethod={totalsByMethod}
        creditCharged={0}
        creditCharges={[]}
        checkoutsCount={0}
      />
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Efectivo declarado ($)")).toBeInTheDocument()
    );
  });
});

describe("CloseShiftModal — arqueo a ciegas", () => {
  beforeEach(() => {
    getCloseShiftBlockersAction.mockReset();
    getCloseShiftBlockersAction.mockResolvedValue({
      success: true,
      data: { blockers: [], occupied_alerts_count: 0, unbilled_count: 0 },
    });
    closeShiftAction.mockReset();
    closeShiftAction.mockResolvedValue({
      success: true,
      data: { expected_cash: 43700, actual_cash: 43700, discrepancy: 0, shouldLogout: false },
    });
    // Al cerrar se abre el comprobante en otra ventana: jsdom no la implementa.
    vi.stubGlobal("open", vi.fn());
  });

  async function abrirArqueo() {
    render(
      <CloseShiftModal
        isOpen
        onClose={() => {}}
        shiftId="s1"
        shiftNumber={1}
        totalsByMethod={totalsByMethod}
        creditCharged={0}
        creditCharges={[]}
        checkoutsCount={0}
      />
    );
    return (await screen.findByLabelText("Efectivo declarado ($)")) as HTMLInputElement;
  }

  /** Lo que hace el navegador al apretar Enter en el campo. */
  function apretarEnter(input: HTMLInputElement) {
    fireEvent.submit(input.closest("form")!);
  }

  it("muestra en vivo cómo leyó el monto: 43.700 son cuarenta y tres mil", async () => {
    const input = await abrirArqueo();
    fireEvent.change(input, { target: { value: "43.700" } });
    expect(screen.getByText("= $43.700,00")).toBeInTheDocument();
  });

  it("Enter no envía: pide confirmar el monto en grande", async () => {
    const input = await abrirArqueo();
    fireEvent.change(input, { target: { value: "43.700" } });
    apretarEnter(input);

    expect(screen.getByText("¿Confirmás?")).toBeInTheDocument();
    expect(screen.getByText("$43.700,00")).toBeInTheDocument();
    expect(closeShiftAction).not.toHaveBeenCalled();
  });

  it("Corregir vuelve al campo con lo tipeado, sin enviar nada", async () => {
    const input = await abrirArqueo();
    fireEvent.change(input, { target: { value: "15.000" } });
    apretarEnter(input);

    fireEvent.click(screen.getByRole("button", { name: /Corregir/ }));

    const deVuelta = screen.getByLabelText("Efectivo declarado ($)") as HTMLInputElement;
    expect(deVuelta.value).toBe("15.000");
    expect(closeShiftAction).not.toHaveBeenCalled();
  });

  it("Confirmar envía el monto como se leyó", async () => {
    const input = await abrirArqueo();
    fireEvent.change(input, { target: { value: "43.700" } });
    apretarEnter(input);
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));

    await waitFor(() => expect(closeShiftAction).toHaveBeenCalledTimes(1));
    expect(closeShiftAction.mock.calls[0][0]).toMatchObject({ shiftId: "s1", actualCash: 43700 });
    expect(await screen.findByText("Caja cerrada")).toBeInTheDocument();
  });

  it("un monto que no se entiende no llega a la confirmación", async () => {
    const input = await abrirArqueo();
    fireEvent.change(input, { target: { value: "1.50.000" } });
    apretarEnter(input);

    expect(screen.queryByText("¿Confirmás?")).not.toBeInTheDocument();
    // Una vez en la pista en vivo y otra en el error del envío.
    expect(screen.getAllByText(/No se entiende el monto/)).toHaveLength(2);
  });

  it("si no cuadra, el reintento con la nota no vuelve a pedir confirmación", async () => {
    closeShiftAction.mockResolvedValueOnce({
      success: false,
      error: "falta la nota",
      code: "P0012",
    });

    const input = await abrirArqueo();
    fireEvent.change(input, { target: { value: "15.000" } });
    apretarEnter(input);
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));

    // Vuelve al formulario con el monto bloqueado y la nota obligatoria.
    const bloqueado = (await screen.findByLabelText("Efectivo declarado ($)")) as HTMLInputElement;
    expect(bloqueado.readOnly).toBe(true);
    expect(screen.getByText(/Notas \(obligatorias por la diferencia\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Notas/), {
      target: { value: "Presioné mal una tecla: eran 150.000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Cerrar Turno/ }));

    await waitFor(() => expect(closeShiftAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("¿Confirmás?")).not.toBeInTheDocument();
    expect(closeShiftAction.mock.calls[1][0]).toMatchObject({
      actualCash: 15000,
      notes: "Presioné mal una tecla: eran 150.000",
    });
  });
});
