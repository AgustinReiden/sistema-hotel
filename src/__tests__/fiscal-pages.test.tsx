// Las dos pantallas de Facturación que se tocan con "Últimos 10 días": /admin/fiscal ya
// no tiene la solapa Sin facturar (redirige al control) y Por facturar hace el barrido
// de facturas trabadas que antes hacía solo /admin/fiscal.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, after, sweepStaleInvoices, data, isCurrentUserAdmin } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  after: vi.fn(),
  sweepStaleInvoices: vi.fn(() => Promise.resolve()),
  isCurrentUserAdmin: vi.fn(),
  data: {
    getCurrentUserRole: vi.fn(),
    getCtaCteAccounts: vi.fn(),
    listBillingControl: vi.fn(),
    getFiscalSettings: vi.fn(),
    getHotelSettings: vi.fn(),
    listAuthorizedInvoices: vi.fn(),
    listPendingInvoices: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/arca/emitter", () => ({ sweepStaleInvoices }));
vi.mock("@/lib/data", () => data);
vi.mock("@/lib/server-auth", () => ({ isCurrentUserAdmin }));
vi.mock("@/lib/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/time")>()),
  hotelDateKey: () => "2026-09-23",
}));
vi.mock("@/app/admin/PageShell", () => ({ PageHeader: () => null }));
vi.mock("@/app/admin/fiscal/FiscalClient", () => ({ default: () => null }));
vi.mock("@/app/admin/fiscal/control/ControlClient", () => ({ default: () => null }));

import ControlPage from "@/app/admin/fiscal/control/page";
import FiscalPage from "@/app/admin/fiscal/page";

beforeEach(() => {
  vi.clearAllMocks();
  isCurrentUserAdmin.mockResolvedValue(true);
  data.getCurrentUserRole.mockResolvedValue("admin");
  data.getCtaCteAccounts.mockResolvedValue([]);
  data.listBillingControl.mockResolvedValue([]);
  data.getFiscalSettings.mockResolvedValue({ enabled: true, environment: "produccion" });
  data.getHotelSettings.mockResolvedValue(null);
  data.listAuthorizedInvoices.mockResolvedValue([]);
  data.listPendingInvoices.mockResolvedValue([]);
});

const abrirFiscal = (params: { view?: string } = {}) => FiscalPage({ searchParams: Promise.resolve(params) });
const abrirControl = (params: Record<string, string> = {}) =>
  ControlPage({ searchParams: Promise.resolve(params) });

describe("/admin/fiscal sin la solapa Sin facturar", () => {
  it("un marcador viejo del dueño abre Por facturar con Últimos 10 días", async () => {
    await expect(abrirFiscal({ view: "sin_facturar" })).rejects.toThrow(
      "NEXT_REDIRECT /admin/fiscal/control?desde=2026-09-14&hasta=2026-09-23&estado=pendiente"
    );
    expect(redirect).toHaveBeenCalledWith(
      "/admin/fiscal/control?desde=2026-09-14&hasta=2026-09-23&estado=pendiente"
    );
  });

  it("la recepcionista con ese marcador no es redirigida: sigue en su Con error", async () => {
    isCurrentUserAdmin.mockResolvedValue(false);

    await abrirFiscal({ view: "sin_facturar" });

    expect(redirect).not.toHaveBeenCalled();
    expect(data.listPendingInvoices).toHaveBeenCalledTimes(1);
  });

  it("el dueño sin ?view= ve Con error", async () => {
    await abrirFiscal();

    expect(redirect).not.toHaveBeenCalled();
    expect(data.listPendingInvoices).toHaveBeenCalledTimes(1);
    expect(data.listAuthorizedInvoices).not.toHaveBeenCalled();
  });

  it("el barrido de facturas trabadas sigue corriendo para el dueño y no para recepción", async () => {
    await abrirFiscal({ view: "emitidas" });
    expect(after).toHaveBeenCalledTimes(1);

    after.mockClear();
    isCurrentUserAdmin.mockResolvedValue(false);
    await abrirFiscal({ view: "emitidas" });
    expect(after).not.toHaveBeenCalled();
  });
});

describe("/admin/fiscal/control (Por facturar) hace el barrido de facturas trabadas", () => {
  it("el dueño lo dispara sin bloquear el render", async () => {
    await abrirControl();

    expect(sweepStaleInvoices).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("recepción va a /forbidden y no dispara nada", async () => {
    data.getCurrentUserRole.mockResolvedValue("receptionist");

    await expect(abrirControl()).rejects.toThrow("NEXT_REDIRECT /forbidden");

    expect(sweepStaleInvoices).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
