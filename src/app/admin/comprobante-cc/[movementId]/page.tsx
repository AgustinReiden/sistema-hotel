import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getFiscalSettings, getHotelSettings } from "@/lib/data";
import { nombreComprobante, prefijoArchivo } from "@/lib/comprobante-nombre";
import { formatAmount, formatShiftCode } from "@/lib/format";
import { formatHotelDateTime, formatHotelDate } from "@/lib/time";
import { codigoRemito, numeroVisible } from "@/lib/remito-codigo";
import { remitoQrDataUrl } from "@/lib/remito-qr";
import ReceiptAutoPrint from "../../recibo/[paymentId]/ReceiptAutoPrint";
import ThermalStyles from "@/app/admin/components/ThermalStyles";
import { CSS_TICKET_COMPACTO, REMITO_QR_MM } from "../ticket-compacto";

export const dynamic = "force-dynamic";


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

  // Solo los cargos llevan remito. Un pago que llegara por esta URL se imprimía
  // como "CARGO A CUENTA CORRIENTE" con un número que no es de ningún remito.
  if (raw.tipo !== "cargo") notFound();

  const company = one(raw.associated_client);
  const guest = one(raw.guest);
  const reservation = one(raw.reservation);
  const room = one(reservation?.rooms ?? null);

  const clientName = company?.display_name ?? guest?.full_name ?? "—";
  const clientDoc = company?.document_id ?? guest?.document_id ?? null;

  const hotelSettings = await getHotelSettings().catch(() => null);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
  const amount = Number(raw.amount) || 0;

  // Correlativo del remito (mig 106). El fallback al pedazo de UUID existe por si se
  // lee una fila sin numero, no como camino normal: sin numero no hay QR.
  const codigo = raw.remito_numero !== null ? codigoRemito(raw.remito_numero) : null;
  const visible = raw.remito_numero !== null ? numeroVisible(raw.remito_numero) : raw.id.slice(0, 8);
  const qr = codigo ? await remitoQrDataUrl(codigo) : null;

  return (
    <div className="thermal">
      <div className="compacto">
        {/* Sin nombre ni dirección del hotel: sólo gastaban papel (pedido de Agustín,
            2026-09-22). El remito arranca en el tipo de comprobante. */}
        <p className="tipo">COMPROBANTE CTA. CTE.</p>
        <hr />
        {/* QR al costado del número, no arriba: el bloque ocupa lo que mide el QR
            y el ticket sale más corto que el de antes sin QR (pedido de Agustín). */}
        <div className="ident">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="qr"
              src={qr}
              alt={codigo ?? ""}
              style={{ width: `${REMITO_QR_MM}mm`, height: `${REMITO_QR_MM}mm` }}
            />
          ) : null}
          <div>
            <p className="nro">{visible}</p>
            <p className="fecha">{formatHotelDateTime(raw.created_at, tz)}</p>
          </div>
        </div>
        <hr />
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
            <span>Habitación:</span>
            <span>{room.room_number}</span>
          </p>
        )}
        {reservation && (
          <p className="row">
            <span>Estadía:</span>
            <span>
              {formatHotelDate(reservation.check_in_target, tz)} → {formatHotelDate(reservation.check_out_target, tz)}
            </span>
          </p>
        )}
        <p className="total">
          <span>CARGADO A CUENTA</span>
          <span className="money">{formatAmount(amount)}</span>
        </p>
        <div className="firma">
          <span>Firma:</span>
          <span className="linea" />
        </div>
        <div className="aclaracion">
          <span>Aclaración:</span>
          <span className="linea" />
        </div>
      </div>
      <div className="thermal-feed" aria-hidden="true" />
      {autoPrint && <ReceiptAutoPrint closeOnDone />}
      <ThermalStyles />
      {/* Después de ThermalStyles a propósito: el diseño compacto manda sobre los
          tamaños comunes de los papeles térmicos. */}
      <style>{`.thermal-feed { height: 2mm; }\n${CSS_TICKET_COMPACTO}`}</style>
    </div>
  );
}
