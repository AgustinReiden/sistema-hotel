import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import AlertsPanel from "@/app/admin/mantenimiento/AlertsPanel";
import OccupiedRoomAlertBanner from "@/app/admin/OccupiedRoomAlertBanner";
import type { AdminAlert, RoomOccupancyAlert } from "@/lib/types";
import { conIcuDeChrome } from "./icu-chrome";

// Error #418 de React en el build de producción: el HTML del servidor no coincidía con
// el primer dibujo del navegador. Acá se dibuja el componente como en el servidor (con
// el ICU de Node), se hidrata como en Chrome (con su ICU) y se mira si React avisa.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/admin/mantenimiento/actions", () => ({
  authorizeOldTariffAction: vi.fn(),
  rejectOldTariffAction: vi.fn(),
  resolveAdminAlertAction: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => ({
  closeOccupancyAlertAction: vi.fn(),
  regularizeOccupiedRoomAction: vi.fn(),
}));
// Cerrado no dibuja nada, ni en el servidor ni en el navegador.
vi.mock("@/app/admin/WalkInModal", () => ({ default: () => null }));

const TZ = "America/Argentina/Tucuman";
// 17:30 UTC = 14:30 en Tucumán.
const TARDE = "2026-09-26T17:30:00.000Z";

const montados: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  montados.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
});

/** Dibuja como el servidor (ICU de Node) e hidrata como Chrome. Devuelve lo que avisó React. */
async function hidratarComoChrome(ui: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(ui);
  document.body.appendChild(container);

  const errores: string[] = [];
  let root: Root | undefined;
  await conIcuDeChrome(async () => {
    await act(async () => {
      root = hydrateRoot(container, ui, {
        onRecoverableError: (error) =>
          errores.push(error instanceof Error ? error.message : String(error)),
      });
    });
  });
  if (root) montados.push({ root, container });
  return { container, errores };
}

function aviso(overrides: Partial<AdminAlert> = {}): AdminAlert {
  return {
    id: 1,
    kind: "unexpected_cleaning",
    message: "Limpieza no esperada en la habitación 4",
    related_room_id: 4,
    related_room_number: "4",
    related_cleaning_log_id: null,
    related_reservation_id: null,
    decision: null,
    payload: null,
    created_at: TARDE,
    resolved_at: null,
    resolved_by: null,
    resolved_notes: null,
    ...overrides,
  };
}

function piezaOcupada(overrides: Partial<RoomOccupancyAlert> = {}): RoomOccupancyAlert {
  return {
    alert_id: 1,
    room_id: 4,
    room_number: "4",
    message: "Habitación marcada ocupada sin reserva activa",
    created_at: TARDE,
    detected_at: TARDE,
    reported_by_name: "Limpieza",
    resolved_at: null,
    decision: null,
    resolved_notes: null,
    resolved_by_name: null,
    ...overrides,
  };
}

describe("hidratación: lo que dibuja el servidor coincide con el navegador", () => {
  // Mantenimiento: la fecha y hora de cada aviso sin revisar (AlertsPanel.tsx).
  it("el panel de avisos de Mantenimiento hidrata sin diferencias", async () => {
    const { container, errores } = await hidratarComoChrome(
      <AlertsPanel
        hotelTimezone={TZ}
        alerts={[aviso(), aviso({ id: 2, kind: "room_change_keep_old_tariff_request" })]}
      />
    );

    expect(errores).toEqual([]);
    expect(container.textContent).toContain("26/09/2026, 02:30 p.\xa0m.");
  });

  // Hoy: el aviso de pieza usada sin estadía, el único componente de cliente de la
  // pantalla que escribe una fecha. Ya coincidía; esto lo deja atado.
  it("el aviso de pieza ocupada de Hoy hidrata sin diferencias", async () => {
    const { container, errores } = await hidratarComoChrome(
      <OccupiedRoomAlertBanner
        alerts={[
          piezaOcupada(),
          piezaOcupada({
            alert_id: 2,
            room_id: 5,
            room_number: "5",
            resolved_at: TARDE,
            decision: "regularizada",
            resolved_by_name: "Admin Prueba",
            resolved_notes: "Se cargó la estadía",
          }),
        ]}
        pricingByRoomId={{ 4: { roomNumber: "4", basePrice: 50000, halfDayPrice: 25000 } }}
        associatedClients={[]}
        timezone={TZ}
        isAdmin
      />
    );

    expect(errores).toEqual([]);
    // "sept" o "sep" según la versión del ICU; lo que importa es que coincidan.
    expect(container.textContent).toMatch(/26 sept? 14:30/);
  });
});
