import { describe, expect, it } from "vitest";

import { buildConfirmationMessage } from "@/lib/whatsapp-messages";

const reservationData = {
  client_name: "María García",
  room_type: "Doble superior",
  room_number: "204",
  check_in: "2026-05-10",
  check_out: "2026-05-12",
  total_price: 125000,
  hotel_phone: "+54 9 376 400-0000",
};

describe("buildConfirmationMessage", () => {
  it("builds a warmer Spanish confirmation message", () => {
    const message = buildConfirmationMessage("es", reservationData);

    expect(message).toContain("¡Reserva confirmada!");
    expect(message).toContain("qué alegría recibirte");
    expect(message).toContain("Ya dejamos todo reservado para tu estadía");
    expect(message).toContain("Llegada:");
    expect(message).toContain("Salida:");
    expect(message).toContain(
      "escribinos por WhatsApp al +54 9 364 438-6455"
    );
    expect(message).toContain("¡Te esperamos con todo listo!");
  });

  it("uses the confirmation help phone even when the hotel phone is missing", () => {
    const message = buildConfirmationMessage("es", {
      ...reservationData,
      hotel_phone: " ",
    });

    expect(message).toContain(
      "escribinos por WhatsApp al +54 9 364 438-6455"
    );
  });

  it("fills a configured confirmation template", () => {
    const message = buildConfirmationMessage(
      "es",
      reservationData,
      "Hola {nombre}! Habitación {numero_habitacion}. Total {total}. Dudas: {telefono_consultas}"
    );

    expect(message).toBe(
      "Hola María García! Habitación 204. Total $125.000. Dudas: +54 9 364 438-6455"
    );
  });

  it("builds a warmer Portuguese confirmation message", () => {
    const message = buildConfirmationMessage("pt", reservationData);

    expect(message).toContain("Reserva confirmada!");
    expect(message).toContain("que alegria receber você");
    expect(message).toContain("Entrada:");
    expect(message).toContain("Saída:");
    expect(message).toContain("fale com a gente pelo +54 9 364 438-6455");
    expect(message).toContain("Esperamos por você com tudo pronto!");
  });
});
