import { describe, expect, it } from "vitest";

import {
  findActiveNav,
  getNavSections,
  sectionBadge,
  sectionHref,
  type NavSection,
  type NavState,
} from "@/app/admin/nav-links";

const tabsDe = (role: string, state: NavState = {}) => getNavSections(role, state).flatMap((s) => s.tabs);

/** "seccion/pestaña" activa para una URL, o null si ninguna. */
function activo(sections: NavSection[], url: string): string | null {
  const u = new URL(url, "http://hotel.test");
  const r = findActiveNav(sections, u.pathname, u.searchParams);
  return r ? `${r.section.id}/${r.tab.id}` : null;
}

describe("menu: remitos firmados", () => {
  it("el admin lo ve con el numerito de pendientes; recepcion no lo ve", () => {
    const admin = tabsDe("admin", { remitosPendientes: 3 });
    const remitos = admin.find((i) => i.href === "/admin/remitos");
    expect(remitos?.label).toBe("Remitos");
    expect(remitos?.badge?.text).toBe("3");
    const recepcion = tabsDe("receptionist", { remitosPendientes: 3 });
    expect(recepcion.find((i) => i.href === "/admin/remitos")).toBeUndefined();
  });

  it("sin pendientes no hay numerito", () => {
    const admin = tabsDe("admin", {});
    expect(admin.find((i) => i.href === "/admin/remitos")?.badge).toBeUndefined();
  });
});

describe("menu por secciones", () => {
  it("recepción ve exactamente Hoy, Reservas, Caja y Facturación", () => {
    expect(getNavSections("receptionist").map((s) => s.id)).toEqual(["hoy", "reservas", "caja", "facturacion"]);
    const ids = tabsDe("receptionist").map((t) => t.id);
    for (const oculta of ["historial", "emitidas", "por_facturar", "remitos"]) {
      expect(ids).not.toContain(oculta);
    }
    // Por llegar es la única pantalla de /admin/guests que recepción ve, en solo lectura.
    expect(ids).toContain("por_llegar");
    const facturacion = getNavSections("receptionist").find((s) => s.id === "facturacion");
    expect(facturacion?.tabs.map((t) => t.label)).toEqual(["Con error"]);
  });

  it("el dueño ve las 7 secciones, en orden", () => {
    expect(getNavSections("admin").map((s) => s.label)).toEqual([
      "Hoy",
      "Reservas",
      "Caja",
      "Facturación",
      "Clientes",
      "Tablero",
      "Configuración",
    ]);
  });

  it("cada sección del dueño tiene sus pestañas", () => {
    const labels = (id: string) => getNavSections("admin").find((s) => s.id === id)?.tabs.map((t) => t.label);
    expect(labels("reservas")).toEqual(["Calendario", "Solicitudes", "Por llegar", "Historial"]);
    expect(labels("caja")).toEqual(["Turno", "Rendiciones"]);
    expect(labels("facturacion")).toEqual(["Por facturar", "Con error", "Emitidas", "Remitos"]);
    expect(labels("clientes")).toEqual(["Directorio", "Empresas y convenios", "Cuenta corriente", "Descuentos"]);
    expect(labels("tablero")).toEqual(["General", "Por habitación", "Cobros del día", "Limpiezas"]);
    expect(labels("configuracion")).toEqual(["Ajustes", "Habitaciones y tarifas"]);
  });

  it("recepción ve su caja: Mi turno y Mis rendiciones", () => {
    const caja = getNavSections("receptionist").find((s) => s.id === "caja");
    expect(caja?.tabs.map((t) => t.label)).toEqual(["Mi turno", "Mis rendiciones"]);
    expect(getNavSections("receptionist").find((s) => s.id === "reservas")?.tabs.map((t) => t.label)).toEqual([
      "Calendario",
      "Solicitudes",
      "Por llegar",
    ]);
  });

  it("Caja y Cuenta corriente no comparten ícono", () => {
    const admin = getNavSections("admin");
    const caja = admin.find((s) => s.id === "caja");
    const cuentaCorriente = admin.flatMap((s) => s.tabs).find((t) => t.id === "cuenta_corriente");
    expect(caja?.icon).toBeDefined();
    expect(cuentaCorriente?.icon).toBeDefined();
    expect(cuentaCorriente?.icon).not.toBe(caja?.icon);
  });

  it("las URLs son las de siempre", () => {
    const hrefs = tabsDe("admin").map((t) => t.href);
    expect(hrefs).toEqual([
      "/admin",
      "/admin/calendario",
      "/admin/solicitudes",
      "/admin/guests?view=por_llegar",
      "/admin/guests?view=historial",
      "/admin/caja",
      "/admin/caja/rendiciones",
      "/admin/fiscal/control",
      "/admin/fiscal?view=pendientes",
      "/admin/fiscal?view=emitidas",
      "/admin/remitos",
      "/admin/guests",
      "/admin/asociados",
      "/admin/cuentas",
      "/admin/descuentos",
      "/admin/analytics",
      "/admin/analytics/habitaciones",
      "/admin/finances",
      "/admin/mantenimiento",
      "/admin/settings",
      "/admin/rooms",
    ]);
  });

  it("la sección abre su primera pestaña: Facturación va a Por facturar (dueño) o a Con error (recepción)", () => {
    const href = (role: string, id: string) => {
      const s = getNavSections(role).find((x) => x.id === id);
      return s ? sectionHref(s) : null;
    };
    expect(href("admin", "hoy")).toBe("/admin");
    expect(href("admin", "facturacion")).toBe("/admin/fiscal/control");
    expect(href("receptionist", "facturacion")).toBe("/admin/fiscal?view=pendientes");
    expect(href("admin", "clientes")).toBe("/admin/guests");
    expect(href("admin", "configuracion")).toBe("/admin/settings");
  });
});

describe("menu: numeritos", () => {
  it("solicitudes y facturas con error se ven en los dos roles", () => {
    for (const role of ["admin", "receptionist"]) {
      const tabs = tabsDe(role, { solicitudesPendientes: 2, facturasConError: 1 });
      expect(tabs.find((t) => t.id === "solicitudes")?.badge).toMatchObject({ text: "2", tone: "warn" });
      expect(tabs.find((t) => t.id === "con_error")?.badge).toMatchObject({ text: "1", tone: "alert" });
    }
  });

  it("en cero no hay numerito", () => {
    const tabs = tabsDe("admin", { solicitudesPendientes: 0, facturasConError: 0, unbilledCount: 0 });
    expect(tabs.find((t) => t.id === "solicitudes")?.badge).toBeUndefined();
    expect(tabs.find((t) => t.id === "con_error")?.badge).toBeUndefined();
    expect(tabs.find((t) => t.id === "por_facturar")?.badge).toBeUndefined();
  });

  it("la caja dice si el turno está abierto", () => {
    const abierta = getNavSections("receptionist", { hasOpenShift: true }).find((s) => s.id === "caja");
    expect(abierta && sectionBadge(abierta)).toMatchObject({ text: "ABIERTA", tone: "ok" });
    expect(abierta?.highlighted).toBe(true);
    const cerrada = getNavSections("receptionist", { hasOpenShift: false }).find((s) => s.id === "caja");
    expect(cerrada && sectionBadge(cerrada)).toMatchObject({ text: "CERRADA", tone: "warn" });
    expect(cerrada?.highlighted).toBe(false);
  });

  it("sectionBadge: lo rojo va antes que lo ámbar, aunque venga después", () => {
    const facturacion = getNavSections("admin", { remitosPendientes: 3, unbilledCount: 5 }).find(
      (s) => s.id === "facturacion"
    )!;
    expect(sectionBadge(facturacion)).toMatchObject({ text: "5", tone: "alert" });

    const inventada: NavSection = {
      ...facturacion,
      tabs: [
        { ...facturacion.tabs[0], badge: { text: "7", tone: "warn", title: "ámbar" } },
        { ...facturacion.tabs[1], badge: { text: "1", tone: "alert", title: "rojo" } },
      ],
    };
    expect(sectionBadge(inventada)).toMatchObject({ text: "1", tone: "alert" });

    const soloRemitos = getNavSections("admin", { remitosPendientes: 3 }).find((s) => s.id === "facturacion")!;
    expect(sectionBadge(soloRemitos)).toMatchObject({ text: "3", tone: "warn" });

    // El texto del numerito de Remitos no depende del singular o plural.
    const unoSolo = getNavSections("admin", { remitosPendientes: 1 }).find((s) => s.id === "facturacion")!;
    expect(sectionBadge(unoSolo)).toMatchObject({ text: "1", title: "Para revisar: 1" });

    const clientes = getNavSections("admin").find((s) => s.id === "clientes")!;
    expect(sectionBadge(clientes)).toBeUndefined();
  });

  it("sectionBadge: con los dos en rojo, las facturas que no salieron le ganan a lo que falta facturar", () => {
    // Lo que falta facturar casi nunca baja a cero: si ganara el primero, el dueño no
    // vería nunca las facturas rechazadas o trabadas con Facturación cerrada.
    const facturacion = getNavSections("admin", {
      unbilledCount: 286,
      facturasConError: 2,
      remitosPendientes: 4,
    }).find((s) => s.id === "facturacion")!;
    expect(sectionBadge(facturacion)).toMatchObject({ text: "2", tone: "alert", title: "2 facturas no salieron" });

    // Sin facturas con error, vuelve a mostrar lo que falta facturar.
    const sinError = getNavSections("admin", { unbilledCount: 286, facturasConError: 0 }).find(
      (s) => s.id === "facturacion"
    )!;
    expect(sectionBadge(sinError)).toMatchObject({ text: "286", tone: "alert" });

    // Urgente desempata dentro del color, pero no salta uno: un ámbar urgente no le gana al rojo.
    const inventada: NavSection = {
      ...facturacion,
      tabs: [
        { ...facturacion.tabs[0], badge: { text: "7", tone: "warn", title: "ámbar", urgent: true } },
        { ...facturacion.tabs[1], badge: { text: "1", tone: "alert", title: "rojo" } },
      ],
    };
    expect(sectionBadge(inventada)).toMatchObject({ text: "1", tone: "alert" });
  });
});

describe("findActiveNav", () => {
  const admin = getNavSections("admin");
  const recepcion = getNavSections("receptionist");

  it("/admin solo marca Hoy", () => {
    expect(activo(admin, "/admin")).toBe("hoy/hoy");
    expect(activo(recepcion, "/admin")).toBe("hoy/hoy");
  });

  it("gana la ruta más larga", () => {
    expect(activo(admin, "/admin/caja")).toBe("caja/turno");
    expect(activo(admin, "/admin/caja/rendiciones")).toBe("caja/rendiciones");
    expect(activo(admin, "/admin/caja/rendiciones/abc")).toBe("caja/rendiciones");
    expect(activo(recepcion, "/admin/caja/rendiciones/abc")).toBe("caja/rendiciones");
    expect(activo(admin, "/admin/analytics/habitaciones?from=2026-09-01&to=2026-09-10")).toBe("tablero/por_habitacion");
    expect(activo(admin, "/admin/analytics?from=2026-09-01")).toBe("tablero/general");
  });

  it("la consolidada y el control son Por facturar", () => {
    expect(activo(admin, "/admin/fiscal/consolidada?kind=company&id=x")).toBe("facturacion/por_facturar");
    expect(activo(admin, "/admin/fiscal/control?desde=2026-09-01")).toBe("facturacion/por_facturar");
  });

  it("categorías es Habitaciones y tarifas, dentro de Configuración", () => {
    expect(activo(admin, "/admin/categorias")).toBe("configuracion/habitaciones");
    expect(activo(admin, "/admin/rooms")).toBe("configuracion/habitaciones");
  });

  it("los comprobantes para imprimir no marcan ninguna sección", () => {
    expect(activo(admin, "/admin/recibo/1")).toBeNull();
    expect(activo(recepcion, "/admin/recibo/1")).toBeNull();
    expect(activo(admin, "/admin/comprobante-cc/1")).toBeNull();
    expect(activo(admin, "/admin/factura/1")).toBeNull();
  });

  it("los marcadores viejos abren la misma pantalla con su sección marcada", () => {
    expect(activo(admin, "/admin/cuentas")).toBe("clientes/cuenta_corriente");
    expect(activo(admin, "/admin/fiscal?view=emitidas")).toBe("facturacion/emitidas");
    expect(activo(admin, "/admin/asociados")).toBe("clientes/empresas");
    expect(activo(admin, "/admin/finances")).toBe("tablero/cobros");
    expect(activo(admin, "/admin/mantenimiento")).toBe("tablero/limpiezas");
    expect(activo(admin, "/admin/settings")).toBe("configuracion/ajustes");
  });

  it("con parámetro compara el valor, y la pestaña por defecto vale sin él", () => {
    expect(activo(admin, "/admin/guests")).toBe("clientes/directorio");
    expect(activo(admin, "/admin/guests?view=directorio&q=juan")).toBe("clientes/directorio");
    expect(activo(admin, "/admin/guests?view=por_llegar")).toBe("reservas/por_llegar");
    expect(activo(admin, "/admin/guests?view=historial&page=2")).toBe("reservas/historial");
    expect(activo(admin, "/admin/fiscal?view=pendientes")).toBe("facturacion/con_error");
  });

  it("/admin/fiscal sin solapa marca Con error para los dos roles", () => {
    expect(activo(admin, "/admin/fiscal")).toBe("facturacion/con_error");
    expect(activo(recepcion, "/admin/fiscal")).toBe("facturacion/con_error");
    // El alias de la solapa que ya no existe no marca Por facturar (la pantalla redirige
    // antes de dibujar); con un valor que ninguna pestaña reconoce, vale la de por defecto.
    expect(activo(admin, "/admin/fiscal?view=sin_facturar")).toBe("facturacion/con_error");
    // La pantalla le muestra a recepción su única solapa con cualquier ?view=.
    expect(activo(recepcion, "/admin/fiscal?view=emitidas")).toBe("facturacion/con_error");
  });

  it("recepción tiene marcada Por llegar y ninguna otra pantalla del dueño", () => {
    expect(activo(recepcion, "/admin/guests?view=por_llegar")).toBe("reservas/por_llegar");
    expect(activo(recepcion, "/admin/cuentas")).toBeNull();
    expect(activo(recepcion, "/admin/guests?view=historial")).toBeNull();
    expect(activo(recepcion, "/admin/remitos")).toBeNull();
  });

  it("sin searchParams también funciona", () => {
    expect(findActiveNav(admin, "/admin/guests", null)?.tab.id).toBe("directorio");
    expect(findActiveNav(admin, "/admin/solicitudes")?.section.id).toBe("reservas");
  });
});
