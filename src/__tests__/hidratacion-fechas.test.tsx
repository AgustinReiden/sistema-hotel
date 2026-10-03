import { act } from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/admin/layout";
import AdminAlertsList from "@/app/admin/AdminAlertsList";
import { MobileTabBar, MobileTopBar } from "@/app/admin/MobileNav";
import OccupiedRoomAlertBanner from "@/app/admin/OccupiedRoomAlertBanner";
import OpenShiftAgeAlert from "@/app/admin/OpenShiftAgeAlert";
import Dashboard from "@/app/admin/page";
import RoomCard from "@/app/admin/RoomCard";
import Sidebar from "@/app/admin/Sidebar";
import {
  countBillingPending,
  getActiveAssociatedClients,
  getActiveOpenShift,
  getCurrentUserRole,
  getDashboardData,
  getFiscalSettings,
  getPendingSolicitudesCount,
  getRemitosSalud,
  getUnresolvedAdminAlertsCount,
  listPendingInvoices,
  listRoomOccupancyAlerts,
} from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type {
  AdminAlert,
  AssociatedClient,
  FiscalSettings,
  HotelSettings,
  Room,
  RoomOccupancyAlert,
} from "@/lib/types";
import { comoChrome, conIcuCambiado, septiembreSinT, type CambioDeIcu } from "./icu-chrome";

// Error #418 de React en el build de producción: el HTML del servidor no coincidía con
// el primer dibujo del navegador. Acá se dibuja el componente como en el servidor (con
// el ICU de Node y la zona del contenedor, UTC), se hidrata como en la PC de la recepción
// (con el ICU de Chrome y la zona del hotel) y se mira si React avisa.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
// La pantalla entera de Hoy (el marco del panel y la página) lee la sesión y los datos
// en el servidor: acá salen de estos dobles.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/data", () => ({
  countBillingPending: vi.fn(),
  getActiveAssociatedClients: vi.fn(),
  getActiveOpenShift: vi.fn(),
  getCurrentUserRole: vi.fn(),
  getDashboardData: vi.fn(),
  getFiscalSettings: vi.fn(),
  getPendingSolicitudesCount: vi.fn(),
  getRemitosSalud: vi.fn(),
  getShiftSummary: vi.fn(),
  getUnresolvedAdminAlertsCount: vi.fn(),
  listPendingInvoices: vi.fn(),
  listRoomOccupancyAlerts: vi.fn(),
}));
vi.mock("@/app/admin/mantenimiento/actions", () => ({
  authorizeOldTariffAction: vi.fn(),
  listAdminAlertsAction: vi.fn(),
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

// --- La pantalla entera de Hoy: lo que leen del servidor el marco del panel y la página.

type DatosDeHoy = Awaited<ReturnType<typeof getDashboardData>>;
type Reserva = DatosDeHoy["reservations"][number];

function pieza(id: number, status: Room["status"] = "available"): Room {
  return {
    id,
    category_id: null,
    room_number: String(id),
    room_type: "Doble",
    status,
    capacity: 2,
    capacity_adults: 2,
    capacity_children: 0,
    beds_configuration: "1 cama doble",
    amenities: [],
    description: null,
    image_url: null,
    base_price: 80000,
    half_day_price: 40000,
    is_active: true,
  };
}

function reserva(overrides: Partial<Reserva> = {}): Reserva {
  return {
    id: "res-1",
    room_id: 1,
    client_name: "Juan Prueba",
    status: "checked_in",
    check_in_target: "2026-09-25T17:00:00.000Z",
    check_out_target: "2026-09-27T13:00:00.000Z",
    late_check_out_until: null,
    actual_check_in: null,
    actual_check_out: null,
    base_total_price: 80000,
    discount_percent: 0,
    discount_amount: 0,
    total_price: 80000,
    paid_amount: 0,
    associated_client_id: null,
    company_passenger_id: null,
    client_dni: null,
    ...overrides,
  };
}

const EMPRESA: AssociatedClient = {
  id: "emp-1",
  display_name: "Empresa Ficticia SA",
  document_id: "30123456781",
  phone: null,
  discount_percent: 10,
  notes: null,
  is_active: true,
  cuenta_corriente_habilitada: true,
  condicion_iva: "responsable_inscripto",
  razon_social: null,
  domicilio: null,
  facturacion_modo: "consolidada",
  robinet_id: null,
  created_at: TARDE,
  updated_at: TARDE,
};

const AJUSTES_DEL_HOTEL: HotelSettings = {
  id: 1,
  name: "Hotel de Prueba",
  standard_check_in_time: "14:00",
  standard_check_out_time: "10:00",
  late_check_out_time: "18:00",
  timezone: TZ,
  currency: "ARS",
  contact_email: null,
  contact_phone: null,
  address: null,
  hero_title: "Hotel de Prueba",
  hero_subtitle: "",
};

const FACTURACION: FiscalSettings = {
  id: 1,
  enabled: true,
  environment: "homologacion",
  cuit: null,
  razon_social: null,
  domicilio_fiscal: null,
  iibb: null,
  inicio_actividades: null,
  punto_venta: null,
  cbte_tipo: 6,
  concepto: 2,
  iva_pct: 21,
  prefijo_archivos: null,
  dias_vto_cuenta_corriente: 30,
};

/** Hoy a las 14:30 de un admin, con una habitación en cada estado y todos los avisos. */
function prepararHoy() {
  const reservas = [
    // Ocupada, con deuda y el check-out de las 10:00 ya pasado.
    reserva({
      id: "res-2",
      room_id: 2,
      check_out_target: "2026-09-26T13:00:00.000Z",
      paid_amount: 30000,
    }),
    // De una empresa, pagada, con tardío hasta las 14:00 de mañana.
    reserva({
      id: "res-3",
      room_id: 3,
      client_name: "Empresa Ficticia SA",
      check_in_target: "2026-09-24T17:00:00.000Z",
      late_check_out_until: "2026-09-27T17:00:00.000Z",
      base_total_price: 240000,
      total_price: 240000,
      paid_amount: 240000,
      associated_client_id: EMPRESA.id,
      company_passenger_id: "pas-1",
    }),
    // Llegada de ayer que nadie registró, de la empresa y sin pasajero cargado.
    reserva({
      id: "res-4",
      room_id: 4,
      client_name: "Empresa Ficticia SA",
      status: "confirmed",
      associated_client_id: EMPRESA.id,
    }),
    // Llega hoy.
    reserva({
      id: "res-5",
      room_id: 5,
      client_name: "Ana Prueba",
      status: "confirmed",
      check_in_target: "2026-09-26T17:00:00.000Z",
    }),
  ];

  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: "u-admin", email: "admin@example.com" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: "admin", full_name: "Admin Prueba" } }),
        }),
      }),
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(getActiveOpenShift).mockResolvedValue({
    id: "turno-1",
    shift_number: 12,
    // Abierta hace dos días: sale el aviso de turno viejo (recién después de montar).
    opened_at: "2026-09-24T11:00:00.000Z",
    closed_at: null,
    opened_by: "u-admin",
    closed_by: null,
    opening_cash: 0,
    expected_cash: null,
    actual_cash: null,
    discrepancy: null,
    notes: null,
    status: "open",
  });
  vi.mocked(countBillingPending).mockResolvedValue({ falta: 2, pendiente_consolidada: 1, dias: 60 });
  vi.mocked(listPendingInvoices).mockResolvedValue([]);
  vi.mocked(getRemitosSalud).mockResolvedValue({
    ultima_ingesta_at: TARDE,
    ultima_evaluacion_at: TARDE,
    evaluando_viejos: 0,
    a_revisar: 2,
    piezas_abiertas: 1,
    umbral_confianza: 0.8,
    controlar_desde: 1,
    max_intentos_firma: 3,
    vencidos: 1,
    a_revisar_vencidos: 0,
    horas_vencimiento: 72,
    alertar_desde: "2026-09-01",
  });
  vi.mocked(getDashboardData).mockResolvedValue({
    rooms: [
      pieza(1),
      pieza(2, "occupied"),
      pieza(3, "occupied"),
      pieza(4),
      pieza(5),
      pieza(6, "cleaning"),
      pieza(7, "maintenance"),
    ],
    reservations: reservas,
    accountCreditByReservation: { "res-3": true, "res-4": true },
    facturacionModoByReservation: { "res-3": "consolidada", "res-4": "consolidada" },
    invoicePrefillByReservation: {},
    priorPaymentMethodsByReservation: { "res-2": ["cash"], "res-3": ["cuenta_corriente"] },
    todayIncome: 0,
    hotelSettings: AJUSTES_DEL_HOTEL,
  });
  vi.mocked(getActiveAssociatedClients).mockResolvedValue([EMPRESA]);
  vi.mocked(getCurrentUserRole).mockResolvedValue("admin");
  vi.mocked(getPendingSolicitudesCount).mockResolvedValue(2);
  vi.mocked(getUnresolvedAdminAlertsCount).mockResolvedValue(3);
  vi.mocked(getFiscalSettings).mockResolvedValue(FACTURACION);
  vi.mocked(listRoomOccupancyAlerts).mockResolvedValue([
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
  ]);
}

describe("hidratación: lo que dibuja el servidor coincide con el navegador", () => {
  it("la simulación cambia de verdad la zona del proceso", async () => {
    const corrimiento = () => new Date(TARDE).getTimezoneOffset();
    expect(await enZona(ZONA_DEL_SERVIDOR, corrimiento)).toBe(0);
    expect(await enZona(ZONA_DE_LA_PC, corrimiento)).toBe(180);
  });

  // La campana de avisos: la fecha y hora de cada aviso sin revisar (AdminAlertsList.tsx,
  // que reemplazó al panel de Mantenimiento).
  it("la lista de avisos de la campana hidrata sin diferencias", async () => {
    const { container, errores } = await hidratar(
      <AdminAlertsList
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

  // Hoy entera, como la arma Next: el marco del panel (layout.tsx) con la página
  // (page.tsx) adentro, los dos calculados una sola vez "en el servidor", y todo lo de
  // cliente dibujado de nuevo "en el navegador". Cubre también lo que escriben los
  // componentes de servidor (títulos, avisos, contadores) y cómo anidan las etiquetas:
  // una etiqueta mal anidada el navegador la reacomoda al leer el HTML y también da #418.
  it("la pantalla entera de Hoy (el marco del panel y la página) hidrata sin diferencias", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TARDE));
    try {
      prepararHoy();
      const pantalla = await enZona(ZONA_DEL_SERVIDOR, async () =>
        AdminLayout({ children: await Dashboard() })
      );

      // El ICU de Chrome medido, y otro que además abrevia distinto el mes (con el
      // time.ts de main, este segundo fallaba por el aviso de pieza ocupada).
      const cambios: CambioDeIcu[] = [comoChrome, (texto) => septiembreSinT(comoChrome(texto))];
      for (const cambio of cambios) {
        const { container, errores } = await hidratar(pantalla, cambio);

        expect(errores).toEqual([]);
        const texto = container.textContent ?? "";
        expect(texto).toContain("Hoy · sábado, 26 sept");
        expect(texto).toContain("Hay 1 habitación usada sin estadía cargada");
        expect(texto).toContain("26 sept 14:30");
        expect(texto).toContain("Tenés 3 avisos sin revisar");
        expect(texto).toContain("Ver avisos");
        // La campana del dueño, arriba en el escritorio y en la barra del celular.
        expect(container.querySelectorAll('[aria-label="Avisos: 3 sin revisar"]')).toHaveLength(2);
        expect(texto).toContain("Tenés 2 solicitudes pendientes");
        expect(texto).toContain("Retraso Check-out");
        expect(texto).toContain("$50.000,00");
        expect(texto).toContain("Late Check-out");
        expect(texto).toContain("Falta Check-In");
        expect(texto).toContain("Llega Hoy");
        expect(texto).toContain("Limpieza");
        expect(texto).toContain("Mantenimiento");
        expect(texto).toContain("Turno de caja abierto hace 54h 30m");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
