import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import EstadoPagoTag from "@/app/admin/EstadoPagoTag";
import StatusPill from "@/components/ui/StatusPill";

const pastilla = (container: HTMLElement) => container.firstElementChild as HTMLElement;

const CASOS: { kind: "habitacion" | "pago" | "factura" | "remito"; status: string; texto: string }[] = [
  { kind: "habitacion", status: "available", texto: "Disponible" },
  { kind: "habitacion", status: "occupied", texto: "Ocupada" },
  { kind: "habitacion", status: "cleaning", texto: "Limpieza" },
  { kind: "habitacion", status: "maintenance", texto: "Mantenimiento" },
  { kind: "pago", status: "sin_facturar", texto: "Sin facturar" },
  { kind: "pago", status: "facturado_externo", texto: "Cobro por fuera" },
  { kind: "pago", status: "impaga", texto: "Impaga" },
  { kind: "pago", status: "parcial", texto: "Pago parcial" },
  { kind: "pago", status: "pagada", texto: "Pagada" },
  { kind: "factura", status: "authorized", texto: "Emitida" },
  { kind: "factura", status: "pending", texto: "Pendiente de ARCA" },
  { kind: "factura", status: "processing", texto: "En verificación" },
  { kind: "factura", status: "rejected", texto: "Rechazada" },
  { kind: "remito", status: "sin_escanear", texto: "Sin escanear" },
  { kind: "remito", status: "evaluando", texto: "Evaluando" },
  { kind: "remito", status: "a_revisar", texto: "A revisar" },
  { kind: "remito", status: "firmado", texto: "Firmado" },
  { kind: "remito", status: "sin_firma", texto: "Sin firma" },
  { kind: "remito", status: "sin_remito", texto: "Sin remito" },
];

describe("StatusPill", () => {
  it.each(CASOS)("$kind + $status muestra «$texto»", ({ kind, status, texto }) => {
    const { container } = render(<StatusPill kind={kind} status={status} />);
    expect(pastilla(container).textContent).toBe(texto);
  });

  it("un status desconocido cae en un gris neutro, sin romper, y muestra el valor tal cual", () => {
    const { container } = render(<StatusPill kind="pago" status="algo_nuevo" />);
    const p = pastilla(container);
    expect(p.textContent).toBe("algo_nuevo");
    expect(p.className).toContain("bg-slate-100");
    expect(p.className).toContain("text-slate-600");
  });

  it("un status desconocido de cualquier kind no rompe", () => {
    for (const kind of ["habitacion", "pago", "factura", "remito"] as const) {
      const { container } = render(<StatusPill kind={kind} status="desconocido" />);
      expect(pastilla(container).className).toContain("bg-slate-100");
    }
  });

  it("los colores de pago son los de EstadoPagoTag, uno por uno", () => {
    for (const estado of ["pagada", "parcial", "impaga", "facturado_externo", "sin_facturar"] as const) {
      const tag = render(<EstadoPagoTag estado={estado} />);
      const pill = render(<StatusPill kind="pago" status={estado} />);
      const clasesTag = pastilla(tag.container).className.split(/\s+/);
      const color = clasesTag.filter((c) => c.startsWith("bg-") || (c.startsWith("text-") && !c.startsWith("text-[")));
      expect(color.length).toBe(2);
      for (const c of color) {
        expect(pastilla(pill.container).className.split(/\s+/)).toContain(c);
      }
    }
  });

  it("acepta className extra", () => {
    const { container } = render(<StatusPill kind="habitacion" status="available" className="ml-2" />);
    expect(pastilla(container).className).toContain("ml-2");
  });
});
