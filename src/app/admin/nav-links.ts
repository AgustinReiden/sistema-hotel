import {
  AlertTriangle,
  BarChart3,
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  FileText,
  HandCoins,
  History,
  LayoutDashboard,
  Percent,
  Receipt,
  Settings,
  Signature,
  Sparkles,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// Fuente única del menú del panel. Lo consumen el menú lateral de escritorio, el cajón
// del celular y la barra inferior (los tres, componentes de cliente). Es un módulo de
// datos y no JSX a propósito: cada componente lo importa directo, así el icono nunca
// viaja como prop de servidor a cliente (eso no se puede serializar).
//
// El menú son secciones con pestañas, y cada pestaña es una pantalla que ya existe: no
// cambia ninguna URL. Qué pestaña está activa lo decide `findActiveNav` a partir de la
// ruta y los parámetros, así un marcador viejo (/admin/cuentas, /admin/fiscal?view=
// emitidas) abre la misma pantalla con su sección marcada.

export type NavBadge = {
  text: string;
  tone: "ok" | "warn" | "alert";
  title: string;
  /**
   * Hay que resolverlo ya: con la sección cerrada, a igual color le gana a los otros
   * numeritos. Es para que un número que casi nunca baja a cero (lo que falta facturar)
   * no tape las facturas que no salieron.
   */
  urgent?: boolean;
};

/** Qué URLs marcan una pestaña como la pantalla actual. */
export type NavMatch = {
  /** Esa ruta y todo lo que cuelga de ella (salvo `exact`). */
  path: string;
  /** Solo la ruta exacta: para "/admin", del que cuelga todo el panel. */
  exact?: boolean;
  /**
   * Pestañas distintas sobre la misma pantalla (?view=): compara el valor. La que es
   * `isDefault` vale también sin el parámetro o con un valor que ninguna otra pestaña
   * reconoce, igual que la pantalla, que con un ?view= desconocido cae en su solapa
   * por defecto.
   */
  param?: { name: string; value: string; isDefault?: boolean };
};

export type NavTab = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  match: NavMatch[];
  /** Solo la ve el dueño. `getNavSections` ya las saca para recepción. */
  adminOnly?: boolean;
  badge?: NavBadge;
};

export type NavSectionId = "hoy" | "reservas" | "caja" | "facturacion" | "clientes" | "tablero" | "configuracion";

export type NavSection = {
  id: NavSectionId;
  label: string;
  icon: LucideIcon;
  tabs: NavTab[];
  adminOnly?: boolean;
  /** El icono queda resaltado aunque no haya badge (turno abierto). */
  highlighted?: boolean;
};

/** Datos que el layout calcula en el servidor y que definen los avisos del menú. */
export type NavState = {
  hasOpenShift?: boolean;
  /** Lo que falta facturar más lo que espera la consolidada (solo el dueño). */
  unbilledCount?: number;
  /** Remitos a revisar + vencidos + piezas sin resolver: `remitosParaRevisar(salud).total`. */
  remitosPendientes?: number;
  /** Reservas web sin responder. */
  solicitudesPendientes?: number;
  /** `facturasConError(filas, ahora).length`: rechazadas o trabadas más de 15 minutos. */
  facturasConError?: number;
};

function countBadge(count: number, tone: NavBadge["tone"], title: string, urgent = false): NavBadge | undefined {
  return count > 0 ? { text: String(count), tone, title, urgent } : undefined;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** El menú entero, con las etiquetas y los avisos del rol; `getNavSections` lo filtra. */
function todasLasSecciones(role: string, state: NavState): NavSection[] {
  const isAdmin = role === "admin";
  const {
    hasOpenShift = false,
    unbilledCount = 0,
    remitosPendientes = 0,
    solicitudesPendientes = 0,
    facturasConError = 0,
  } = state;

  return [
    {
      id: "hoy",
      label: "Hoy",
      icon: CalendarCheck,
      tabs: [{ id: "hoy", label: "Hoy", href: "/admin", icon: CalendarCheck, match: [{ path: "/admin", exact: true }] }],
    },
    {
      id: "reservas",
      label: "Reservas",
      icon: CalendarDays,
      tabs: [
        {
          id: "calendario",
          label: "Calendario",
          href: "/admin/calendario",
          icon: CalendarDays,
          match: [{ path: "/admin/calendario" }],
        },
        {
          id: "solicitudes",
          label: "Solicitudes",
          href: "/admin/solicitudes",
          icon: ClipboardList,
          match: [{ path: "/admin/solicitudes" }],
          badge: countBadge(
            solicitudesPendientes,
            "warn",
            plural(solicitudesPendientes, "solicitud sin responder", "solicitudes sin responder")
          ),
        },
        {
          // Solo del dueño hasta F1-8, que se la abre a recepción en solo lectura.
          id: "por_llegar",
          label: "Por llegar",
          href: "/admin/guests?view=por_llegar",
          icon: UserCheck,
          adminOnly: true,
          match: [{ path: "/admin/guests", exact: true, param: { name: "view", value: "por_llegar" } }],
        },
        {
          id: "historial",
          label: "Historial",
          href: "/admin/guests?view=historial",
          icon: History,
          adminOnly: true,
          match: [{ path: "/admin/guests", exact: true, param: { name: "view", value: "historial" } }],
        },
      ],
    },
    {
      id: "caja",
      label: "Caja",
      icon: CircleDollarSign,
      highlighted: hasOpenShift,
      tabs: [
        {
          id: "turno",
          label: isAdmin ? "Turno" : "Mi turno",
          href: "/admin/caja",
          icon: CircleDollarSign,
          match: [{ path: "/admin/caja" }],
          badge: hasOpenShift
            ? { text: "ABIERTA", tone: "ok", title: "Turno abierto" }
            : { text: "CERRADA", tone: "warn", title: "Sin turno" },
        },
        {
          id: "rendiciones",
          label: isAdmin ? "Rendiciones" : "Mis rendiciones",
          href: "/admin/caja/rendiciones",
          icon: Receipt,
          match: [{ path: "/admin/caja/rendiciones" }],
        },
      ],
    },
    {
      id: "facturacion",
      label: "Facturación",
      icon: FileText,
      tabs: [
        {
          // /admin/fiscal sin solapa le muestra al dueño "Sin facturar", que es lo mismo
          // que esta pestaña: por eso marca acá hasta que F1-7 lo unifique.
          id: "por_facturar",
          label: "Por facturar",
          href: "/admin/fiscal/control",
          icon: ClipboardCheck,
          adminOnly: true,
          match: [
            { path: "/admin/fiscal/control" },
            { path: "/admin/fiscal/consolidada" },
            { path: "/admin/fiscal", exact: true, param: { name: "view", value: "sin_facturar", isDefault: true } },
          ],
          // Sin ventana en el texto: el número es de todo el historial, y es el mismo que
          // muestra el control al abrir.
          badge: countBadge(unbilledCount, "alert", plural(unbilledCount, "estadía sin facturar", "estadías sin facturar")),
        },
        {
          // Recepción tiene solo esta solapa: /admin/fiscal le abre esto con cualquier ?view=.
          id: "con_error",
          label: "Con error",
          href: "/admin/fiscal?view=pendientes",
          icon: AlertTriangle,
          match: [{ path: "/admin/fiscal", exact: true, param: { name: "view", value: "pendientes", isDefault: !isAdmin } }],
          // Urgente: con Facturación cerrada, le gana al rojo de Por facturar.
          badge: countBadge(
            facturasConError,
            "alert",
            plural(facturasConError, "factura no salió", "facturas no salieron"),
            true
          ),
        },
        {
          id: "emitidas",
          label: "Emitidas",
          href: "/admin/fiscal?view=emitidas",
          icon: FileCheck,
          adminOnly: true,
          match: [{ path: "/admin/fiscal", exact: true, param: { name: "view", value: "emitidas" } }],
        },
        {
          id: "remitos",
          label: "Remitos",
          href: "/admin/remitos",
          icon: Signature,
          adminOnly: true,
          match: [{ path: "/admin/remitos" }],
          // Es el total de la línea "Para revisar" del panel, de todo el historial: lo que
          // dice el menú es lo que se ve al abrir.
          badge: countBadge(remitosPendientes, "warn", `Para revisar: ${remitosPendientes}`),
        },
      ],
    },
    {
      id: "clientes",
      label: "Clientes",
      icon: Users,
      adminOnly: true,
      tabs: [
        {
          id: "directorio",
          label: "Directorio",
          href: "/admin/guests",
          icon: Users,
          match: [{ path: "/admin/guests", exact: true, param: { name: "view", value: "directorio", isDefault: true } }],
        },
        {
          id: "empresas",
          label: "Empresas y convenios",
          href: "/admin/asociados",
          icon: Building2,
          match: [{ path: "/admin/asociados" }],
        },
        {
          // HandCoins y no el de Caja: son dos cosas distintas (fiar no es cobrar).
          id: "cuenta_corriente",
          label: "Cuenta corriente",
          href: "/admin/cuentas",
          icon: HandCoins,
          match: [{ path: "/admin/cuentas" }],
        },
        {
          id: "descuentos",
          label: "Descuentos",
          href: "/admin/descuentos",
          icon: Percent,
          match: [{ path: "/admin/descuentos" }],
        },
      ],
    },
    {
      id: "tablero",
      label: "Tablero",
      icon: BarChart3,
      adminOnly: true,
      tabs: [
        {
          id: "general",
          label: "General",
          href: "/admin/analytics",
          icon: LayoutDashboard,
          match: [{ path: "/admin/analytics" }],
        },
        {
          id: "por_habitacion",
          label: "Por habitación",
          href: "/admin/analytics/habitaciones",
          icon: BedDouble,
          match: [{ path: "/admin/analytics/habitaciones" }],
        },
        {
          id: "cobros",
          label: "Cobros del día",
          href: "/admin/finances",
          icon: Wallet,
          match: [{ path: "/admin/finances" }],
        },
        {
          id: "limpiezas",
          label: "Limpiezas",
          href: "/admin/mantenimiento",
          icon: Sparkles,
          match: [{ path: "/admin/mantenimiento" }],
        },
      ],
    },
    {
      id: "configuracion",
      label: "Configuración",
      icon: Settings,
      adminOnly: true,
      tabs: [
        {
          id: "ajustes",
          label: "Ajustes",
          href: "/admin/settings",
          icon: Settings,
          match: [{ path: "/admin/settings" }],
        },
        {
          id: "habitaciones",
          label: "Habitaciones y tarifas",
          href: "/admin/rooms",
          icon: BedDouble,
          match: [{ path: "/admin/rooms" }, { path: "/admin/categorias" }],
        },
      ],
    },
  ];
}

/**
 * El menú según el rol: el dueño ve 7 secciones y recepción 4 (Hoy, Reservas, Caja y
 * Facturación, esta última solo con "Con error").
 */
export function getNavSections(role: string, state: NavState = {}): NavSection[] {
  const isAdmin = role === "admin";
  return todasLasSecciones(role, state)
    .filter((s) => isAdmin || !s.adminOnly)
    .map((s) => ({ ...s, tabs: s.tabs.filter((t) => isAdmin || !t.adminOnly) }))
    .filter((s) => s.tabs.length > 0);
}

/** Adónde lleva tocar la sección: su primera pestaña. */
export function sectionHref(section: NavSection): string {
  return section.tabs[0]?.href ?? "/admin";
}

const TONE_RANK: Record<NavBadge["tone"], number> = { alert: 3, warn: 2, ok: 1 };

/** Manda el color; `urgent` solo desempata dentro del mismo color, nunca salta uno. */
const badgeRank = (b: NavBadge) => TONE_RANK[b.tone] * 2 + (b.urgent ? 1 : 0);

/**
 * El aviso que muestra la sección cuando sus pestañas no están a la vista: el más
 * urgente (rojo antes que ámbar, ámbar antes que verde; a igual color, el `urgent`,
 * como las facturas que no salieron frente a lo que falta facturar); si siguen
 * empatados, el primero.
 */
export function sectionBadge(section: NavSection): NavBadge | undefined {
  let best: NavBadge | undefined;
  for (const tab of section.tabs) {
    if (tab.badge && (!best || badgeRank(tab.badge) > badgeRank(best))) best = tab.badge;
  }
  return best;
}

export type ActiveNav = { section: NavSection; tab: NavTab };

type SearchParamsLike = { get(name: string): string | null };

function pathMatches(m: NavMatch, pathname: string): boolean {
  if (pathname === m.path) return true;
  return !m.exact && pathname.startsWith(`${m.path}/`);
}

/**
 * La pestaña de la pantalla actual, o null si no es ninguna (un recibo para imprimir).
 * Gana la ruta más larga; sobre la misma ruta, la que coincide con el parámetro le gana
 * a la que vale por defecto.
 */
export function findActiveNav(
  sections: NavSection[],
  pathname: string,
  searchParams?: SearchParamsLike | null
): ActiveNav | null {
  // Valores de cada parámetro que alguna pestaña reconoce, por ruta: lo que no esté acá
  // cae en la pestaña por defecto.
  const known = new Map<string, Set<string>>();
  for (const s of sections) {
    for (const t of s.tabs) {
      for (const m of t.match) {
        if (!m.param) continue;
        const key = `${m.path}?${m.param.name}`;
        if (!known.has(key)) known.set(key, new Set());
        known.get(key)!.add(m.param.value);
      }
    }
  }

  let best: (ActiveNav & { score: number }) | null = null;
  for (const section of sections) {
    for (const tab of section.tabs) {
      for (const m of tab.match) {
        if (!pathMatches(m, pathname)) continue;
        let paramScore = 0;
        if (m.param) {
          const value = searchParams?.get(m.param.name) ?? null;
          if (value === m.param.value) {
            paramScore = 2;
          } else if (m.param.isDefault && (!value || !known.get(`${m.path}?${m.param.name}`)?.has(value))) {
            paramScore = 1;
          } else {
            continue;
          }
        }
        const score = m.path.length * 4 + paramScore;
        if (!best || score > best.score) best = { section, tab, score };
      }
    }
  }
  return best ? { section: best.section, tab: best.tab } : null;
}

// ─── Barra inferior del celular ────────────────────────────────────────────────
// Sigue con sus cinco accesos de siempre hasta F1-2, que la arma por sección y rol.

export type NavItem = {
  href: string;
  label: string;
  /** Etiqueta corta para la barra inferior del celular, donde entran ~11 caracteres. */
  shortLabel?: string;
  icon: LucideIcon;
  badge?: NavBadge;
  /** El icono queda resaltado aunque no haya badge (turno abierto). */
  highlighted?: boolean;
};

/**
 * Lo que recepción usa todos los días. Es también lo que va en la barra inferior del
 * celular: cinco accesos al alcance del pulgar, sin abrir ningún menú.
 */
export function getReceptionItems({ hasOpenShift }: NavState = {}): NavItem[] {
  return [
    { href: "/admin", label: "Dashboard Hoy", shortLabel: "Hoy", icon: CalendarCheck },
    { href: "/admin/calendario", label: "Calendario", icon: CalendarDays },
    { href: "/admin/solicitudes", label: "Solicitudes", icon: ClipboardList },
    {
      href: "/admin/caja",
      label: "Caja",
      icon: CircleDollarSign,
      highlighted: Boolean(hasOpenShift),
      badge: hasOpenShift
        ? { text: "ABIERTA", tone: "ok", title: "Turno abierto" }
        : { text: "CERRADA", tone: "warn", title: "Sin turno" },
    },
    { href: "/admin/fiscal", label: "Facturación", icon: FileText },
  ];
}

/**
 * ¿Este link es el de la pantalla actual? "/admin" tiene que comparar exacto: con
 * startsWith se prendería en todas las pantallas del panel, porque todas cuelgan de ahí.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
