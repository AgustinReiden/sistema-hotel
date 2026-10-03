import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { codigoRemito } from "@/lib/remito-codigo";

// La página del remito es un server component async: se la llama como función y se
// renderiza lo que devuelve. Supabase, los datos del hotel y el QR van mockeados; el
// QR mockeado lleva el código adentro para comparar que el reimpreso es el mismo.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: "mov-1",
              remito_numero: 17,
              amount: "80000",
              created_at: "2026-09-25T11:00:00.000Z",
              tipo: "cargo",
              associated_client: { display_name: "Empresa Ficticia SA", document_id: "30123456781" },
              guest: null,
              reservation: {
                client_name: "Juan Prueba",
                check_in_target: "2026-09-24T14:00:00.000Z",
                check_out_target: "2026-09-25T10:00:00.000Z",
                rooms: { room_number: "4" },
              },
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/data", () => ({
  getHotelSettings: async () => ({ timezone: "America/Argentina/Buenos_Aires" }),
  getFiscalSettings: async () => null,
}));

vi.mock("@/lib/remito-qr", () => ({
  remitoQrDataUrl: async (codigo: string) => `data:image/png;base64,${codigo}`,
}));

vi.mock("@/app/admin/recibo/[paymentId]/ReceiptAutoPrint", () => ({ default: () => null }));

import AccountVoucherPage from "@/app/admin/comprobante-cc/[movementId]/page";

async function renderRemito(searchParams: { autoprint?: string; reimpresion?: string }) {
  return render(
    await AccountVoucherPage({
      params: Promise.resolve({ movementId: "mov-1" }),
      searchParams: Promise.resolve(searchParams),
    })
  );
}

describe("remito de cuenta corriente: reimpresión", () => {
  it("con ?reimpresion=1 dice REIMPRESIÓN debajo del tipo, con el mismo número y QR", async () => {
    const { container } = await renderRemito({ autoprint: "1", reimpresion: "1" });

    expect(screen.getByText("COMPROBANTE CTA. CTE.")).toBeTruthy();
    expect(screen.getByText("REIMPRESIÓN")).toBeTruthy();
    expect(screen.getByText("R-000017")).toBeTruthy();
    const qr = container.querySelector("img.qr");
    expect(qr?.getAttribute("alt")).toBe(codigoRemito(17));
    expect(qr?.getAttribute("src")).toBe(`data:image/png;base64,${codigoRemito(17)}`);

    // La leyenda va pegada debajo del tipo de comprobante, antes de la línea.
    const tipo = screen.getByText("COMPROBANTE CTA. CTE.");
    expect(tipo.nextElementSibling?.textContent).toBe("REIMPRESIÓN");
  });

  it("el remito del check-out (sin reimpresion) sale sin leyenda y con el mismo número y QR", async () => {
    const { container } = await renderRemito({ autoprint: "1" });

    expect(screen.getByText("COMPROBANTE CTA. CTE.")).toBeTruthy();
    expect(screen.queryByText("REIMPRESIÓN")).toBeNull();
    expect(screen.getByText("R-000017")).toBeTruthy();
    const qr = container.querySelector("img.qr");
    expect(qr?.getAttribute("alt")).toBe(codigoRemito(17));
  });
});
