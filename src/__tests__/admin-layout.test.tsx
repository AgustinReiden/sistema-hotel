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
  // Conteos del menú. `falla` hace que esa consulta lance.
  falla: new Set<string>(),
  solicitudes: 0,
  facturas: [] as { status: string; created_at: string; last_attempt_at: string | null }[],
  // Avisos del admin sin revisar (campana) y cuántas veces se pidieron.
  avisos: 0,
  avisosPedidos: 0,
}));

async function conteo<T>(nombre: string, valor: T): Promise<T> {
  if (H.falla.has(nombre)) throw new Error(`falló ${nombre}`);
  return valor;
}

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
  countBillingPending: () => conteo("unbilled", { falta: 4, pendiente_consolidada: 1, dias: 3650 }),
  getRemitosSalud: () => conteo("remitos", { a_revisar: 2, a_revisar_vencidos: 0, vencidos: 1, piezas_abiertas: 3 }),
  getPendingSolicitudesCount: () => conteo("solicitudes", H.solicitudes),
  listPendingInvoices: () => conteo("facturas", H.facturas),
  getUnresolvedAdminAlertsCount: () => {
    H.avisosPedidos += 1;
    return conteo("avisos", H.avisos);
  },
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
// El menú deja a la vista (en data-nav) los numeritos que le pasa el layout.
vi.mock("@/app/admin/Sidebar", () => ({
  default: (props: Record<string, unknown>) => <span data-nav={JSON.stringify(props)}>Menú del panel</span>,
}));
// Las barras dibujan al lado lo que el layout les pasa en `actions` (la campana del admin).
vi.mock("@/app/admin/MobileNav", () => ({
  MobileTopBar: ({ actions, ...props }: Record<string, unknown> & { actions?: React.ReactNode }) => (
    <>
      <span data-nav={JSON.stringify(props)}>Cajón del celular</span>
      {actions}
    </>
  ),
  MobileTabBar: () => null,
}));
vi.mock("@/app/admin/OpenShiftAgeAlert", () => ({ default: () => null }));
// La barra de las pestañas lee la ruta de la URL: acá solo importa dónde la pone el layout.
vi.mock("@/app/admin/AdminTopBar", () => ({
  default: ({ actions }: { actions?: React.ReactNode }) => (
    <>
      <span data-testid="barra-pestanas" />
      {actions}
    </>
  ),
}));
vi.mock("@/app/admin/AdminAlertsBell", () => ({
  default: ({ initialCount, placement }: { initialCount: number; placement?: string }) => (
    <span data-campana={placement}>Campana con {initialCount}</span>
  ),
}));

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
  H.falla = new Set();
  H.solicitudes = 0;
  H.facturas = [];
  H.avisos = 0;
  H.avisosPedidos = 0;
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

// Las pestañas de la sección son parte del marco: dentro de <main> y fuera del wrapper que
// scrollea, para que no se vayan con el contenido. Y no existen en la rendición forzada.
describe("layout del panel: barra de pestañas", () => {
  it("va dentro de <main>, antes y fuera del área que scrollea", async () => {
    H.openedBy = "u-actual";
    const { container } = await renderLayout();
    const barra = screen.getByTestId("barra-pestanas");
    const main = container.querySelector("main")!;
    const scroll = container.querySelector("[data-admin-scroll]")!;
    expect(main).toContainElement(barra);
    expect(scroll).not.toContainElement(barra);
    expect(barra.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("la rendición forzada no la lleva", async () => {
    await renderLayout();
    expect(screen.queryByTestId("barra-pestanas")).toBeNull();
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

// Los numeritos del menú. Si una cuenta falla, el menú sigue con 0: el layout envuelve
// todo el panel y no puede romper ninguna pantalla.
describe("layout del panel: numeritos del menú", () => {
  const navDe = (texto: string) => JSON.parse(screen.getByText(texto).getAttribute("data-nav") ?? "{}");
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  beforeEach(() => {
    H.openedBy = "u-actual";
    H.solicitudes = 2;
    H.facturas = [
      { status: "rejected", created_at: hace(1), last_attempt_at: null },
      { status: "processing", created_at: hace(30), last_attempt_at: null },
      { status: "processing", created_at: hace(2), last_attempt_at: null },
    ];
  });

  it("el dueño recibe los cuatro, y el de remitos es el total del panel", async () => {
    H.role = "admin";
    await renderLayout();
    for (const menu of ["Menú del panel", "Cajón del celular"]) {
      expect(navDe(menu)).toMatchObject({
        role: "admin",
        hasOpenShift: true,
        unbilledCount: 5,
        // 2 a revisar + 1 vencido + 3 piezas: lo mismo que suma la línea "Para revisar".
        remitosPendientes: 6,
        solicitudesPendientes: 2,
        facturasConError: 2,
      });
    }
  });

  it("recepción recibe solicitudes y facturas con error; lo del dueño queda en 0", async () => {
    await renderLayout();
    expect(navDe("Menú del panel")).toMatchObject({
      role: "receptionist",
      unbilledCount: 0,
      remitosPendientes: 0,
      solicitudesPendientes: 2,
      facturasConError: 2,
    });
  });

  it("si una cuenta falla, ese numerito queda en 0 y el resto sigue", async () => {
    H.role = "admin";
    H.falla = new Set(["unbilled", "remitos", "solicitudes", "facturas"]);
    await renderLayout();
    expect(screen.getByText("Contenido de la pantalla")).toBeInTheDocument();
    expect(navDe("Menú del panel")).toMatchObject({
      unbilledCount: 0,
      remitosPendientes: 0,
      solicitudesPendientes: 0,
      facturasConError: 0,
    });

    H.falla = new Set(["facturas"]);
    await renderLayout();
    const menus = screen.getAllByText("Menú del panel");
    expect(JSON.parse(menus[menus.length - 1].getAttribute("data-nav") ?? "{}")).toMatchObject({
      unbilledCount: 5,
      solicitudesPendientes: 2,
      facturasConError: 0,
    });
  });
});

// La campana de avisos (F1-3): solo para el dueño, en la barra de arriba del escritorio y
// en la del celular, con el número que cuenta el layout.
describe("layout del panel: campana de avisos", () => {
  beforeEach(() => {
    H.openedBy = "u-actual";
    H.avisos = 4;
  });

  it("el dueño la tiene en las dos barras con los avisos sin revisar", async () => {
    H.role = "admin";
    const { container } = await renderLayout();
    const campanas = Array.from(container.querySelectorAll("[data-campana]"));
    expect(campanas.map((c) => c.getAttribute("data-campana")).sort()).toEqual(["desktop", "mobile"]);
    campanas.forEach((c) => expect(c).toHaveTextContent("Campana con 4"));
  });

  it("recepción no la ve y ni se piden los avisos", async () => {
    await renderLayout();
    expect(screen.queryByText(/Campana con/)).toBeNull();
    expect(H.avisosPedidos).toBe(0);
  });

  it("si contar los avisos falla, la campana queda en 0 y el panel sigue", async () => {
    H.role = "admin";
    H.falla = new Set(["avisos"]);
    await renderLayout();
    expect(screen.getByText("Contenido de la pantalla")).toBeInTheDocument();
    expect(screen.getAllByText("Campana con 0")).toHaveLength(2);
  });

  it("la rendición forzada no la lleva", async () => {
    H.openedBy = "otra-recepcionista";
    await renderLayout();
    expect(screen.queryByText(/Campana con/)).toBeNull();
  });
});
