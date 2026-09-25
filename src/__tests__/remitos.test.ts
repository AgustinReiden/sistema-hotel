import { describe, expect, it } from "vitest";

import {
  accionesRemito,
  avisosSalud,
  esVencido,
  estadoPaquete,
  haceCuanto,
  haceDias,
  iaTexto,
  motivoPiezaLabel,
  motivoVencido,
  parseNumeroRemito,
  piezaAsignable,
  rangoDeMes,
  remitosParaRevisar,
  resumirRemitos,
  textoParaRevisar,
  textoSemaforo,
  textoVencidos,
} from "@/lib/remitos";
import { codigoRemito } from "@/lib/remito-codigo";
import type { RemitoEstado, RemitoPanelRow, RemitoPaqueteEstado, RemitoPaqueteFactura, RemitosSalud } from "@/lib/types";

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
  vencidos: 0, a_revisar_vencidos: 0, horas_vencimiento: 48, alertar_desde: "2026-09-24",
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

describe("vencidos (mig 124)", () => {
  const AHORA = Date.parse("2026-09-28T15:00:00Z");
  const AJ = { horas_vencimiento: 48, alertar_desde: "2026-09-24" };
  const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

  it("vence a las 48 h si no está firmado ni marcado sin remito", () => {
    expect(esVencido(fila("sin_escanear", { created_at: hace(49) }), AJ, AHORA)).toBe(true);
    expect(esVencido(fila("sin_escanear", { created_at: hace(47) }), AJ, AHORA)).toBe(false);
    for (const e of ["evaluando", "a_revisar", "sin_firma"] as const) {
      expect(esVencido(fila(e, { created_at: hace(49) }), AJ, AHORA)).toBe(true);
    }
    expect(esVencido(fila("firmado", { created_at: hace(200) }), AJ, AHORA)).toBe(false);
    expect(esVencido(fila("sin_remito", { created_at: hace(200) }), AJ, AHORA)).toBe(false);
  });

  it("los cargos anteriores a alertar_desde no vencen", () => {
    // 2026-09-23 21:00 en Argentina es 2026-09-24 00:00 UTC: cuenta la fecha del hotel.
    expect(esVencido(fila("sin_escanear", { created_at: "2026-09-24T00:00:00Z" }), AJ, AHORA)).toBe(false);
    expect(esVencido(fila("sin_escanear", { created_at: "2026-09-24T03:30:00Z" }), AJ, AHORA)).toBe(true);
  });

  it("motivo del vencido en castellano", () => {
    expect(motivoVencido("sin_escanear")).toBe("sin escanear");
    expect(motivoVencido("evaluando")).toBe("la IA todavía no lo miró");
    expect(motivoVencido("a_revisar")).toBe("a revisar");
    expect(motivoVencido("sin_firma")).toBe("sin firma");
  });

  it("resumen de vencidos por motivo", () => {
    expect(textoVencidos([fila("sin_escanear"), fila("sin_escanear"), fila("sin_firma")])).toBe(
      "3 vencidos: 2 sin escanear · 1 sin firma"
    );
    expect(textoVencidos([fila("a_revisar")])).toBe("1 vencido: 1 a revisar");
  });

  it("para revisar: el menú y el panel dicen lo mismo, sin contar dos veces", () => {
    const s = { ...SALUD, a_revisar: 3, a_revisar_vencidos: 1, vencidos: 4, piezas_abiertas: 1 };
    expect(remitosParaRevisar(s)).toEqual({ remitos: 2, vencidos: 4, piezas: 1, total: 7 });
    expect(textoParaRevisar(remitosParaRevisar(s))).toBe("Para revisar: 2 remitos, 4 vencidos y 1 pieza");
    expect(textoParaRevisar({ remitos: 0, vencidos: 1, piezas: 0, total: 1 })).toBe("Para revisar: 1 vencido");
    expect(textoParaRevisar({ remitos: 0, vencidos: 0, piezas: 0, total: 0 })).toBeNull();
  });

  it("hace cuánto salió: horas hasta 3 días, después días", () => {
    expect(haceCuanto(hace(50), AHORA)).toBe("hace 50 h");
    expect(haceCuanto(hace(80), AHORA)).toBe("hace 3 días");
  });

  it("el semáforo del mes suma los vencidos", () => {
    const r = resumirRemitos([fila("firmado"), fila("sin_escanear")]);
    expect(textoSemaforo(r, 1)).toBe("2 remitos: 1 firmado · 1 sin escanear · 1 vencido");
    expect(textoSemaforo(r)).toBe("2 remitos: 1 firmado · 1 sin escanear");
  });
});

describe("paquetes", () => {
  const AHORA = Date.parse("2026-10-01T15:00:00Z");
  const base = (paquete: RemitoPaqueteFactura["paquete"], extra: Partial<RemitoPaqueteFactura> = {}): RemitoPaqueteFactura => ({
    invoice_id: "i1", factura_texto: "FB 00008-00000010", cbte_fch: "2026-09-30", imp_total: 100,
    remitos_total: 3, remitos_firmados: 2, constancia: null, paquete, firmados_nuevos: 0, ...extra,
  });
  const paq = (estado: RemitoPaqueteEstado, extra = {}) => ({
    id: "p1", version: 1, estado, remitos: 2, drive_link: estado === "listo" ? "https://example.test/p" : null,
    error: null, pedido_at: "2026-10-01T14:50:00Z", armando_at: "2026-10-01T14:51:00Z", terminado_at: null, ...extra,
  });

  it("sin paquete se puede armar; sin firmados no", () => {
    expect(estadoPaquete(base(null), AHORA)).toEqual({ puedeArmar: true, armando: false, texto: null });
    expect(estadoPaquete(base(null, { remitos_firmados: 0 }), AHORA).puedeArmar).toBe(false);
  });

  it("pedido o armando: esperar; trabado más de 30 min: se puede volver a pedir", () => {
    expect(estadoPaquete(base(paq("armando")), AHORA)).toMatchObject({ puedeArmar: false, armando: true });
    const trabado = paq("armando", { armando_at: "2026-10-01T14:00:00Z" });
    expect(estadoPaquete(base(trabado), AHORA)).toMatchObject({ puedeArmar: true, armando: false, texto: "Se cortó a mitad de camino: volvé a pedirlo." });
  });

  it("listo con firmados nuevos: avisa y deja volver a armar", () => {
    expect(estadoPaquete(base(paq("listo"), { firmados_nuevos: 1 }), AHORA)).toMatchObject({
      puedeArmar: true, texto: "Hay 1 remito firmado nuevo: volvé a armarlo.",
    });
    expect(estadoPaquete(base(paq("listo")), AHORA)).toMatchObject({ puedeArmar: false, texto: null });
  });

  it("error: muestra el motivo y deja volver a pedir", () => {
    expect(estadoPaquete(base(paq("error", { error: "R-000163: el archivo de Drive no está" })), AHORA)).toMatchObject({
      puedeArmar: true, texto: "No se pudo armar: R-000163: el archivo de Drive no está",
    });
  });
});
