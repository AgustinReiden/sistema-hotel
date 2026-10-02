"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const UNSAVED_CHANGES_MESSAGE = "Tenés cambios sin guardar. ¿Salir igual?";

/** Los datos de un formulario como texto, para comparar con la foto del momento de abrirlo. */
export function serializeForm(form: HTMLFormElement): string {
  const params = new URLSearchParams();
  new FormData(form).forEach((value, key) => {
    params.append(key, typeof value === "string" ? value : value.name);
  });
  return params.toString();
}

/**
 * ¿El formulario tiene cambios? Compara lo que hay escrito con la foto del momento de
 * abrirlo (o del último guardado). `check` se llama después de cada cambio; `markSaved`,
 * cuando el servidor confirmó el guardado.
 */
export function useFormDirty(onDirtyChange?: (dirty: boolean) => void) {
  const formRef = useRef<HTMLFormElement>(null);
  const snapshot = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const onDirtyChangeRef = useRef(onDirtyChange);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });

  const apply = useCallback((next: boolean) => {
    setDirty(next);
    onDirtyChangeRef.current?.(next);
  }, []);

  const check = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const now = serializeForm(form);
    if (snapshot.current === null) snapshot.current = now;
    apply(now !== snapshot.current);
  }, [apply]);

  const markSaved = useCallback(() => {
    const form = formRef.current;
    if (form) snapshot.current = serializeForm(form);
    apply(false);
  }, [apply]);

  return { formRef, dirty, check, markSaved };
}

/**
 * Con cambios sin guardar avisa antes de irse de Configuración:
 * - cerrar o recargar la pestaña: el aviso del navegador (`beforeunload`);
 * - tocar un link que lleva a otra pantalla: pregunta y, si dice que no, el clic muere
 *   antes de llegar al Link de Next (listener en captura).
 * Pasar de una pestaña de Configuración a otra no pregunta: los paneles siguen montados.
 * No cubre un `router.push` hecho por código; en esta pantalla no hay ninguno.
 */
export function useUnsavedChangesGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome viejo exige que returnValue tenga algo.
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      // Abre otra pestaña o baja un archivo: esta pantalla queda como está.
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;

      let destino: URL;
      try {
        destino = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      // Otro sitio: lo cubre `beforeunload`.
      if (destino.origin !== window.location.origin) return;
      // Dentro de Configuración (otra pestaña, un ancla) no se pierde nada.
      if (destino.pathname === window.location.pathname) return;

      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
