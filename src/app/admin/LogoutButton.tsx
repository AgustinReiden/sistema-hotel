"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";
import { useTransition } from "react";

export default function LogoutButton() {
    const [isPending, startTransition] = useTransition();

    return (
        <button
            onClick={() => startTransition(() => logout())}
            disabled={isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-lg transition-colors font-medium text-sm border border-slate-200"
            title="Cerrar Sesión"
        >
            <LogOut size={16} />
            {/* Sin ocultarlo en pantallas chicas: en el cajón del celular un icono suelto
                no dice nada, y en escritorio ya se veía igual. */}
            <span>{isPending ? "Saliendo..." : "Salir"}</span>
        </button>
    );
}
