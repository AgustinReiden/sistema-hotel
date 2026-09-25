import { afterEach, describe, expect, it, vi } from "vitest";

import { openPrintWindow } from "@/lib/print-window";

describe("openPrintWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("da false si el navegador bloqueó la ventana (window.open devuelve null)", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));

    expect(openPrintWindow("/admin/comprobante-cc/mov-1?autoprint=1", "comprobante-mov-1")).toBe(
      false
    );
  });

  it("da true si la ventana abrió, con la firma de ventana de la comandera", () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);

    expect(openPrintWindow("/admin/comprobante-cc/mov-1?autoprint=1", "comprobante-mov-1")).toBe(
      true
    );
    expect(open).toHaveBeenCalledWith(
      "/admin/comprobante-cc/mov-1?autoprint=1",
      "comprobante-mov-1",
      "width=420,height=720"
    );
  });

  it("da false si window.open tira un error en lugar de abrir", () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => {
        throw new Error("bloqueado");
      })
    );

    expect(openPrintWindow("/admin/recibo/p-1?autoprint=1", "recibo-p-1")).toBe(false);
  });
});
