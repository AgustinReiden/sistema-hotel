import { redirect } from "next/navigation";
import { Layers } from "lucide-react";

import {
  getCtaCteAccount,
  getCtaCteBillingProfile,
  getCurrentUserRole,
  getFiscalSettings,
  getHotelSettings,
} from "@/lib/data";
import { hotelDateKey } from "@/lib/time";
import type { CtaCteClientKind } from "@/lib/types";
import ConsolidadaClient from "./ConsolidadaClient";

export const dynamic = "force-dynamic";

export default async function ConsolidadaPage({
  searchParams,
}: {
  // Un parámetro repetido en la URL (`?id=a&id=b`) llega como lista.
  searchParams: Promise<{ kind?: string | string[]; id?: string | string[] }>;
}) {
  // El rol va antes que los parámetros: recepción va a /forbidden, traiga lo que traiga.
  const role = await getCurrentUserRole();
  if (role !== "admin") {
    redirect("/forbidden");
  }

  // A la consolidada se entra siempre con el cliente puesto: desde Control, Cuentas o
  // la ficha, que mandan `kind` e `id`. Sin cliente no hay nada que revisar, así que
  // se vuelve a Control en vez de abrir un selector vacío. Un parámetro repetido
  // tampoco es un cliente puesto (y `trim()` sobre una lista rompía la página).
  const { kind, id } = await searchParams;
  const preselectKind: CtaCteClientKind | null =
    kind === "company" || kind === "guest" ? kind : null;
  const preselectId = typeof id === "string" ? id.trim() || null : null;
  if (!preselectKind || !preselectId) {
    redirect("/admin/fiscal/control");
  }

  const [cuenta, settings, hotel] = await Promise.all([
    // Sólo el cliente de la URL, por su id: no depende de leer bien todas las cuentas.
    // Si la lectura falla, la página no abre (antes, con la lista entera, un error en
    // las empresas o en los huéspedes lo hacía pasar por "no es de cuenta corriente").
    getCtaCteAccount(preselectKind, preselectId),
    getFiscalSettings().catch(() => null),
    // Sólo se usa para la zona horaria de los presets: si falla, la pantalla
    // tiene que seguir funcionando igual, no morirse por unos botones.
    getHotelSettings().catch(() => null),
  ]);

  // El "hoy" de los presets se calcula en el servidor y en la zona del hotel: si
  // saliera del reloj del navegador, "Este mes" podría arrancar un día antes o
  // después según la máquina de la recepción.
  const todayKey = hotelDateKey(new Date(), hotel?.timezone || undefined);

  // Un id que no es de ningún cliente de cuenta corriente tampoco es un cliente puesto.
  if (!cuenta) {
    redirect("/admin/fiscal/control");
  }

  // La ficha del cliente precarga el receptor, tenga o no la cuenta corriente prendida:
  // la pantalla manda 'consumidor_final' si no ve una condición, así que una ficha que
  // no llega haría salir B con DNI a un Responsable Inscripto. Se lee recién con el
  // cliente validado, porque el id viene de la URL.
  const profile = await getCtaCteBillingProfile(preselectKind, preselectId);
  const billingProfiles = profile ? { [`${preselectKind}:${preselectId}`]: profile } : {};

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-8 py-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Layers size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Factura consolidada</h1>
            <p className="text-sm text-slate-500">
              Juntá varias estadías de un cliente de cuenta corriente en un solo comprobante fiscal.
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          {settings?.enabled
            ? settings.environment === "homologacion"
              ? "Ambiente de PRUEBA (homologación): los comprobantes no tienen valor fiscal."
              : "Ambiente de PRODUCCIÓN: se emiten facturas reales."
            : "La facturación electrónica no está habilitada (Ajustes → Facturación electrónica)."}
        </p>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto">
          <ConsolidadaClient
            enabled={Boolean(settings?.enabled)}
            // La pantalla busca al cliente en esta lista: va sólo el de la URL.
            accounts={[cuenta]}
            billingProfiles={billingProfiles}
            preselectKind={preselectKind}
            preselectId={preselectId}
            todayKey={todayKey}
            fiscal={
              settings
                ? {
                    environment: settings.environment,
                    punto_venta: settings.punto_venta,
                    dias_vto_cuenta_corriente: settings.dias_vto_cuenta_corriente,
                  }
                : null
            }
          />
        </div>
      </div>
    </div>
  );
}
