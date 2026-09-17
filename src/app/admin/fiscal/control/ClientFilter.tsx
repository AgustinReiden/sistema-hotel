"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import type { CtaCteAccount } from "@/lib/types";

type Props = {
  accounts: CtaCteAccount[];
  /** "company:<uuid>" | "guest:<uuid>" | "" (todos). */
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
};

const MAX_RESULTADOS = 12;

function normalizar(texto: string): string {
  // Sin tildes: nadie escribe "Martínez" con tilde cuando está buscando apurado.
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function claveDe(a: CtaCteAccount): string {
  return `${a.kind}:${a.id}`;
}

/**
 * Buscador de clientes del control de facturación. Reemplaza al <select> de una
 * sola lista: con 78 cuentas de cuenta corriente, encontrar una empresa era
 * scrollear a ojo hasta dar con el nombre.
 *
 * Busca por nombre y por documento (CUIT/DNI), sin tildes y sin importar dónde cae
 * el texto dentro del nombre: "perfum" encuentra "JUFEC SA - PERFUMERIA". Filtrar
 * en el navegador y no contra la base es a propósito — las cuentas ya vienen
 * cargadas en la página, así que el resultado aparece mientras se tipea y sin
 * depender de la conexión.
 */
export default function ClientFilter({ accounts, value, onChange, inputId = "control-cliente" }: Props) {
  const [query, setQuery] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const contenedorRef = useRef<HTMLDivElement>(null);

  const elegido = useMemo(
    () => accounts.find((a) => claveDe(a) === value) ?? null,
    [accounts, value]
  );

  const resultados = useMemo(() => {
    const q = normalizar(query.trim());
    if (q === "") return accounts.slice(0, MAX_RESULTADOS);
    // El CUIT se guarda con guiones y se tipea sin ellos (y al revés), así que la
    // comparación por documento va sobre los dígitos pelados de los dos lados.
    // Si lo tipeado no tiene ningún dígito, esa comparación no corre: si no,
    // buscar "sa" haría match con cualquier documento por el string vacío.
    const digitos = q.replace(/\D/g, "");
    return accounts
      .filter((a) => {
        if (normalizar(a.name).includes(q)) return true;
        if (digitos === "") return false;
        return (a.document_id ?? "").replace(/\D/g, "").includes(digitos);
      })
      .slice(0, MAX_RESULTADOS);
  }, [accounts, query]);

  // Click afuera: cierra y descarta lo tipeado, para que el input no quede
  // mostrando una búsqueda a medias que no es lo que está filtrado.
  useEffect(() => {
    if (!abierto) return;
    const onDown = (e: MouseEvent) => {
      if (!contenedorRef.current?.contains(e.target as Node)) {
        setAbierto(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [abierto]);

  const elegir = (clave: string) => {
    setAbierto(false);
    setQuery("");
    onChange(clave);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setAbierto(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!abierto) setAbierto(true);
      setResaltado((i) => {
        const n = resultados.length;
        if (n === 0) return 0;
        return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const elegida = resultados[resaltado];
      if (elegida) elegir(claveDe(elegida));
    }
  };

  return (
    <div className="relative" ref={contenedorRef}>
      <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor={inputId}>
        Cliente
      </label>

      <div className="relative">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={`${inputId}-lista`}
          autoComplete="off"
          value={abierto ? query : elegido?.name ?? ""}
          placeholder={elegido ? elegido.name : "Todos los clientes"}
          onFocus={() => {
            setAbierto(true);
            setResaltado(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setAbierto(true);
            setResaltado(0);
          }}
          onKeyDown={onKeyDown}
          className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm"
        />
        {(elegido || query) && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setAbierto(false);
              if (elegido) onChange("");
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
            aria-label="Ver todos los clientes"
            title="Ver todos los clientes"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {abierto && (
        <ul
          id={`${inputId}-lista`}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1"
        >
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => elegir("")}
              className="w-full text-left px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              Todos los clientes
            </button>
          </li>

          {resultados.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-400">
              Ningún cliente con cuenta corriente coincide con “{query.trim()}”.
            </li>
          ) : (
            resultados.map((a, i) => (
              <li key={claveDe(a)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={claveDe(a) === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setResaltado(i)}
                  onClick={() => elegir(claveDe(a))}
                  className={`w-full text-left px-3 py-2 transition-colors ${
                    i === resaltado ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-800 truncate">
                    {a.name}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {a.kind === "company" ? "Empresa" : "Huésped"}
                    {a.document_id ? ` · ${a.document_id}` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
