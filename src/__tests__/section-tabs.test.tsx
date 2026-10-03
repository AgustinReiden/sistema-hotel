import { render, within } from "@testing-library/react";
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

/** La barra de arriba, o null si no se dibujó. */
function barra(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-admin-topbar]");
}

/** El link de una pestaña, por su texto, dentro de la barra. */
function pestana(container: HTMLElement, texto: string) {
  return within(barra(container)!).getByText(texto).closest("a")!;
}

beforeEach(() => en("/admin"));

describe("barra de arriba con las pestañas de la sección", () => {
  it("en Facturación el dueño ve las 4 pestañas y 'Con error' es la actual", () => {
    en("/admin/fiscal?view=pendientes");
    const { container } = render(<AdminTopBar role="admin" />);

    const links = barra(container)!.querySelectorAll("a");
    expect(links).toHaveLength(4);
    for (const t of ["Por facturar", "Con error", "Emitidas", "Remitos"]) {
      expect(within(barra(container)!).getByText(t)).toBeInTheDocument();
    }
    expect(pestana(container, "Con error")).toHaveAttribute("aria-current", "page");
    expect(pestana(container, "Emitidas")).not.toHaveAttribute("aria-current");
    expect(barra(container)!.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("el nombre de la sección va a la izquierda", () => {
    en("/admin/fiscal?view=emitidas");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(within(barra(container)!).getByText("Facturación")).toBeInTheDocument();
  });

  it("recepción en Facturación tiene una sola pestaña: no se dibuja la fila", () => {
    en("/admin/fiscal?view=pendientes");
    const { container } = render(<AdminTopBar role="receptionist" />);
    expect(barra(container)).toBeNull();
  });

  it("Hoy tiene una sola pestaña: no se dibuja la fila", () => {
    en("/admin");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(barra(container)).toBeNull();
  });

  it("en un comprobante para imprimir no hay barra", () => {
    en("/admin/recibo/1");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(barra(container)).toBeNull();
  });

  it("no sale en el papel al imprimir", () => {
    en("/admin/fiscal?view=emitidas");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(barra(container)).toHaveClass("print:hidden");
  });

  it("en el celular la fila de pestañas scrollea hacia el costado", () => {
    en("/admin/fiscal?view=emitidas");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(barra(container)!.querySelector("nav")).toHaveClass("overflow-x-auto");
  });

  it("en el Tablero, pasar de General a Por habitación conserva el rango", () => {
    en("/admin/analytics?from=2026-09-01&to=2026-09-10");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(pestana(container, "General")).toHaveAttribute("aria-current", "page");
    const href = pestana(container, "Por habitación").getAttribute("href")!;
    const [ruta, query] = href.split("?");
    expect(ruta).toBe("/admin/analytics/habitaciones");
    const params = new URLSearchParams(query);
    expect(params.get("from")).toBe("2026-09-01");
    expect(params.get("to")).toBe("2026-09-10");
  });

  it("en Facturación, pasar de Con error a Emitidas conserva el período, el tipo y la búsqueda", () => {
    en("/admin/fiscal?view=pendientes&desde=2026-09-01&hasta=2026-09-10&tipo=6&q=prueba");
    const { container } = render(<AdminTopBar role="admin" />);
    const href = pestana(container, "Emitidas").getAttribute("href")!;
    const [ruta, query] = href.split("?");
    expect(ruta).toBe("/admin/fiscal");
    const params = new URLSearchParams(query);
    // La solapa es la de destino, no la de origen.
    expect(params.get("view")).toBe("emitidas");
    expect(params.get("desde")).toBe("2026-09-01");
    expect(params.get("hasta")).toBe("2026-09-10");
    expect(params.get("tipo")).toBe("6");
    expect(params.get("q")).toBe("prueba");
  });

  it("en Facturación, Por facturar conserva el período pero no el tipo ni la búsqueda", () => {
    en("/admin/fiscal?view=emitidas&desde=2026-09-01&hasta=2026-09-10&tipo=6&q=prueba");
    const { container } = render(<AdminTopBar role="admin" />);
    const [ruta, query] = pestana(container, "Por facturar").getAttribute("href")!.split("?");
    expect(ruta).toBe("/admin/fiscal/control");
    const params = new URLSearchParams(query);
    expect(params.get("desde")).toBe("2026-09-01");
    expect(params.get("hasta")).toBe("2026-09-10");
    expect(params.has("tipo")).toBe(false);
    expect(params.has("q")).toBe(false);
  });

  it("en Reservas, pasar de Por llegar a Historial conserva la búsqueda, el período y el orden", () => {
    en("/admin/guests?view=por_llegar&q=gomez&desde=2026-09-01&hasta=2026-09-10&orden=nombre&page=3");
    const { container } = render(<AdminTopBar role="admin" />);
    const [ruta, query] = pestana(container, "Historial").getAttribute("href")!.split("?");
    expect(ruta).toBe("/admin/guests");
    const params = new URLSearchParams(query);
    expect(params.get("view")).toBe("historial");
    expect(params.get("q")).toBe("gomez");
    expect(params.get("desde")).toBe("2026-09-01");
    expect(params.get("hasta")).toBe("2026-09-10");
    expect(params.get("orden")).toBe("nombre");
    expect(params.has("page")).toBe(false);
  });

  it("sin rango en la URL, los links quedan limpios", () => {
    en("/admin/analytics");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(pestana(container, "Por habitación")).toHaveAttribute("href", "/admin/analytics/habitaciones");
  });

  it("no arrastra parámetros que la pestaña no declara", () => {
    en("/admin/analytics?from=2026-09-01&to=2026-09-10&page=3");
    const { container } = render(<AdminTopBar role="admin" />);
    expect(pestana(container, "Por habitación").getAttribute("href")).not.toContain("page");
    // Cobros del día no lee el rango del Tablero.
    expect(pestana(container, "Cobros del día")).toHaveAttribute("href", "/admin/finances");
  });

  it("lleva los numeritos de cada pestaña", () => {
    en("/admin/fiscal?view=emitidas");
    const { container } = render(
      <AdminTopBar role="admin" unbilledCount={5} remitosPendientes={3} facturasConError={2} />
    );
    expect(within(pestana(container, "Por facturar")).getByText("5")).toBeInTheDocument();
    expect(within(pestana(container, "Con error")).getByText("2")).toBeInTheDocument();
    expect(within(pestana(container, "Remitos")).getByText("3")).toBeInTheDocument();
  });

  it("dibuja lo que se le pone en el lugar de las acciones", () => {
    en("/admin/fiscal?view=emitidas");
    const { container } = render(<AdminTopBar role="admin" actions={<span>Acción de prueba</span>} />);
    expect(within(barra(container)!).getByText("Acción de prueba")).toBeInTheDocument();
  });
});
