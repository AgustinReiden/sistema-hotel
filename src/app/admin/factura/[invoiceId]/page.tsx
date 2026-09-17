import { cache } from "react";
import type { Metadata } from "next";

import { cbteLetra, formatCbteNumero, formatCuit, isNotaCredito } from "@/lib/arca/amounts";
import { nombreComprobante, prefijoArchivo } from "@/lib/comprobante-nombre";
import { defaultStayDescription } from "@/lib/billing";
import { qrPngDataUrl } from "@/lib/arca/qr";
import { getFiscalSettings, getHotelSettings, getInvoiceById, getInvoiceStays } from "@/lib/data";
import ReceiptAutoPrint from "../../recibo/[paymentId]/ReceiptAutoPrint";
import InvoicePrintActions from "./InvoicePrintActions";
import ThermalStyles from "@/app/admin/components/ThermalStyles";

export const dynamic = "force-dynamic";

// `cache` de React dedupe por request: generateMetadata y la página piden lo mismo
// y la base lo recibe una sola vez.
const invoiceCached = cache(getInvoiceById);
const fiscalCached = cache(getFiscalSettings);

/**
 * El <title> es lo que el navegador propone como nombre de archivo al "Guardar como
 * PDF". Sin esto, los cuatro papeles del sistema se guardaban todos como
 * "El Refugio | Hotel & Servicios de Ruta.pdf" y había que renombrarlos a mano.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { invoiceId } = await params;
  const [invoice, fiscal] = await Promise.all([
    invoiceCached(invoiceId).catch(() => null),
    fiscalCached().catch(() => null),
  ]);

  if (!invoice || invoice.cbte_nro === null) return { title: "Comprobante" };

  return {
    title: nombreComprobante({
      prefijo: prefijoArchivo(fiscal?.prefijo_archivos, fiscal?.razon_social),
      tipo: isNotaCredito(invoice.cbte_tipo) ? "NC" : "Fact",
      // El mismo helper que imprime el número en el papel: el archivo y el
      // comprobante no pueden decir números distintos.
      numero: formatCbteNumero(invoice.pto_vta, invoice.cbte_nro),
    }),
  };
}

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
    invoiceCached(invoiceId).catch(() => null),
    fiscalCached().catch(() => null),
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

  // Nota de crédito (mig 80): anula el comprobante referenciado. AFIP lo exige en
  // el <CbtesAsoc> del envío y RG 1415 en la representación impresa.
  const isNC = isNotaCredito(invoice.cbte_tipo);
  const anulado = invoice.nota_credito_de
    ? await invoiceCached(invoice.nota_credito_de).catch(() => null)
    : null;

  // Consolidada (mig 79): cubre N estadías. El detalle sólo va al impreso —
  // WSFEv1 no recibe renglones, únicamente totales.
  // La NC de una consolidada tiene que decir lo mismo que la factura que anula, y
  // sus estadías cuelgan del comprobante original (que la NC ya desvinculó).
  const isConsolidada = invoice.kind === "consolidada" || anulado?.kind === "consolidada";
  const stays = !isConsolidada
    ? []
    : invoice.kind === "consolidada"
      ? await getInvoiceStays(invoice.id).catch(() => [])
      : await getInvoiceStays(invoice.nota_credito_de as string, true).catch(() => []);
  // La NC hereda la nota del comprobante que anula: los dos papeles tienen que
  // decir lo mismo.
  const detalleNota = invoice.detalle_nota ?? (isNC ? anulado?.detalle_nota ?? null : null);
  // Y por la misma razón hereda la forma del detalle (mig 102): si la factura
  // anulada salió con un solo concepto, la NC que la anula tiene que salir igual,
  // o el cliente recibe dos papeles que no se parecen. null = detallado.
  const conceptoUnico =
    invoice.detalle_concepto_unico ?? (isNC ? anulado?.detalle_concepto_unico ?? null : null);

  const qrDataUrl = invoice.qr_url ? await qrPngDataUrl(invoice.qr_url) : null;
  const numero = formatCbteNumero(invoice.pto_vta, invoice.cbte_nro);
  const isHomo = invoice.environment === "homologacion";
  // Factura A (Responsable Inscripto / Monotributo): IVA discriminado. El receptor
  // lleva CUIT cuando doc_tipo=80 (A, o B a Exento); DNI para consumidor final.
  // Letra: A = Factura A (1) y NC A (3) → IVA discriminado. B = Factura B (6) y NC B (8).
  const isA = cbteLetra(invoice.cbte_tipo) === "A";
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
    <>
      {/* Reimprimir y guardar PDF. Sólo cuando se entra a mirar el comprobante:
          con ?autoprint=1 la ventana imprime sola y se cierra. */}
      {!autoPrint && <InvoicePrintActions />}
      <div className="thermal">
      <div className="thermal-page">
        {isHomo && <div className="homo-band">COMPROBANTE DE PRUEBA — SIN VALOR FISCAL</div>}

        {/* Emisor (RG 1415) — el domicilio fiscal es obligatorio para habilitar la
            facturación (ver validación), así que no se cae a la dirección del hotel. */}
        <h1>{fiscal?.razon_social || hotel?.name || "Hotel El Refugio"}</h1>
        <p className="addr">{fiscal?.domicilio_fiscal || ""}</p>
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
          <span className="tipo-cod">Cód. {String(invoice.cbte_tipo).padStart(2, "0")}</span>
        </div>
        <h2>
          {isNC
            ? "NOTA DE CRÉDITO"
            : isConsolidada
              ? "FACTURA (CUENTA CORRIENTE)"
              : "FACTURA"}
        </h2>
        {isNC && anulado?.cbte_nro !== null && anulado !== null && (
          <div className="row small">
            <span>Anula:</span>
            <span>
              {cbteLetra(anulado.cbte_tipo)}{" "}
              {formatCbteNumero(anulado.pto_vta, anulado.cbte_nro ?? 0)} del{" "}
              {anulado.cbte_fch ? formatDateCol(anulado.cbte_fch) : "—"}
            </span>
          </div>
        )}
        <div className="row">
          <span>Nro:</span>
          <span>{numero}</span>
        </div>
        <div className="row">
          <span>Fecha:</span>
          <span>{formatDateCol(invoice.cbte_fch)}</span>
        </div>
        <div className="row">
          {/* RG 1415 exige declarar la condición de venta, y la consolidada NO es
              contado: junta un mes de estadías fiadas. Sale de invoice.kind, que ya
              está guardado; no hace falta un campo aparte (mig 98). */}
          <span>Cond. venta:</span>
          <span>{isConsolidada ? "Cuenta corriente" : "Contado"}</span>
        </div>
        {/* El vencimiento sólo dice algo cuando no es el mismo día de la emisión, o
            sea en la consolidada a plazo. En el check-out sería ruido. */}
        {invoice.fch_vto_pago && invoice.fch_vto_pago !== invoice.cbte_fch && (
          <div className="row">
            <span>Vencimiento:</span>
            <span>{formatDateCol(invoice.fch_vto_pago)}</span>
          </div>
        )}

        <hr />
        {/* Receptor */}
        <p className="seccion">Cliente</p>
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
        {isConsolidada ? (
          <>
            {/* Un rótulo en vez de una fila "DETALLE DE ESTADÍAS | N": dice lo mismo
                con menos tinta y sin competir con las líneas que siguen. */}
            <p className="seccion">
              Detalle{conceptoUnico ? "" : ` · ${stays.length} estadías`}
            </p>
            {conceptoUnico ? (
              // Un solo concepto (mig 102): ni habitaciones ni fechas estadía por
              // estadía, que es justamente lo que pidieron algunas empresas.
              // El importe es imp_total, el mismo que suman las líneas del modo
              // detallado, TAMBIÉN en una Factura A: con imp_neto cambiaría cómo se
              // lee una A respecto de las consolidadas ya emitidas.
              // `item` y no `row`: acá el texto es lo que envuelve y el importe lo
              // que tiene que quedar entero (ver los estilos).
              <div className="item">
                <span>{conceptoUnico}</span>
                <span className="money">${money(invoice.imp_total)}</span>
              </div>
            ) : (
              <>
                {stays.map((s) => (
                  <div className="item small" key={s.reservation_id}>
                    {/* Texto congelado al emitir (mig 93). Las facturas anteriores no
                        lo tienen y caen al automático, que es lo que mostraban. */}
                    <span>{s.descripcion ?? defaultStayDescription(s)}</span>
                    <span className="money">${money(s.amount)}</span>
                  </div>
                ))}
              </>
            )}
            {/* El período y la nota al pie se quedan en los dos modos: el período
                es el dato del servicio que pide la RG 1415. */}
            <div className="row small">
              <span>Período:</span>
              <span>
                {formatDateCol(invoice.fch_serv_desde)} al {formatDateCol(invoice.fch_serv_hasta)}
              </span>
            </div>
            {detalleNota && <p className="nota">{detalleNota}</p>}
          </>
        ) : (
          <>
            <p className="seccion">Detalle</p>
            <div className="item">
              <span>HOSPEDAJE</span>
              <span className="money">${money(isA ? invoice.imp_neto : invoice.imp_total)}</span>
            </div>
            <div className="row small">
              <span>Período:</span>
              <span>
                {formatDateCol(invoice.fch_serv_desde)} al {formatDateCol(invoice.fch_serv_hasta)}
              </span>
            </div>
          </>
        )}

        {isA ? (
          <>
            {/* Factura A: IVA discriminado (Neto + IVA + Total) */}
            <div className="row">
              <span>Neto Gravado:</span>
              <span className="money">${money(invoice.imp_neto)}</span>
            </div>
            <div className="row">
              <span>IVA {ivaPctLabel}:</span>
              <span className="money">${money(invoice.imp_iva)}</span>
            </div>
            <div className="total">
              <span>TOTAL:</span>
              <span className="money">${money(invoice.imp_total)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="total">
              <span>TOTAL:</span>
              <span className="money">${money(invoice.imp_total)}</span>
            </div>

            {/* RG 5614 / Ley 27.743 — Transparencia Fiscal: solo a consumidor final. */}
            {isConsumidorFinal && (
              <div className="transparencia">
                <p className="transparencia-title">
                  Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)
                </p>
                <div className="row small">
                  <span>IVA Contenido:</span>
                  <span className="money">${money(invoice.imp_iva)}</span>
                </div>
                {/* Etiqueta larguísima: acá el que envuelve tiene que ser el texto,
                    no el importe, así que va como `item`. */}
                <div className="item small">
                  <span>Otros Impuestos Nacionales Indirectos:</span>
                  <span className="money">$0,00</span>
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
        /* Lo propio de la factura; el resto del papel térmico vive en ThermalStyles. */
        .thermal-feed { height: 10mm; }
        .tipo-box { display: flex; flex-direction: column; align-items: center; margin: 3px 0 0; }
        .tipo-letra { font-size: 16pt; font-weight: 900; border: 1.5px solid #000; padding: 0 10px; line-height: 1.25; }
        .tipo-cod { font-size: 7pt; font-weight: 700; }
        .transparencia { border: 1px solid #000; padding: 3px 4px; margin: 4px 0; }
        .transparencia-title { font-size: 7.5pt; font-weight: 800; text-align: center; margin: 0 0 2px; }
        .leyenda { border: 1px solid #000; padding: 3px 4px; margin: 4px 0; font-size: 7pt; font-weight: 600; text-align: justify; }
        .leyenda p { margin: 0; }
        .qr-wrap { display: flex; justify-content: center; margin: 5px 0 2px; }
        .qr { width: 26mm; height: 26mm; }
        .homo-band { font-size: 8pt; font-weight: 900; text-align: center; border: 2px dashed #000; padding: 2px 4px; margin: 4px 0; }
      `}</style>
      <ThermalStyles />
      </div>
    </>
  );
}
