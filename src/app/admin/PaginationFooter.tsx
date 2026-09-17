import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Pie de paginación, único para todo el panel.
 *
 * A propósito NO lleva "use client" ni usa hooks: así lo puede renderizar tanto un
 * server component que pagina por URL (`hrefFor`) como una pantalla que pagina en
 * memoria (`onPageChange`). Lo que se comparte es cómo se ve; cómo se navega lo
 * decide cada pantalla. Antes había tres copias de este bloque y ya habían empezado
 * a divergir (una usaba <Link>, otra <a aria-disabled>, y el tamaño de página era
 * distinto en cada una).
 */

type Navegacion =
  | { hrefFor: (page: number) => string; onPageChange?: never }
  | { onPageChange: (page: number) => void; hrefFor?: never };

export type PaginationFooterProps = {
  page: number;
  totalPages: number;
  total: number;
  firstIndex: number;
  lastIndex: number;
  /** "huéspedes", "estadías", "reservas"…: cierra el "Mostrando 1–20 de 223 …". */
  noun?: string;
  /** Aviso contextual, a la izquierda (ej.: filas tildadas en otra página). */
  note?: ReactNode;
  /** Mostrarlo aunque haya una sola página. Por defecto no: sería ruido. */
  always?: boolean;
} & Navegacion;

const BTN_BASE =
  "px-3 py-1.5 rounded-lg border text-sm font-bold flex items-center gap-1 transition-colors";
const BTN_ON = "border-slate-200 bg-white text-slate-700 hover:bg-slate-100";
const BTN_OFF = "border-slate-100 bg-slate-100 text-slate-400 cursor-not-allowed";

export default function PaginationFooter(props: PaginationFooterProps) {
  const { page, totalPages, total, firstIndex, lastIndex, noun, note, always } = props;

  // Con una sola página no hay nada que navegar: las pantallas chicas (empresas,
  // descuentos, cuentas) quedan exactamente como estaban.
  if (totalPages <= 1 && !always && !note) return null;

  const boton = (destino: number, texto: string, icono: ReactNode, habilitado: boolean) => {
    const contenido =
      texto === "Anterior" ? (
        <>
          {icono}
          {texto}
        </>
      ) : (
        <>
          {texto}
          {icono}
        </>
      );

    if (!habilitado) {
      return <span className={`${BTN_BASE} ${BTN_OFF}`}>{contenido}</span>;
    }
    if (props.hrefFor) {
      return (
        <Link href={props.hrefFor(destino)} className={`${BTN_BASE} ${BTN_ON}`}>
          {contenido}
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={() => props.onPageChange(destino)}
        className={`${BTN_BASE} ${BTN_ON}`}
      >
        {contenido}
      </button>
    );
  };

  return (
    <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs text-slate-500">
        <p>
          {total === 0
            ? "Sin resultados"
            : `Mostrando ${firstIndex}–${lastIndex} de ${total}${noun ? ` ${noun}` : ""} · Página ${page} de ${totalPages}`}
        </p>
        {note && <div className="mt-1">{note}</div>}
      </div>
      <div className="flex items-center gap-2">
        {boton(page - 1, "Anterior", <ChevronLeft size={15} />, page > 1)}
        {boton(page + 1, "Siguiente", <ChevronRight size={15} />, page < totalPages)}
      </div>
    </div>
  );
}
