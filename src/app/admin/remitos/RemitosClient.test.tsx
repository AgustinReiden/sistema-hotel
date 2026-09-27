import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RemitosClient from "./RemitosClient";
import type { RemitoEstado, RemitoPanelRow, RemitoPieza, RemitosSalud } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const markRemitoAction = vi.fn();
const lookupRemitoAction = vi.fn();
const assignRemitoPiezaAction = vi.fn();
const resolveRemitoPiezaAction = vi.fn();
const saveRemitosAjustesAction = vi.fn();
vi.mock("./actions", () => ({
  markRemitoAction: (...a: unknown[]) => markRemitoAction(...a),
  lookupRemitoAction: (...a: unknown[]) => lookupRemitoAction(...a),
  assignRemitoPiezaAction: (...a: unknown[]) => assignRemitoPiezaAction(...a),
  resolveRemitoPiezaAction: (...a: unknown[]) => resolveRemitoPiezaAction(...a),
  saveRemitosAjustesAction: (...a: unknown[]) => saveRemitosAjustesAction(...a),
  pedirPaqueteAction: vi.fn(),
}));

const AHORA = Date.parse("2026-09-22T15:00:00Z");
let n = 150;
const fila = (estado: RemitoEstado, extra: Partial<RemitoPanelRow> = {}): RemitoPanelRow => ({
  movimiento_id: `m${++n}`, remito_numero: n, created_at: "2026-09-20T12:00:00Z", amount: 50000,
  client_kind: "company", client_id: "c1", cliente: "Empresa de prueba", room_number: "7", pasajero: "Pasajero",
  estado, decidido_por: null, decidido_por_nombre: null, estado_at: null, nota: null,
  escaneo_version: estado === "sin_escanear" ? null : 1, escaneo_link: estado === "sin_escanear" ? null : "https://example.test/x",
  escaneo_origen: estado === "sin_escanear" ? null : "qr", firma_ia: null, firma_ia_confianza: null,
  firma_ia_observacion: null, ...extra,
});
const SALUD: RemitosSalud = {
  ultima_ingesta_at: "2026-09-22T14:55:00Z", ultima_evaluacion_at: "2026-09-22T14:55:00Z",
  evaluando_viejos: 0, a_revisar: 0, piezas_abiertas: 0, umbral_confianza: 0.95, controlar_desde: 151,
  max_intentos_firma: 5, vencidos: 0, a_revisar_vencidos: 0, horas_vencimiento: 48, alertar_desde: "2026-09-24",
};
const pieza = (motivo: string, extra: Partial<RemitoPieza> = {}): RemitoPieza => ({
  id: `p-${motivo}`, created_at: "2026-09-22T12:00:00Z", motivo, numeros_leidos: [],
  drive_link: "https://example.test/p", lote_archivo: "escaneo.pdf", ubicacion: "1.1",
  resuelta_at: null, resuelta_como: null, resuelta_nota: null, remito_numero: null, ...extra,
});

function renderPanel(props: Partial<Parameters<typeof RemitosClient>[0]> = {}) {
  return render(
    <RemitosClient rows={[]} piezas={[]} salud={SALUD} accounts={[]} cliente="" mes="2026-09" nowMs={AHORA} errores={[]} {...props} />
  );
}

// Los botones se buscan por su texto (con selector "button") y los avisos por su
// atributo role, no con getByRole sobre toda la pantalla: getByRole calcula el rol y el
// nombre accesible de cada elemento y llama a getComputedStyle de jsdom por cada
// ancestro (PR #131). Con la máquina cargada, "sin remito exige nota" pasaba los 5 s.
const boton = (texto: string) => screen.getByText(texto, { selector: "button" });

describe("RemitosClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    n = 150;
  });

  it("muestra el semaforo del periodo", () => {
    renderPanel({ rows: [fila("firmado"), fila("sin_firma"), fila("a_revisar"), fila("sin_escanear")] });
    expect(screen.getByTestId("semaforo")).toHaveTextContent(
      "4 remitos: 1 firmado · 1 sin firma · 1 a revisar · 1 sin escanear"
    );
  });

  it("avisa en rojo si la ingesta no corre hace mas de una hora", () => {
    const { container } = renderPanel({ salud: { ...SALUD, ultima_ingesta_at: "2026-09-22T12:00:00Z" } });
    const alertas = container.querySelectorAll('[role="alert"]');
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toHaveTextContent("no corre desde hace 3 h");
  });

  it("sin remito exige nota antes de confirmar", async () => {
    markRemitoAction.mockResolvedValue({ success: true });
    renderPanel({ rows: [fila("sin_escanear")] });
    fireEvent.click(screen.getAllByText("Sin remito", { selector: "button" })[0]);
    const confirmar = boton("Confirmar");
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: "se perdio en la habitacion" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(markRemitoAction).toHaveBeenCalledWith("m151", "sin_remito", "se perdio en la habitacion"));
    expect(refresh).toHaveBeenCalled();
  });

  it("asignar a mano muestra el remito antes de vincular", async () => {
    lookupRemitoAction.mockResolvedValue({
      success: true,
      data: { existe: true, movimiento_id: "m9", remito_numero: 158, cliente: "Empresa de prueba",
        created_at: "2026-09-20T12:00:00Z", amount: 70000, room_number: "3", pasajero: "X", estado: "sin_escanear", escaneos: 0 },
    });
    assignRemitoPiezaAction.mockResolvedValue({ success: true });
    renderPanel({ piezas: [pieza("codigo_ilegible")] });
    fireEvent.click(boton("Asignar a un remito"));
    const vincular = boton("Vincular");
    expect(vincular).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Número del remito"), { target: { value: "158" } });
    fireEvent.click(boton("Buscar"));
    expect(await screen.findByTestId("remito-encontrado")).toHaveTextContent("R-000158 · Empresa de prueba");
    fireEvent.click(vincular);
    await waitFor(() => expect(assignRemitoPiezaAction).toHaveBeenCalledWith("p-codigo_ilegible", 158));
  });

  it("una pieza con tickets pegados no se puede asignar y muestra que tiene adentro", () => {
    renderPanel({ piezas: [pieza("forma_no_reconocida", { numeros_leidos: ["R-000001", "R-000002"] })] });
    expect(screen.queryByText("Asignar a un remito", { selector: "button" })).toBeNull();
    expect(screen.getByText(/Adentro se leyó: R-000001, R-000002/)).toBeInTheDocument();
  });

  it("la línea 'para revisar' dice lo mismo que el numerito del menú", () => {
    renderPanel({ salud: { ...SALUD, a_revisar: 2, a_revisar_vencidos: 1, vencidos: 3, piezas_abiertas: 1 } });
    expect(screen.getByTestId("para-revisar")).toHaveTextContent("Para revisar: 1 remito, 3 vencidos y 1 pieza");
  });

  it("muestra los vencidos con sus acciones", () => {
    renderPanel({ vencidos: [fila("sin_escanear", { created_at: "2026-09-19T12:00:00Z" })] });
    expect(screen.getByText("Vencidos (1)")).toBeInTheDocument();
    expect(screen.getByText("Sin remito")).toBeInTheDocument();
  });

  it("los ajustes mandan horas y fecha", async () => {
    saveRemitosAjustesAction.mockResolvedValue({ success: true });
    renderPanel();
    fireEvent.click(screen.getByText("Ajustes"));
    fireEvent.change(screen.getByLabelText("Horas para que un remito venza"), { target: { value: "72" } });
    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() => expect(saveRemitosAjustesAction).toHaveBeenCalledWith(95, 151, 72, "2026-09-24"));
  });
});

// Lo que dice el menú es lo que se ve al abrir: un remito a revisar de otro mes no está
// en la tabla del mes, así que la línea "Para revisar" lleva a la lista de todos.
describe("RemitosClient: ver los remitos a revisar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    n = 150;
  });

  it("la línea ofrece ver los N a revisar, sin contar los vencidos (tienen su lista)", () => {
    renderPanel({ salud: { ...SALUD, a_revisar: 3, a_revisar_vencidos: 1, vencidos: 1, piezas_abiertas: 2 } });
    expect(screen.getByTestId("para-revisar")).toHaveTextContent("Para revisar: 2 remitos, 1 vencido y 2 piezas");
    expect(screen.getByText("Ver los 2 a revisar").closest("a")).toHaveAttribute("href", "/admin/remitos?ver=a_revisar");
  });

  it("con uno solo, en singular", () => {
    renderPanel({ salud: { ...SALUD, a_revisar: 1 } });
    expect(screen.getByText("Ver el remito a revisar").closest("a")).toHaveAttribute("href", "/admin/remitos?ver=a_revisar");
  });

  it("sin remitos a revisar (solo vencidos o piezas) no hay link", () => {
    renderPanel({ salud: { ...SALUD, vencidos: 1, piezas_abiertas: 2 } });
    expect(screen.getByTestId("para-revisar")).toBeInTheDocument();
    expect(screen.queryByText(/a revisar$/)).toBeNull();
  });

  it("en la lista de a revisar lo dice y deja volver al mes", () => {
    renderPanel({ aRevisar: true, rows: [fila("a_revisar"), fila("a_revisar")], salud: { ...SALUD, a_revisar: 2 } });
    expect(screen.getByTestId("semaforo")).toHaveTextContent("2 remitos a revisar, de todos los meses");
    expect(screen.queryByText("Ver los 2 a revisar")).toBeNull();
    expect(screen.getByText("Volver al mes").closest("a")).toHaveAttribute("href", "/admin/remitos");
  });

  it("sin nada a revisar, la lista lo dice", () => {
    renderPanel({ aRevisar: true, cliente: "company:c1" });
    expect(screen.getByTestId("semaforo")).toHaveTextContent("No quedan remitos a revisar.");
    expect(screen.getByText("Volver al mes").closest("a")).toHaveAttribute("href", "/admin/remitos?cliente=company%3Ac1");
  });
});
