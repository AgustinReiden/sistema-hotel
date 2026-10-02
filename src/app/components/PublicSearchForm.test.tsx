import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PublicSearchForm from "./PublicSearchForm";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

// Los botones se buscan por el texto que llevan adentro, no con getByRole sobre toda la
// pantalla: getByRole calcula el rol y el nombre accesible de cada elemento y llama a
// getComputedStyle de jsdom por cada ancestro (PR #131). Con la suite entera en paralelo
// y la máquina cargada, este archivo llegó a pasar los 5 s.
function botonCon(texto: string): HTMLButtonElement {
  const boton = screen.getByText(texto).closest("button");
  if (!boton) throw new Error(`No hay un botón que diga «${texto}»`);
  return boton;
}

describe("PublicSearchForm", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("toggles the arrival calendar when the field is clicked twice", () => {
    render(<PublicSearchForm />);

    const arrivalField = botonCon("Llegada");

    fireEvent.click(arrivalField);
    expect(screen.getByLabelText("Mes anterior")).toBeInTheDocument();

    fireEvent.click(arrivalField);
    expect(screen.queryByLabelText("Mes anterior")).not.toBeInTheDocument();
  });

  it("shows an immediate loading state when searching", () => {
    render(<PublicSearchForm />);

    fireEvent.click(botonCon("Buscar"));

    expect(screen.getByText("Buscando")).toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("uses a styled guest stepper instead of the native select menu", async () => {
    render(<PublicSearchForm />);

    fireEvent.click(botonCon("Huéspedes"));
    // Lo que getByRole llamaría "combobox" en toda la página: un <select> nativo, un input
    // con lista o un rol puesto a mano.
    expect(document.body.querySelector('select, input[list], [role="combobox"]')).toBeNull();

    fireEvent.click(screen.getByLabelText("Agregar huesped"));

    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => element?.textContent === "3 Personas").length
      ).toBeGreaterThan(0);
    });
  });
});
