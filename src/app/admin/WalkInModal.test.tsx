import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import WalkInModal from "./WalkInModal";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("./actions", () => ({
  searchGuestsAction: vi.fn().mockResolvedValue([]),
  searchCompanyPassengersAction: vi.fn().mockResolvedValue([]),
}));

const TZ = "America/Argentina/Tucuman";

function abrir(props: Partial<React.ComponentProps<typeof WalkInModal>> = {}) {
  return render(
    <WalkInModal
      isOpen
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      roomNumber="4"
      basePrice={50000}
      halfDayPrice={25000}
      associatedClients={[]}
      timezone={TZ}
      standardCheckOutTime="10:00"
      {...props}
    />
  );
}

const noches = () => screen.getByLabelText("Cantidad de noches") as HTMLInputElement;

/** Escribe en el campo de noches como la recepcionista: entra, tipea y sale. */
function tipearNoches(valor: string) {
  act(() => noches().focus());
  fireEvent.change(noches(), { target: { value: valor } });
  act(() => noches().blur());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WalkInModal: el botón final dice noches y salida", () => {
  it("una tarde, con 3 noches: 'Asignar · 3 noches · sale el 26/09'", () => {
    // 23/09 a las 18:00 en Tucumán.
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z"));
    abrir();

    expect(screen.getByText("Asignar · 1 noche · sale el 24/09")).toBeInTheDocument();

    tipearNoches("3");
    expect(screen.getByText("Asignar · 3 noches · sale el 26/09")).toBeInTheDocument();
  });

  it("+ y − mueven el botón con las noches", () => {
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z"));
    abrir();

    fireEvent.click(screen.getByLabelText("Cantidad de noches: sumar 1"));
    fireEvent.click(screen.getByLabelText("Cantidad de noches: sumar 1"));
    expect(noches().value).toBe("3");
    expect(screen.getByText("Asignar · 3 noches · sale el 26/09")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Cantidad de noches: restar 1"));
    expect(screen.getByText("Asignar · 2 noches · sale el 25/09")).toBeInTheDocument();
  });

  it("borrar las noches y salir del campo deja las que había, no 1", () => {
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z"));
    abrir();

    tipearNoches("3");
    tipearNoches("");
    expect(noches().value).toBe("3");
    expect(screen.getByText("Asignar · 3 noches · sale el 26/09")).toBeInTheDocument();
  });

  it("de madrugada, vendiendo la noche de anoche, la salida es un día antes", () => {
    // 24/09 a las 02:30 en Tucumán: viene marcada la noche de anoche.
    vi.setSystemTime(new Date("2026-09-24T05:30:00.000Z"));
    abrir();

    expect(screen.getByText("Asignar · 1 noche · sale el 24/09")).toBeInTheDocument();
    tipearNoches("3");
    expect(screen.getByText("Asignar · 3 noches · sale el 26/09")).toBeInTheDocument();

    fireEvent.click(screen.getByText("La de hoy (24/09)"));
    expect(screen.getByText("Asignar · 3 noches · sale el 27/09")).toBeInTheDocument();
  });

  it("en medio día: 'Asignar · medio día' y no pide noches", () => {
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z"));
    abrir();

    fireEvent.click(screen.getByText("Media estadía (siesta)"));
    expect(screen.getByText("Asignar · medio día")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cantidad de noches")).toBeNull();
  });

  it("sin el reloj del hotel dice solo las noches", () => {
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z"));
    abrir({ timezone: undefined, standardCheckOutTime: undefined });

    tipearNoches("3");
    expect(screen.getByText("Asignar · 3 noches")).toBeInTheDocument();
  });

  it("los pasajeros no pasan de 20", () => {
    vi.setSystemTime(new Date("2026-09-23T21:00:00.000Z"));
    abrir();

    const pasajeros = screen.getByLabelText("Cantidad de pasajeros") as HTMLInputElement;
    act(() => pasajeros.focus());
    fireEvent.change(pasajeros, { target: { value: "25" } });
    act(() => pasajeros.blur());
    expect(pasajeros.value).toBe("20");
    expect(screen.getByLabelText("Cantidad de pasajeros: sumar 1")).toBeDisabled();
  });
});
