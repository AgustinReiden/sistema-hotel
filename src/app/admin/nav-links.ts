import {
  BarChart3,
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Percent,
  Settings,
  Sparkles,
  Tags,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// Fuente única del menú del panel. Lo consumen tres componentes: el sidebar de escritorio
// (server), el cajón del celular y la barra inferior (ambos client). Es un módulo de datos
// y no JSX a propósito: cada componente lo importa directo, así el icono nunca viaja como
// prop de servidor a cliente (eso no se puede serializar).

export type NavBadge = {
  text: string;
  tone: "ok" | "warn" | "alert";
  title: string;
};

export type NavItem = {
  href: string;
  label: string;
  /** Etiqueta corta para la barra inferior del celular, donde entran ~11 caracteres. */
  shortLabel?: string;
  icon: LucideIcon;
  badge?: NavBadge;
  /** El icono queda resaltado aunque no haya badge (turno abierto, facturas pendientes). */
  highlighted?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/** Datos que el layout calcula en el servidor y que definen los avisos del menú. */
export type NavState = {
  hasOpenShift?: boolean;
  unbilledCount?: number;
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

function getAdminItems({ unbilledCount = 0 }: NavState = {}): NavItem[] {
  return [
    { href: "/admin/guests", label: "Huéspedes", icon: Users },
    { href: "/admin/finances", label: "Finanzas", icon: Wallet },
    { href: "/admin/rooms", label: "Habitaciones", icon: BedDouble },
    { href: "/admin/categorias", label: "Categorias", icon: Tags },
    { href: "/admin/asociados", label: "Empresas / Convenios", icon: Building2 },
    { href: "/admin/descuentos", label: "Descuentos", icon: Percent },
    { href: "/admin/cuentas", label: "Cuenta Corriente", icon: CircleDollarSign },
    {
      href: "/admin/fiscal/control",
      label: "Control de facturación",
      icon: ClipboardCheck,
      highlighted: unbilledCount > 0,
      badge:
        unbilledCount > 0
          ? {
              text: String(unbilledCount),
              tone: "alert",
              // Sin ventana en el texto: el número es de todo el historial, y es el
              // mismo que muestra el control al abrir.
              title: `${unbilledCount} estadías sin facturar`,
            }
          : undefined,
    },
    { href: "/admin/settings", label: "Ajustes", icon: Settings },
    { href: "/admin/mantenimiento", label: "Mantenimiento", icon: Sparkles },
    { href: "/admin/analytics", label: "Tablero", icon: BarChart3 },
  ];
}

/** El menú completo según el rol. Un recepcionista no ve la sección de administración. */
export function getNavSections(role: string, state: NavState = {}): NavSection[] {
  const sections: NavSection[] = [{ title: "Recepción", items: getReceptionItems(state) }];
  if (role === "admin") {
    sections.push({ title: "Administración", items: getAdminItems(state) });
  }
  return sections;
}

/**
 * ¿Este link es el de la pantalla actual? "/admin" tiene que comparar exacto: con
 * startsWith se prendería en todas las pantallas del panel, porque todas cuelgan de ahí.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
