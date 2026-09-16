"use client";

// Barra de acciones flotante que queda pegada al pie del área de contenido. Recién
// se ve pegada de verdad cuando el layout que la contiene scrollea en un contenedor
// propio (cambio en curso en otra sesión); hasta entonces scrollea con la página,
// lo cual es esperado.

type Props = {
  children: React.ReactNode;
  visible: boolean;
};

export default function StickyActionBar({ children, visible }: Props) {
  if (!visible) return null;

  return (
    <div className="sticky bottom-0 print:hidden pb-4 pt-3">
      <div className="rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-lg px-4 py-3">
        {children}
      </div>
    </div>
  );
}
