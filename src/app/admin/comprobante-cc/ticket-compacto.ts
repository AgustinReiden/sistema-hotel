// Copia textual de automatizaciones/remitos/comun/ticket-compacto.mjs: el ticket del
// sistema y los de prueba de la automatización tienen que ser el mismo papel. El test
// src/__tests__/ticket-compacto.test.ts compara las dos copias (y las opciones del
// dibujo del QR, que viven en src/lib/remito-qr.ts).

/**
 * Lado del QR impreso, en mm. Salió de la prueba de impresión en la comandera del
 * 2026-09-22: con 14 mm uno de cada dos tickets no se leía; con 16 se leyeron todos.
 */
export const REMITO_QR_MM = 16;

/**
 * Estilos completos del ticket compacto, bajo la clase `compacto`. Van DESPUÉS de
 * ThermalStyles, así estos mandan.
 */
export const CSS_TICKET_COMPACTO = `
.compacto { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; background: white; color: #000; width: 72mm; max-width: 72mm; margin: 0 auto; padding: 0 3mm; box-sizing: border-box; line-height: 1.25; }
.compacto h1 { font-size: 12pt; font-weight: 900; margin: 0 0 1px; padding-top: 1mm; text-align: center; line-height: 1.15; }
.compacto .addr { font-size: 8pt; font-weight: 600; text-align: center; margin: 0 0 2px; }
.compacto .tipo { font-size: 7.5pt; font-weight: 800; text-align: center; letter-spacing: 1px; margin: 0 0 2px; }
.compacto hr { border: none; border-top: 1px solid #000; margin: 3px 0; }
.compacto .ident { display: flex; align-items: center; gap: 3mm; margin: 3px 0; }
.compacto .ident .qr { display: block; flex: 0 0 auto; image-rendering: pixelated; image-rendering: crisp-edges; }
.compacto .ident .nro { font-family: "Courier New", monospace; font-size: 13pt; font-weight: 900; letter-spacing: 0.5px; margin: 0; }
.compacto .ident .fecha { font-size: 8.5pt; font-weight: 700; margin: 2px 0 0; }
.compacto .row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-size: 9pt; margin: 1.5px 0; }
.compacto .row > span:first-child { flex: 0 0 auto; white-space: nowrap; font-weight: 700; }
.compacto .row > span:last-child { flex: 1 1 auto; min-width: 0; text-align: right; font-weight: 600; overflow-wrap: break-word; }
.compacto .total { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 10.5pt; font-weight: 900; margin: 4px 0 2px; border-top: 1px solid #000; padding-top: 3px; }
.compacto .total > span:first-child { font-size: 9pt; }
.compacto .total > span:last-child { white-space: nowrap; }
.compacto .firma, .compacto .aclaracion { display: flex; align-items: flex-end; gap: 2mm; font-size: 8.5pt; font-weight: 700; }
.compacto .firma { height: 13mm; }
.compacto .aclaracion { height: 8mm; }
.compacto .linea { flex: 1 1 auto; border-bottom: 1px solid #000; margin-bottom: 1mm; }
.compacto .thermal-feed { height: 2mm; }
`.trim();
