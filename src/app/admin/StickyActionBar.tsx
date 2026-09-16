"use client";

// Barra de acciones flotante que queda pegada al pie del área de contenido.
//
// En el celular se despega 4rem del borde: ahí abajo está la barra de navegación fija
// del panel y, pegada a bottom-0, esta barra quedaba debajo y sus botones eran
// inalcanzables. En escritorio no hay barra inferior, así que vuelve a bottom-0.

type Props = {
  children: React.ReactNode;
  visible: boolean;
};

export default function StickyActionBar({ children, visible }: Props) {
  if (!visible) return null;

  return (
    <div className="sticky bottom-16 md:bottom-0 print:hidden pb-4 pt-3">
      <div className="rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-lg px-4 py-3">
        {children}
      </div>
    </div>
  );
}
