import { fireEvent, render } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import EmptyState from "@/components/ui/EmptyState";

describe("EmptyState", () => {
  it("muestra el título y el ícono", () => {
    const { container } = render(<EmptyState icon={Inbox} title="No hay nada para mostrar" />);
    expect(container.textContent).toContain("No hay nada para mostrar");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("sin descripción ni acción no muestra más párrafo que el título ni botón", () => {
    const { container } = render(<EmptyState icon={Inbox} title="Vacío" />);
    expect(container.querySelectorAll("p").length).toBe(1);
    expect(container.querySelector("button")).toBeNull();
  });

  it("muestra la descripción cuando la recibe", () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="Sin estadías" description="Cuando haya una reserva, aparece acá." />,
    );
    const parrafos = container.querySelectorAll("p");
    expect(parrafos.length).toBe(2);
    expect(parrafos[0].textContent).toBe("Sin estadías");
    expect(parrafos[1].textContent).toBe("Cuando haya una reserva, aparece acá.");
  });

  it("con action, el botón llama a su onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <EmptyState icon={Inbox} title="Sin clientes" action={{ label: "Cargar cliente", onClick }} />,
    );
    const boton = container.querySelector("button") as HTMLButtonElement;
    expect(boton.textContent).toBe("Cargar cliente");
    fireEvent.click(boton);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
