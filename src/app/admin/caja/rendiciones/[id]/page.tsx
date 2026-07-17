import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { getCurrentUserRole, getHotelSettings, getShiftSummary } from "@/lib/data";
import { formatAmount, formatShiftCode, formatSignedAmount } from "@/lib/format";
import { formatHotelDateTime, formatHotelTime } from "@/lib/time";
import ThermalAutoPrint from "@/app/admin/components/ThermalAutoPrint";
import PrintButton from "./PrintButton";
import ExportCsvButton from "../../ExportCsvButton";

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
  firstCopy: boolean;
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
  checkoutsCount: number;
  cobradoRows: Array<[string, number]>;
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
    firstCopy,
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
    checkoutsCount,
    cobradoRows,
    totalIncome,
    paymentsList,
    notes,
    printedAt,
  } = props;

  return (
    <div className={`thermal-page${firstCopy ? "" : " copy-next"}`}>
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
      <p className="row big">
        <span>Piezas rendidas:</span>
        <span>{checkoutsCount}</span>
      </p>

      <hr />
      <p className="section">COBRADO POR MEDIO</p>
      {cobradoRows.map(([label, amount]) => (
        <p className="row" key={label}>
          <span>{label}:</span>
          <span>{money(amount)}</span>
        </p>
      ))}
      <p className="row big">
        <span>TOTAL:</span>
        <span>{money(totalIncome)}</span>
      </p>

      <hr />
      <p className="section">ARQUEO EFECTIVO</p>
      <p className="row">
        <span>Efectivo contado:</span>
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

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string; copy?: string }>;
};

export default async function ShiftReportPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const autoPrint = sp.autoprint === "1";
  const requestedCopy =
    sp.copy === "duplicate" ? "duplicate" : sp.copy === "original" ? "original" : null;
  // En autoimpresion se imprimen las dos copias (original + duplicado) en un UNICO trabajo
  // y la ventana se cierra una vez. Antes navegaba de una copia a la otra, y esa segunda
  // request perdia la sesion (al cerrar caja) -> el comprobante "se cerraba" antes de imprimir.
  const copyMode = autoPrint ? "both" : requestedCopy ?? "both";
  const [summary, hotelSettings, role] = await Promise.all([
    getShiftSummary(id),
    getHotelSettings().catch(() => null),
    getCurrentUserRole(),
  ]);
  if (!summary) notFound();

  // Arqueo a ciegas: si un recepcionista intenta abrir la rendición de un turno TODAVÍA ABIERTO,
  // no se la mostramos (vería el efectivo esperado / total antes de contar, anulando el control).
  // La rendición se genera al cerrar; el admin sí puede verla siempre.
  if (role !== "admin" && summary.shift.status === "open") {
    return (
      <div className="max-w-md mx-auto p-10 text-center">
        <h1 className="text-xl font-bold text-slate-800 mb-2">Rendición no disponible</h1>
        <p className="text-slate-600">
          La rendición se genera al cerrar la caja. Cerrá el turno para verla e imprimirla.
        </p>
        <Link
          href="/admin/caja"
          className="inline-block mt-6 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-bold transition-colors"
        >
          Volver a Caja
        </Link>
      </div>
    );
  }

  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
  const { shift, totalsByMethod, totalIncome, checkoutsCount, payments, openedByEmail, closedByEmail } =
    summary;
  // Medios fijos que siempre salen (aunque den 0) + los eventuales que tuvieron
  // movimiento. "Tarjeta" agrupa credito + debito.
  const cobradoRows: Array<[string, number]> = [
    ["Efectivo", totalsByMethod.cash],
    ["Tarjeta", totalsByMethod.credit_card + totalsByMethod.debit_card],
    ["Vale Blanco", totalsByMethod.vale_blanco],
    ["Cta Cte", totalsByMethod.cuenta_corriente],
    ...(
      [
        ["Mercado Pago", totalsByMethod.mercado_pago],
        ["Transferencia", totalsByMethod.bank_transfer],
        ["Otro", totalsByMethod.other],
      ] as Array<[string, number]>
    ).filter(([, value]) => value > 0),
  ];

  const copyProps: Omit<ShiftCopyProps, "title" | "firstCopy"> = {
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
    checkoutsCount,
    cobradoRows,
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
  const copies =
    copyMode === "both"
      ? [
          { key: "original", title: "ORIGINAL" },
          { key: "duplicate", title: "DUPLICADO" },
        ]
      : [{ key: copyMode, title: copyMode === "original" ? "ORIGINAL" : "DUPLICADO" }];

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
        <div className="flex items-center gap-2">
          {shift.status === "closed" && (
            <ExportCsvButton
              shiftId={shift.id}
              shiftNumber={shift.shift_number}
              className="px-4 py-2 border border-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm disabled:opacity-60"
            />
          )}
          <PrintButton />
        </div>
      </div>

      <div className="thermal">
        {copies.map((copy, index) => (
          <ShiftCopy key={copy.key} title={copy.title} firstCopy={index === 0} {...copyProps} />
        ))}
        <div className="thermal-feed" aria-hidden="true" />
        {autoPrint && <ThermalAutoPrint closeOnDone />}

        <style>{`
          /* Comandera termica: ancho 80mm y ALTO automatico (= largo del contenido), sin
             margenes. Asi no quedan hojas en blanco y el corte cae al final del contenido. */
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
          /* Copias en flujo continuo (sin salto de pagina, que era lo que generaba el
             espacio en blanco gigante entre original y duplicado). Se separan con una
             linea de corte punteada. */
          .thermal-page { padding: 0 3mm; }
          .thermal-page.copy-next {
            margin-top: 4mm;
            padding-top: 4mm;
            border-top: 1px dashed #000;
          }
          .thermal-feed { height: 2mm; }
          .thermal h1 { font-size: 15pt; font-weight: 900; margin: 0 0 2px; text-align: center; }
          .thermal .addr { font-size: 9pt; font-weight: 700; text-align: center; margin: 0 0 4px; }
          .thermal h2 { font-size: 12.5pt; font-weight: 900; margin: 6px 0 0; text-align: center; letter-spacing: 0.6px; }
          .thermal .sub { font-size: 10pt; font-weight: 800; text-align: center; margin: 0 0 6px; letter-spacing: 1.5px; }
          .thermal .section { font-size: 10pt; font-weight: 900; text-align: center; margin: 6px 0 3px; letter-spacing: 0.8px; }
          .thermal hr { border: none; border-top: 1.5px solid #000; margin: 5px 0; }
          .thermal .row { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5pt; font-weight: 700; margin: 1.5px 0; }
          .thermal .row span:last-child { text-align: right; }
          .thermal .row.small { font-size: 9.5pt; }
          .thermal .row.big { font-size: 12.5pt; font-weight: 900; margin: 4px 0; }
          .thermal .indent { padding-left: 6px; }
          .thermal .muted { color: #000; }
          .thermal .payment-line { margin-bottom: 2px; }
          .thermal .small { font-size: 9.5pt; font-weight: 700; }
          .thermal .sign { font-size: 10pt; font-weight: 800; text-align: center; margin: 8px 0 2px; }
        `}</style>
      </div>
    </>
  );
}
