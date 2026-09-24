import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El layout del panel es un server component async: se lo llama como función y se
// renderiza lo que devuelve. Supabase, los datos y los componentes de cliente van
// mockeados; los componentes quedan como marcadores de texto para ver qué se monta.
const H = vi.hoisted(() => ({
  role: "receptionist" as string,
  openedBy: "otra-recepcionista" as string | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-actual", email: "juan@example.com" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: H.role, full_name: "Juan Prueba" } }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/data", () => ({
  getActiveOpenShift: async () =>
    H.openedBy
      ? { id: "turno-1", shift_number: 7, opened_by: H.openedBy, opened_at: "2026-09-24T08:00:00-03:00" }
      : null,
  getShiftSummary: async () => ({
    openedByName: "Ana Ficticia",
    totalsByMethod: {
      cash: 0,
      credit_card: 0,
      debit_card: 0,
      bank_transfer: 0,
      mercado_pago: 0,
      vale_blanco: 0,
      cuenta_corriente: 0,
      other: 0,
    },
    creditCharged: 0,
    creditCharges: [],
    checkoutsCount: 0,
  }),
  countBillingPending: async () => [],
  getRemitosSalud: async () => ({ a_revisar: 0, piezas_abiertas: 0 }),
}));

vi.mock("@/app/admin/IdleLogout", () => ({ default: () => <span>Cierre por inactividad</span> }));
vi.mock("@/app/admin/caja/ForcedShiftHandover", () => ({
  default: ({ currentUserName }: { currentUserName: string }) => (
    <span>Rendición forzada de {currentUserName}</span>
  ),
}));
vi.mock("@/app/admin/Sidebar", () => ({ default: () => <span>Menú del panel</span> }));
vi.mock("@/app/admin/MobileNav", () => ({ MobileTopBar: () => null, MobileTabBar: () => null }));
vi.mock("@/app/admin/OpenShiftAgeAlert", () => ({ default: () => null }));

import AdminLayout from "@/app/admin/layout";

async function renderLayout() {
  render(await AdminLayout({ children: <span>Contenido de la pantalla</span> }));
}

beforeEach(() => {
  H.role = "receptionist";
  H.openedBy = "otra-recepcionista";
});

// Una PC olvidada en Hoy pasa sola a la rendición forzada cuando otra recepcionista abre
// la caja. Si esa rama del layout pierde IdleLogout, la sesión no vence nunca y lint,
// typecheck y build no se enteran: este test sí.
describe("layout del panel: cierre de sesión por inactividad", () => {
  it("la rendición forzada de recepción también lo monta", async () => {
    await renderLayout();
    expect(screen.getByText("Rendición forzada de Juan Prueba")).toBeInTheDocument();
    expect(screen.getByText("Cierre por inactividad")).toBeInTheDocument();
    // Es la rendición y nada más: sin menú ni pantalla.
    expect(screen.queryByText("Menú del panel")).toBeNull();
    expect(screen.queryByText("Contenido de la pantalla")).toBeNull();
  });

  it("el panel normal de recepción lo sigue montando", async () => {
    H.openedBy = "u-actual";
    await renderLayout();
    expect(screen.queryByText(/Rendición forzada/)).toBeNull();
    expect(screen.getByText("Menú del panel")).toBeInTheDocument();
    expect(screen.getByText("Cierre por inactividad")).toBeInTheDocument();
  });

  it("el admin no pasa por la rendición forzada ni tiene cierre por inactividad", async () => {
    H.role = "admin";
    await renderLayout();
    expect(screen.queryByText(/Rendición forzada/)).toBeNull();
    expect(screen.getByText("Menú del panel")).toBeInTheDocument();
    expect(screen.queryByText("Cierre por inactividad")).toBeNull();
  });
});
