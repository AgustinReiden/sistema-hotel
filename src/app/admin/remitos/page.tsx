import { redirect } from "next/navigation";
import { Signature } from "lucide-react";

import { getCtaCteAccounts, getCurrentUserRole, getRemitosSalud, listRemitoPiezas, listRemitos } from "@/lib/data";
import { esVencido, rangoDeMes } from "@/lib/remitos";
import { hotelDateKey } from "@/lib/time";
import type { CtaCteClientKind, RemitosSalud } from "@/lib/types";
import RemitosClient from "./RemitosClient";

export const dynamic = "force-dynamic";

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SALUD_VACIA: RemitosSalud = {
  ultima_ingesta_at: null, ultima_evaluacion_at: null, evaluando_viejos: 0, a_revisar: 0,
  piezas_abiertas: 0, umbral_confianza: 0.95, controlar_desde: 1, max_intentos_firma: 5,
  vencidos: 0, a_revisar_vencidos: 0, horas_vencimiento: 48, alertar_desde: "2026-09-24",
};

export default async function RemitosPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; mes?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (role !== "admin") redirect("/forbidden");

  const { cliente, mes } = await searchParams;
  const ahora = new Date();
  const mesFiltro = mes && MES_RE.test(mes) ? mes : hotelDateKey(ahora).slice(0, 7);
  const { desde, hasta } = rangoDeMes(mesFiltro);

  // `cliente` viaja como "company:<uuid>" | "guest:<uuid>", igual que en el control.
  const [rawKind, rawId] = (cliente ?? "").split(":");
  const clientKind: CtaCteClientKind | undefined = rawKind === "company" || rawKind === "guest" ? rawKind : undefined;
  const clientId = clientKind && rawId ? rawId : undefined;

  // Lo que falla se dice en pantalla: una lista vacía por un error se confunde con
  // "no hay nada que controlar".
  const errores: string[] = [];
  const cargar = <T,>(p: Promise<T>, vacio: T, que: string): Promise<T> =>
    p.catch((e: unknown) => {
      console.error(`[remitos] ${que}:`, e);
      errores.push(que);
      return vacio;
    });

  const [rows, piezas, salud, accounts] = await Promise.all([
    cargar(listRemitos(desde, hasta, clientKind, clientId), [], "los remitos"),
    cargar(listRemitoPiezas(false), [], "las piezas a revisar"),
    cargar(getRemitosSalud(), SALUD_VACIA, "el estado de la ingesta"),
    cargar(getCtaCteAccounts(), [], "los clientes"),
  ]);

  // Los vencidos no dependen del mes elegido. Solo se buscan si la salud dice que hay.
  const hoyKey = hotelDateKey(ahora);
  const vencidos =
    salud.vencidos > 0
      ? (await cargar(listRemitos(salud.alertar_desde, hoyKey), [], "los remitos vencidos"))
          .filter((r) => esVencido(r, salud, ahora.getTime()))
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
      : [];

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="h-auto bg-white border-b border-slate-200 px-4 md:px-6 py-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Signature size={20} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Remitos firmados</h1>
            <p className="text-sm text-slate-500">Qué remitos de cuenta corriente están escaneados y firmados, y cuáles faltan.</p>
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-3 md:p-5">
        <div className="max-w-[1400px] mx-auto">
          <RemitosClient
            rows={rows}
            vencidos={vencidos}
            piezas={piezas}
            salud={salud}
            accounts={accounts}
            cliente={cliente ?? ""}
            mes={mesFiltro}
            nowMs={ahora.getTime()}
            errores={errores}
          />
        </div>
      </div>
    </div>
  );
}
