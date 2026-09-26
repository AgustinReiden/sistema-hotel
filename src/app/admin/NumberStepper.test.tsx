import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import NumberStepper from "./NumberStepper";

const LABEL = "Cantidad de noches";

/** El stepper con un padre que guarda el valor, como en los modales. */
function Controlado({
  inicial,
  onChange,
  min,
  max = 30,
}: {
  inicial: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(inicial);
  return (
    <NumberStepper
      id="noches"
      label={LABEL}
      value={value}
      min={min}
      max={max}
      hint="Hasta 30."
      onChange={(n) => {
        onChange(n);
        setValue(n);
      }}
    />
  );
}

const campo = () => screen.getByLabelText(LABEL) as HTMLInputElement;
const menos = () => screen.getByLabelText(`${LABEL}: restar 1`) as HTMLButtonElement;
const mas = () => screen.getByLabelText(`${LABEL}: sumar 1`) as HTMLButtonElement;

function enfocar() {
  act(() => campo().focus());
}

function salir() {
  act(() => campo().blur());
}

describe("NumberStepper", () => {
  it("es un campo de texto numérico, no un type=number", () => {
    render(<Controlado inicial={1} onChange={vi.fn()} />);
    expect(campo().type).toBe("text");
    expect(campo().inputMode).toBe("numeric");
    expect(screen.getByText("Hasta 30.")).toBeInTheDocument();
  });

  it("borrar y salir del campo restaura el valor, y onChange no recibe 1", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={3} onChange={onChange} />);

    enfocar();
    fireEvent.change(campo(), { target: { value: "" } });
    // Mientras se escribe el campo puede quedar vacío: no vuelve solo a 1.
    expect(campo().value).toBe("");

    salir();
    expect(campo().value).toBe("3");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("al tomar el foco selecciona todo, así tipear 3 sobre un 1 da 3 y no 13", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={1} onChange={onChange} />);

    enfocar();
    expect(campo().selectionStart).toBe(0);
    expect(campo().selectionEnd).toBe(campo().value.length);
    // El mouseup del mismo click no deja el cursor al final del 1.
    expect(fireEvent.mouseUp(campo())).toBe(false);
    expect(campo().selectionStart).toBe(0);
    expect(campo().selectionEnd).toBe(campo().value.length);
    // El siguiente mouseup ya es del usuario (poner el cursor donde quiera).
    expect(fireEvent.mouseUp(campo())).toBe(true);

    fireEvent.change(campo(), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(3);
    expect(campo().value).toBe("3");

    salir();
    expect(campo().value).toBe("3");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("tipear una letra no cambia nada", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={2} onChange={onChange} />);

    enfocar();
    fireEvent.change(campo(), { target: { value: "a" } });
    expect(campo().value).toBe("2");
    fireEvent.change(campo(), { target: { value: "2a" } });
    expect(campo().value).toBe("2");

    salir();
    expect(campo().value).toBe("2");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("− y + cambian de a uno", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={2} onChange={onChange} />);

    fireEvent.click(mas());
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(campo().value).toBe("3");

    fireEvent.click(menos());
    fireEvent.click(menos());
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(campo().value).toBe("1");
  });

  it("− se deshabilita en el mínimo y + en el máximo", () => {
    const onChange = vi.fn();
    const { unmount } = render(<Controlado inicial={1} onChange={onChange} />);
    expect(menos()).toBeDisabled();
    expect(mas()).not.toBeDisabled();
    unmount();

    render(<Controlado inicial={19} max={20} onChange={onChange} />);
    fireEvent.click(mas());
    expect(campo().value).toBe("20");
    expect(mas()).toBeDisabled();
    expect(menos()).not.toBeDisabled();
    // Un click más en el + deshabilitado no pasa del máximo.
    fireEvent.click(mas());
    expect(campo().value).toBe("20");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("lo que se pasa del rango queda en el límite al salir del campo", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={3} onChange={onChange} />);

    enfocar();
    fireEvent.change(campo(), { target: { value: "45" } });
    // Fuera de rango todavía no se manda: puede ser que siga escribiendo.
    expect(onChange).not.toHaveBeenCalled();
    salir();
    expect(onChange).toHaveBeenLastCalledWith(30);
    expect(campo().value).toBe("30");

    enfocar();
    fireEvent.change(campo(), { target: { value: "0" } });
    salir();
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(campo().value).toBe("1");
  });

  it("no entran más de dos dígitos", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={1} onChange={onChange} />);

    enfocar();
    fireEvent.change(campo(), { target: { value: "123" } });
    expect(campo().value).toBe("12");
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it("Enter con un número fuera de rango lo ajusta y no manda el formulario", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={3} onChange={onChange} />);

    enfocar();
    fireEvent.change(campo(), { target: { value: "45" } });
    const siguio = fireEvent.keyDown(campo(), { key: "Enter" });
    expect(siguio).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(30);
    expect(campo().value).toBe("30");
  });

  it("Enter con un número válido deja que el formulario siga", () => {
    const onChange = vi.fn();
    render(<Controlado inicial={3} onChange={onChange} />);

    enfocar();
    fireEvent.change(campo(), { target: { value: "5" } });
    expect(fireEvent.keyDown(campo(), { key: "Enter" })).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(5);
  });
});
