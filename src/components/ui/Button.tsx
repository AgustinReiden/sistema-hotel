"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

/**
 * Botón base del panel. Existe para que el verde, el gris de deshabilitado y el
 * foco sean los mismos en todas las pantallas, en vez de repetir clases a mano.
 *
 * - primary: la acción principal (brand-700).
 * - secondary: la acción de al lado (borde gris, fondo blanco).
 * - ghost: acción liviana, sin borde ni fondo.
 * - danger: lo que borra o cancela (red-600).
 * - md tiene 44 px de alto mínimo, el mínimo cómodo para un dedo en el celular.
 * - `loading` muestra el ícono girando y deshabilita el botón: un doble toque no
 *   dispara dos veces la misma acción.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTE: Record<ButtonVariant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-700",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
};

const TAMANO: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "min-h-[44px] px-4 py-2.5 text-sm",
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  type?: "button" | "submit" | "reset";
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  type = "button",
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const clases = [BASE, VARIANTE[variant], TAMANO[size], className].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clases}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
