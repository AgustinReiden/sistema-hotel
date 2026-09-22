import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { calcularDV, codigoRemito, interpretarCodigo, numeroVisible } from "@/lib/remito-codigo";

type CodigoAutomatizacion = {
  calcularDV(prefijo: string, numero: number): string;
  formatearCodigo(prefijo: string, numero: number): string;
  interpretarCodigo(texto: string): { ok: boolean; motivo?: string; numero?: number; prefijo?: string };
};

async function automatizacion(): Promise<CodigoAutomatizacion> {
  const ruta = path.resolve(process.cwd(), "automatizaciones/remitos/comun/codigo.mjs");
  return (await import(/* @vite-ignore */ pathToFileURL(ruta).href)) as CodigoAutomatizacion;
}

describe("codigo del remito", () => {
  it("numero visible y codigo completo", () => {
    expect(numeroVisible(158)).toBe("R-000158");
    expect(codigoRemito(158)).toMatch(/^R-000158-\d{2}$/);
  });

  it("da exactamente el mismo DV que la automatizacion (R y T, del 0 al 5000 y los bordes)", async () => {
    const a = await automatizacion();
    for (const prefijo of ["R", "T"]) {
      for (let n = 0; n <= 5000; n++) expect(calcularDV(prefijo, n)).toBe(a.calcularDV(prefijo, n));
    }
    for (const n of [999998, 999999]) expect(codigoRemito(n)).toBe(a.formatearCodigo("R", n));
  });

  it("lee lo mismo que la automatizacion y rechaza lo mismo", async () => {
    const a = await automatizacion();
    const bueno = codigoRemito(158);
    const dvMalo = bueno.slice(0, -2) + (bueno.endsWith("00") ? "01" : "00");
    for (const t of [bueno, dvMalo, "R-158-00", "X", ""]) {
      expect(interpretarCodigo(t).ok).toBe(a.interpretarCodigo(t).ok);
    }
    expect(interpretarCodigo(bueno)).toEqual({ ok: true, prefijo: "R", numero: 158, visible: "R-000158" });
    expect(interpretarCodigo(dvMalo)).toEqual({ ok: false, motivo: "dv_invalido" });
  });

  it("R y T con el mismo numero no comparten codigo", () => {
    expect(codigoRemito(158, "R")).not.toBe(codigoRemito(158, "T").replace(/^T/, "R"));
  });
});
