// Encabezado y cuerpo de las pantallas del panel. Antes cada página repetía las mismas
// clases a mano, así que el arreglo de celular había que acordarse de aplicarlo en cada
// una. Son componentes de servidor sin estado: sólo maquetan.

import type { ReactNode } from "react";

const ICON_TONE = {
  slate: "bg-slate-100",
  emerald: "bg-emerald-100",
  amber: "bg-amber-100",
} as const;

export function PageHeader({
  icon,
  iconTone = "slate",
  title,
  badge,
  subtitle,
  className = "",
  children,
}: {
  /** El icono suelto: el componente le pone la cajita de color. */
  icon?: ReactNode;
  iconTone?: keyof typeof ICON_TONE;
  title: ReactNode;
  /** Píldora al lado del título (contadores, avisos). */
  badge?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  /** Acciones de la derecha. */
  children?: ReactNode;
}) {
  // min-h-16 y no h-16: con alto fijo, en 375px el título y el botón de acción se
  // aprietan uno contra otro y no pueden pasar a dos líneas. Con min-h el escritorio se
  // ve igual (el contenido mide menos y queda centrado) y el celular crece en vez de
  // recortar. px-4 md:px-8 por lo mismo: 32px por lado en un teléfono son 64px tirados.
  return (
    <header
      className={`shrink-0 min-h-16 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 md:px-8 md:py-0 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className={`shrink-0 rounded-lg p-2 ${ICON_TONE[iconTone]}`}>{icon}</div>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold text-slate-800 md:text-xl">{title}</h1>
            {badge}
          </div>
          {subtitle && <div className="text-xs text-slate-400">{subtitle}</div>}
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}

export function PageBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`flex-1 overflow-auto p-4 md:p-8 ${className}`}>{children}</div>;
}
