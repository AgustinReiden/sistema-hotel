import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/comprobante-cc/1" }));
vi.mock("@/app/admin/LogoutButton", () => ({ default: () => null }));

import { MobileTabBar, MobileTopBar } from "@/app/admin/MobileNav";

// Los comprobantes térmicos se abren en una ventana de 420 px, así que se imprimen con
// el panel en versión celular. Lo que no tenga print:hidden (o sea aside/nav) sale en
// el papel de la comandera: la barra de arriba salía en todos los tickets.
describe("barras del panel en el celular, al imprimir", () => {
  it("ninguna de las dos sale en el papel", () => {
    render(
      <>
        <MobileTopBar role="admin" userEmail="admin@example.com" hasOpenShift unbilledCount={0} />
        <MobileTabBar hasOpenShift />
      </>
    );
    expect(screen.getByRole("banner")).toHaveClass("print:hidden");
    expect(screen.getByRole("navigation", { name: "Accesos de recepción" })).toHaveClass("print:hidden");
  });
});
