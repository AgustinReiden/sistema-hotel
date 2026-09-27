import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ pathname: "/admin", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => H.pathname,
  useSearchParams: () => new URLSearchParams(H.search),
}));
vi.mock("@/app/admin/LogoutButton", () => ({ default: () => null }));

import Sidebar from "@/app/admin/Sidebar";
import { MobileTopBar } from "@/app/admin/MobileNav";

function en(url: string) {
  const [pathname, search = ""] = url.split("?");
  H.pathname = pathname;
  H.search = search;
}

/** El link (sección o pestaña) que lleva ese texto. */
function link(texto: string, scope: HTMLElement = document.body) {
  return within(scope).getByText(texto).closest("a");
}

beforeEach(() => en("/admin"));

describe("menú lateral de escritorio", () => {
  it("en /admin/cuentas queda marcada Clientes, con sus pestañas debajo", () => {
    en("/admin/cuentas");
    render(<Sidebar role="admin" userEmail="admin@example.com" />);
    expect(link("Clientes")).toHaveAttribute("aria-current", "page");
    expect(link("Cuenta corriente")).toHaveAttribute("aria-current", "page");
    expect(link("Directorio")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Empresas y convenios")).toBeInTheDocument();
    expect(screen.getByText("Descuentos")).toBeInTheDocument();
    // Las otras secciones no se marcan ni despliegan.
    expect(link("Hoy")).not.toHaveAttribute("aria-current");
    expect(screen.queryByText("Rendiciones")).toBeNull();
  });

  it("el dueño ve las 7 secciones", () => {
    render(<Sidebar role="admin" userEmail="admin@example.com" />);
    for (const s of ["Hoy", "Reservas", "Caja", "Facturación", "Clientes", "Tablero", "Configuración"]) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
    expect(link("Hoy")).toHaveAttribute("aria-current", "page");
  });

  it("recepción ve 4 secciones y no tiene Clientes", () => {
    en("/admin/caja/rendiciones/abc");
    render(<Sidebar role="receptionist" userEmail="" hasOpenShift />);
    for (const s of ["Hoy", "Reservas", "Caja", "Facturación"]) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
    for (const s of ["Clientes", "Tablero", "Configuración"]) {
      expect(screen.queryByText(s)).toBeNull();
    }
    expect(link("Caja")).toHaveAttribute("aria-current", "page");
    expect(link("Mis rendiciones")).toHaveAttribute("aria-current", "page");
    expect(link("Mi turno")).toHaveAttribute("href", "/admin/caja");
  });

  it("la sección abre su primera pestaña", () => {
    render(<Sidebar role="admin" userEmail="admin@example.com" />);
    expect(link("Facturación")).toHaveAttribute("href", "/admin/fiscal/control");
    expect(link("Clientes")).toHaveAttribute("href", "/admin/guests");
  });

  it("los numeritos: en la sección cerrada el más urgente, abierta cada uno en su pestaña", () => {
    render(<Sidebar role="admin" userEmail="admin@example.com" unbilledCount={5} remitosPendientes={3} />);
    expect(within(link("Facturación")!).getByText("5")).toBeInTheDocument();

    en("/admin/fiscal?view=emitidas");
    render(<Sidebar role="admin" userEmail="admin@example.com" unbilledCount={5} remitosPendientes={3} />);
    const menus = document.body.querySelectorAll("aside");
    const abierto = menus[menus.length - 1] as HTMLElement;
    expect(link("Emitidas", abierto)).toHaveAttribute("aria-current", "page");
    expect(within(link("Por facturar", abierto)!).getByText("5")).toBeInTheDocument();
    expect(within(link("Remitos", abierto)!).getByText("3")).toBeInTheDocument();
  });

  it("en un comprobante para imprimir no marca nada", () => {
    en("/admin/recibo/1");
    const { container } = render(<Sidebar role="admin" userEmail="admin@example.com" />);
    expect(container.querySelector("[aria-current]")).toBeNull();
  });
});

describe("cajón del celular", () => {
  function abrir() {
    fireEvent.click(screen.getByLabelText("Abrir menú"));
    return document.body.querySelector('nav[aria-label="Menú del panel"]') as HTMLElement;
  }

  it("lista las secciones con sus pestañas y marca la activa", () => {
    en("/admin/guests?view=por_llegar");
    render(<MobileTopBar role="admin" userEmail="admin@example.com" />);
    const cajon = abrir();
    expect(link("Reservas", cajon)).toHaveAttribute("aria-current", "page");
    expect(link("Por llegar", cajon)).toHaveAttribute("aria-current", "page");
    expect(link("Directorio", cajon)).not.toHaveAttribute("aria-current");
    // Las pestañas de las otras secciones también están, a un toque.
    expect(link("Cuenta corriente", cajon)).toHaveAttribute("href", "/admin/cuentas");
    expect(link("Limpiezas", cajon)).toHaveAttribute("href", "/admin/mantenimiento");
  });

  it("recepción no ve Clientes en el cajón", () => {
    render(<MobileTopBar role="receptionist" userEmail="" facturasConError={2} />);
    const cajon = abrir();
    expect(within(cajon).queryByText("Clientes")).toBeNull();
    expect(link("Hoy", cajon)).toHaveAttribute("aria-current", "page");
    // Facturación tiene una sola pestaña: la sección lleva el numerito.
    expect(within(link("Facturación", cajon)!).getByText("2")).toBeInTheDocument();
  });
});
