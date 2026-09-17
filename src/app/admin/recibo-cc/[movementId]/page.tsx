import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCcPaymentReceipt, getFiscalSettings, getHotelSettings } from "@/lib/data";
import { cbteNombre, formatCbteNumero } from "@/lib/arca/amounts";
import { nombreComprobante, prefijoArchivo } from "@/lib/comprobante-nombre";
import { formatAmount, formatShiftCode } from "@/lib/format";
import { formatHotelDateTime } from "@/lib/time";
import type { CcPaymentReceipt } from "@/lib/types";
import ReceiptAutoPrint from "../../recibo/[paymentId]/ReceiptAutoPrint";
import ThermalStyles from "@/app/admin/components/ThermalStyles";

export const dynamic = "force-dynamic";

/**
 * El pago a cuenta no tiene CHECK de método (a diferencia de `payments`, que sí lo
 * tiene desde la mig 89), así que el texto puede ser cualquiera: si no está en la
 * tabla se imprime tal cual en vez de dejar el renglón vacío.
 */
const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  mercado_pago: "Mercado Pago",
  bank_transfer: "Transferencia",
  credit_card: "Tarjeta credito",
  debit_card: "Tarjeta debito",
  cheque: "Cheque",
  other: "Otro",
};

function money(n: number) {
  return formatAmount(n);
}

/**
 * Fecha de comprobante (columna `date`, sin hora ni zona). Se parte el string en vez
 * de usar formatHotelDate: "2026-09-17" pasado por una zona UTC-3 se imprime como el
 * 16. Mismo helper que el impreso de la factura.
 */
function formatDateCol(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

type PageProps = {
  params: Promise<{ movementId: string }>;
  searchParams: Promise<{ autoprint?: string; copy?: string }>;
};

/** Cacheado por request: `generateMetadata` y la página comparten la misma lectura. */
const receiptCached = cache(getCcPaymentReceipt);
const fiscalCached = cache(getFiscalSettings);

/**
 * El <title> es lo que el navegador propone al "Guardar como PDF": "COMB - Rec -
 * 000042". Mismo tipo "Rec" que el recibo de caja: los dos son recibos de cobranza,
 * y el prefijo de la mig 107 más el encabezado del papel los distinguen.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { movementId } = await params;
  const [receipt, fiscal] = await Promise.all([
    receiptCached(movementId).catch(() => null),
    fiscalCached().catch(() => null),
  ]);

  return {
    title: nombreComprobante({
      prefijo: prefijoArchivo(fiscal?.prefijo_archivos, fiscal?.razon_social),
      tipo: "Rec",
      numero:
        receipt?.recibo_cc_numero !== null && receipt?.recibo_cc_numero !== undefined
          ? formatShiftCode(receipt.recibo_cc_numero)
          : "",
    }),
  };
}

type ReceiptCopyProps = {
  title: string;
  firstCopy: boolean;
  hotelName: string;
  hotelAddress: string;
  numero: string;
  createdAtFormatted: string;
  receipt: CcPaymentReceipt;
};

function ReceiptCopy({
  title,
  firstCopy,
  hotelName,
  hotelAddress,
  numero,
  createdAtFormatted,
  receipt,
}: ReceiptCopyProps) {
  const retenciones = receipt.retencion_ganancias + receipt.retencion_iibb;
  const metodo = receipt.payment_method
    ? METHOD_LABEL[receipt.payment_method] ?? receipt.payment_method
    : null;

  return (
    <div className={`thermal-page${firstCopy ? "" : " copy-next"}`}>
      <h1>{hotelName}</h1>
      <p className="addr">{hotelAddress}</p>
      <hr />
      <h2>RECIBO DE COBRANZA</h2>
      <p className="sub">CUENTA CORRIENTE</p>
      <p className="sub">{title}</p>
      <p className="row">
        <span>Nro:</span>
        <span>{numero}</span>
      </p>
      <p className="row">
        <span>Fecha:</span>
        <span>{createdAtFormatted}</span>
      </p>
      <hr />
      <p className="seccion">Cliente</p>
      <p className="row">
        <span>Cliente:</span>
        <span>{receipt.client_name}</span>
      </p>
      {receipt.client_document && (
        <p className="row">
          <span>DNI/CUIT:</span>
          <span>{receipt.client_document}</span>
        </p>
      )}
      <hr />
      <p className="seccion">Cobro</p>
      {metodo && (
        <p className="row">
          <span>Metodo:</span>
          <span>{metodo}</span>
        </p>
      )}
      {/* El total del recibo es lo que CANCELA de deuda: efectivo mas retenciones. */}
      <p className="total">
        <span>TOTAL CANCELADO</span>
        <span className="money">{money(receipt.amount)}</span>
      </p>
      {retenciones > 0 && (
        <>
          {receipt.retencion_ganancias > 0 && (
            <p className="row small">
              <span>Ret. Ganancias:</span>
              <span className="money">-{money(receipt.retencion_ganancias)}</span>
            </p>
          )}
          {receipt.retencion_iibb > 0 && (
            <p className="row small">
              <span>Ret. Ing. Brutos:</span>
              <span className="money">-{money(receipt.retencion_iibb)}</span>
            </p>
          )}
          {receipt.retencion_certificado && (
            <p className="row small">
              <span>Certificado:</span>
              <span>{receipt.retencion_certificado}</span>
            </p>
          )}
          <p className="total">
            <span>NETO RECIBIDO</span>
            <span className="money">{money(receipt.neto_recibido)}</span>
          </p>
          <p className="nota">
            Las retenciones las ingresa el cliente a ARCA por cuenta del hotel: cancelan
            la deuda igual que el efectivo.
          </p>
        </>
      )}
      {receipt.imputaciones.length > 0 && (
        <>
          <hr />
          <p className="seccion">Imputado a</p>
          {receipt.imputaciones.map((imp) => (
            <p className="item small" key={imp.invoice_id}>
              <span>
                {cbteNombre(imp.cbte_tipo)}{" "}
                {imp.cbte_nro !== null ? formatCbteNumero(imp.pto_vta, imp.cbte_nro) : "s/nro"}
                {imp.cbte_fch ? ` - ${formatDateCol(imp.cbte_fch)}` : ""}
                {imp.anulada ? " (anulada)" : ""}
              </span>
              <span className="money">{money(imp.imputado)}</span>
            </p>
          ))}
        </>
      )}
      <hr />
      <p className="row">
        <span>Saldo de la cuenta:</span>
        <span className="money">{money(receipt.saldo_despues)}</span>
      </p>
      {receipt.notes && (
        <>
          <hr />
          <p className="note">Notas: {receipt.notes}</p>
        </>
      )}
      <hr />
      <p className="footer">Firma: _____________________</p>
      <p className="footer">Aclaracion: _____________________</p>
      {/* El correlativo fiscal lo da ARCA y vive en las facturas: este papel prueba
          el cobro, no lo documenta ante el fisco. */}
      <p className="footer muted">ESTE DOCUMENTO NO ES COMPROBANTE FISCAL.</p>
      <p className="footer muted">Conserve este recibo.</p>
    </div>
  );
}

export default async function AccountPaymentReceiptPage({ params, searchParams }: PageProps) {
  const { movementId } = await params;
  const sp = await searchParams;
  const autoPrint = sp.autoprint === "1";
  const requestedCopy =
    sp.copy === "duplicate" ? "duplicate" : sp.copy === "original" ? "original" : null;
  // En autoimpresion cada copia se imprime como un TRABAJO separado: primero el
  // original y, encadenado via nextUrl, el duplicado. Asi la comandera guillotina al
  // final de cada documento (corte entre copias) sin dejar una hoja en blanco.
  // En vista manual se muestran las dos copias con linea de corte punteada.
  const copyMode: "both" | "original" | "duplicate" = autoPrint
    ? requestedCopy ?? "original"
    : requestedCopy ?? "both";

  const receipt = await receiptCached(movementId);
  if (!receipt) notFound();

  const hotelSettings = await getHotelSettings().catch(() => null);
  const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";

  const shared = {
    hotelName: hotelSettings?.name || "Hotel El Refugio",
    hotelAddress: hotelSettings?.address ?? "",
    // Correlativo propio del recibo de cuenta corriente (mig 109). El fallback al
    // pedazo de UUID existe por si se lee una fila sin numero, no como camino normal.
    numero:
      receipt.recibo_cc_numero !== null
        ? formatShiftCode(receipt.recibo_cc_numero)
        : receipt.movimiento_id.slice(0, 8),
    createdAtFormatted: formatHotelDateTime(receipt.created_at, tz),
    receipt,
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
        <ReceiptCopy key={copy.key} title={copy.title} firstCopy={index === 0} {...shared} />
      ))}
      <div className="thermal-feed" aria-hidden="true" />
      {autoPrint &&
        (copyMode === "original" ? (
          // Tras imprimir el original, encadena el duplicado como segundo trabajo.
          <ReceiptAutoPrint
            nextUrl={`/admin/recibo-cc/${movementId}?autoprint=1&copy=duplicate`}
          />
        ) : (
          <ReceiptAutoPrint closeOnDone />
        ))}

      <style>{`
        /* Copias en flujo continuo (sin salto de pagina, que dejaba un espacio en
           blanco gigante entre original y duplicado); se separan con linea de corte. */
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
