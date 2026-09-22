import { describe, expect, it } from "vitest";

import {
  accionesRemito,
  avisosSalud,
  haceDias,
  iaTexto,
  motivoPiezaLabel,
  parseNumeroRemito,
  piezaAsignable,
  rangoDeMes,
  resumirRemitos,
  textoSemaforo,
} from "@/lib/remitos";
import { codigoRemito } from "@/lib/remito-codigo";
import type { RemitoEstado, RemitoPanelRow, RemitosSalud } from "@/lib/types";

const fila = (estado: RemitoEstado, extra: Partial<RemitoPanelRow> = {}): RemitoPanelRow => ({
  movimiento_id: `m-${estado}`, remito_numero: 158, created_at: "2026-09-20T12:00:00Z", amount: 50000,
  client_kind: "company", client_id: "c1", cliente: "Empresa de prueba", room_number: "7", pasajero: "Pasajero",
  estado, decidido_por: null, decidido_por_nombre: null, estado_at: null, nota: null,
  escaneo_version: null, escaneo_link: null, escaneo_origen: null,
  firma_ia: null, firma_ia_confianza: null, firma_ia_observacion: null, ...extra,
});

const SALUD: RemitosSalud = {
  ultima_ingesta_at: null, ultima_evaluacion_at: null, evaluando_viejos: 0, a_revisar: 0,
  piezas_abiertas: 0, umbral_confianza: 0.95, controlar_desde: 158, max_intentos_firma: 5,
};
const AHORA = Date.parse("2026-09-22T15:00:00Z");

describe("remitos: ayudantes del panel", () => {
  it("el numero se tipea como venga, pero un DV que no cierra se rechaza", () => {
    expect(parseNumeroRemito("158")).toBe(158);
    expect(parseNumeroRemito(" r-000158 ")).toBe(158);
    expect(parseNumeroRemito("R158")).toBe(158);
    expect(parseNumeroRemito(codigoRemito(158))).toBe(158);
    const malo = codigoRemito(158).slice(0, -2) + (codigoRemito(158).endsWith("00") ? "01" : "00");
    expect(parseNumeroRemito(malo)).toBeNull();
    expect(parseNumeroRemito("0")).toBeNull();
    expect(parseNumeroRemito("1234567")).toBeNull();
    expect(parseNumeroRemito("abc")).toBeNull();
  });

  it("semaforo: cuenta por estado y no nombra los ceros", () => {
    const r = resumirRemitos([fila("firmado"), fila("firmado"), fila("sin_firma"), fila("sin_escanear")]);
    expect(textoSemaforo(r)).toBe("4 remitos: 2 firmados · 1 sin firma · 1 sin escanear");
    expect(textoSemaforo(resumirRemitos([]))).toBe("No hay remitos en este período.");
    expect(textoSemaforo(resumirRemitos([fila("firmado")]))).toBe("1 remito: 1 firmado");
  });

  it("avisos: la ingesta parada es rojo; nunca corrio es informativo", () => {
    expect(avisosSalud(SALUD, AHORA)).toEqual([
      { tono: "info", texto: "La ingesta de remitos todavía no registró ninguna corrida." },
    ]);
    const parada = avisosSalud({ ...SALUD, ultima_ingesta_at: "2026-09-22T12:00:00Z" }, AHORA);
    expect(parada[0].tono).toBe("alert");
    expect(parada[0].texto).toMatch(/no corre desde hace 3 h/);
    expect(avisosSalud({ ...SALUD, ultima_ingesta_at: "2026-09-22T14:50:00Z" }, AHORA)).toEqual([]);
    const lenta = avisosSalud({ ...SALUD, ultima_ingesta_at: "2026-09-22T14:50:00Z", evaluando_viejos: 2 }, AHORA);
    expect(lenta).toHaveLength(1);
    expect(lenta[0].texto).toMatch(/2 remitos esperan/);
  });

  it("acciones: sin escaneo solo se puede decir que se perdio; nunca se ofrece el estado actual", () => {
    expect(accionesRemito("sin_escanear").map((a) => a.estado)).toEqual(["sin_remito"]);
    expect(accionesRemito("firmado").map((a) => a.estado)).toEqual(["sin_firma", "sin_remito", "a_revisar"]);
  });

  it("piezas: con varios tickets no se asignan a mano", () => {
    expect(piezaAsignable("codigo_ilegible")).toBe(true);
    expect(piezaAsignable("forma_no_reconocida")).toBe(false);
    expect(piezaAsignable("varios_codigos")).toBe(false);
    expect(motivoPiezaLabel("forma_no_reconocida")).toBe("Tickets pegados o forma rara");
    expect(motivoPiezaLabel("algo_nuevo")).toBe("algo nuevo");
  });

  it("IA, dias y rango del mes", () => {
    expect(iaTexto(fila("firmado", { firma_ia: "si", firma_ia_confianza: 0.98 }))).toBe("firmado 98%");
    expect(iaTexto(fila("sin_firma", { firma_ia: "no", firma_ia_confianza: 0.97 }))).toBe("sin firma 97%");
    expect(iaTexto(fila("evaluando"))).toBe("esperando");
    expect(iaTexto(fila("sin_escanear"))).toBeNull();
    expect(haceDias("2026-09-20T12:00:00Z", AHORA)).toBe("hace 2 días");
    expect(haceDias("2026-09-22T10:00:00Z", AHORA)).toBe("hoy");
    expect(rangoDeMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoDeMes("2026-12")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});
