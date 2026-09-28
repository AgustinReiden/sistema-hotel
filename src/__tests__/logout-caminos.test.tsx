import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cada camino de salida del panel, de punta a punta: desde el botón hasta el
 * `signOut` de Supabase (acá simulado) y el login. Decisión de Agustín (27/09):
 *
 *  - "Salir" cierra la sesión solo en este dispositivo (`scope: 'local'`).
 *  - El cierre por inactividad, "¿No sos vos? → Cerrar sesión" del traspaso forzado y
 *    "Listo" después de rendir la caja propia la cierran en todos los dispositivos
 *    (`scope: 'global'`), como hasta hoy.
 *
 * Las acciones de `@/app/login/actions` son las reales: si un camino cambia de acción,
 * o una acción cambia de alcance, este archivo se entera.
 */

const H = vi.hoisted(() => ({
  signOut: vi.fn(),
  redirect: vi.fn(),
  getCloseShiftBlockersAction: vi.fn(),
  closeShiftAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  // En Next, redirect corta tirando una excepción; acá solo se anota adónde lleva.
  redirect: (url: string) => H.redirect(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signOut: async (options?: unknown) => {
        H.signOut(options);
        return { error: null };
      },
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/app/admin/actions", () => ({
  handleExtendReservation: vi.fn(),
}));

vi.mock("@/app/admin/caja/actions", () => ({
  getCloseShiftBlockersAction: (...args: unknown[]) => H.getCloseShiftBlockersAction(...args),
  closeShiftAction: (...args: unknown[]) => H.closeShiftAction(...args),
  openShiftAction: vi.fn(),
  reportShiftConflictAction: vi.fn(),
}));

import LogoutButton from "@/app/admin/LogoutButton";
import IdleLogout from "@/app/admin/IdleLogout";
import CloseShiftModal from "@/app/admin/caja/CloseShiftModal";
import ForcedShiftHandover from "@/app/admin/caja/ForcedShiftHandover";
import type { PaymentMethod } from "@/lib/types";

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

beforeEach(() => {
  H.signOut.mockReset();
  H.redirect.mockReset();
  H.getCloseShiftBlockersAction.mockReset();
  H.getCloseShiftBlockersAction.mockResolvedValue({
    success: true,
    data: { blockers: [], occupied_alerts_count: 0, unbilled_count: 0 },
  });
  H.closeShiftAction.mockReset();
  H.closeShiftAction.mockResolvedValue({
    success: true,
    data: { expected_cash: 43700, actual_cash: 43700, discrepancy: 0, shouldLogout: false },
  });
  // Al cerrar la caja se abre el comprobante en otra ventana: jsdom no la implementa.
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Salir: solo este dispositivo", () => {
  it("el botón Salir cierra la sesión solo acá y lleva al login", async () => {
    render(<LogoutButton />);

    fireEvent.click(screen.getByText("Salir"));

    await waitFor(() => expect(H.redirect).toHaveBeenCalledWith("/login"));
    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("Todos los dispositivos, como hasta hoy", () => {
  it("el cierre por inactividad de recepción la cierra en todos lados a los 30 minutos", async () => {
    vi.useFakeTimers();
    render(<IdleLogout />);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1);
    expect(H.signOut).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(H.redirect).toHaveBeenCalledWith("/login"));
    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("¿No sos vos? → Cerrar sesión, en el traspaso forzado, la cierra en todos lados sin rendir", async () => {
    render(
      <ForcedShiftHandover
        shiftId="s1"
        shiftNumber={1}
        openedByName="Ana Ficticia"
        currentUserName="Juan Prueba"
        totalsByMethod={totalsByMethod}
        creditCharged={0}
        creditCharges={[]}
        checkoutsCount={0}
      />
    );
    await screen.findByLabelText("Efectivo declarado ($)");

    fireEvent.click(screen.getByText("Cerrar sesión"));

    await waitFor(() => expect(H.redirect).toHaveBeenCalledWith("/login"));
    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(H.closeShiftAction).not.toHaveBeenCalled();
  });

  it("Listo después de rendir la caja propia al fin de turno la cierra en todos lados", async () => {
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
        afterClose="logout"
      />
    );
    const input = (await screen.findByLabelText("Efectivo declarado ($)")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "43.700" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(screen.getByText("Confirmar"));
    await screen.findByText("Caja cerrada");
    expect(H.signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Listo"));

    await waitFor(() => expect(H.redirect).toHaveBeenCalledWith("/login"));
    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
});
