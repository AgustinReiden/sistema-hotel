import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { getHotelSettings, getShiftSummary } from "@/lib/data";
import { formatHotelDateTime, formatHotelTime } from "@/lib/time";
import PrintButton from "./PrintButton";

export const revalidate = 0;

function money(n: number | null) {
  if (n === null) return "—";
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  mercado_pago: "Mercado Pago",
  bank_transfer: "Transferencia",
  credit_card: "T. Crédito",
  debit_card: "T. Débito",
  vale_blanco: "Vale Blanco",
  cuenta_corriente: "Cta. Corriente",
  other: "Otro",
};

type ShiftCopyProps = {
  title: string;
  hotelName: string;
  hotelAddress: string;
  shiftIdShort: string;
  openedAt: string;
  closedAt: string;
  openedBy: string | null;
  closedBy: string | null;
  cashIncome: number;
  expectedCash: number | null;
  actualCash: number | null;
  discrepancy: number | null;
  otherMethods: Array<[string, number]>;
  otherIncome: number;
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
    shiftIdShort,
    openedAt,
    closedAt,
    openedBy,
    closedBy,
    cashIncome,
    expectedCash,
    actualCash,
    discrepancy,
    otherMethods,
    otherIncome,
    totalIncome,
    paymentsList,
    notes,
    printedAt,
  } = props;

  const diffClass =
    discrepancy === null
      ? ""
      : discrepancy === 0
        ? "ok"
        : discrepancy > 0
          ? "over"
          : "under";

  return (
    <div className="thermal-page">
      <h1>{hotelName}</h1>
      <p className="addr">{hotelAddress}</p>
      <hr />
      <h2>RENDICIÓN DE CAJA</h2>
      <p className="sub">{title}</p>
      <p className="row">
        <span>Turno #</span>
        <span>{shiftIdShort}</span>
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
      <p className="section">RECONCILIACIÓN EFECTIVO</p>
      <p className="row">
        <span>Cobros efectivo:</span>
        <span>{money(cashIncome)}</span>
      </p>
      <p className="row bold">
        <span>Esperado:</span>
        <span>{money(expectedCash)}</span>
      </p>
      <p className="row">
        <span>Contado:</span>
        <span>{money(actualCash)}</span>
      </p>
      <p className={`row big ${diffClass}`}>
        <span>DIFERENCIA:</span>
        <span>
          {discrepancy === null
            ? "—"
            : (discrepancy > 0 ? "+" : "") + money(discrepancy)}
        </span>
      </p>

      {otherMethods.length > 0 && (
        <>
          <hr />
          <p className="section">TAMBIÉN SE RINDE</p>
          {otherMethods.map(([method, amount]) => (
            <p className="row" key={method}>
              <span>{METHOD_LABELS[method] ?? method}:</span>
              <span>{money(amount)}</span>
            </p>
          ))}
          <p className="row bold">
            <span>Subtotal otros:</span>
            <span>{money(otherIncome)}</span>
          </p>
        </>
      )}

      <hr />
      <p className="section">TOTAL COBRADO</p>
      <p className="row big">
        <span>TOTAL:</span>
        <span>{money(totalIncome)}</span>
      </p>

      {paymentsList.length > 0 && (
        <>
          <hr />
          <p className="section">DETALLE ({paymentsList.length})</p>
          {paymentsList.map((p) => (
            <div key={p.id} className="payment-line">
              <p className="row small">
                <span>
                  {p.time} · {p.methodLabel}
                </span>
                <span>{money(p.amount)}</span>
              </p>
              <p className="row small muted indent">
                {p.clientName}
                {p.roomNumber ? ` (Hab. ${p.roomNumber})` : ""}
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
  const { shift, totalsByMethod, totalIncome, cashIncome, payments, openedByEmail, closedByEmail } = summary;
  const otherIncome = totalIncome - cashIncome;
  const otherMethods = (Object.entries(totalsByMethod) as Array<[string, number]>)
    .filter(([method, v]) => method !== "cash" && v > 0)
    .sort((a, b) => b[1] - a[1]);

  const copyProps: Omit<ShiftCopyProps, "title"> = {
    hotelName: hotelSettings?.name || "Hotel El Refugio",
    hotelAddress: hotelSettings?.address ?? "",
    shiftIdShort: shift.id.slice(0, 8),
    openedAt: formatHotelDateTime(shift.opened_at, tz),
    closedAt: formatHotelDateTime(shift.closed_at, tz),
    openedBy: openedByEmail ?? null,
    closedBy: closedByEmail ?? null,
    cashIncome,
    expectedCash: shift.expected_cash,
    actualCash: shift.actual_cash,
    discrepancy: shift.discrepancy,
    otherMethods,
    otherIncome,
    totalIncome,
    paymentsList: payments.map((p) => ({
      id: p.id,
      time: formatHotelTime(p.created_at, tz),
      methodLabel: METHOD_LABELS[p.payment_method] ?? p.payment_method,
      amount: p.amount,
      clientName: p.client_name,
      roomNumber: p.room_number,
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
            body { background: white !important; }
            .no-print { display: none !important; }
          }
          .thermal {
            font-family: 'Courier New', monospace;
            background: white;
            color: #000;
            max-width: 75mm;
            margin: 0 auto;
          }
          .thermal-page {
            page-break-after: always;
            break-after: page;
            padding: 4mm 2mm;
          }
          .thermal-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .thermal h1 { font-size: 13pt; font-weight: 800; margin: 0 0 2px; text-align: center; }
          .thermal .addr { font-size: 8pt; text-align: center; margin: 0 0 4px; }
          .thermal h2 { font-size: 11pt; font-weight: 800; margin: 6px 0 0; text-align: center; }
          .thermal .sub { font-size: 10pt; font-weight: 700; text-align: center; margin: 0 0 6px; letter-spacing: 2px; }
          .thermal .section { font-size: 9pt; font-weight: 800; text-align: center; margin: 6px 0 3px; letter-spacing: 1px; }
          .thermal hr { border: none; border-top: 1px dashed #000; margin: 5px 0; }
          .thermal .row { display: flex; justify-content: space-between; font-size: 10pt; margin: 1px 0; }
          .thermal .row.small { font-size: 9pt; }
          .thermal .row.bold { font-weight: 800; }
          .thermal .row.big { font-size: 12pt; font-weight: 900; margin: 4px 0; }
          .thermal .row.big.ok { color: #065f46; }
          .thermal .row.big.over { color: #1e3a8a; }
          .thermal .row.big.under { color: #991b1b; }
          .thermal .indent { padding-left: 6px; color: #555; }
          .thermal .muted { color: #555; }
          .thermal .payment-line { margin-bottom: 2px; }
          .thermal .small { font-size: 9pt; }
          .thermal .sign { font-size: 9pt; text-align: center; margin: 8px 0 2px; }
        `}</style>
      </div>
    </>
  );
}
