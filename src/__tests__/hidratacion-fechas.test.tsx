import { act } from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import AlertsPanel from "@/app/admin/mantenimiento/AlertsPanel";
import { MobileTabBar, MobileTopBar } from "@/app/admin/MobileNav";
import OccupiedRoomAlertBanner from "@/app/admin/OccupiedRoomAlertBanner";
import OpenShiftAgeAlert from "@/app/admin/OpenShiftAgeAlert";
import RoomCard from "@/app/admin/RoomCard";
import Sidebar from "@/app/admin/Sidebar";
import type { AdminAlert, RoomOccupancyAlert } from "@/lib/types";
import { comoChrome, conIcuCambiado, septiembreSinT, type CambioDeIcu } from "./icu-chrome";

// Error #418 de React en el build de producción: el HTML del servidor no coincidía con
// el primer dibujo del navegador. Acá se dibuja el componente como en el servidor (con
// el ICU de Node y la zona del contenedor, UTC), se hidrata como en la PC de la recepción
// (con el ICU de Chrome y la zona del hotel) y se mira si React avisa.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin",
}));
vi.mock("@/app/admin/mantenimiento/actions", () => ({
  authorizeOldTariffAction: vi.fn(),
  rejectOldTariffAction: vi.fn(),
  resolveAdminAlertAction: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => ({
  closeOccupancyAlertAction: vi.fn(),
  regularizeOccupiedRoomAction: vi.fn(),
  handleLateCheckOut: vi.fn(),
  handleMarkAvailable: vi.fn(),
  handleCancelReservation: vi.fn(),
  handleCheckOut: vi.fn(),
  handleEarlyCheckOut: vi.fn(),
  handleCheckIn: vi.fn(),
  handleSetMaintenance: vi.fn(),
  handleAssignWalkIn: vi.fn(),
  handleExtendReservation: vi.fn(),
}));
vi.mock("@/app/admin/finances/actions", () => ({ registerPaymentAction: vi.fn() }));
vi.mock("@/app/login/actions", () => ({ logout: vi.fn() }));
// Cerrados no dibujan nada, ni en el servidor ni en el navegador.
vi.mock("@/app/admin/WalkInModal", () => ({ default: () => null }));
vi.mock("@/app/admin/CompanyCheckInModal", () => ({ default: () => null }));
vi.mock("@/app/admin/ExtraChargesModal", () => ({ default: () => null }));
vi.mock("@/app/admin/ChangeRoomModal", () => ({ default: () => null }));
vi.mock("@/app/admin/EditReservationModal", () => ({ default: () => null }));
vi.mock("@/app/admin/EarlyCheckoutModal", () => ({ default: () => null }));
vi.mock("@/app/admin/InvoicePromptModal", () => ({ default: () => null }));

const TZ = "America/Argentina/Tucuman";
// El contenedor del servidor corre en UTC; la PC de la recepción, en la zona del hotel.
const ZONA_DEL_SERVIDOR = "UTC";
const ZONA_DE_LA_PC = TZ;
// 17:30 UTC = 14:30 en Tucumán.
const TARDE = "2026-09-26T17:30:00.000Z";

const montados: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  montados.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
});

/** Corre `fn` con el proceso en otra zona horaria (Node la toma en el momento). */
async function enZona<T>(zona: string, fn: () => T | Promise<T>): Promise<T> {
  const antes = process.env.TZ;
  process.env.TZ = zona;
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
}

/**
 * Dibuja como el servidor (ICU de Node, UTC) e hidrata como el navegador (con el ICU
 * cambiado por `cambio`, en la zona del hotel). Devuelve lo que avisó React.
 */
async function hidratar(ui: ReactElement, cambio: CambioDeIcu = comoChrome) {
  const container = document.createElement("div");
  container.innerHTML = await enZona(ZONA_DEL_SERVIDOR, () => renderToString(ui));
  document.body.appendChild(container);

  const errores: string[] = [];
  let root: Root | undefined;
  await enZona(ZONA_DE_LA_PC, () =>
    conIcuCambiado(cambio, async () => {
      await act(async () => {
        root = hydrateRoot(container, ui, {
          onRecoverableError: (error) =>
            errores.push(error instanceof Error ? error.message : String(error)),
        });
      });
    })
  );
  if (root) montados.push({ root, container });
  return { container, errores };
}

function aviso(overrides: Partial<AdminAlert> = {}): AdminAlert {
  return {
    id: 1,
    kind: "unexpected_cleaning",
    message: "Limpieza no esperada en la habitación 4",
    related_room_id: 4,
    related_room_number: "4",
    related_cleaning_log_id: null,
    related_reservation_id: null,
    decision: null,
    payload: null,
    created_at: TARDE,
    resolved_at: null,
    resolved_by: null,
    resolved_notes: null,
    ...overrides,
  };
}

function piezaOcupada(overrides: Partial<RoomOccupancyAlert> = {}): RoomOccupancyAlert {
  return {
    alert_id: 1,
    room_id: 4,
    room_number: "4",
    message: "Habitación marcada ocupada sin reserva activa",
    created_at: TARDE,
    detected_at: TARDE,
    reported_by_name: "Limpieza",
    resolved_at: null,
    decision: null,
    resolved_notes: null,
    resolved_by_name: null,
    ...overrides,
  };
}

function avisosDePiezaOcupada() {
  return (
    <OccupiedRoomAlertBanner
      alerts={[
        piezaOcupada(),
        piezaOcupada({
          alert_id: 2,
          room_id: 5,
          room_number: "5",
          resolved_at: TARDE,
          decision: "regularizada",
          resolved_by_name: "Admin Prueba",
          resolved_notes: "Se cargó la estadía",
        }),
      ]}
      pricingByRoomId={{ 4: { roomNumber: "4", basePrice: 50000, halfDayPrice: 25000 } }}
      associatedClients={[]}
      timezone={TZ}
      isAdmin
    />
  );
}

type Habitacion = ComponentProps<typeof RoomCard>["room"];

function habitacion(overrides: Partial<Habitacion> = {}): Habitacion {
  return {
    id: 1,
    number: "1",
    type: "Doble",
    status: "available",
    client: null,
    checkout: null,
    check_in_target: null,
    check_out_target: null,
    isLate: false,
    hasLateCheckout: false,
    canChargeLateCheckout: false,
    reservationId: null,
    reservationStatus: null,
    baseTotalPrice: 0,
    discountPercent: 0,
    discountAmount: 0,
    totalPrice: 0,
    paidAmount: 0,
    basePrice: 80000,
    halfDayPrice: 40000,
    hasPendingArrival: false,
    arrivalIsOverdue: false,
    arrivalDateLabel: null,
    accountCreditEnabled: false,
    billedToCompany: false,
    associatedClientId: null,
    companyPassengerId: null,
    clientDni: null,
    facturacionModo: "por_checkout",
    invoicePrefill: {
      razonSocial: "",
      cuit: "",
      condicionIva: "",
      domicilio: "",
      suggestA: false,
      complete: false,
    },
    priorPaymentMethods: [],
    ...overrides,
  };
}

describe("hidratación: lo que dibuja el servidor coincide con el navegador", () => {
  it("la simulación cambia de verdad la zona del proceso", async () => {
    const corrimiento = () => new Date(TARDE).getTimezoneOffset();
    expect(await enZona(ZONA_DEL_SERVIDOR, corrimiento)).toBe(0);
    expect(await enZona(ZONA_DE_LA_PC, corrimiento)).toBe(180);
  });

  // Mantenimiento: la fecha y hora de cada aviso sin revisar (AlertsPanel.tsx).
  it("el panel de avisos de Mantenimiento hidrata sin diferencias", async () => {
    const { container, errores } = await hidratar(
      <AlertsPanel
        hotelTimezone={TZ}
        alerts={[aviso(), aviso({ id: 2, kind: "room_change_keep_old_tariff_request" })]}
      />
    );

    expect(errores).toEqual([]);
    expect(container.textContent).toContain("26/09/2026, 02:30 p.\xa0m.");
  });

  // Hoy: el aviso de pieza usada sin estadía, el único componente de cliente de la
  // pantalla que escribe una fecha al cargar.
  it("el aviso de pieza ocupada de Hoy hidrata sin diferencias", async () => {
    const { container, errores } = await hidratar(avisosDePiezaOcupada());

    expect(errores).toEqual([]);
    expect(container.textContent).toContain("26 sept 14:30");
  });

  // El mes abreviado lo escribía el ICU: si el del navegador trae otro nombre que el del
  // servidor ("sep" y no "sept"), el texto no coincidía (fallaba con el time.ts de main).
  it("el aviso de pieza ocupada hidrata igual aunque el navegador abrevie distinto el mes", async () => {
    const { container, errores } = await hidratar(avisosDePiezaOcupada(), (texto) =>
      septiembreSinT(comoChrome(texto))
    );

    expect(errores).toEqual([]);
    expect(container.textContent).toContain("26 sept 14:30");
  });

  // Hoy: las tarjetas de habitación en cada estado que puede tener una al cargar.
  it("las tarjetas de habitación de Hoy hidratan sin diferencias", async () => {
    const habitaciones = [
      habitacion({ id: 1, number: "1" }),
      // Ocupada, con deuda, con el check-out pasado y cobrable como tardío.
      habitacion({
        id: 2,
        number: "2",
        status: "occupied",
        client: "Juan Prueba",
        checkout: "26 sept 10:00",
        check_in_target: "2026-09-25T17:00:00.000Z",
        check_out_target: "2026-09-26T13:00:00.000Z",
        isLate: true,
        canChargeLateCheckout: true,
        reservationId: "res-2",
        reservationStatus: "checked_in",
        baseTotalPrice: 80000,
        totalPrice: 80000,
        paidAmount: 30000,
      }),
      // De una empresa, pagada, con tardío ya cargado.
      habitacion({
        id: 3,
        number: "3",
        status: "occupied",
        client: "Empresa Ficticia SA",
        checkout: "27 sept 14:00",
        check_in_target: "2026-09-24T17:00:00.000Z",
        check_out_target: "2026-09-27T13:00:00.000Z",
        hasLateCheckout: true,
        reservationId: "res-3",
        reservationStatus: "checked_in",
        baseTotalPrice: 240000,
        totalPrice: 240000,
        paidAmount: 240000,
        accountCreditEnabled: true,
        billedToCompany: true,
        associatedClientId: "emp-1",
        companyPassengerId: "pas-1",
        facturacionModo: "consolidada",
      }),
      // Llegada de ayer que nadie registró, de una empresa sin pasajero cargado.
      habitacion({
        id: 4,
        number: "4",
        client: "Empresa Ficticia SA",
        checkout: "27 sept 10:00",
        reservationId: "res-4",
        reservationStatus: "confirmed",
        baseTotalPrice: 80000,
        totalPrice: 80000,
        hasPendingArrival: true,
        arrivalIsOverdue: true,
        arrivalDateLabel: "25 sept 26",
        billedToCompany: true,
        associatedClientId: "emp-1",
      }),
      habitacion({ id: 5, number: "5", status: "cleaning" }),
      habitacion({ id: 6, number: "6", status: "maintenance" }),
    ];

    const { container, errores } = await hidratar(
      <div>
        {habitaciones.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            associatedClients={[]}
            isAdmin
            timezone={TZ}
            standardCheckOutTime="10:00"
            fiscalEnabled
          />
        ))}
      </div>
    );

    expect(errores).toEqual([]);
    expect(container.textContent).toContain("$50.000,00");
  });

  // El marco del panel, que se dibuja en todas las pantallas (Hoy y Mantenimiento).
  it("los menús y el aviso de turno viejo hidratan sin diferencias", async () => {
    const { container, errores } = await hidratar(
      <>
        <MobileTopBar
          role="admin"
          userEmail="admin@example.com"
          hasOpenShift
          unbilledCount={3}
          remitosPendientes={2}
        />
        <Sidebar
          role="admin"
          userEmail="admin@example.com"
          hasOpenShift
          unbilledCount={3}
          remitosPendientes={2}
        />
        {/* Abierto hace días: el aviso sale recién después de montar, en los dos lados. */}
        <OpenShiftAgeAlert openedAt="2026-09-20T11:00:00.000Z" />
        <MobileTabBar hasOpenShift />
      </>
    );

    expect(errores).toEqual([]);
    expect(container.textContent).toContain("Turno de caja abierto hace");
  });
});
