import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PublicSearchForm from "./PublicSearchForm";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("PublicSearchForm", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("toggles the arrival calendar when the field is clicked twice", () => {
    render(<PublicSearchForm />);

    const arrivalField = screen.getByRole("button", { name: /Llegada/i });

    fireEvent.click(arrivalField);
    expect(screen.getByLabelText("Mes anterior")).toBeInTheDocument();

    fireEvent.click(arrivalField);
    expect(screen.queryByLabelText("Mes anterior")).not.toBeInTheDocument();
  });

  it("shows an immediate loading state when searching", () => {
    render(<PublicSearchForm />);

    fireEvent.click(screen.getByRole("button", { name: /Buscar/i }));

    expect(screen.getByText("Buscando")).toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("uses a styled guest stepper instead of the native select menu", async () => {
    render(<PublicSearchForm />);

    fireEvent.click(screen.getByRole("button", { name: /Huéspedes/i }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Agregar huesped"));

    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => element?.textContent === "3 Personas").length
      ).toBeGreaterThan(0);
    });
  });
});
