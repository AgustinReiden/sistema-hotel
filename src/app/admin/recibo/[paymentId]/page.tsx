import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getHotelSettings } from "@/lib/data";
import { formatAmount } from "@/lib/format";
import { formatHotelDateTime } from "@/lib/time";
import ReceiptAutoPrint from "./ReceiptAutoPrint";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  mercado_pago: "Mercado Pago",
  bank_transfer: "Transferencia",
  credit_card: "Tarjeta credito",
  debit_card: "Tarjeta debito",
  vale_blanco: "Vale Blanco",
  cuenta_corriente: "Cta. Corriente",
  other: "Otro",
};

function money(n: number) {
  return formatAmount(n);
}

type ReceiptCopyProps = {
  title: string;
  firstCopy: boolean;
  hotelName: string;
  hotelAddress: string;
  paymentIdShort: string;
  paymentMethod: string;
  createdAtFormatted: string;
  clientName: string;
  clientDni: string | null;
  billedTo: string | null;
  roomNumber: string | null;
  amount: number;
  totalPrice: number;
  paidAmount: number;
  saldo: number;
  notes: string | null;
};

function ReceiptCopy(props: ReceiptCopyProps) {
  const {
    title,
    firstCopy,
    hotelName,
    hotelAddress,
    paymentIdShort,
    paymentMethod,
    createdAtFormatted,
    clientName,
    clientDni,
    billedTo,
    roomNumber,
    amount,
    totalPrice,
    paidAmount,
    saldo,
    notes,
  } = props;
  return (
    <div className={`thermal-page${firstCopy ? "" : " copy-next"}`}>
      <h1>{hotelName}</h1>
      <p className="addr">{hotelAddress}</p>
      <hr />
      <h2>RECIBO DE PAGO</h2>
      <p className="sub">{title}</p>
      <p className="row">
        <span>Nro:</span>
        <span>{paymentIdShort}</span>
      </p>
      <p className="row">
        <span>Fecha:</span>
        <span>{createdAtFormatted}</span>
      </p>
      <hr />
      <p className="row">
        <span>Huesped:</span>
        <span>{clientName}</span>
      </p>
      {clientDni && (
        <p className="row">
          <span>DNI/CUIT:</span>
          <span>{clientDni}</span>
        </p>
      )}
      {billedTo && (
        <p className="row">
          <span>Factura a:</span>
          <span>{billedTo}</span>
        </p>
      )}
      {roomNumber && (
        <p className="row">
          <span>Habitacion:</span>
          <span>{roomNumber}</span>
        </p>
      )}
      <hr />
      <p className="row">
        <span>Metodo:</span>
        <span>{paymentMethod}</span>
      </p>
      <p className="total">
        <span>TOTAL PAGADO</span>
        <span>{money(amount)}</span>
      </p>
      <hr />
      <p className="row small">
        <span>Total estadia:</span>
        <span>{money(totalPrice)}</span>
      </p>
      <p className="row small">
        <span>Pagado acumulado:</span>
        <span>{money(paidAmount)}</span>
      </p>
      <p className="row small">
        <span>Saldo restante:</span>
        <span>{money(saldo)}</span>
      </p>
      {notes && (
        <>
          <hr />
          <p className="note">Notas: {notes}</p>
        </>
      )}
      <hr />
      <p className="footer">Firma: _____________________</p>
      <p className="footer muted">Gracias por su pago.</p>
    </div>
  );
}

type PageProps = {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ autoprint?: string; copy?: string }>;
};

export default async function ReceiptPage({ params, searchParams }: PageProps) {
  const { paymentId } = await params;
  const sp = await searchParams;
  const autoPrint = sp.autoprint === "1";
  const requestedCopy =
    sp.copy === "duplicate" ? "duplicate" : sp.copy === "original" ? "original" : null;
  // En autoimpresion cada copia se imprime como un TRABAJO separado: primero el original
  // y, encadenado via nextUrl, el duplicado. Asi la comandera guillotina al final de cada
  // documento (corte entre copias) sin el salto de pagina que dejaba una hoja en blanco.
  // En vista manual (sin autoprint) se muestran ambas copias con linea de corte punteada.
  const copyMode: "both" | "original" | "duplicate" = autoPrint
    ? requestedCopy ?? "original"
    : requestedCopy ?? "both";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select(
      `
      id, amount, payment_method, notes, created_at,
      reservation:reservations ( client_name, client_dni, total_price, paid_amount, rooms ( room_number ), associated_client:associated_clients ( display_name ) )
      `
    )
    .eq("id", paymentId)
    .maybeSingle();

  if (error || !data) notFound();

  type Raw = {
    id: string;
    amount: number | string;
    payment_method: string;
    notes: string | null;
    created_at: string;
    reservation: unknown;
  };
  const raw = data as Raw;
  type AssociatedRelation =
    | { display_name: string }
    | { display_name: string }[]
    | null;
  type ReservationShape = {
    client_name: string;
    client_dni: string | null;
    total_price: number | string;
    paid_amount: number | string;
    rooms: { room_number: string } | { room_number: string }[] | null;
    associated_client: AssociatedRelation;
  };
  const reservationRelation = raw.reservation as ReservationShape | ReservationShape[] | null;
  const reservation = Array.isArray(reservationRelation)
    ? reservationRelation[0]
    : reservationRelation;
  const roomsRelation = reservation?.rooms;
  const roomNumber = Array.isArray(roomsRelation)
    ? roomsRelation[0]?.room_number
    : roomsRelation?.room_number;
  const associatedRelation = reservation?.associated_client;
  const billedTo = Array.isArray(associatedRelation)
    ? associatedRelation[0]?.display_name ?? null
    : associatedRelation?.display_name ?? null;

  const hotelSettings = await getHotelSettings().catch(() => null);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
  const amount = Number(raw.amount) || 0;
  const totalPrice = Number(reservation?.total_price) || 0;
  const paidAmount = Number(reservation?.paid_amount) || 0;
  const saldo = Math.max(0, totalPrice - paidAmount);

  const receiptData = {
    hotelName: hotelSettings?.name || "Hotel El Refugio",
    hotelAddress: hotelSettings?.address ?? "",
    paymentIdShort: raw.id.slice(0, 8),
    paymentMethod: METHOD_LABEL[raw.payment_method] ?? raw.payment_method,
    createdAtFormatted: formatHotelDateTime(raw.created_at, tz),
    clientName: reservation?.client_name ?? "---",
    clientDni: reservation?.client_dni ?? null,
    billedTo,
    roomNumber: roomNumber ?? null,
    amount,
    totalPrice,
    paidAmount,
    saldo,
    notes: raw.notes,
  };

  const copies =
    copyMode === "both"
      ? [
          { key: "original", title: "ORIGINAL" },
          { key: "duplicate", title: "DUPLICADO" },
        ]
      : [{ key: copyMode, title: copyMode === "original" ? "ORIGINAL" : "DUPLICADO" }];

  return (
    <div className="thermal">
      {copies.map((copy, index) => (
        <ReceiptCopy key={copy.key} title={copy.title} firstCopy={index === 0} {...receiptData} />
      ))}
      <div className="thermal-feed" aria-hidden="true" />
      {autoPrint &&
        (copyMode === "original" ? (
          // Tras imprimir el original, encadena el duplicado como segundo trabajo (corte entre copias).
          <ReceiptAutoPrint nextUrl={`/admin/recibo/${paymentId}?autoprint=1&copy=duplicate`} />
        ) : (
          <ReceiptAutoPrint closeOnDone />
        ))}

      <style>{`
        /* Comandera termica: ancho 80mm y alto automatico (= largo del contenido), sin
           margenes, para que no queden hojas en blanco y el corte caiga al final. */
        @page { size: 80mm auto; margin: 0; }
        @media print {
          body {
            background: white !important;
            color: #000 !important;
            margin: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print { display: none !important; }
        }
        .thermal {
          font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
          background: white;
          color: #000;
          width: 72mm;
          max-width: 72mm;
          margin: 0 auto;
          line-height: 1.2;
          word-break: break-word;
        }
        /* Copias en flujo continuo (sin salto de pagina, que generaba el espacio en blanco
           gigante entre original y duplicado); se separan con linea de corte punteada. */
        .thermal-page { padding: 0 3mm; }
        .thermal-page.copy-next {
          margin-top: 4mm;
          padding-top: 4mm;
          border-top: 1px dashed #000;
        }
        .thermal-feed { height: 2mm; }
        .thermal h1 { font-size: 15pt; font-weight: 900; margin: 0 0 2px; text-align: center; }
        .thermal .addr { font-size: 9pt; font-weight: 700; text-align: center; margin: 0 0 5px; }
        .thermal h2 { font-size: 12.5pt; font-weight: 900; margin: 6px 0 2px; text-align: center; letter-spacing: 0.6px; }
        .thermal .sub { font-size: 10pt; font-weight: 800; text-align: center; margin: 0 0 6px; letter-spacing: 1.5px; }
        .thermal hr { border: none; border-top: 1.5px solid #000; margin: 5px 0; }
        .thermal .row { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5pt; font-weight: 700; margin: 1.5px 0; }
        .thermal .row span:first-child { font-weight: 800; margin-right: 6px; }
        .thermal .row span:last-child { text-align: right; }
        .thermal .row.small { font-size: 9.5pt; font-weight: 700; }
        .thermal .total { display: flex; justify-content: space-between; gap: 8px; font-size: 13pt; font-weight: 900; margin: 6px 0 4px; }
        .thermal .note { font-size: 9.5pt; font-weight: 700; margin: 4px 0; }
        .thermal .footer { font-size: 10pt; font-weight: 800; text-align: center; margin: 6px 0 0; }
        .thermal .footer.muted { color: #000; margin-top: 2px; }
      `}</style>
    </div>
  );
}
