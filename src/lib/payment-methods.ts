import {
  Banknote,
  CreditCard,
  Landmark,
  Receipt,
  Smartphone,
  Ticket,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Cómo se llama cada medio de pago en pantalla, con su ícono y su color.
 *
 * Es el único archivo de etiquetas de medios de pago: las pantallas que todavía
 * tienen su propia tabla se van pasando de a una a este. Sin JSX a propósito: el
 * ícono viaja como componente (`LucideIcon`) y cada pantalla lo dibuja con el
 * tamaño que necesite, así este módulo se puede importar también desde el servidor.
 *
 * La clave es texto y no `PaymentMethod`: el cobro a cuenta corriente no tiene CHECK
 * de método en la base (el pago de caja sí), y "cheque" existe ahí sin existir en el
 * tipo de caja.
 */
export type PaymentMethodMeta = {
  /** Lo que se lee en pantalla, en el CSV y en el papel. */
  label: string;
  icon: LucideIcon;
  /** Clase de Tailwind para el color del ícono. */
  tone: string;
};

export const PAYMENT_METHOD_META: Record<string, PaymentMethodMeta> = {
  cash: { label: "Efectivo", icon: Banknote, tone: "text-emerald-600" },
  bank_transfer: { label: "Transferencia", icon: Landmark, tone: "text-slate-600" },
  mercado_pago: { label: "Mercado Pago", icon: Smartphone, tone: "text-blue-500" },
  credit_card: { label: "Tarjeta de crédito", icon: CreditCard, tone: "text-slate-600" },
  debit_card: { label: "Tarjeta de débito", icon: CreditCard, tone: "text-slate-600" },
  cheque: { label: "Cheque", icon: Receipt, tone: "text-slate-600" },
  vale_blanco: { label: "Vale blanco", icon: Ticket, tone: "text-slate-400" },
  cuenta_corriente: { label: "Cuenta corriente", icon: Wallet, tone: "text-purple-500" },
  other: { label: "Otro", icon: Wallet, tone: "text-slate-500" },
};

/**
 * Etiqueta de un medio de pago. Sin método dice "Sin método"; un valor que no está en
 * la tabla se devuelve tal cual, para no dejar un renglón vacío (el texto es libre en
 * la base).
 */
export function paymentMethodLabel(method: string | null): string {
  if (!method) return "Sin método";
  return PAYMENT_METHOD_META[method]?.label ?? method;
}
