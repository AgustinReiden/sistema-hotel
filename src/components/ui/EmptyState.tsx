import type { LucideIcon } from "lucide-react";

import Button from "./Button";

/**
 * "No hay nada" con ícono, título y, si ayuda, una frase y un botón. Reemplaza los
 * renglones sueltos que dejaban una lista vacía sin decir qué hacer.
 *
 * Si recibe `action` tiene que usarse desde un componente de cliente: el onClick
 * es una función y no cruza de un server component.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={["flex flex-col items-center text-center px-4 py-10", className].filter(Boolean).join(" ")}>
      <Icon className="h-10 w-10 text-slate-300" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && (
        <Button variant="secondary" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
