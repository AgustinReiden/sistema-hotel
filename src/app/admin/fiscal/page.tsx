import { after } from "next/server";
import { FileText } from "lucide-react";

import { sweepStaleInvoices } from "@/lib/arca/emitter";
import {
  getFiscalSettings,
  getHotelSettings,
  listAuthorizedInvoices,
  listInvoiceableCheckouts,
  listPendingInvoices,
} from "@/lib/data";
import { DATE_KEY } from "@/lib/date-range";
import { PageHeader } from "../PageShell";
import { isCurrentUserAdmin } from "@/lib/server-auth";
import { hotelDateKey } from "@/lib/time";
import FiscalClient from "./FiscalClient";
import { parseFiscalView } from "./views";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ desde?: string; hasta?: string; view?: string }> };

export default async function FiscalPage({ searchParams }: PageProps) {
  // Barrido de facturas trabadas: una consolidada se emite una vez por mes, así que
  // si ARCA da timeout justo ahí nadie vuelve a pasar por el barrido hasta la
  // siguiente emisión, y el recepcionista ni siquiera la ve en su lista. Que el admin
  // abra esta pantalla ALCANZA para reconciliarla, sin cron ni infraestructura nueva.
  //
  // Va en `after()`: corre DESPUÉS de mandar la respuesta, así que no le agrega ni un
  // milisegundo a la carga de la pantalla aunque ARCA tarde. La contracara es que lo
  // reconciliado se ve recién al refrescar; para algo que hoy puede quedar semanas
  // trabado, esperar un refresh es barato. `sweepStaleInvoices` nunca lanza.
  const isAdmin = await isCurrentUserAdmin();
  if (isAdmin) {
    after(sweepStaleInvoices());
  }

  // Default: mes en curso, en zona del hotel (no UTC: se corre de mes a la noche en Tucumán).
  const hotelSettings = await getHotelSettings().catch(() => null);
  const todayKey = hotelDateKey(new Date(), hotelSettings?.timezone);
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const { desde, hasta, view: viewParam } = await searchParams;
  const view = parseFiscalView(viewParam, isAdmin);
  let fromKey = desde && DATE_KEY.test(desde) ? desde : monthStartKey;
  let toKey = hasta && DATE_KEY.test(hasta) ? hasta : todayKey;
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];

  // Cada solapa trae sólo su lista: las otras dos no se ven, así que pedirlas sería
  // pagar tres consultas para pintar una.
  const [settings, pending, invoiceable, authorized] = await Promise.all([
    getFiscalSettings().catch(() => null),
    view === "pendientes" ? listPendingInvoices().catch(() => []) : Promise.resolve([]),
    // Los check-outs sin facturar son del administrador: al recepcionista ni se le
    // piden. Lo suyo son las pendientes/con error de su turno abierto.
    isAdmin && view === "sin_facturar"
      ? listInvoiceableCheckouts().catch(() => [])
      : Promise.resolve([]),
    view === "emitidas" ? listAuthorizedInvoices(fromKey, toKey).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={<FileText size={20} className="text-emerald-600" />}
        iconTone="emerald"
        title="Facturación"
        subtitle={
          settings?.enabled
            ? settings.environment === "homologacion"
              ? "Ambiente de PRUEBA (homologación): los comprobantes no tienen valor fiscal."
              : "Ambiente de PRODUCCIÓN: se emiten facturas reales."
            : "La facturación electrónica no está habilitada (Ajustes → Facturación electrónica)."
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-8 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <FiscalClient
            enabled={Boolean(settings?.enabled)}
            pending={pending}
            invoiceable={invoiceable}
            authorized={authorized}
            from={fromKey}
            to={toKey}
            today={todayKey}
            isAdmin={isAdmin}
            view={view}
          />
        </div>
      </div>
    </div>
  );
}
