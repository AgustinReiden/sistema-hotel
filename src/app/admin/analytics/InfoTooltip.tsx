"use client";

// Ícono "i" que al pasar el mouse (o tocar en mobile) explica qué es una métrica y
// cómo se calcula. El popover se renderiza en un portal a <body> con posición fixed,
// así no lo recortan los `overflow-hidden`/`rounded` de las tarjetas ni pelea con el
// z-index de la grilla. `tone="light"` para fondos oscuros (ícono blanco).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { METRIC_INFO, type MetricKey } from "@/lib/metric-glossary";

type Props = {
  metric?: MetricKey;
  title?: string;
  what?: string;
  how?: string;
  tone?: "light" | "dark";
};

const POP_W = 260;

export default function InfoTooltip({ metric, title, what, how, tone = "dark" }: Props) {
  const info = metric ? METRIC_INFO[metric] : undefined;
  const t = title ?? info?.title ?? "";
  const w = what ?? info?.what ?? "";
  const h = how ?? info?.how ?? "";

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let left = r.left + r.width / 2 - POP_W / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - POP_W - margin));
    setCoords({ top: r.bottom + 8, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  if (!t) return null;

  const iconColor =
    tone === "light" ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-slate-600";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Qué es: ${t}`}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center justify-center rounded-full align-middle cursor-help transition-colors ${iconColor}`}
      >
        <Info size={15} strokeWidth={2.25} />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={popRef}
            role="tooltip"
            style={{ position: "fixed", top: coords.top, left: coords.left, width: POP_W }}
            className="z-[100] rounded-xl bg-slate-900 p-3 text-left text-white shadow-2xl ring-1 ring-black/10"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="mb-1 text-xs font-bold">{t}</div>
            <div className="text-xs leading-relaxed text-slate-200">{w}</div>
            {h && (
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Cómo se calcula
                </div>
                <div className="text-xs leading-relaxed text-slate-200">{h}</div>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
