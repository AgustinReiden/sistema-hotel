import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { getHotelSettings, getShiftSummary } from "@/lib/data";
import { formatAmount, formatShiftCode, formatSignedAmount } from "@/lib/format";
import { formatHotelDateTime, formatHotelTime } from "@/lib/time";
import PrintButton from "./PrintButton";

export const revalidate = 0;

function money(n: number | null) {
  if (n === null) return "---";
  return formatAmount(n);
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  mercado_pago: "Mercado Pago",
  bank_transfer: "Transferencia",
  credit_card: "Tarjeta credito",
  debit_card: "Tarjeta debito",
  vale_blanco: "Vale Blanco",
  cuenta_corriente: "Cuenta corriente",
  other: "Otro",
};

type ShiftCopyProps = {
  title: string;
  hotelName: string;
  hotelAddress: string;
  shiftCode: string;
  openedAt: string;
  closedAt: string;
  openedBy: string | null;
  closedBy: string | null;
  expectedCash: number | null;
  actualCash: number | null;
  discrepancy: number | null;
  otherMethods: Array<[string, number]>;
  totalIncome: number;
  paymentsList: Array<{
    id: string;
    time: string;
    methodLabel: string;
    amount: number;
    clientName: string;
    roomNumber: string | null;
  }>;
  notes: string | null;
  printedAt: string;
};

function ShiftCopy(props: ShiftCopyProps) {
  const {
    title,
    hotelName,
    hotelAddress,
    shiftCode,
    openedAt,
    closedAt,
    openedBy,
    closedBy,
    expectedCash,
    actualCash,
    discrepancy,
    otherMethods,
    totalIncome,
    paymentsList,
    notes,
    printedAt,
  } = props;

  return (
    <div className="thermal-page">
      <h1>{hotelName}</h1>
      <p className="addr">{hotelAddress}</p>
      <hr />
      <h2>RENDICION DE CAJA</h2>
      <p className="sub">{title}</p>
      <p className="row">
        <span>Turno #</span>
        <span>{shiftCode}</span>
      </p>
      <p className="row">
        <span>Abierto:</span>
        <span>{openedAt}</span>
      </p>
      {openedBy && <p className="row small indent">por {openedBy}</p>}
      <p className="row">
        <span>Cerrado:</span>
        <span>{closedAt}</span>
      </p>
      {closedBy && closedBy !== openedBy && (
        <p className="row small indent">por {closedBy}</p>
      )}

      <hr />
      <p className="row">
        <span>Efectivo:</span>
        <span>{money(actualCash)}</span>
      </p>
      <p className="row">
        <span>Esperado:</span>
        <span>{money(expectedCash)}</span>
      </p>
      <p className="row big">
        <span>Diferencia:</span>
        <span>{formatSignedAmount(discrepancy)}</span>
      </p>

      {otherMethods.length > 0 && (
        <>
          <hr />
          {otherMethods.map(([method, amount]) => (
            <p className="row" key={method}>
              <span>{METHOD_LABELS[method] ?? method}:</span>
              <span>{money(amount)}</span>
            </p>
          ))}
        </>
      )}

      <hr />
      <p className="section">TOTAL COBRADO</p>
      <p className="row big">
        <span>Total:</span>
        <span>{money(totalIncome)}</span>
      </p>

      {paymentsList.length > 0 && (
        <>
          <hr />
          <p className="section">DETALLE ({paymentsList.length})</p>
          {paymentsList.map((payment) => (
            <div key={payment.id} className="payment-line">
              <p className="row small">
                <span>
                  {payment.time} - {payment.methodLabel}
                </span>
                <span>{money(payment.amount)}</span>
              </p>
              <p className="row small muted indent">
                {payment.clientName}
                {payment.roomNumber ? ` (Hab. ${payment.roomNumber})` : ""}
              </p>
            </div>
          ))}
        </>
      )}

      {notes && (
        <>
          <hr />
          <p className="small">Notas: {notes}</p>
        </>
      )}

      <hr />
      <p className="sign">Firma: _____________________</p>
      <p className="sign muted">Impreso: {printedAt}</p>
    </div>
  );
}

type PageProps = { params: Promise<{ id: string }> };

export default async function ShiftReportPage({ params }: PageProps) {
  const { id } = await params;
  const [summary, hotelSettings] = await Promise.all([
    getShiftSummary(id),
    getHotelSettings().catch(() => null),
  ]);
  if (!summary) notFound();

  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
  const { shift, totalsByMethod, totalIncome, payments, openedByEmail, closedByEmail } = summary;
  const otherMethods = (Object.entries(totalsByMethod) as Array<[string, number]>)
    .filter(([method, value]) => method !== "cash" && value > 0)
    .sort((a, b) => b[1] - a[1]);

  const copyProps: Omit<ShiftCopyProps, "title"> = {
    hotelName: hotelSettings?.name || "Hotel El Refugio",
    hotelAddress: hotelSettings?.address ?? "",
    shiftCode: formatShiftCode(shift.shift_number),
    openedAt: formatHotelDateTime(shift.opened_at, tz),
    closedAt: shift.closed_at ? formatHotelDateTime(shift.closed_at, tz) : "---",
    openedBy: openedByEmail ?? null,
    closedBy: closedByEmail ?? null,
    expectedCash: shift.expected_cash,
    actualCash: shift.actual_cash,
    discrepancy: shift.discrepancy,
    otherMethods,
    totalIncome,
    paymentsList: payments.map((payment) => ({
      id: payment.id,
      time: formatHotelTime(payment.created_at, tz),
      methodLabel: METHOD_LABELS[payment.payment_method] ?? payment.payment_method,
      amount: payment.amount,
      clientName: payment.client_name,
      roomNumber: payment.room_number,
    })),
    notes: shift.notes,
    printedAt: formatHotelDateTime(new Date().toISOString(), tz),
  };

  return (
    <>
      <div className="no-print p-6 max-w-3xl mx-auto flex items-center justify-between">
        <Link
          href="/admin/caja/rendiciones"
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          <ArrowLeft size={14} />
          Volver
        </Link>
        <PrintButton />
      </div>

      <div className="thermal">
        <ShiftCopy title="ORIGINAL" {...copyProps} />
        <ShiftCopy title="DUPLICADO" {...copyProps} />

        <style>{`
          @page { size: 75mm auto; margin: 2mm; }
          @media print {
            body {
              background: white !important;
              color: #000 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .no-print { display: none !important; }
          }
          .thermal {
            font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
            background: white;
            color: #000;
            max-width: 75mm;
            margin: 0 auto;
            line-height: 1.25;
            word-break: break-word;
          }
          .thermal-page {
            page-break-after: always;
            break-after: page;
            padding: 4mm 2.5mm;
          }
          .thermal-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .thermal h1 { font-size: 15pt; font-weight: 900; margin: 0 0 2px; text-align: center; }
          .thermal .addr { font-size: 9pt; font-weight: 700; text-align: center; margin: 0 0 4px; }
          .thermal h2 { font-size: 12.5pt; font-weight: 900; margin: 6px 0 0; text-align: center; letter-spacing: 0.6px; }
          .thermal .sub { font-size: 10pt; font-weight: 800; text-align: center; margin: 0 0 6px; letter-spacing: 1.5px; }
          .thermal .section { font-size: 10pt; font-weight: 900; text-align: center; margin: 6px 0 3px; letter-spacing: 0.8px; }
          .thermal hr { border: none; border-top: 1.5px solid #000; margin: 6px 0; }
          .thermal .row { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5pt; font-weight: 700; margin: 2px 0; }
          .thermal .row span:last-child { text-align: right; }
          .thermal .row.small { font-size: 9.5pt; }
          .thermal .row.big { font-size: 12.5pt; font-weight: 900; margin: 5px 0; }
          .thermal .indent { padding-left: 6px; }
          .thermal .muted { color: #000; }
          .thermal .payment-line { margin-bottom: 3px; }
          .thermal .small { font-size: 9.5pt; font-weight: 700; }
          .thermal .sign { font-size: 10pt; font-weight: 800; text-align: center; margin: 10px 0 2px; }
        `}</style>
      </div>
    </>
  );
}
