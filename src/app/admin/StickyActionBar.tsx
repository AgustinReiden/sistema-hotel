"use client";

// Barra de acciones flotante que queda pegada al pie del área de contenido. Se pega al
// pie del contenedor que scrollea, que es el del panel (no la ventana), así que la barra
// de navegación del celular —que vive fuera de ese contenedor— nunca la tapa.

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
