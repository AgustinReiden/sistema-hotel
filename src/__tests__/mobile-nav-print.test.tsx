import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/comprobante-cc/1",
  useSearchParams: () => new URLSearchParams(),
}));
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
    // Por etiqueta y atributo, no con getByRole sobre toda la pantalla: getByRole calcula
    // el rol de cada elemento y llama a getComputedStyle de jsdom por cada ancestro, y con
    // la suite entera en paralelo este test solo tardaba cerca de un segundo (PR #131).
    const barras = document.body.querySelectorAll("header");
    expect(barras).toHaveLength(1);
    expect(barras[0]).toHaveClass("print:hidden");
    const accesos = document.body.querySelectorAll('nav[aria-label="Accesos de recepción"]');
    expect(accesos).toHaveLength(1);
    expect(accesos[0]).toHaveClass("print:hidden");
  });
});
