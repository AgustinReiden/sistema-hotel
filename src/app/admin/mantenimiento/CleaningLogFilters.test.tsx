import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import CleaningLogFilters from "./CleaningLogFilters";

const rooms = [{ id: 1, room_number: "1" }];

function montar(props: Partial<React.ComponentProps<typeof CleaningLogFilters>> = {}) {
  return render(
    <CleaningLogFilters
      from="2026-09-01"
      to="2026-09-23"
      isAll={false}
      isDefault
      category=""
      room=""
      rooms={rooms}
      {...props}
    />
  );
}

describe("CleaningLogFilters: período", () => {
  beforeEach(() => push.mockClear());
  afterEach(cleanup);

  it("'Todo el historial' pide todo=1", () => {
    montar();
    fireEvent.click(screen.getByText("Todo el historial"));
    expect(push).toHaveBeenCalledWith("/admin/mantenimiento?todo=1");
  });

  it("'Mes en curso' vuelve al período por defecto y conserva la categoría elegida", () => {
    montar({ from: "", to: "", isAll: true, isDefault: false, category: "checkout" });
    fireEvent.click(screen.getByText("Mes en curso"));
    expect(push).toHaveBeenCalledWith("/admin/mantenimiento?category=checkout");
  });

  it("marca como activo el período vigente", () => {
    const { rerender } = montar();
    expect(screen.getByText("Mes en curso").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Todo el historial").getAttribute("aria-pressed")).toBe("false");
    rerender(
      <CleaningLogFilters
        from=""
        to=""
        isAll
        isDefault={false}
        category=""
        room=""
        rooms={rooms}
      />
    );
    expect(screen.getByText("Todo el historial").getAttribute("aria-pressed")).toBe("true");
  });

  it("en el mes por defecto no hay 'Limpiar'; con otro período sí, y vuelve al mes", () => {
    const { unmount } = montar();
    expect(screen.queryByText("Limpiar")).toBeNull();
    unmount();
    montar({ from: "2026-08-01", to: "2026-08-31", isDefault: false });
    fireEvent.click(screen.getByText("Limpiar"));
    expect(push).toHaveBeenCalledWith("/admin/mantenimiento");
  });

  it("'Aplicar' con las fechas elegidas manda desde y hasta", () => {
    montar({ from: "2026-08-01", to: "2026-08-31", isDefault: false });
    fireEvent.click(screen.getByText("Aplicar"));
    expect(push).toHaveBeenCalledWith("/admin/mantenimiento?from=2026-08-01&to=2026-08-31");
  });
});
