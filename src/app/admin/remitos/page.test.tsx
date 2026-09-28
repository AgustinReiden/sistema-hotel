import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RemitosPage from "./page";
import { BILLING_EPOCH } from "@/lib/date-range";
import { remitosParaRevisar } from "@/lib/remitos";
import type { RemitoEstado, RemitoPanelRow, RemitosSalud } from "@/lib/types";

// page.tsx es un server component async: se lo llama como función. Los datos vienen de
// la base, que acá no hay, y el panel queda como un marcador que guarda sus props, así
// se ve qué le llega: el rango que se pidió y las filas que muestra.
// `montajes` cuenta las veces que el panel se monta de cero (el filtro arranca de las props).
const H = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, montajes: 0 }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("./RemitosClient", async () => {
  const { useState } = await import("react");
  return {
    default: function PanelFalso(props: Record<string, unknown>) {
      const [montaje] = useState(() => ++H.montajes);
      H.props = { ...props, montaje };
      return null;
    },
  };
});

const listRemitos = vi.fn();
const getRemitosSalud = vi.fn();
vi.mock("@/lib/data", () => ({
  getCurrentUserRole: async () => "admin",
  getCtaCteAccounts: async () => [],
  getRemitosSalud: () => getRemitosSalud(),
  listRemitoPaquetes: async () => [],
  listRemitoPiezas: async () => [],
  listRemitos: (...a: unknown[]) => listRemitos(...a),
}));

// Domingo 27/09 al mediodía en el hotel.
const AHORA = new Date("2026-09-27T15:00:00Z");
const HOY = "2026-09-27";

let n = 200;
const fila = (estado: RemitoEstado, created_at: string): RemitoPanelRow => ({
  movimiento_id: `m${++n}`, remito_numero: n, created_at, amount: 50000,
  client_kind: "company", client_id: "c1", cliente: "Empresa Ficticia SA", room_number: "7", pasajero: "Juan Prueba",
  estado, decidido_por: null, decidido_por_nombre: null, estado_at: null, nota: null,
  escaneo_version: 1, escaneo_link: "https://example.test/x", escaneo_origen: "qr", firma_ia: null,
  firma_ia_confianza: null, firma_ia_observacion: null,
});

// Uno a revisar de agosto (otro mes, no vence: es de antes de alertar_desde), uno a
// revisar del 24/09 que ya venció (48 h) y dos que no son "a revisar".
const DE_AGOSTO = fila("a_revisar", "2026-08-10T12:00:00Z");
const VENCIDO = fila("a_revisar", "2026-09-24T12:00:00Z");
const FIRMADO = fila("firmado", "2026-08-11T12:00:00Z");
const SIN_FIRMA = fila("sin_firma", "2026-08-12T12:00:00Z");
const TODOS = [DE_AGOSTO, VENCIDO, FIRMADO, SIN_FIRMA];

// Lo que la base cuenta para el menú con esas mismas filas.
const SALUD: RemitosSalud = {
  ultima_ingesta_at: "2026-09-27T14:55:00Z", ultima_evaluacion_at: "2026-09-27T14:55:00Z",
  evaluando_viejos: 0, a_revisar: 2, piezas_abiertas: 0, umbral_confianza: 0.95, controlar_desde: 151,
  max_intentos_firma: 5, vencidos: 1, a_revisar_vencidos: 1, horas_vencimiento: 48, alertar_desde: "2026-09-24",
};

const abrir = async (params: { cliente?: string; mes?: string; ver?: string }) => {
  render(await RemitosPage({ searchParams: Promise.resolve(params) }));
  return H.props!;
};
const filas = (props: Record<string, unknown>) => (props.rows as RemitoPanelRow[]).map((r) => r.movimiento_id);

describe("RemitosPage: lo que dice el menú es lo que se ve al abrir", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    vi.clearAllMocks();
    H.props = null;
    H.montajes = 0;
    listRemitos.mockResolvedValue(TODOS);
    getRemitosSalud.mockResolvedValue(SALUD);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("?ver=a_revisar pide los remitos de todo el historial y muestra solo los a revisar que no vencieron", async () => {
    const props = await abrir({ ver: "a_revisar", mes: "2026-09" });
    // Desde siempre hasta hoy, no el mes elegido: el de agosto tiene que aparecer.
    expect(listRemitos).toHaveBeenNthCalledWith(1, BILLING_EPOCH, HOY, undefined, undefined);
    expect(props.aRevisar).toBe(true);
    expect(filas(props)).toEqual([DE_AGOSTO.movimiento_id]);
    // El vencido va en su propia lista, no repetido en esta.
    expect((props.vencidos as RemitoPanelRow[]).map((r) => r.movimiento_id)).toEqual([VENCIDO.movimiento_id]);
    // Son tantos como los remitos que cuenta el numerito del menú.
    expect(filas(props)).toHaveLength(remitosParaRevisar(SALUD).remitos);
  });

  it("?ver=a_revisar respeta el cliente elegido", async () => {
    await abrir({ ver: "a_revisar", cliente: "company:c1" });
    expect(listRemitos).toHaveBeenNthCalledWith(1, BILLING_EPOCH, HOY, "company", "c1");
  });

  it("sin ?ver= sigue siendo la tabla del mes, con todos sus estados", async () => {
    const props = await abrir({ mes: "2026-09" });
    expect(listRemitos).toHaveBeenNthCalledWith(1, "2026-09-01", "2026-09-30", undefined, undefined);
    expect(props.aRevisar).toBe(false);
    expect(filas(props)).toEqual(TODOS.map((r) => r.movimiento_id));
  });
});

// Si no se sabe qué venció, sacar los vencidos de la lista escondería un remito a revisar
// que tampoco está en la lista de vencidos.
describe("RemitosPage: ?ver=a_revisar cuando algo no carga", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    H.props = null;
    H.montajes = 0;
    getRemitosSalud.mockResolvedValue(SALUD);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("si falla la salud, trae todos los a revisar (también el que venció) y lo dice", async () => {
    listRemitos.mockResolvedValue(TODOS);
    getRemitosSalud.mockRejectedValue(new Error("timeout"));
    const props = await abrir({ ver: "a_revisar" });
    expect(filas(props)).toEqual([DE_AGOSTO.movimiento_id, VENCIDO.movimiento_id]);
    expect(props.vencidos).toEqual([]);
    expect(props.errores).toEqual(["el estado de la ingesta"]);
  });

  it("si falla la búsqueda de los vencidos, la lista a revisar no los saca", async () => {
    listRemitos.mockResolvedValueOnce(TODOS).mockRejectedValueOnce(new Error("timeout"));
    const props = await abrir({ ver: "a_revisar" });
    expect(filas(props)).toEqual([DE_AGOSTO.movimiento_id, VENCIDO.movimiento_id]);
    expect(props.vencidos).toEqual([]);
    expect(props.errores).toEqual(["los remitos vencidos"]);
  });

  it("si fallan los remitos, el panel recibe el error junto con la lista vacía", async () => {
    listRemitos.mockRejectedValue(new Error("timeout"));
    const props = await abrir({ ver: "a_revisar" });
    expect(filas(props)).toEqual([]);
    expect(props.errores).toContain("los remitos");
  });
});

// Next no vuelve a montar la página si cambian solo los parámetros: el panel lleva una key
// con el cliente, el mes y la lista, para que el filtro no quede mostrando los de antes.
describe("RemitosPage: el filtro sigue a la URL", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    vi.clearAllMocks();
    H.props = null;
    H.montajes = 0;
    listRemitos.mockResolvedValue(TODOS);
    getRemitosSalud.mockResolvedValue(SALUD);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("al pasar a la lista a revisar y al volver al mes, el panel arranca de nuevo", async () => {
    const pagina = (params: { cliente?: string; mes?: string; ver?: string }) =>
      RemitosPage({ searchParams: Promise.resolve(params) });
    const { rerender } = render(await pagina({ cliente: "company:c1", mes: "2026-08" }));
    expect(H.props!.montaje).toBe(1);

    rerender(await pagina({ ver: "a_revisar" }));
    expect(H.props!.montaje).toBe(2);
    expect(H.props!.cliente).toBe("");

    rerender(await pagina({}));
    expect(H.props!.montaje).toBe(3);
    expect(H.props!.mes).toBe("2026-09");
  });

  it("con los mismos parámetros (router.refresh después de marcar) no se vuelve a montar", async () => {
    const params = { cliente: "company:c1", mes: "2026-08" };
    const { rerender } = render(await RemitosPage({ searchParams: Promise.resolve(params) }));
    rerender(await RemitosPage({ searchParams: Promise.resolve(params) }));
    expect(H.props!.montaje).toBe(1);
  });
});
