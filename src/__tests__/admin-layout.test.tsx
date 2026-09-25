import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El layout del panel es un server component async: se lo llama como función y se
// renderiza lo que devuelve. Supabase, los datos y los componentes de cliente van
// mockeados; los componentes quedan como marcadores de texto para ver qué se monta.
const H = vi.hoisted(() => ({
  role: "receptionist" as string,
  fullName: "Juan Prueba" as string | null,
  openedBy: "otra-recepcionista" as string | null,
  idleMounts: 0,
  idleUnmounts: 0,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

// El perfil devuelve solo las columnas que se piden, como PostgREST. El cliente de
// Supabase no tiene tipos: si el layout deja de pedir full_name, typecheck no se entera,
// pero acá el nombre no llega y "Entraste como" pasaría a mostrar el email.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-actual", email: "juan@example.com" } } }) },
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          single: async () => {
            const row: Record<string, unknown> = { role: H.role, full_name: H.fullName };
            const data = Object.fromEntries(
              columns
                .split(",")
                .map((c) => c.trim())
                .filter((c) => c in row)
                .map((c) => [c, row[c]]),
            );
            return { data };
          },
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

// IdleLogout arranca el conteo de 30 minutos al montarse: el marcador cuenta cuántas
// veces se monta y se desmonta.
vi.mock("@/app/admin/IdleLogout", async () => {
  const { useEffect } = await import("react");
  return {
    default: function IdleLogoutMock() {
      useEffect(() => {
        H.idleMounts += 1;
        return () => {
          H.idleUnmounts += 1;
        };
      }, []);
      return <span>Cierre por inactividad</span>;
    },
  };
});
vi.mock("@/app/admin/caja/ForcedShiftHandover", () => ({
  default: ({ currentUserName }: { currentUserName: string }) => (
    <span>Rendición forzada de {currentUserName}</span>
  ),
}));
vi.mock("@/app/admin/Sidebar", () => ({ default: () => <span>Menú del panel</span> }));
vi.mock("@/app/admin/MobileNav", () => ({ MobileTopBar: () => null, MobileTabBar: () => null }));
vi.mock("@/app/admin/OpenShiftAgeAlert", () => ({ default: () => null }));

import AdminLayout from "@/app/admin/layout";

function layoutTree() {
  return AdminLayout({ children: <span>Contenido de la pantalla</span> });
}

async function renderLayout() {
  return render(await layoutTree());
}

beforeEach(() => {
  H.role = "receptionist";
  H.fullName = "Juan Prueba";
  H.openedBy = "otra-recepcionista";
  H.idleMounts = 0;
  H.idleUnmounts = 0;
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

  // La PC de A queda en Hoy con su caja. B la rinde en otra PC y abre la suya, y el
  // refresco siguiente pasa la PC de A a la rendición forzada sin que nadie toque nada.
  // Si React desmonta y vuelve a montar IdleLogout al cambiar de rama, el conteo arranca
  // de cero y la sesión de A vive hasta 30 minutos de más.
  it("pasar del panel a la rendición forzada no reinicia el conteo de inactividad", async () => {
    H.openedBy = "u-actual";
    const { rerender } = await renderLayout();
    expect(screen.getByText("Menú del panel")).toBeInTheDocument();
    expect(H.idleMounts).toBe(1);

    H.openedBy = "otra-recepcionista";
    rerender(await layoutTree());
    expect(screen.getByText("Rendición forzada de Juan Prueba")).toBeInTheDocument();
    expect(screen.queryByText("Menú del panel")).toBeNull();
    expect(H.idleMounts).toBe(1);
    expect(H.idleUnmounts).toBe(0);
  });
});

describe("layout del panel: con qué usuario se entró", () => {
  it.each([
    ["sin nombre", null],
    ["con el nombre vacío", ""],
    ["con el nombre en blanco", "   "],
  ])("con el perfil %s, la rendición forzada muestra el email", async (_caso, fullName) => {
    H.fullName = fullName;
    await renderLayout();
    expect(screen.getByText("Rendición forzada de juan@example.com")).toBeInTheDocument();
  });
});
