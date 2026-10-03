"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, X } from "lucide-react";

import { globalSearchAction } from "./search-actions";
import { classifySearchTerm, EMPTY_GLOBAL_SEARCH } from "@/lib/global-search";
import { DEFAULT_TZ, formatHotelShortDate } from "@/lib/time";
import type { GlobalSearchHit, GlobalSearchResult } from "@/lib/types";

// El buscador global del panel (F1-5b): nombre, DNI, CUIT o número de habitación. Escribís
// arriba (o tocás la lupa en el celular) y ves, sin apretar nada, el resumen de la persona
// o de la habitación. Recepción ve el resumen sin montos ni links; el dueño, además, el
// monto de la cuenta corriente y los links. Eso lo decide el servidor (F1-5a): esta
// pantalla dibuja lo que llega y no inventa ni un monto ni un link.

type Props = {
  /**
   * Dónde está: la caja de la barra de arriba del escritorio o la lupa de la barra negra
   * del celular. El marco dibuja las dos y cada una se esconde en el otro tamaño; con
   * esto, el atajo `/` lo atiende solo la que se ve. Sin placement, siempre.
   */
  placement?: "desktop" | "mobile";
};

const DESKTOP_QUERY = "(min-width: 768px)";
const DEBOUNCE_MS = 250;
const PLACEHOLDER = "Buscar huésped, DNI, CUIT o habitación";

const GROUPS: { key: keyof GlobalSearchResult; label: string }[] = [
  { key: "habitaciones", label: "Habitaciones" },
  { key: "huespedes", label: "Huéspedes" },
  { key: "empresas", label: "Empresas" },
  { key: "pasajeros", label: "Pasajeros" },
];

const hasResults = (r: GlobalSearchResult) => GROUPS.some((g) => r[g.key].length > 0);

/** `/` no se roba si estás escribiendo en otro campo. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function dateRange(entrada: string, salida: string): string {
  return `${formatHotelShortDate(entrada, DEFAULT_TZ)} al ${formatHotelShortDate(salida, DEFAULT_TZ)}`;
}

function SummaryCard({ hit, onNavigate }: { hit: GlobalSearchHit; onNavigate: () => void }) {
  const summary = hit.resumen;
  const links: { href: string; label: string }[] = [];
  if (hit.href) {
    links.push({
      href: hit.href,
      label: hit.kind === "huesped" ? "Ver en el Directorio" : "Ver en Empresas",
    });
  }
  if (hit.hrefCuenta) links.push({ href: hit.hrefCuenta, label: "Ver cuenta corriente" });

  return (
    <div
      data-search-card
      aria-label={`Resumen de ${hit.titulo}`}
      className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
    >
      <p className="font-bold text-slate-900">{hit.titulo}</p>
      {hit.detalle && <p className="text-xs text-slate-500">{hit.detalle}</p>}

      {summary && (
        <dl className="mt-2 space-y-1">
          <div className="flex gap-2">
            <dt className="shrink-0 text-slate-500">Descuento:</dt>{" "}
            <dd className="font-semibold">{summary.descuento}%</dd>
          </div>
          {summary.saldoTexto && (
            <div className="flex gap-2">
              <dt className="sr-only">Cuenta corriente</dt>
              <dd
                className={`font-semibold ${summary.debe ? "text-rose-700" : "text-emerald-700"}`}
              >
                {summary.saldoTexto}
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="shrink-0 text-slate-500">Última estadía:</dt>{" "}
            <dd>
              {summary.ultimaEstadia
                ? `${formatHotelShortDate(summary.ultimaEstadia.salida, DEFAULT_TZ)}${
                    summary.ultimaEstadia.habitacion ? ` · Hab. ${summary.ultimaEstadia.habitacion}` : ""
                  }`
                : "Sin estadías anteriores"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-slate-500">Reserva activa:</dt>{" "}
            <dd>
              {summary.reservaActiva
                ? `${summary.reservaActiva.estado === "checked_in" ? "Alojado" : "Reservada"}${
                    summary.reservaActiva.habitacion ? ` · Hab. ${summary.reservaActiva.habitacion}` : ""
                  } · ${dateRange(summary.reservaActiva.entrada, summary.reservaActiva.salida)}`
                : "Ninguna"}
            </dd>
          </div>
        </dl>
      )}

      {hit.habitacion && (
        <p className="mt-2">
          {hit.habitacion.alojado
            ? `Alojado: ${hit.habitacion.alojado.nombre} · ${dateRange(
                hit.habitacion.alojado.entrada,
                hit.habitacion.alojado.salida
              )}`
            : "Sin nadie alojado"}
        </p>
      )}

      {links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className="rounded-lg border border-brand-700 px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GlobalSearch({ placement }: Props) {
  const listId = useId();
  const optionId = (index: number) => `${listId}-opt-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lupaRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Solo en el celular: la lupa abre el buscador a pantalla completa.
  const [overlayOpen, setOverlayOpen] = useState(false);

  const isMobile = placement === "mobile";
  const inputVisible = !isMobile || overlayOpen;

  const flat = useMemo(
    () => (result ? GROUPS.flatMap((g) => result[g.key]) : []),
    [result]
  );
  const activeHit = flat[activeIndex] ?? null;

  const cancelPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    // Lo que todavía no llegó se descarta: ya no es lo que hay escrito.
    requestRef.current += 1;
  }, []);

  const run = useCallback(
    async (text: string) => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      const response = await globalSearchAction(text).catch(() => null);
      if (request !== requestRef.current) return;
      setLoading(false);
      if (!response || !response.success) {
        setResult(null);
        setError(response?.error ?? "No se pudo buscar. Probá de nuevo.");
        return;
      }
      setResult(response.data ?? EMPTY_GLOBAL_SEARCH);
      setActiveIndex(0);
    },
    []
  );

  const onChange = (text: string) => {
    setQuery(text);
    setPanelOpen(true);
    cancelPending();
    if (!classifySearchTerm(text)) {
      setLoading(false);
      setError(null);
      setResult(null);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => void run(text), DEBOUNCE_MS);
  };

  const resetQuery = useCallback(() => {
    cancelPending();
    setQuery("");
    setResult(null);
    setError(null);
    setLoading(false);
    setPanelOpen(false);
    setActiveIndex(0);
  }, [cancelPending]);

  // Esc y la X del celular: limpia lo escrito y cierra (también la pantalla completa).
  const clearAndClose = useCallback(() => {
    resetQuery();
    setOverlayOpen(false);
  }, [resetQuery]);

  useEffect(() => cancelPending, [cancelPending]);

  const appliesHere = useCallback(() => {
    if (placement && typeof window.matchMedia === "function") {
      const isDesktop = window.matchMedia(DESKTOP_QUERY).matches;
      return isDesktop === (placement === "desktop");
    }
    return true;
  }, [placement]);

  // El atajo `/`: no se roba si estás escribiendo en otro campo ni con Ctrl, Meta o Alt.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (!appliesHere()) return;
      event.preventDefault();
      if (isMobile) setOverlayOpen(true);
      else inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appliesHere, isMobile]);

  // Celular: al abrir, el cursor ya está en la caja; la página de atrás no se mueve; al
  // cerrar, el foco vuelve a la lupa.
  useEffect(() => {
    if (!overlayOpen) return;
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const lupa = lupaRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      lupa?.focus();
    };
  }, [overlayOpen]);

  // Escritorio: un toque afuera cierra los resultados (lo escrito queda).
  useEffect(() => {
    if (!panelOpen || isMobile) return;
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panelOpen, isMobile]);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearAndClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (flat.length === 0) return;
      event.preventDefault();
      setPanelOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      // La tarjeta ya muestra el resultado marcado; Enter solo evita que se mande un form.
      event.preventDefault();
    }
  };

  const termReady = !!classifySearchTerm(query);
  const showHint = panelOpen && query.trim() !== "" && !termReady;
  const showPanel = panelOpen && (loading || error !== null || result !== null || showHint);

  const body = showPanel ? (
    <div
      className={
        isMobile
          ? "flex-1 space-y-3 overflow-y-auto p-3"
          : "absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-[26rem] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl"
      }
    >
      {showHint && (
        <p className="px-2 py-4 text-center text-sm text-slate-500">
          Escribí al menos 2 letras, el DNI, el CUIT o el número de la habitación.
        </p>
      )}
      {loading && (
        <p className="flex items-center justify-center gap-2 px-4 py-4 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Buscando…
        </p>
      )}
      {!loading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void run(query)}
            className="mt-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
          >
            Reintentar
          </button>
        </div>
      )}
      {!loading && !error && result && !hasResults(result) && termReady && (
        <p className="px-2 py-4 text-center text-sm text-slate-500">
          No encontramos nada con eso. Probá con el nombre, el DNI, el CUIT o el número de la
          habitación.
        </p>
      )}
      {!error && result && hasResults(result) && (
        <>
          <div id={listId} role="listbox" aria-label="Resultados de la búsqueda" className="space-y-2">
            {GROUPS.map((group) => {
              const hits = result[group.key];
              if (hits.length === 0) return null;
              return (
                <div key={group.key} role="group" aria-label={group.label}>
                  <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {group.label}
                  </p>
                  {hits.map((hit) => {
                    const index = flat.indexOf(hit);
                    const selected = index === activeIndex;
                    return (
                      <div
                        key={hit.key}
                        id={optionId(index)}
                        role="option"
                        aria-selected={selected}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          setActiveIndex(index);
                          inputRef.current?.focus();
                        }}
                        className={`cursor-pointer rounded-lg px-3 py-2 ${
                          selected ? "bg-brand-50 ring-1 ring-brand-700/30" : "hover:bg-slate-50"
                        }`}
                      >
                        <p className="truncate text-sm font-semibold text-slate-900">{hit.titulo}</p>
                        {hit.detalle && (
                          <p className="truncate text-xs text-slate-500">{hit.detalle}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {activeHit && <SummaryCard hit={activeHit} onNavigate={clearAndClose} />}
        </>
      )}
    </div>
  ) : null;

  const field = (
    <div className="relative">
      <Search
        size={16}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showPanel && flat.length > 0}
        aria-controls={listId}
        aria-activedescendant={showPanel && flat.length > 0 ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        aria-label={PLACEHOLDER}
        placeholder={PLACEHOLDER}
        value={query}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setPanelOpen(true)}
        onKeyDown={onInputKeyDown}
        className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-base text-slate-900 placeholder:text-slate-400 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/30 md:h-9 md:text-sm"
      />
      {!isMobile && query === "" && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 bg-slate-50 px-1.5 text-[11px] font-semibold text-slate-500 lg:block"
        >
          /
        </kbd>
      )}
      {query !== "" && (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onClick={() => {
            resetQuery();
            inputRef.current?.focus();
          }}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 md:h-7 md:w-7"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="md:hidden">
        <button
          ref={lupaRef}
          type="button"
          onClick={() => setOverlayOpen(true)}
          aria-label="Buscar"
          aria-haspopup="dialog"
          aria-expanded={overlayOpen}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <Search size={20} />
        </button>
        {inputVisible && (
          <div
            data-search-overlay
            role="dialog"
            aria-modal="true"
            aria-label="Buscar"
            className="fixed inset-0 z-50 flex flex-col bg-white text-left"
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
              <div className="min-w-0 flex-1">{field}</div>
              <button
                type="button"
                onClick={clearAndClose}
                aria-label="Cerrar búsqueda"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X size={20} />
              </button>
            </div>
            {body}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative w-72 max-w-full ${placement ? "hidden md:block" : ""}`}>
      {field}
      {body}
    </div>
  );
}
