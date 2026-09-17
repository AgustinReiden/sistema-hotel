"use client";

// Navegación del panel en el celular. Son dos piezas que resuelven cosas distintas:
//  - La barra inferior: los cinco accesos que recepción usa todo el día, a un toque y al
//    alcance del pulgar.
//  - El cajón de la hamburguesa: el resto (administración, usuario, cerrar sesión).
//
// Arriba de 768px las dos desaparecen (md:hidden) y manda el <Sidebar> de siempre. Los
// links salen de nav-links.ts, así que el menú se escribe en un solo lugar.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BedDouble, Menu, X } from "lucide-react";

import LogoutButton from "./LogoutButton";
import {
  getNavSections,
  getReceptionItems,
  isNavItemActive,
  type NavBadge,
  type NavState,
} from "./nav-links";

const BADGE_TONE: Record<NavBadge["tone"], string> = {
  ok: "text-emerald-400 bg-emerald-950/40",
  warn: "text-amber-400 bg-amber-950/40",
  alert: "text-rose-300 bg-rose-950/50",
};

type MobileNavProps = NavState & {
  role: string;
  userEmail: string;
};

export function MobileTopBar({ role, userEmail, hasOpenShift, unbilledCount }: MobileNavProps) {
  const pathname = usePathname();
  // El cajón se cierra solo al navegar: en vez de un efecto que lo sincronice, se guarda
  // desde qué pantalla se abrió y sólo sigue abierto mientras la ruta siga siendo esa.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const isOpen = openedOn === pathname;
  const closeMenu = () => setOpenedOn(null);
  const sections = getNavSections(role, { hasOpenShift, unbilledCount });
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedOn(null);
    };
    window.addEventListener("keydown", onKeyDown);
    // Sin esto, el dedo scrollea la página de atrás en vez del menú.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <>
      <header className="md:hidden sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 shadow-lg">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 shadow-lg shadow-emerald-500/20">
            <BedDouble size={18} className="text-white" />
          </span>
          <span className="text-base font-bold tracking-wide text-white">
            El <span className="text-emerald-400">Refugio</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpenedOn(pathname)}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          aria-label="Abrir menú"
          aria-expanded={isOpen}
        >
          <Menu size={22} />
        </button>
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
              {sections.map((section) => (
                <div key={section.title} className="pb-2">
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {section.title}
                  </p>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(item.href, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center rounded-lg px-3 py-3 transition-colors ${
                          active ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <Icon
                          size={18}
                          className={`mr-3 shrink-0 ${item.highlighted ? "text-emerald-400" : ""}`}
                        />
                        <span className="flex-1 font-medium">{item.label}</span>
                        {item.badge && (
                          <span
                            title={item.badge.title}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${BADGE_TONE[item.badge.tone]}`}
                          >
                            {item.badge.text}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ))}
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

export function MobileTabBar({ hasOpenShift }: NavState) {
  const pathname = usePathname();
  const items = getReceptionItems({ hasOpenShift });

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-800 bg-slate-900 print:hidden"
      aria-label="Accesos de recepción"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = isNavItemActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 px-1 py-2.5 transition-colors ${
              active ? "text-emerald-400" : "text-slate-400"
            }`}
          >
            <span className="relative">
              <Icon size={20} />
              {/* El badge ABIERTA/CERRADA no entra acá: se reduce a un punto sobre el
                  icono, que es lo único que recepción necesita ver de un vistazo. */}
              {item.badge && (
                <span
                  title={item.badge.title}
                  className={`absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-slate-900 ${
                    item.highlighted ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
              )}
            </span>
            <span className="w-full truncate text-center text-[10px] font-semibold leading-none">
              {item.shortLabel ?? item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
