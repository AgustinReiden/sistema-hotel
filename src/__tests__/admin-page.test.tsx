import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoy es un server component async: se lo llama como función y se renderiza lo que
// devuelve, como en admin-layout.test.tsx. Los datos van mockeados y los componentes de
// cliente quedan como marcadores de texto para ver qué se monta y con qué.
const H = vi.hoisted(() => ({ role: "receptionist" as string }));

vi.mock("@/lib/data", () => ({
  getDashboardData: async () => ({
    rooms: [],
    reservations: [],
    accountCreditByReservation: {},
    facturacionModoByReservation: {},
    invoicePrefillByReservation: {},
    priorPaymentMethodsByReservation: {},
    hotelSettings: {
      timezone: "America/Argentina/Buenos_Aires",
      standard_check_in_time: "14:00",
      standard_check_out_time: "10:00",
    },
  }),
  getActiveAssociatedClients: async () => [],
  getCurrentUserRole: async () => H.role,
  getPendingSolicitudesCount: async () => 0,
  getUnresolvedAdminAlertsCount: async () => 0,
  getFiscalSettings: async () => null,
  listRoomOccupancyAlerts: async () => [],
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/app/admin/AutoRefresh", () => ({
  default: ({ timezone, renderedAt }: { timezone: string; renderedAt?: number }) => (
    <p>{`AutoRefresh zona=${timezone} armada=${renderedAt}`}</p>
  ),
}));

vi.mock("@/app/admin/NewReservationButton", () => ({ default: () => null }));
vi.mock("@/app/admin/OccupiedRoomAlertBanner", () => ({ default: () => null }));
vi.mock("@/app/admin/RoomCard", () => ({ default: () => null }));

import Dashboard from "@/app/admin/page";

const AHORA = new Date("2026-09-25T13:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Hoy (admin/page.tsx) monta el refresco automático", () => {
  it.each(["receptionist", "admin"])(
    "con el rol %s monta AutoRefresh arriba del encabezado, con la zona del hotel y la hora de este render",
    async (role) => {
      H.role = role;
      render(await Dashboard());

      const autoRefresh = screen.getByText(/^AutoRefresh /);
      expect(autoRefresh.textContent).toBe(
        `AutoRefresh zona=America/Argentina/Buenos_Aires armada=${AHORA.getTime()}`
      );
      // La línea del aviso va arriba del encabezado de Hoy.
      const encabezado = screen.getByText(/^Vista Global:/);
      expect(
        autoRefresh.compareDocumentPosition(encabezado) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  );

  it("cada render de la página (cada recarga) trae su propia hora", async () => {
    const primera = render(await Dashboard());
    expect(screen.getByText(/^AutoRefresh /).textContent).toContain(`armada=${AHORA.getTime()}`);
    primera.unmount();

    vi.setSystemTime(AHORA.getTime() + 30_000);
    render(await Dashboard());
    expect(screen.getByText(/^AutoRefresh /).textContent).toContain(
      `armada=${AHORA.getTime() + 30_000}`
    );
  });
});
