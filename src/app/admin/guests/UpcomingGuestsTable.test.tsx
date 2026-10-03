import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import UpcomingGuestsTable from "./UpcomingGuestsTable";
import type { UpcomingGuest } from "@/lib/types";

const TZ = "America/Argentina/Tucuman";

function guest(id: string, name: string, status: UpcomingGuest["status"], checkIn: string): UpcomingGuest {
  return {
    id,
    client_name: name,
    client_dni: null,
    status,
    check_in_target: checkIn,
    check_out_target: "2026-09-30T15:00:00Z",
    room_number: "3",
    guest_count: 1,
  };
}

describe("UpcomingGuestsTable", () => {
  it("rotula cada fila según su estado real", () => {
    render(
      <UpcomingGuestsTable
        guests={[
          guest("a", "Vencida Uno", "confirmed", "2026-09-14T17:00:00Z"),
          guest("b", "Futura Dos", "confirmed", "2026-09-20T17:00:00Z"),
          guest("c", "Web Tres", "pending", "2026-09-20T17:00:00Z"),
        ]}
        searchQuery=""
        timezone={TZ}
        todayKey="2026-09-15"
      />
    );
    expect(screen.getByText("Atrasada (no vino)")).toBeTruthy();
    expect(screen.getByText("Confirmada")).toBeTruthy();
    expect(screen.getByText("Solicitud web")).toBeTruthy();
  });

  it("es solo lectura: sin botones ni links", () => {
    const { container } = render(
      <UpcomingGuestsTable
        guests={[guest("a", "Vencida Uno", "confirmed", "2026-09-14T17:00:00Z")]}
        searchQuery=""
        timezone={TZ}
        todayKey="2026-09-15"
      />
    );
    expect(container.querySelector("button, a, input, select")).toBeNull();
  });
});
