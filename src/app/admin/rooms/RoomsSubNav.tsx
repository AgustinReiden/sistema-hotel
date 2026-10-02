import Link from "next/link";

// "Habitaciones | Categorías y tarifas": las dos pantallas son parte de una misma cosa
// (las categorías le ponen la tarifa a las habitaciones), y esta tira deja pasar de una a
// la otra. Es de servidor y no lee la URL: cada página dice cuál es la actual.
const ITEMS = [
    { id: "habitaciones", label: "Habitaciones", href: "/admin/rooms" },
    { id: "categorias", label: "Categorías y tarifas", href: "/admin/categorias" },
] as const;

export type RoomsSubNavCurrent = (typeof ITEMS)[number]["id"];

export default function RoomsSubNav({ current }: { current: RoomsSubNavCurrent }) {
    return (
        <nav aria-label="Habitaciones y categorías" className="mb-6 inline-flex rounded-lg bg-slate-100 p-1">
            {ITEMS.map((item) => {
                const active = item.id === current;
                return (
                    <Link
                        key={item.id}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                            active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                        }`}
                    >
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}
