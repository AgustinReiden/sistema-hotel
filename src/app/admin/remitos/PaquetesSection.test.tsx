import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PaquetesSection from "./PaquetesSection";
import type { RemitoPaqueteFactura } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const pedirPaqueteAction = vi.fn();
vi.mock("./actions", () => ({ pedirPaqueteAction: (...a: unknown[]) => pedirPaqueteAction(...a) }));

const AHORA = Date.parse("2026-10-01T15:00:00Z");
const factura = (extra: Partial<RemitoPaqueteFactura> = {}): RemitoPaqueteFactura => ({
  invoice_id: "i1", factura_texto: "FB 00008-00000010", cbte_fch: "2026-09-30", imp_total: 150000,
  remitos_total: 3, remitos_firmados: 2, constancia: null, paquete: null, firmados_nuevos: 0, ...extra,
});

describe("PaquetesSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin cliente elegido pide elegir uno", () => {
    render(<PaquetesSection facturas={[]} clienteElegido={false} nowMs={AHORA} />);
    expect(screen.getByText(/Elegí un cliente/)).toBeInTheDocument();
  });

  it("muestra firmados, la constancia y pide el paquete", async () => {
    pedirPaqueteAction.mockResolvedValue({ success: true });
    render(
      <PaquetesSection
        facturas={[factura({ constancia: { motivo: "se perdió", faltantes: 1, usuario: "Admin", created_at: "2026-09-30T12:00:00Z" } })]}
        clienteElegido
        nowMs={AHORA}
      />
    );
    expect(screen.getByText("FB 00008-00000010")).toBeInTheDocument();
    expect(screen.getByText("2 de 3 firmados")).toBeInTheDocument();
    expect(screen.getByText(/Emitida sin 1 remito — motivo: se perdió/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Armar paquete"));
    await waitFor(() => expect(pedirPaqueteAction).toHaveBeenCalledWith("i1"));
  });

  it("listo: ofrece descargar", () => {
    render(
      <PaquetesSection
        facturas={[factura({ paquete: { id: "p1", version: 1, estado: "listo", remitos: 2, drive_link: "https://example.test/p", error: null, pedido_at: "2026-10-01T14:00:00Z", armando_at: "2026-10-01T14:01:00Z", terminado_at: "2026-10-01T14:02:00Z" } })]}
        clienteElegido
        nowMs={AHORA}
      />
    );
    expect(screen.getByText("Descargar").closest("a")).toHaveAttribute("href", "https://example.test/p");
    expect(screen.queryByText("Armar paquete")).not.toBeInTheDocument();
  });

  it("la fecha de la factura sale tal cual, sin correrla de zona; la de la constancia, en la hora del hotel", () => {
    render(
      <PaquetesSection
        facturas={[factura({ cbte_fch: "2026-09-01", constancia: { motivo: "se perdió", faltantes: 1, usuario: null, created_at: "2026-10-01T02:00:00Z" } })]}
        clienteElegido
        nowMs={AHORA}
      />
    );
    // "2026-09-01" es una fecha sin hora: leída como medianoche UTC y pasada a la zona
    // del hotel (UTC-3) salía el día anterior.
    expect(screen.getByText(/· 01\/09\/2026 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/31\/08\/2026/)).not.toBeInTheDocument();
    // La constancia sí es un instante: las 02:00 UTC del 1/10 son las 23:00 del 30/09 en el hotel.
    expect(screen.getByText(/motivo: se perdió, 30\/09\/2026/)).toBeInTheDocument();
  });
});
