import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Button from "@/components/ui/Button";

const boton = (container: HTMLElement) => container.querySelector("button") as HTMLButtonElement;

describe("Button", () => {
  it("por defecto es primary: brand-700 con hover brand-800, y llama a onClick", () => {
    const onClick = vi.fn();
    const { container } = render(<Button onClick={onClick}>Guardar</Button>);
    const b = boton(container);
    expect(b.textContent).toBe("Guardar");
    expect(b.className).toContain("bg-brand-700");
    expect(b.className).toContain("hover:bg-brand-800");
    expect(b.type).toBe("button");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("variant=danger aplica bg-red-600", () => {
    const { container } = render(<Button variant="danger">Cancelar estadía</Button>);
    expect(boton(container).className).toContain("bg-red-600");
  });

  it("secondary lleva borde slate-300 y ghost no lleva fondo de color", () => {
    const sec = render(<Button variant="secondary">Volver</Button>);
    expect(boton(sec.container).className).toContain("border-slate-300");
    const gh = render(<Button variant="ghost">Más</Button>);
    expect(boton(gh.container).className).not.toContain("bg-brand-700");
    expect(boton(gh.container).className).not.toContain("bg-red-600");
  });

  it("md tiene alto mínimo de 44 px y sm es más chico", () => {
    const md = render(<Button>Aceptar</Button>);
    expect(boton(md.container).className).toContain("min-h-[44px]");
    const sm = render(<Button size="sm">Aceptar</Button>);
    expect(boton(sm.container).className).not.toContain("min-h-[44px]");
  });

  it("siempre lleva el anillo de foco visible", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
      const { container } = render(<Button variant={variant}>X</Button>);
      expect(boton(container).className).toContain("focus-visible:ring-2");
    }
  });

  it("con disabled no llama a onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button disabled onClick={onClick}>
        Guardar
      </Button>,
    );
    expect(boton(container).disabled).toBe(true);
    fireEvent.click(boton(container));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("con loading no llama a onClick, muestra el ícono y avisa que está ocupado", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Guardar
      </Button>,
    );
    const b = boton(container);
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector("svg.animate-spin")).not.toBeNull();
    expect(b.textContent).toBe("Guardar");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("sin loading no muestra el ícono", () => {
    const { container } = render(<Button>Guardar</Button>);
    expect(boton(container).querySelector("svg")).toBeNull();
  });

  it("type=submit se respeta y se suman las clases propias", () => {
    const { container } = render(
      <Button type="submit" className="w-full">
        Enviar
      </Button>,
    );
    expect(boton(container).type).toBe("submit");
    expect(boton(container).className).toContain("w-full");
  });
});
