import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import VencidosSection from "./VencidosSection";
import type { RemitoEstado, RemitoPanelRow } from "@/lib/types";

const AHORA = Date.parse("2026-09-28T15:00:00Z");
const fila = (numero: number, estado: RemitoEstado, horas: number): RemitoPanelRow => ({
  movimiento_id: `m${numero}`, remito_numero: numero, created_at: new Date(AHORA - horas * 3_600_000).toISOString(),
  amount: 50000, client_kind: "company", client_id: "c1", cliente: "Empresa de prueba", room_number: "4",
  pasajero: "Pasajero", estado, decidido_por: null, decidido_por_nombre: null, estado_at: null, nota: null,
  escaneo_version: estado === "sin_escanear" ? null : 1,
  escaneo_link: estado === "sin_escanear" ? null : "https://example.test/x",
  escaneo_origen: estado === "sin_escanear" ? null : "qr",
  firma_ia: null, firma_ia_confianza: null, firma_ia_observacion: null,
});

describe("VencidosSection", () => {
  it("no muestra nada si no hay vencidos", () => {
    const { container } = render(<VencidosSection rows={[]} horas={48} nowMs={AHORA} renderAcciones={() => null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lista cada vencido con su motivo, hace cuánto salió y sus acciones", () => {
    render(
      <VencidosSection
        rows={[fila(163, "sin_escanear", 50), fila(170, "sin_firma", 90)]}
        horas={48}
        nowMs={AHORA}
        renderAcciones={(r) => <button type="button">Acción {r.remito_numero}</button>}
      />
    );
    expect(screen.getByText("Vencidos (2)")).toBeInTheDocument();
    expect(screen.getByText("2 vencidos: 1 sin escanear · 1 sin firma")).toBeInTheDocument();
    expect(screen.getByText("R-000163")).toBeInTheDocument();
    expect(screen.getByText(/hace 50 h/)).toBeInTheDocument();
    expect(screen.getByText(/hace 3 días/)).toBeInTheDocument();
    expect(screen.getByText("Acción 170")).toBeInTheDocument();
  });
});
