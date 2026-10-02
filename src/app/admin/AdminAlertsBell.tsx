"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Loader2, X } from "lucide-react";

import AdminAlertsList from "./AdminAlertsList";
import { listAdminAlertsAction } from "./mantenimiento/actions";
import { formatAlertsCount, OPEN_ALERTS_EVENT } from "@/lib/admin-alerts";
import { DEFAULT_TZ } from "@/lib/time";
import type { AdminAlert } from "@/lib/types";

type Props = {
  /** Avisos sin resolver según el layout (solo se calcula para el admin). */
  initialCount: number;
  /**
   * Dónde está: en la barra de arriba del escritorio o en la barra negra del celular.
   * El marco dibuja las dos y cada una se esconde en el otro tamaño; con esto, "Ver
   * avisos" abre solo la que se ve (y la lista se pide una vez). Sin placement, siempre.
   */
  placement?: "desktop" | "mobile";
};

const DESKTOP_QUERY = "(min-width: 768px)";

// La campana de avisos del admin (`admin_alerts`): el número de sin revisar y, al
// tocarla, la lista con sus acciones. En el escritorio se despliega debajo de la campana;
// en el celular ocupa la pantalla entera. La lista se pide al abrir, no con cada pantalla:
// el layout solo cuenta.
export default function AdminAlertsBell({ initialCount, placement }: Props) {
  const [count, setCount] = useState(initialCount);
  // Después de un router.refresh() el layout trae el número de nuevo: se toma ese.
  const [prevInitial, setPrevInitial] = useState(initialCount);
  if (prevInitial !== initialCount) {
    setPrevInitial(initialCount);
    setCount(initialCount);
  }

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AdminAlert[] | null>(null);
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const requestRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setAlerts(null);
    const result = await listAdminAlertsAction().catch(() => null);
    // Si se volvió a abrir mientras tanto, manda la respuesta más nueva.
    if (request !== requestRef.current) return;
    setLoading(false);
    if (!result || !result.success) {
      setError(result?.error ?? "No se pudieron leer los avisos.");
      return;
    }
    const list = result.data?.alerts ?? [];
    setAlerts(list);
    setTimezone(result.data?.timezone || DEFAULT_TZ);
    setCount(list.length);
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const closePanel = () => setOpen(false);

  // Una nota a medio escribir no se pierde por un Escape o un toque en el fondo.
  const hasDraft = () =>
    Array.from(dialogRef.current?.querySelectorAll("textarea") ?? []).some(
      (t) => t.value.trim() !== "",
    );
  const closeUnlessDraft = () => {
    if (!hasDraft()) closePanel();
  };

  // "Ver avisos" (Hoy) la abre desde cualquier parte.
  useEffect(() => {
    const onOpen = () => {
      if (placement && typeof window.matchMedia === "function") {
        const isDesktop = window.matchMedia(DESKTOP_QUERY).matches;
        if (isDesktop !== (placement === "desktop")) return;
      }
      openPanel();
    };
    window.addEventListener(OPEN_ALERTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ALERTS_EVENT, onOpen);
  }, [placement, openPanel]);

  useEffect(() => {
    if (!open) return;
    const bell = bellRef.current;
    closeRef.current?.focus();
    // En el celular la hoja tapa todo: la página de atrás no se mueve (como MobileNav).
    const isDesktop =
      typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
    const previousOverflow = document.body.style.overflow;
    if (!isDesktop) document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const draft = Array.from(dialogRef.current?.querySelectorAll("textarea") ?? []).some(
          (t) => t.value.trim() !== "",
        );
        if (!draft) setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      // Trampa de foco: el diálogo es modal.
      const items = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]",
        ) ?? [],
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      bell?.focus();
    };
  }, [open]);

  const handleResolved = (alertId: number) => {
    setAlerts((prev) => (prev ? prev.filter((a) => a.id !== alertId) : prev));
    setCount((c) => Math.max(0, c - 1));
  };

  const onDark = placement === "mobile";
  const label = count > 0 ? `Avisos: ${formatAlertsCount(count)} sin revisar` : "Avisos";
  const visibility =
    placement === "desktop" ? "hidden md:block" : placement === "mobile" ? "md:hidden" : "";

  return (
    <div className={`relative ${visibility}`}>
      <button
        ref={bellRef}
        type="button"
        onClick={() => (open ? closePanel() : openPanel())}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors md:h-9 md:w-9 ${
          onDark
            ? "text-slate-300 hover:bg-slate-800 hover:text-white"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <Bell size={20} />
        {count > 0 && (
          <span
            data-alerts-badge
            aria-hidden
            className="absolute -right-0.5 -top-0.5 min-w-[1.125rem] rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-[1.125rem] text-white"
          >
            {formatAlertsCount(count)}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Cerrar avisos"
            onClick={closeUnlessDraft}
            className="fixed inset-0 z-40 cursor-default bg-slate-900/40 md:bg-transparent"
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Avisos sin revisar"
            className="fixed inset-0 z-50 flex flex-col bg-slate-50 text-left md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:max-h-[70vh] md:w-[26rem] md:overflow-hidden md:rounded-2xl md:border md:border-slate-200 md:shadow-2xl"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 md:h-12">
              <p className="text-sm font-bold text-slate-800">Avisos sin revisar</p>
              <button
                ref={closeRef}
                type="button"
                onClick={closePanel}
                aria-label="Cerrar avisos"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 md:h-9 md:w-9"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {loading && (
                <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
                  <Loader2 size={16} className="animate-spin" />
                  Buscando avisos…
                </p>
              )}
              {!loading && error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  <p>{error}</p>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="mt-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Reintentar
                  </button>
                </div>
              )}
              {!loading && !error && alerts && (
                <AdminAlertsList
                  alerts={alerts}
                  hotelTimezone={timezone}
                  onResolved={handleResolved}
                  onNavigate={closePanel}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
