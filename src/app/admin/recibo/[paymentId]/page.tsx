import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getFiscalSettings, getHotelSettings } from "@/lib/data";
import { nombreComprobante, prefijoArchivo } from "@/lib/comprobante-nombre";
import { formatAmount, formatShiftCode } from "@/lib/format";
import { formatHotelDateTime } from "@/lib/time";
import ReceiptAutoPrint from "./ReceiptAutoPrint";
import ThermalStyles from "@/app/admin/components/ThermalStyles";

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
      <p className="seccion">Cliente</p>
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
      <p className="seccion">Pago</p>
      <p className="row">
        <span>Metodo:</span>
        <span>{paymentMethod}</span>
      </p>
      <p className="total">
        <span>TOTAL PAGADO</span>
        <span className="money">{formatAmount(amount)}</span>
      </p>
      <p className="row small">
        <span>Total estadia:</span>
        <span className="money">{formatAmount(totalPrice)}</span>
      </p>
      <p className="row small">
        <span>Pagado acumulado:</span>
        <span className="money">{formatAmount(paidAmount)}</span>
      </p>
      <p className="row small">
        <span>Saldo restante:</span>
        <span className="money">{formatAmount(saldo)}</span>
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

/** Sólo el número, para el título. Cacheado por request: no duplica la consulta. */
const reciboNumeroCached = cache(async (paymentId: string): Promise<number | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("recibo_numero")
    .eq("id", paymentId)
    .maybeSingle();
  const numero = (data as { recibo_numero: number | null } | null)?.recibo_numero;
  return numero ?? null;
});

const fiscalCached = cache(getFiscalSettings);

/**
 * El <title> es lo que el navegador propone como nombre de archivo al "Guardar como
 * PDF": "COMB - Rec - 000042". Antes los cuatro papeles del sistema se guardaban
 * todos como "El Refugio | Hotel & Servicios de Ruta.pdf".
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { paymentId } = await params;
  const [numero, fiscal] = await Promise.all([
    reciboNumeroCached(paymentId).catch(() => null),
    fiscalCached().catch(() => null),
  ]);

  return {
    title: nombreComprobante({
      prefijo: prefijoArchivo(fiscal?.prefijo_archivos, fiscal?.razon_social),
      tipo: "Rec",
      numero: numero !== null ? formatShiftCode(numero) : "",
    }),
  };
}

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
      id, amount, payment_method, notes, created_at, recibo_numero,
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
    recibo_numero: number | null;
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
    // Numero correlativo del recibo (mig 106). Los pagos anteriores a esa migracion
    // quedaron numerados por el backfill; el fallback al pedazo de UUID existe por si
    // alguna vez se lee una fila sin numero, no como camino normal.
    paymentIdShort: raw.recibo_numero !== null ? formatShiftCode(raw.recibo_numero) : raw.id.slice(0, 8),
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
        /* Copias en flujo continuo (sin salto de pagina, que generaba el espacio en
           blanco gigante entre original y duplicado); se separan con linea de corte
           punteada. */
        .thermal-page.copy-next {
          margin-top: 4mm;
          padding-top: 4mm;
          border-top: 1px dashed #000;
        }
        .thermal-feed { height: 2mm; }
      `}</style>
      <ThermalStyles />
    </div>
  );
}
