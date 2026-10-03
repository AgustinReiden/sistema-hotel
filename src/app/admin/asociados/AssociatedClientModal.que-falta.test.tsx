import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AssociatedClientModal from "./AssociatedClientModal";

// F2-9: "Crear Empresa / Convenio" no queda gris. Con el nombre o el documento vacíos
// dice qué falta y lleva el cursor al primero, antes de consultar si el CUIT se repite.

const H = vi.hoisted(() => ({
  findCompaniesByDocumentAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: H.toast }));

vi.mock("./actions", () => ({
  findCompaniesByDocumentAction: H.findCompaniesByDocumentAction,
}));

function montar() {
  const onSubmit = vi.fn().mockResolvedValue({ success: true });
  const { container } = render(
    <AssociatedClientModal isOpen onClose={vi.fn()} onSubmit={onSubmit} initialClient={null} title="Nueva empresa" />
  );
  return { onSubmit, container };
}

const boton = (container: HTMLElement) => {
  const el = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!el) throw new Error("No está el botón de guardar");
  return el;
};
const nombre = (container: HTMLElement) => container.querySelector<HTMLInputElement>("#associated-display-name")!;
const documento = (container: HTMLElement) => container.querySelector<HTMLInputElement>("#associated-document-id")!;

beforeEach(() => {
  vi.clearAllMocks();
  H.findCompaniesByDocumentAction.mockResolvedValue({ success: true, data: [] });
});

describe("AssociatedClientModal: el botón dice qué falta", () => {
  it("con el formulario vacío el botón está activo; al tocarlo no consulta duplicados y el foco va al nombre", () => {
    const { container, onSubmit } = montar();
    expect(boton(container)).toBeEnabled();

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: Nombre, DNI o CUIT")).toBeInTheDocument();
    expect(H.findCompaniesByDocumentAction).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(nombre(container));
    expect(nombre(container)).toHaveAttribute("aria-invalid", "true");
    expect(documento(container)).toHaveAttribute("aria-invalid", "true");
    expect(H.toast.error).not.toHaveBeenCalled();
  });

  it("con el nombre cargado y sin documento, el foco va al documento", () => {
    const { container } = montar();
    fireEvent.change(nombre(container), { target: { value: "Empresa Ficticia SA" } });

    fireEvent.click(boton(container));

    expect(screen.getByText("Falta completar: DNI o CUIT")).toBeInTheDocument();
    expect(document.activeElement).toBe(documento(container));
    expect(H.findCompaniesByDocumentAction).not.toHaveBeenCalled();
  });

  it("un N° de Robinet inválido frena el envío en vez de borrarse en silencio", () => {
    const { container, onSubmit } = montar();
    fireEvent.change(nombre(container), { target: { value: "Empresa Ficticia SA" } });
    fireEvent.change(documento(container), { target: { value: "30-12345678-1" } });
    fireEvent.change(container.querySelector<HTMLInputElement>("#associated-robinet-id")!, { target: { value: "0" } });

    fireEvent.click(boton(container));

    expect(H.findCompaniesByDocumentAction).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("con nombre y documento sigue como antes: chequea el CUIT y guarda", async () => {
    const { container, onSubmit } = montar();
    fireEvent.change(nombre(container), { target: { value: "Empresa Ficticia SA" } });
    fireEvent.change(documento(container), { target: { value: "30-12345678-1" } });

    fireEvent.click(boton(container));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(H.findCompaniesByDocumentAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Falta completar/)).toBeNull();
  });
});
