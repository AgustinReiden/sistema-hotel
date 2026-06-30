import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getHotelSettings } from "@/lib/data";
import { formatAmount } from "@/lib/format";
import { formatHotelDateTime, formatHotelDate } from "@/lib/time";
import ReceiptAutoPrint from "../../recibo/[paymentId]/ReceiptAutoPrint";

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

export default async function AccountVoucherPage({ params, searchParams }: PageProps) {
  const { movementId } = await params;
  const sp = await searchParams;
  const autoPrint = sp.autoprint === "1";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cuenta_corriente_movimientos")
    .select(
      `
      id, amount, created_at, tipo,
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
          <span>{raw.id.slice(0, 8)}</span>
        </p>
        <p className="row">
          <span>Fecha:</span>
          <span>{formatHotelDateTime(raw.created_at, tz)}</span>
        </p>
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
          <span>{money(amount)}</span>
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
        @page { size: 80mm auto; margin: 0; }
        @media print {
          body { background: white !important; color: #000 !important; margin: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        .thermal { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; background: white; color: #000; width: 72mm; max-width: 72mm; margin: 0 auto; line-height: 1.2; word-break: break-word; }
        .thermal-page { padding: 0 3mm; }
        .thermal-feed { height: 10mm; }
        .thermal h1 { font-size: 15pt; font-weight: 900; margin: 0 0 2px; text-align: center; }
        .thermal .addr { font-size: 9pt; font-weight: 700; text-align: center; margin: 0 0 5px; }
        .thermal h2 { font-size: 12.5pt; font-weight: 900; margin: 6px 0 2px; text-align: center; letter-spacing: 0.6px; }
        .thermal .sub { font-size: 10pt; font-weight: 800; text-align: center; margin: 0 0 6px; letter-spacing: 1.5px; }
        .thermal hr { border: none; border-top: 1.5px solid #000; margin: 5px 0; }
        .thermal .row { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5pt; font-weight: 700; margin: 1.5px 0; }
        .thermal .row span:first-child { font-weight: 800; margin-right: 6px; }
        .thermal .row span:last-child { text-align: right; }
        .thermal .total { display: flex; justify-content: space-between; gap: 8px; font-size: 13pt; font-weight: 900; margin: 6px 0 4px; }
        .thermal .note { font-size: 9pt; font-weight: 700; margin: 6px 0; }
        .thermal .footer { font-size: 10pt; font-weight: 800; text-align: center; margin: 10px 0 0; }
        .thermal .footer.muted { color: #000; margin-top: 4px; font-weight: 700; }
      `}</style>
    </div>
  );
}
