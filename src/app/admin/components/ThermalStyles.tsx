/**
 * Estilos del papel térmico (comandera de 80mm), compartidos por todos los
 * comprobantes impresos del sistema.
 *
 * EL PROBLEMA QUE RESUELVEN. El papel útil son 66mm: unos 38 caracteres por renglón
 * a 9pt. Los cuerpos viejos (10.5pt y todo en negrita) no entraban, y el navegador
 * partía lo primero que encontraba — que terminaba siendo la etiqueta
 * ("Domicili / o:") o, peor, el importe ("$1.480. / 000,00"). Por eso acá NO hay un
 * `word-break` global: cada tipo de fila declara qué parte puede envolver y cuál
 * tiene que salir entera.
 *
 * - `.row`  (etiqueta + valor): la etiqueta sale SIEMPRE entera; envuelve el valor.
 * - `.item` (concepto + importe): exactamente al revés — envuelve el texto y el
 *   importe queda entero.
 * - `.money`: ningún importe se parte, esté donde esté.
 *
 * Vive en un solo archivo porque este mismo arreglo ya se hizo una vez en la factura
 * y, con el CSS copiado en cada página, había que rehacerlo en cada papel.
 */
export default function ThermalStyles() {
  return (
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
        line-height: 1.25;
      }
      .thermal-page { padding: 0 3mm; }
      .thermal h1 { font-size: 12pt; font-weight: 900; margin: 0 0 1px; text-align: center; line-height: 1.15; }
      .thermal .addr { font-size: 8pt; font-weight: 600; text-align: center; margin: 0 0 4px; }
      .thermal h2 { font-size: 11pt; font-weight: 900; margin: 3px 0; text-align: center; letter-spacing: 0.3px; }
      .thermal .sub { font-size: 8.5pt; font-weight: 800; text-align: center; margin: 0 0 4px; letter-spacing: 1px; }
      .thermal hr { border: none; border-top: 1px solid #000; margin: 4px 0; }
      /* Rótulo de sección: separa emisor / cliente / detalle de un vistazo. */
      .thermal .seccion { font-size: 7pt; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; margin: 4px 0 1px; }

      .thermal .row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-size: 9pt; margin: 1.5px 0; }
      .thermal .row > span:first-child { flex: 0 0 auto; white-space: nowrap; font-weight: 700; }
      .thermal .row > span:last-child { flex: 1 1 auto; min-width: 0; text-align: right; font-weight: 600; overflow-wrap: break-word; }
      .thermal .row.small { font-size: 8pt; }

      .thermal .item { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 9pt; margin: 1.5px 0; }
      .thermal .item > span:first-child { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow-wrap: break-word; }
      .thermal .item > span:last-child { flex: 0 0 auto; white-space: nowrap; font-weight: 700; }
      .thermal .item.small { font-size: 8pt; }

      .thermal .money { white-space: nowrap; }

      .thermal .total { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12pt; font-weight: 900; margin: 5px 0 3px; border-top: 1px solid #000; padding-top: 4px; }
      .thermal .total > span:last-child { white-space: nowrap; }
      .thermal .nota { font-size: 8pt; font-weight: 600; margin: 3px 0 1px; overflow-wrap: break-word; }
      .thermal .note { font-size: 8pt; font-weight: 600; margin: 4px 0; overflow-wrap: break-word; }
      .thermal .footer { font-size: 8.5pt; font-weight: 700; text-align: center; margin: 6px 0 0; }
      .thermal .footer.muted { color: #000; margin-top: 2px; }
    `}</style>
  );
}
