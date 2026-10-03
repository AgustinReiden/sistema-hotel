"use client";

// El cajón del celular lo abren dos botones que viven en lugares distintos: la
// hamburguesa de la barra de arriba y "Más" en la barra de abajo (solo del dueño). Los dos
// tienen que mover el mismo menú, así que el estado vive acá, arriba de ambos.
//
// El cajón se cierra solo al navegar. En vez de un efecto que lo sincronice, se guarda
// desde qué pantalla se abrió y solo cuenta como abierto mientras la URL siga siendo esa.
// Va con los parámetros porque hay pestañas que solo cambian el ?view= (Por llegar e
// Historial son /admin/guests). Por eso quien use `useMobileMenu` tiene que estar dentro
// de un <Suspense>: lee useSearchParams.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Store = { openedOn: string | null; setOpenedOn: (url: string | null) => void };

const MobileMenuContext = createContext<Store | null>(null);

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const store = useMemo(() => ({ openedOn, setOpenedOn }), [openedOn]);
  return <MobileMenuContext.Provider value={store}>{children}</MobileMenuContext.Provider>;
}

export function useMobileMenu(): { isOpen: boolean; open: () => void; close: () => void } {
  const store = useContext(MobileMenuContext);
  if (!store) {
    // Sin el provider, "Más" no abriría nada y nadie se enteraría: que falle fuerte.
    throw new Error("useMobileMenu tiene que usarse dentro de <MobileMenuProvider>");
  }
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentUrl = `${pathname}?${searchParams.toString()}`;
  const { openedOn, setOpenedOn } = store;
  const open = useCallback(() => setOpenedOn(currentUrl), [setOpenedOn, currentUrl]);
  const close = useCallback(() => setOpenedOn(null), [setOpenedOn]);
  return { isOpen: openedOn === currentUrl, open, close };
}
