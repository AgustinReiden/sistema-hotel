import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ pathname: "/admin", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => H.pathname,
  useSearchParams: () => new URLSearchParams(H.search),
}));

import AdminTopBar from "@/app/admin/AdminTopBar";

function en(url: string) {
  const [pathname, search = ""] = url.split("?");
  H.pathname = pathname;
  H.search = search;
}

const barra = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-admin-topbar]");
const campana = <span>Campana</span>;

beforeEach(() => en("/admin"));

// La campana del admin va a la derecha de la barra de arriba (F1-3). En una sección de una
// sola pestaña, la fila existe solo por la campana: en el celular quedaría vacía (allá la
// campana va en la barra negra, al lado de la hamburguesa), así que ahí no se dibuja.
describe("barra de arriba con la campana del admin", () => {
  it("en Hoy (una sola pestaña) se dibuja con la campana, pero solo en el escritorio", () => {
    const { container } = render(<AdminTopBar role="admin" actions={campana} />);
    expect(barra(container)).not.toBeNull();
    expect(barra(container)).toHaveTextContent("Campana");
    expect(barra(container)).toHaveClass("hidden", "md:flex");
  });

  it("con pestañas se dibuja en todos los tamaños", () => {
    en("/admin/fiscal?view=emitidas");
    const { container } = render(<AdminTopBar role="admin" actions={campana} />);
    expect(barra(container)).toHaveClass("flex");
    expect(barra(container)).not.toHaveClass("hidden");
    expect(barra(container)).toHaveTextContent("Campana");
  });

  it("en un comprobante para imprimir no hay barra ni campana", () => {
    en("/admin/recibo/1");
    const { container } = render(<AdminTopBar role="admin" actions={campana} />);
    expect(barra(container)).toBeNull();
  });
});
