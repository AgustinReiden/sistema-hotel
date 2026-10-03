import { ESTADO_PAGO_LABEL } from "@/lib/billing";
import type { EstadoPago } from "@/lib/cc-pagos";
import { REMITO_ESTADO_LABEL, REMITO_ESTADO_TONO } from "@/lib/remitos";
import type { RemitoEstado } from "@/lib/types";

/**
 * Pastilla de estado del panel: una sola forma de mostrar "en qué está" una
 * habitación, un pago, una factura o un remito.
 *
 * Los colores de pago son los de `admin/EstadoPagoTag.tsx` (verde cobrado, ámbar a
 * medias, rojo nada), copiados y no inventados. EstadoPagoTag pasa a usar esta
 * pastilla cuando otro PR toque ese archivo; mientras tanto no se duplica la lógica
 * del detalle "40.000 de 100.000", que sigue siendo suya.
 *
 * Un status que no conoce no rompe: se muestra tal cual, en gris neutro.
 */
export type StatusPillKind = "habitacion" | "pago" | "factura" | "remito";

type Tono = { label: string; clase: string };

const NEUTRO = "bg-slate-100 text-slate-600";

const HABITACION: Record<string, Tono> = {
  available: { label: "Disponible", clase: "bg-emerald-100 text-emerald-700" },
  occupied: { label: "Ocupada", clase: "bg-blue-100 text-blue-700" },
  cleaning: { label: "Limpieza", clase: "bg-slate-200 text-slate-600" },
  maintenance: { label: "Mantenimiento", clase: "bg-red-100 text-red-700" },
};

// Mismos colores que EstadoPagoTag.CLASE; el texto es el de lib/billing.ts.
const PAGO_CLASE: Record<EstadoPago, string> = {
  pagada: "bg-emerald-100 text-emerald-700",
  parcial: "bg-amber-100 text-amber-800",
  impaga: "bg-rose-100 text-rose-700",
  facturado_externo: "bg-indigo-100 text-indigo-700",
  sin_facturar: "bg-slate-100 text-slate-500",
};

const PAGO: Record<string, Tono> = Object.fromEntries(
  (Object.keys(PAGO_CLASE) as EstadoPago[]).map((estado) => [
    estado,
    { label: ESTADO_PAGO_LABEL[estado], clase: PAGO_CLASE[estado] },
  ]),
);

// Los textos son los de la ficha del cliente (INVOICE_STATUS_LABEL) y de Facturación.
const FACTURA: Record<string, Tono> = {
  authorized: { label: "Emitida", clase: "bg-emerald-100 text-emerald-700" },
  pending: { label: "Pendiente de ARCA", clase: "bg-amber-100 text-amber-800" },
  processing: { label: "En verificación", clase: "bg-sky-100 text-sky-700" },
  rejected: { label: "Rechazada", clase: "bg-rose-100 text-rose-700" },
};

// Los textos y tonos son los de lib/remitos.ts, sin el borde (la pastilla no lleva).
const REMITO: Record<string, Tono> = Object.fromEntries(
  (Object.keys(REMITO_ESTADO_LABEL) as RemitoEstado[]).map((estado) => [
    estado,
    {
      label: REMITO_ESTADO_LABEL[estado],
      clase: REMITO_ESTADO_TONO[estado]
        .split(" ")
        .filter((c) => !c.startsWith("border-"))
        .join(" "),
    },
  ]),
);

const TONOS: Record<StatusPillKind, Record<string, Tono>> = {
  habitacion: HABITACION,
  pago: PAGO,
  factura: FACTURA,
  remito: REMITO,
};

export default function StatusPill({
  kind,
  status,
  className,
}: {
  kind: StatusPillKind;
  status: string;
  className?: string;
}) {
  // Object.hasOwn: un status como "constructor" no puede colarse desde el prototipo.
  const tabla = TONOS[kind];
  const tono = Object.hasOwn(tabla, status) ? tabla[status] : null;
  const clases = [
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold",
    tono ? tono.clase : NEUTRO,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={clases}>{tono ? tono.label : status}</span>;
}
