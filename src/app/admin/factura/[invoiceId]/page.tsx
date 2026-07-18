import { formatCbteNumero, formatCuit } from "@/lib/arca/amounts";
import { qrPngDataUrl } from "@/lib/arca/qr";
import { getFiscalSettings, getHotelSettings, getInvoiceById } from "@/lib/data";
import ReceiptAutoPrint from "../../recibo/[paymentId]/ReceiptAutoPrint";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ autoprint?: string }>;
};

function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "2026-07-16" (date de Postgres) → "16/07/2026". */
function formatDateCol(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

/**
 * Representación impresa de la factura (comandera térmica 80mm). Ramifica según
 * el tipo: Factura B (consumidor final, DNI, IVA contenido + Transparencia Fiscal)
 * o Factura A (Responsable Inscripto/Monotributo, CUIT, IVA discriminado, sin
 * bloque de transparencia). Solo se imprime si está autorizada (tiene CAE). Cumple
 * RG 1415 (datos formales), RG 4892 (QR) y, en B, RG 5614/Ley 27.743.
 */
export default async function FacturaPage({ params, searchParams }: PageProps) {
  const { invoiceId } = await params;
  const { autoprint } = await searchParams;
  const autoPrint = autoprint === "1";

  const [invoice, fiscal, hotel] = await Promise.all([
    getInvoiceById(invoiceId).catch(() => null),
    getFiscalSettings().catch(() => null),
    getHotelSettings().catch(() => null),
  ]);

  if (!invoice) {
    return (
      <div className="p-8 text-center text-slate-600">
        <h1 className="text-lg font-bold">Factura no encontrada</h1>
      </div>
    );
  }

  if (invoice.status !== "authorized" || !invoice.cae || !invoice.cbte_nro) {
    return (
      <div className="p-8 text-center text-slate-600">
        <h1 className="text-lg font-bold">Factura no emitida</h1>
        <p className="text-sm mt-2">
          Este comprobante todavía no tiene CAE (estado: {invoice.status}). Emitilo o reintentá
          desde Facturación.
        </p>
      </div>
    );
  }

  const qrDataUrl = invoice.qr_url ? await qrPngDataUrl(invoice.qr_url) : null;
  const numero = formatCbteNumero(invoice.pto_vta, invoice.cbte_nro);
  const isHomo = invoice.environment === "homologacion";
  // Factura A (Responsable Inscripto / Monotributo): IVA discriminado. El receptor
  // lleva CUIT cuando doc_tipo=80 (A, o B a Exento); DNI para consumidor final.
  const isA = invoice.cbte_tipo === 1;
  const isCuit = invoice.doc_tipo === 80;
  const isConsumidorFinal = invoice.condicion_iva_receptor_id === 5;
  const isMonotributo = invoice.condicion_iva_receptor_id === 6;
  const receptorCondicion =
    invoice.condicion_iva_receptor_id === 1
      ? "IVA Responsable Inscripto"
      : invoice.condicion_iva_receptor_id === 4
        ? "IVA Sujeto Exento"
        : invoice.condicion_iva_receptor_id === 6
          ? "Responsable Monotributo"
          : "Consumidor Final";
  const ivaPctLabel = invoice.iva_id === 5 ? "21%" : ""; // 5 = 21% (único que se usa)
  // RG 4919 / Ley 27.618: leyenda obligatoria en Factura A a un Monotributista.
  // Texto a confirmar por el contador antes de producción.
  const leyendaLey27618 =
    "El crédito fiscal discriminado en el presente comprobante sólo podrá ser " +
    "computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para " +
    "Pequeños Contribuyentes de la Ley N° 27.618.";

  return (
    <div className="thermal">
      <div className="thermal-page">
        {isHomo && <div className="homo-band">COMPROBANTE DE PRUEBA — SIN VALOR FISCAL</div>}

        {/* Emisor (RG 1415) */}
        <h1>{fiscal?.razon_social || hotel?.name || "Hotel El Refugio"}</h1>
        <p className="addr">{fiscal?.domicilio_fiscal || hotel?.address || ""}</p>
        <div className="row small">
          <span>CUIT:</span>
          <span>{formatCuit(fiscal?.cuit)}</span>
        </div>
        <div className="row small">
          <span>IIBB:</span>
          <span>{fiscal?.iibb || "—"}</span>
        </div>
        <div className="row small">
          <span>Inicio actividades:</span>
          <span>{formatDateCol(fiscal?.inicio_actividades ?? null)}</span>
        </div>
        <div className="row small">
          <span>Condición IVA:</span>
          <span>Responsable Inscripto</span>
        </div>

        <hr />
        {/* Tipo y número */}
        <div className="tipo-box">
          <span className="tipo-letra">{isA ? "A" : "B"}</span>
          <span className="tipo-cod">{isA ? "Cód. 01" : "Cód. 06"}</span>
        </div>
        <h2>FACTURA</h2>
        <div className="row">
          <span>Nro:</span>
          <span>{numero}</span>
        </div>
        <div className="row">
          <span>Fecha:</span>
          <span>{formatDateCol(invoice.cbte_fch)}</span>
        </div>
        <div className="row">
          <span>Cond. venta:</span>
          <span>Contado</span>
        </div>

        <hr />
        {/* Receptor */}
        <div className="row">
          <span>Cliente:</span>
          <span>{invoice.receptor_nombre ?? "—"}</span>
        </div>
        <div className="row">
          <span>{isCuit ? "CUIT:" : "DNI:"}</span>
          <span>{isCuit ? formatCuit(invoice.doc_nro) : invoice.doc_nro}</span>
        </div>
        {isCuit && invoice.receptor_domicilio && (
          <div className="row small">
            <span>Domicilio:</span>
            <span>{invoice.receptor_domicilio}</span>
          </div>
        )}
        <div className="row small">
          <span>Condición IVA:</span>
          <span>{receptorCondicion}</span>
        </div>

        <hr />
        {/* Detalle (el WSFE factura totales; el detalle es de la representación) */}
        <div className="row">
          <span>HOSPEDAJE</span>
          <span>${money(isA ? invoice.imp_neto : invoice.imp_total)}</span>
        </div>
        <div className="row small">
          <span>Período:</span>
          <span>
            {formatDateCol(invoice.fch_serv_desde)} al {formatDateCol(invoice.fch_serv_hasta)}
          </span>
        </div>

        {isA ? (
          <>
            {/* Factura A: IVA discriminado (Neto + IVA + Total) */}
            <div className="row">
              <span>Neto Gravado:</span>
              <span>${money(invoice.imp_neto)}</span>
            </div>
            <div className="row">
              <span>IVA {ivaPctLabel}:</span>
              <span>${money(invoice.imp_iva)}</span>
            </div>
            <div className="total">
              <span>TOTAL:</span>
              <span>${money(invoice.imp_total)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="total">
              <span>TOTAL:</span>
              <span>${money(invoice.imp_total)}</span>
            </div>

            {/* RG 5614 / Ley 27.743 — Transparencia Fiscal: solo a consumidor final. */}
            {isConsumidorFinal && (
              <div className="transparencia">
                <p className="transparencia-title">
                  Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)
                </p>
                <div className="row small">
                  <span>IVA Contenido:</span>
                  <span>${money(invoice.imp_iva)}</span>
                </div>
                <div className="row small">
                  <span>Otros Impuestos Nacionales Indirectos:</span>
                  <span>$0,00</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* RG 4919 / Ley 27.618 — leyenda obligatoria en Factura A a un Monotributista. */}
        {isMonotributo && (
          <div className="leyenda">
            <p>{leyendaLey27618}</p>
          </div>
        )}

        <hr />
        {/* Autorización */}
        <div className="row">
          <span>CAE:</span>
          <span>{invoice.cae}</span>
        </div>
        <div className="row">
          <span>Vto. CAE:</span>
          <span>{formatDateCol(invoice.cae_vto)}</span>
        </div>

        {qrDataUrl && (
          <div className="qr-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR ARCA (RG 4892)" className="qr" />
          </div>
        )}

        {isHomo && <div className="homo-band">COMPROBANTE DE PRUEBA — SIN VALOR FISCAL</div>}
      </div>

      <div className="thermal-feed" aria-hidden="true" />
      {autoPrint && <ReceiptAutoPrint closeOnDone />}

      <style>{`
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
        .thermal-page { padding: 0 3mm; }
        .thermal-feed { height: 10mm; }
        .thermal h1 { font-size: 14pt; font-weight: 900; margin: 0 0 2px; text-align: center; }
        .thermal .addr { font-size: 9pt; font-weight: 700; text-align: center; margin: 0 0 5px; }
        .thermal h2 { font-size: 13pt; font-weight: 900; margin: 4px 0 2px; text-align: center; letter-spacing: 1px; }
        .thermal hr { border: none; border-top: 1.5px solid #000; margin: 5px 0; }
        .thermal .row { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5pt; font-weight: 700; margin: 1.5px 0; }
        .thermal .row span:first-child { font-weight: 800; margin-right: 6px; }
        .thermal .row span:last-child { text-align: right; }
        .thermal .row.small { font-size: 9pt; font-weight: 700; }
        .thermal .total { display: flex; justify-content: space-between; gap: 8px; font-size: 14pt; font-weight: 900; margin: 6px 0 4px; }
        .tipo-box { display: flex; flex-direction: column; align-items: center; margin: 4px 0 0; }
        .tipo-letra { font-size: 22pt; font-weight: 900; border: 2px solid #000; padding: 0 14px; line-height: 1.3; }
        .tipo-cod { font-size: 8pt; font-weight: 700; }
        .transparencia { border: 1px solid #000; padding: 3px 4px; margin: 4px 0; }
        .transparencia-title { font-size: 8pt; font-weight: 800; text-align: center; margin: 0 0 2px; }
        .leyenda { border: 1px solid #000; padding: 3px 4px; margin: 4px 0; font-size: 7.5pt; font-weight: 700; text-align: justify; }
        .leyenda p { margin: 0; }
        .qr-wrap { display: flex; justify-content: center; margin: 6px 0 2px; }
        .qr { width: 30mm; height: 30mm; }
        .homo-band { font-size: 9pt; font-weight: 900; text-align: center; border: 2px dashed #000; padding: 2px 4px; margin: 4px 0; }
      `}</style>
    </div>
  );
}
