import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/admin/search-actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/admin/LogoutButton", () => ({ default: () => null }));

import AdminTopBar from "@/app/admin/AdminTopBar";
import { MobileTopBar } from "@/app/admin/MobileNav";
import { MobileMenuProvider } from "@/app/admin/MobileMenuContext";

// El buscador global (F1-5b) está en los dos roles: la caja en la barra de arriba del
// escritorio, al lado de la campana del admin, y la lupa en la barra negra del celular.
describe("el buscador en las barras del panel", () => {
  it.each(["admin", "receptionist"])("%s: la caja está en la barra de arriba, antes de la campana", (role) => {
    const { container } = render(<AdminTopBar role={role} actions={<span>Campana</span>} />);
    const barra = container.querySelector("[data-admin-topbar]")!;
    const caja = barra.querySelector("input[role='combobox']");
    expect(caja).not.toBeNull();
    // Solo se ve en el escritorio: en el celular manda la lupa.
    expect(caja!.closest(".hidden")).toHaveClass("md:block");
    const campana = Array.from(barra.querySelectorAll("span")).find((s) => s.textContent === "Campana")!;
    expect(caja!.compareDocumentPosition(campana) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["admin", "receptionist"])("%s: la barra del celular tiene la lupa", (role) => {
    const { container } = render(
      <MobileMenuProvider>
        <MobileTopBar role={role} userEmail="juan@example.com" hasOpenShift />
      </MobileMenuProvider>
    );
    const header = container.querySelector("header")!;
    expect(header.querySelector('[aria-label="Buscar"]')).not.toBeNull();
    // Todavía no abrió: la pantalla completa no está.
    expect(container.querySelector("[data-search-overlay]")).toBeNull();
  });
});
