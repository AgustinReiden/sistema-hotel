import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getFiscalSettings, getHotelSettings } from "@/lib/data";
import { nombreComprobante, prefijoArchivo } from "@/lib/comprobante-nombre";
import { formatAmount, formatShiftCode } from "@/lib/format";
import { formatHotelDateTime, formatHotelDate } from "@/lib/time";
import ReceiptAutoPrint from "../../recibo/[paymentId]/ReceiptAutoPrint";
import ThermalStyles from "@/app/admin/components/ThermalStyles";

export const dynamic = "force-dynamic";

function money(n: number) {
  return formatAmount(n);
}

type RelationOne<T> = T | T[] | null;
function one<T>(rel: RelationOne<T>): T | null {
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

type PageProps = {
  params: Promise<{ movementId: string }>;
  searchParams: Promise<{ autoprint?: string }>;
};

/** Sólo el número, para el título. Cacheado por request: no duplica la consulta. */
const remitoNumeroCached = cache(async (movementId: string): Promise<number | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cuenta_corriente_movimientos")
    .select("remito_numero")
    .eq("id", movementId)
    .maybeSingle();
  const numero = (data as { remito_numero: number | null } | null)?.remito_numero;
  return numero ?? null;
});

const fiscalCached = cache(getFiscalSettings);

/**
 * El <title> es lo que el navegador propone como nombre de archivo al "Guardar como
 * PDF": "COMB - Rem - 000017". Antes los cuatro papeles del sistema se guardaban
 * todos como "El Refugio | Hotel & Servicios de Ruta.pdf".
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { movementId } = await params;
  const [numero, fiscal] = await Promise.all([
    remitoNumeroCached(movementId).catch(() => null),
    fiscalCached().catch(() => null),
  ]);

  return {
    title: nombreComprobante({
      prefijo: prefijoArchivo(fiscal?.prefijo_archivos, fiscal?.razon_social),
      tipo: "Rem",
      numero: numero !== null ? formatShiftCode(numero) : "",
    }),
  };
}

export default async function AccountVoucherPage({ params, searchParams }: PageProps) {
  const { movementId } = await params;
  const sp = await searchParams;
  const autoPrint = sp.autoprint === "1";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cuenta_corriente_movimientos")
    .select(
      `
      id, amount, created_at, tipo, remito_numero,
      associated_client:associated_clients ( display_name, document_id ),
      guest:guests ( full_name, document_id ),
      reservation:reservations ( client_name, check_in_target, check_out_target, rooms ( room_number ) )
      `
    )
    .eq("id", movementId)
    .maybeSingle();

  if (error || !data) notFound();

  const raw = data as {
    id: string;
    remito_numero: number | null;
    amount: number | string;
    created_at: string;
    tipo: string;
    associated_client: RelationOne<{ display_name: string; document_id: string | null }>;
    guest: RelationOne<{ full_name: string; document_id: string | null }>;
    reservation: RelationOne<{
      client_name: string;
      check_in_target: string;
      check_out_target: string;
      rooms: RelationOne<{ room_number: string }>;
    }>;
  };

  const company = one(raw.associated_client);
  const guest = one(raw.guest);
  const reservation = one(raw.reservation);
  const room = one(reservation?.rooms ?? null);

  const clientName = company?.display_name ?? guest?.full_name ?? "—";
  const clientDoc = company?.document_id ?? guest?.document_id ?? null;

  const hotelSettings = await getHotelSettings().catch(() => null);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
  const amount = Number(raw.amount) || 0;

  return (
    <div className="thermal">
      <div className="thermal-page">
        <h1>{hotelSettings?.name || "Hotel El Refugio"}</h1>
        <p className="addr">{hotelSettings?.address ?? ""}</p>
        <hr />
        <h2>COMPROBANTE CTA. CTE.</h2>
        <p className="sub">CARGO A CUENTA CORRIENTE</p>
        <p className="row">
          <span>Nro:</span>
          {/* Correlativo del comprobante (mig 106). El fallback al pedazo de UUID
              existe por si se lee una fila sin numero, no como camino normal. */}
          <span>
            {raw.remito_numero !== null ? formatShiftCode(raw.remito_numero) : raw.id.slice(0, 8)}
          </span>
        </p>
        <p className="row">
          <span>Fecha:</span>
          <span>{formatHotelDateTime(raw.created_at, tz)}</span>
        </p>
        <hr />
        <p className="seccion">Cliente</p>
        <p className="row">
          <span>Cliente:</span>
          <span>{clientName}</span>
        </p>
        {clientDoc && (
          <p className="row">
            <span>DNI/CUIT:</span>
            <span>{clientDoc}</span>
          </p>
        )}
        {room && (
          <p className="row">
            <span>Habitacion:</span>
            <span>{room.room_number}</span>
          </p>
        )}
        {reservation && (
          <p className="row">
            <span>Estadia:</span>
            <span>
              {formatHotelDate(reservation.check_in_target, tz)} → {formatHotelDate(reservation.check_out_target, tz)}
            </span>
          </p>
        )}
        <hr />
        <p className="total">
          <span>CARGADO A CUENTA</span>
          <span className="money">{money(amount)}</span>
        </p>
        <hr />
        <p className="note">
          El cliente reconoce adeudar el monto cargado a su cuenta corriente y se compromete a su pago.
        </p>
        <p className="footer">Firma: _____________________</p>
        <p className="footer">Aclaración: _____________________</p>
        <p className="footer muted">Conserve este comprobante.</p>
      </div>
      <div className="thermal-feed" aria-hidden="true" />
      {autoPrint && <ReceiptAutoPrint closeOnDone />}

      <style>{`
        .thermal-feed { height: 2mm; }
      `}</style>
      <ThermalStyles />
    </div>
  );
}
