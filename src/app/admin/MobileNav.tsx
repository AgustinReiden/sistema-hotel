"use client";

// Navegación del panel en el celular. Son dos piezas que resuelven cosas distintas:
//  - La barra inferior: los accesos que se usan todo el día, a un toque y al alcance del
//    pulgar. Recepción: Hoy, Reservas, Caja y Facturación. El dueño: Hoy, Reservas, Caja,
//    Tablero y "Más", que abre el mismo cajón que la hamburguesa.
//  - El cajón de la hamburguesa: el menú entero, sección por sección con sus pestañas
//    (así nadie pierde Rendiciones, Descuentos o Limpiezas), el usuario y cerrar sesión.
//
// Arriba de 768px las dos desaparecen (md:hidden) y manda el <Sidebar>. Los links salen
// de nav-links.ts, así que el menú se escribe en un solo lugar.

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BedDouble, Menu, MoreHorizontal, X } from "lucide-react";

import LogoutButton from "./LogoutButton";
import { useMobileMenu } from "./MobileMenuContext";
import {
  findActiveNav,
  getMobileBarSections,
  getNavSections,
  sectionBadge,
  sectionHref,
  type NavBadge,
  type NavState,
} from "./nav-links";

const BADGE_TONE: Record<NavBadge["tone"], string> = {
  ok: "text-emerald-400 bg-emerald-950/40",
  warn: "text-amber-400 bg-amber-950/40",
  alert: "text-rose-300 bg-rose-950/50",
};

function Badge({ badge }: { badge: NavBadge }) {
  return (
    <span title={badge.title} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${BADGE_TONE[badge.tone]}`}>
      {badge.text}
    </span>
  );
}

type MobileNavProps = NavState & {
  role: string;
  userEmail: string;
  /** A la izquierda de la hamburguesa: la campana de avisos del admin (F1-3). */
  actions?: ReactNode;
};

export function MobileTopBar({ role, userEmail, actions, ...navState }: MobileNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Si el cajón está abierto lo guarda el MobileMenuContext, porque "Más" de la barra de
  // abajo lo abre también; él mismo lo cierra al navegar.
  const { isOpen, open: openMenu, close: closeMenu } = useMobileMenu();
  const sections = getNavSections(role, navState);
  const active = findActiveNav(sections, pathname, searchParams);
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    // Sin esto, el dedo scrollea la página de atrás en vez del menú.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, closeMenu]);

  return (
    <>
      {/* Ni sticky ni fixed: es un hijo flex del shell de alto fijo, así que no se mueve
          nunca. Con position fija y scroll de ventana, en iOS saltaba cada vez que la
          barra de URL se contraía.
          print:hidden porque los comprobantes térmicos se abren en una ventana angosta
          (versión celular) y la barra salía impresa arriba de cada ticket. */}
      <header className="md:hidden shrink-0 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 shadow-lg print:hidden">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 shadow-lg shadow-emerald-500/20">
            <BedDouble size={18} className="text-white" />
          </span>
          <span className="text-base font-bold tracking-wide text-white">
            El <span className="text-emerald-400">Refugio</span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={openMenu}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Abrir menú"
            aria-expanded={isOpen}
          >
            <Menu size={22} />
          </button>
        </div>
      </header>

      {isOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={closeMenu}
            aria-label="Cerrar menú"
          />
          <nav
            className="relative flex h-full w-72 max-w-[85%] flex-col bg-slate-900 shadow-2xl"
            aria-label="Menú del panel"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 px-4">
              <span className="text-base font-bold tracking-wide text-white">
                El <span className="text-emerald-400">Refugio</span>
              </span>
              <button
                type="button"
                onClick={closeMenu}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Cerrar menú"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = active?.section.id === section.id;
                // Con una sola pestaña la sección ya es la pantalla: no se repite abajo, y
                // el numerito va en la sección. Con varias, cada una lleva el suyo.
                const hasTabs = section.tabs.length > 1;
                const badge = hasTabs ? undefined : sectionBadge(section);
                return (
                  <div key={section.id} className="pb-1">
                    <Link
                      href={sectionHref(section)}
                      onClick={closeMenu}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex items-center rounded-lg px-3 py-3 transition-colors ${
                        isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <Icon
                        size={18}
                        className={`mr-3 shrink-0 ${section.highlighted || isActive ? "text-emerald-400" : ""}`}
                      />
                      <span className="flex-1 font-medium">{section.label}</span>
                      {badge && <Badge badge={badge} />}
                    </Link>
                    {hasTabs && (
                      <ul className="mb-1 ml-5 border-l border-slate-700">
                        {section.tabs.map((tab) => {
                          const TabIcon = tab.icon;
                          const tabActive = active?.tab.id === tab.id;
                          return (
                            <li key={tab.id}>
                              <Link
                                href={tab.href}
                                onClick={closeMenu}
                                aria-current={tabActive ? "page" : undefined}
                                className={`-ml-px flex items-center border-l-2 py-2.5 pl-4 pr-3 text-sm transition-colors ${
                                  tabActive
                                    ? "border-emerald-400 font-semibold text-white"
                                    : "border-transparent text-slate-400 hover:text-white"
                                }`}
                              >
                                <TabIcon size={16} className="mr-2.5 shrink-0" />
                                <span className="flex-1">{tab.label}</span>
                                {tab.badge && <Badge badge={tab.badge} />}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="shrink-0 border-t border-slate-800 p-4">
              <div className="mb-3 flex items-center">
                <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-700 text-xs font-bold text-white">
                  {isAdmin ? "AD" : "RC"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {isAdmin ? "Admin" : "Recepcionista"}
                  </p>
                  <p className="truncate text-xs text-slate-500">{userEmail || "Recepción"}</p>
                </div>
              </div>
              <LogoutButton />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

/** Cada acceso de la barra: el color del punto sale del color del aviso de la sección. */
const DOT_TONE: Record<NavBadge["tone"], string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  alert: "bg-rose-400",
};

const TAB_CLASS = "flex flex-col items-center justify-center gap-1 px-1 py-2.5 transition-colors";

export function MobileTabBar({ role, ...navState }: NavState & { role: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { open } = useMobileMenu();
  const isAdmin = role === "admin";
  const sections = getNavSections(role, navState);
  const bar = getMobileBarSections(role, navState);
  const active = findActiveNav(sections, pathname, searchParams);
  // Con una pantalla de las que quedan detrás de "Más" (Clientes, Configuración...) ningún
  // acceso fijo está marcado: lo marcado es "Más", porque ahí está el camino de vuelta.
  const activeInBar = bar.some((s) => s.id === active?.section.id);

  return (
    <nav
      // Idem la barra de arriba: hijo flex del shell, no fixed. Así no tapa el final de la
      // página (no hace falta padding extra) ni se mueve al scrollear.
      className={`md:hidden shrink-0 grid ${
        isAdmin ? "grid-cols-5" : "grid-cols-4"
      } border-t border-slate-800 bg-slate-900 print:hidden`}
      aria-label="Accesos rápidos"
    >
      {bar.map((section) => {
        const Icon = section.icon;
        const isActive = active?.section.id === section.id;
        // El badge (ABIERTA/CERRADA, un conteo) no entra acá: se reduce a un punto sobre el
        // icono, del color del aviso. Con turno abierto, verde; sin turno, ámbar.
        const badge = sectionBadge(section);
        return (
          <Link
            key={section.id}
            href={sectionHref(section)}
            aria-current={isActive ? "page" : undefined}
            className={`${TAB_CLASS} ${isActive ? "text-emerald-400" : "text-slate-400"}`}
          >
            <span className="relative">
              <Icon size={20} />
              {badge && (
                <span
                  title={badge.title}
                  className={`absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-slate-900 ${DOT_TONE[badge.tone]}`}
                />
              )}
            </span>
            <span className="w-full truncate text-center text-[10px] font-semibold leading-none">
              {section.label}
            </span>
          </Link>
        );
      })}
      {isAdmin && (
        <button
          type="button"
          onClick={open}
          aria-haspopup="dialog"
          className={`${TAB_CLASS} ${active && !activeInBar ? "text-emerald-400" : "text-slate-400"}`}
        >
          <MoreHorizontal size={20} />
          <span className="w-full truncate text-center text-[10px] font-semibold leading-none">Más</span>
        </button>
      )}
    </nav>
  );
}
