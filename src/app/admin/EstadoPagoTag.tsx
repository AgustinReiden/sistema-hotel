import { ESTADO_PAGO_LABEL } from "@/lib/billing";
import { formatAmount } from "@/lib/format";
import type { EstadoPago } from "@/lib/cc-pagos";

/**
 * Pastilla de "¿esta estadía está cobrada?" (mig 109).
 *
 * Existe porque son DOS preguntas distintas y hasta ahora se veía una sola. Que una
 * estadía esté facturada no dice nada de si se cobró: la factura sale en el momento
 * y la transferencia llega a los treinta días. Antes, para saber qué reserva quedó
 * sin cobrar había que mirar el saldo global de la cuenta y adivinar.
 *
 * Vive en su propio archivo porque la usan las dos pantallas que listan estadías: la
 * ficha del cliente (solapa Movimientos) y el control de facturación. El texto lo
 * pone lib/billing.ts, que es lo que también lee el CSV del contador.
 *
 * El color es semántico y NO se repite entre estados: verde cobrado, ámbar a medias,
 * rojo nada. Es lo que se lee de un vistazo cuando la lista tiene ochenta filas.
 */
const CLASE: Record<EstadoPago, string> = {
  pagada: "bg-emerald-100 text-emerald-700",
  parcial: "bg-amber-100 text-amber-800",
  impaga: "bg-rose-100 text-rose-700",
  facturado_externo: "bg-indigo-100 text-indigo-700",
  sin_facturar: "bg-slate-100 text-slate-500",
};

export default function EstadoPagoTag({
  estado,
  impTotal,
  imputado,
}: {
  estado: EstadoPago;
  /** Total de la factura, para poder decir "40.000 de 100.000" en vez de "parcial". */
  impTotal?: number | null;
  imputado?: number | null;
}) {
  // El detalle sólo cuando aporta: en un pago parcial, cuánto entró de cuánto. La
  // unidad de cobro es la FACTURA, así que en una consolidada este número es el de
  // la factura entera y no el de esta estadía; por eso se muestra el importe y no un
  // porcentaje repartido, que sería una precisión que ningún recibo respalda.
  const detalle =
    estado === "parcial" && impTotal
      ? `${formatAmount(imputado ?? 0)} de ${formatAmount(impTotal)}`
      : null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${CLASE[estado]}`}
      title={detalle ? `Cobrado ${detalle}` : undefined}
    >
      {ESTADO_PAGO_LABEL[estado]}
      {detalle && <span className="font-semibold opacity-80">· {detalle}</span>}
    </span>
  );
}
