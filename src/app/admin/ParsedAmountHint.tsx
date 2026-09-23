import { formatAmount, parseArMoney } from "@/lib/format";

/**
 * Debajo de un campo de importe, cómo se leyó lo tipeado: "43.700" → "= $43.700,00".
 *
 * Existe porque el campo acepta varias formas de escribir lo mismo y un error de
 * tipeo (150.000 → 15.000) o de formato (43.700 leído como 43,70) se veía recién
 * al enviar. En el arqueo a ciegas, al enviar ya es tarde: el monto queda firme.
 *
 * Vacío no muestra nada: todavía no hay nada que leer.
 */
export const UNREADABLE_AMOUNT_MESSAGE = "No se entiende el monto. Escribilo así: 43.700 o 43.700,50";

export default function ParsedAmountHint({
  value,
  large = false,
  className = "",
}: {
  value: string;
  /** Más grande, para el campo que manda en la pantalla (el arqueo). */
  large?: boolean;
  className?: string;
}) {
  if (!value.trim()) return null;
  const size = large ? "text-base" : "text-xs";
  const parsed = parseArMoney(value);
  if (parsed === null) {
    return (
      <p className={`mt-1 ${size} font-semibold text-rose-600 ${className}`}>
        {UNREADABLE_AMOUNT_MESSAGE}
      </p>
    );
  }
  return (
    <p className={`mt-1 ${size} font-semibold text-slate-600 tabular-nums ${className}`}>
      = {formatAmount(parsed)}
    </p>
  );
}
