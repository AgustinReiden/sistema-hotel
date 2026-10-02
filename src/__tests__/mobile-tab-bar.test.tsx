import { fireEvent, render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ pathname: "/admin", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => H.pathname,
  useSearchParams: () => new URLSearchParams(H.search),
}));
vi.mock("@/app/admin/LogoutButton", () => ({ default: () => null }));

import { MobileTabBar, MobileTopBar } from "@/app/admin/MobileNav";
import { MobileMenuProvider } from "@/app/admin/MobileMenuContext";

function en(url: string) {
  const [pathname, search = ""] = url.split("?");
  H.pathname = pathname;
  H.search = search;
}

function barra(): HTMLElement {
  return document.body.querySelector('nav[aria-label="Accesos rápidos"]') as HTMLElement;
}

/** El link de la barra que lleva ese texto. */
function acceso(texto: string) {
  return within(barra()).getByText(texto).closest("a");
}

function etiquetasDeLinks() {
  return Array.from(barra().querySelectorAll("a")).map((a) => a.textContent?.trim());
}

function renderBarra(role: string, extra: Record<string, unknown> = {}) {
  return render(
    <MobileMenuProvider>
      <MobileTabBar role={role} {...extra} />
    </MobileMenuProvider>
  );
}

beforeEach(() => en("/admin"));

describe("barra inferior del celular, según el rol", () => {
  it("recepción: Hoy, Reservas, Caja y Facturación, y nada más", () => {
    renderBarra("receptionist");
    expect(etiquetasDeLinks()).toEqual(["Hoy", "Reservas", "Caja", "Facturación"]);
    expect(barra().querySelector("button")).toBeNull();
    expect(barra()).toHaveClass("grid-cols-4");
  });

  it("el dueño: Hoy, Reservas, Caja y Tablero, y el botón Más", () => {
    renderBarra("admin");
    expect(etiquetasDeLinks()).toEqual(["Hoy", "Reservas", "Caja", "Tablero"]);
    const mas = within(barra()).getByText("Más").closest("button");
    expect(mas).not.toBeNull();
    expect(mas).toHaveAttribute("aria-haspopup", "dialog");
    expect(barra()).toHaveClass("grid-cols-5");
  });

  it("no sale en el papel y se llama Accesos rápidos", () => {
    renderBarra("admin");
    expect(barra()).toHaveClass("print:hidden");
  });

  it("cada acceso lleva a la primera pantalla de su sección", () => {
    renderBarra("admin");
    expect(acceso("Hoy")).toHaveAttribute("href", "/admin");
    expect(acceso("Reservas")).toHaveAttribute("href", "/admin/calendario");
    expect(acceso("Caja")).toHaveAttribute("href", "/admin/caja");
    expect(acceso("Tablero")).toHaveAttribute("href", "/admin/analytics");
  });
});

describe("barra inferior del celular: cuál queda marcada", () => {
  it("en Hoy, solo Hoy", () => {
    renderBarra("receptionist");
    expect(acceso("Hoy")).toHaveAttribute("aria-current", "page");
    expect(acceso("Reservas")).not.toHaveAttribute("aria-current");
  });

  it("en Por llegar (/admin/guests?view=por_llegar) queda marcada Reservas", () => {
    en("/admin/guests?view=por_llegar");
    renderBarra("admin");
    expect(acceso("Reservas")).toHaveAttribute("aria-current", "page");
    expect(acceso("Hoy")).not.toHaveAttribute("aria-current");
  });

  it("en una pantalla de otra sección del dueño (Clientes) no marca ningún link y resalta Más", () => {
    en("/admin/cuentas");
    renderBarra("admin");
    expect(barra().querySelector("[aria-current]")).toBeNull();
    expect(within(barra()).getByText("Más").closest("button")).toHaveClass("text-emerald-400");
  });

  it("en el Tablero (admin) queda marcado Tablero", () => {
    en("/admin/analytics/habitaciones");
    renderBarra("admin");
    expect(acceso("Tablero")).toHaveAttribute("aria-current", "page");
  });

  it("en Facturación (recepción) queda marcada Facturación", () => {
    en("/admin/fiscal?view=pendientes");
    renderBarra("receptionist");
    expect(acceso("Facturación")).toHaveAttribute("aria-current", "page");
  });
});

describe("barra inferior del celular: el punto de Caja", () => {
  it("con turno abierto el punto es verde", () => {
    renderBarra("receptionist", { hasOpenShift: true });
    const punto = acceso("Caja")!.querySelector("span[title]");
    expect(punto).toHaveAttribute("title", "Turno abierto");
    expect(punto).toHaveClass("bg-emerald-400");
  });

  it("sin turno el punto es ámbar", () => {
    renderBarra("receptionist", { hasOpenShift: false });
    const punto = acceso("Caja")!.querySelector("span[title]");
    expect(punto).toHaveAttribute("title", "Sin turno");
    expect(punto).toHaveClass("bg-amber-400");
  });

  it("las facturas que no salieron ponen un punto rojo en Facturación", () => {
    renderBarra("receptionist", { facturasConError: 2 });
    const punto = acceso("Facturación")!.querySelector("span[title]");
    expect(punto).toHaveAttribute("title", "2 facturas no salieron");
    expect(punto).toHaveClass("bg-rose-400");
  });
});

describe("el botón Más y el cajón de la hamburguesa", () => {
  const cajon = () => document.body.querySelector('nav[aria-label="Menú del panel"]');

  it("Más, junto a la barra de arriba, abre el mismo menú que la hamburguesa", () => {
    render(
      <MobileMenuProvider>
        <MobileTopBar role="admin" userEmail="admin@example.com" />
        <MobileTabBar role="admin" />
      </MobileMenuProvider>
    );
    expect(cajon()).toBeNull();
    fireEvent.click(within(barra()).getByText("Más").closest("button")!);
    expect(cajon()).not.toBeNull();
    // Y con el cajón abierto se cierra como siempre.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cajon()).toBeNull();
  });

  it("la hamburguesa sigue abriendo el cajón", () => {
    render(
      <MobileMenuProvider>
        <MobileTopBar role="admin" userEmail="admin@example.com" />
        <MobileTabBar role="admin" />
      </MobileMenuProvider>
    );
    fireEvent.click(document.body.querySelector('[aria-label="Abrir menú"]')!);
    expect(cajon()).not.toBeNull();
  });

  it("el cajón se cierra solo al pasar a otra pantalla", () => {
    const { rerender } = render(
      <MobileMenuProvider>
        <MobileTopBar role="admin" userEmail="admin@example.com" />
        <MobileTabBar role="admin" />
      </MobileMenuProvider>
    );
    fireEvent.click(within(barra()).getByText("Más").closest("button")!);
    expect(cajon()).not.toBeNull();
    en("/admin/caja");
    rerender(
      <MobileMenuProvider>
        <MobileTopBar role="admin" userEmail="admin@example.com" />
        <MobileTabBar role="admin" />
      </MobileMenuProvider>
    );
    expect(cajon()).toBeNull();
  });
});
