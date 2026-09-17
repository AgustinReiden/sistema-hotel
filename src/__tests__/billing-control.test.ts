import { describe, expect, it } from "vitest";

import {
  BILLING_ESTADO_MATIZ,
  billingComprobante,
  billingGrupo,
  bulkBillingAction,
} from "@/lib/billing";
import { billingControlCsvFilename, buildBillingControlCsv } from "@/lib/csv";
import type { BillingControlEstado, BillingControlRow } from "@/lib/types";

function row(partial: Partial<BillingControlRow> = {}): BillingControlRow {
  return {
    reservation_id: "r1",
    room_number: "5",
    client_name: "Juan Pérez",
    cliente: "Juan Pérez",
    client_kind: null,
    client_id: null,
    actual_check_out: "2026-08-12T14:00:00Z",
    fch_desde: "2026-08-10",
    fch_hasta: "2026-08-12",
    total_price: 1000,
    cargo_cc: null,
    cierre: "caja",
    facturacion_modo: "por_checkout",
    estado: "falta",
    invoice_id: null,
    invoice_kind: null,
    invoice_status: null,
    cbte_tipo: null,
    pto_vta: null,
    cbte_nro: null,
    imp_total: null,
    external_ref: null,
    bancario: false,
    ...partial,
  };
}

const conEstado = (...estados: BillingControlEstado[]) => estados.map((estado) => row({ estado }));

/** Las filas de datos del CSV, ya sin BOM ni header. */
function dataRows(csv: string): string[][] {
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  return lines.slice(1).map((l) => l.split(";"));
}

describe("bulkBillingAction — qué acción en lote admite una selección", () => {
  it("sin nada seleccionado no hay acción", () => {
    expect(bulkBillingAction([])).toBe("vacio");
  });

  it("todas en 'falta' se pueden marcar", () => {
    expect(bulkBillingAction(conEstado("falta", "falta", "falta"))).toBe("marcar");
  });

  it("'falta' y 'pendiente_consolidada' juntas también se pueden marcar", () => {
    // No son el mismo estado, pero comparten el hecho de que todavía falta
    // facturarlas: la acción es inequívoca, así que se habilita.
    expect(bulkBillingAction(conEstado("falta", "pendiente_consolidada"))).toBe("marcar");
  });

  it("todas en 'facturado_externo' se pueden deshacer", () => {
    expect(bulkBillingAction(conEstado("facturado_externo", "facturado_externo"))).toBe("deshacer");
  });

  it("mezclar pendientes con ya marcadas deshabilita todo", () => {
    expect(bulkBillingAction(conEstado("falta", "facturado_externo"))).toBe("mezclado");
    expect(bulkBillingAction(conEstado("pendiente_consolidada", "facturado_externo"))).toBe(
      "mezclado"
    );
  });

  it("mezclar una marcable con una que no admite lote también es 'mezclado'", () => {
    expect(bulkBillingAction(conEstado("falta", "facturado"))).toBe("mezclado");
  });

  it("todas iguales pero en un estado sin lote es 'sin_accion', no 'mezclado'", () => {
    // Decirle "elegí filas del mismo estado" a alguien que eligió filas del mismo
    // estado sería mentirle: son casos distintos y el mensaje también.
    expect(bulkBillingAction(conEstado("facturado", "facturado"))).toBe("sin_accion");
    expect(bulkBillingAction(conEstado("en_proceso"))).toBe("sin_accion");
    expect(bulkBillingAction(conEstado("no_corresponde", "no_corresponde"))).toBe("sin_accion");
  });

  it("una sola fila marcable habilita el marcado", () => {
    expect(bulkBillingAction(conEstado("falta"))).toBe("marcar");
    expect(bulkBillingAction(conEstado("facturado_externo"))).toBe("deshacer");
  });
});

describe("billingGrupo — los dos grupos del filtro de estado", () => {
  it("manda a 'pendiente' todo lo que todavía pide una acción", () => {
    expect(billingGrupo("falta")).toBe("pendiente");
    expect(billingGrupo("pendiente_consolidada")).toBe("pendiente");
    // Emitida pero sin CAE todavía: hasta que ARCA conteste puede terminar
    // rechazada, así que no se le dice al admin que ya está facturada.
    expect(billingGrupo("en_proceso")).toBe("pendiente");
  });

  it("manda a 'facturado' lo que ya no pide ninguna acción", () => {
    expect(billingGrupo("facturado")).toBe("facturado");
    expect(billingGrupo("facturado_consolidado")).toBe("facturado");
    expect(billingGrupo("facturado_externo")).toBe("facturado");
    // No lleva comprobante y nadie tiene que hacer nada: cae de este lado del
    // filtro aunque su chip en pantalla diga "No corresponde".
    expect(billingGrupo("no_corresponde")).toBe("facturado");
  });

  it("conserva el matiz de los estados que no se explican solos", () => {
    expect(BILLING_ESTADO_MATIZ.facturado_externo).toBe("por fuera");
    expect(BILLING_ESTADO_MATIZ.facturado_consolidado).toBe("consolidada");
    expect(BILLING_ESTADO_MATIZ.pendiente_consolidada).toBe("espera consolidada");
    expect(BILLING_ESTADO_MATIZ.falta).toBeNull();
    expect(BILLING_ESTADO_MATIZ.facturado).toBeNull();
  });
});

describe("billingComprobante", () => {
  it("el comprobante externo declarado a mano gana sobre el emitido", () => {
    const r = row({ external_ref: "FC A 0008-00000123", cbte_tipo: 6, pto_vta: 3, cbte_nro: 45 });
    expect(billingComprobante(r)).toBe("FC A 0008-00000123");
  });

  it("arma el número del comprobante emitido con su letra", () => {
    expect(billingComprobante(row({ cbte_tipo: 1, pto_vta: 3, cbte_nro: 45 }))).toBe(
      "A 00003-00000045"
    );
    expect(billingComprobante(row({ cbte_tipo: 6, pto_vta: 3, cbte_nro: 45 }))).toBe(
      "B 00003-00000045"
    );
  });

  it("devuelve null cuando no hay ninguno", () => {
    expect(billingComprobante(row())).toBeNull();
  });
});

describe("buildBillingControlCsv — el archivo que se le manda al contador", () => {
  it("lleva las 8 columnas acordadas, en orden", () => {
    const csv = buildBillingControlCsv([]);
    const header = csv.replace(/^﻿/, "").split("\r\n")[0];
    expect(header).toBe(
      "Salida;Habitacion;Cliente;Cierre;Total;Cargo cta. cte.;Estado;Comprobante"
    );
  });

  it("abre con BOM UTF-8 para que Excel no rompa los acentos", () => {
    const csv = buildBillingControlCsv([row({ cliente: "Ñandú Bebidas S.R.L." })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Ñandú Bebidas S.R.L.");
  });

  it("escribe fecha DD/MM/AAAA, montos con coma decimal y las etiquetas de pantalla", () => {
    const csv = buildBillingControlCsv([
      row({ total_price: 1234.5, cargo_cc: 800, cierre: "cuenta_corriente", estado: "falta" }),
    ]);
    const [salida, hab, cliente, cierre, total, cargo, estado] = dataRows(csv)[0];
    expect(salida).toBe("12/08/2026");
    expect(hab).toBe("5");
    expect(cliente).toBe("Juan Pérez");
    expect(cierre).toBe("Cta. cte.");
    expect(total).toBe("1234,50");
    expect(cargo).toBe("800,00");
    expect(estado).toBe("FALTA FACTURAR");
  });

  it("deja el cargo a cta. cte. VACÍO cuando no hay, en vez de un 0,00 que sería falso", () => {
    const csv = buildBillingControlCsv([row({ cargo_cc: null })]);
    expect(dataRows(csv)[0][5]).toBe("");
  });

  it("neutraliza la inyección de fórmulas de Excel en cliente y comprobante", () => {
    // Ambos son texto untrusted: el nombre puede venir de una reserva pública y el
    // comprobante lo tipea a mano un admin.
    const csv = buildBillingControlCsv([
      row({ cliente: '=HYPERLINK("http://evil","cobrar acá")', external_ref: "+1+1" }),
    ]);
    const fields = dataRows(csv)[0];
    expect(fields[2].replace(/^"/, "").startsWith("'")).toBe(true);
    expect(fields[7].replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("no deja que un ';' en el nombre corra las columnas", () => {
    const csv = buildBillingControlCsv([row({ cliente: "Pérez; Juan" })]);
    const linea = csv.replace(/^﻿/, "").split("\r\n")[1];
    expect(linea).toContain('"Pérez; Juan"');
    // Entrecomillado, la fila sigue teniendo 8 campos reales.
    expect(linea.match(/"/g)?.length).toBe(2);
  });

  it("exporta una fila por cada estadía visible, en el mismo orden", () => {
    const csv = buildBillingControlCsv([
      row({ reservation_id: "a", room_number: "1" }),
      row({ reservation_id: "b", room_number: "2" }),
      row({ reservation_id: "c", room_number: "3" }),
    ]);
    const filas = dataRows(csv);
    expect(filas).toHaveLength(3);
    expect(filas.map((f) => f[1])).toEqual(["1", "2", "3"]);
  });

  it("sin filas no escribe ninguna fila de datos (el botón avisa y no descarga)", () => {
    const csv = buildBillingControlCsv([]);
    expect(csv.replace(/^﻿/, "").includes("\r\n")).toBe(false);
  });
});

describe("billingControlCsvFilename", () => {
  it("lleva el rango, para que dos descargas no se pisen en Descargas", () => {
    expect(billingControlCsvFilename("2026-08-01", "2026-08-31")).toBe(
      "control-facturacion-2026-08-01_2026-08-31.csv"
    );
  });
});
