// Diseño del comprobante de cuenta corriente con QR (2026-09-22).
//
// Lo usan el generador de tickets de prueba y, copiado, el sistema
// (src/app/admin/comprobante-cc/ticket-compacto.ts). Un test del sistema compara
// las dos copias: si cambia una sin la otra, falla.
//
// Sin dependencias a proposito: el test del sistema lo importa desde otra raiz.

/**
 * Lado del QR impreso, en mm. Sale de la prueba de impresion en la comandera
 * (2026-09-22, dos tickets por tamaño, escaneados con la cartulina): con 14 mm uno
 * de los dos no se leyo ni a 300 dpi (modulos de 0,6 mm, la termica los dejo
 * huecos); con 16 y 18 mm se leyeron todos en la primera pasada, y siguen
 * leyendose aunque la imagen baje a 100 dpi.
 */
export const QR_MM = 16;

/**
 * Opciones de la libreria `qrcode` para el PNG del QR. Las mismas en el generador
 * y en el sistema: la prueba de impresion tiene que medir el mismo dibujo que
 * despues sale en la comandera (mismo margen blanco, mismo tamaño de modulo).
 * Escala entera, 8 px por modulo: con image-rendering pixelated no se suaviza.
 */
export const OPCIONES_QR = { errorCorrectionLevel: "M", margin: 1, scale: 8 };

/**
 * Estilos completos del ticket compacto, bajo la clase `compacto`. En el sistema
 * van DESPUES de los estilos termicos comunes, asi estos mandan.
 */
export const CSS_TICKET_COMPACTO = `
.compacto { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; background: white; color: #000; width: 72mm; max-width: 72mm; margin: 0 auto; padding: 0 3mm; box-sizing: border-box; line-height: 1.25; }
.compacto .tipo { font-size: 7.5pt; font-weight: 800; text-align: center; letter-spacing: 1px; margin: 0 0 2px; padding-top: 1mm; }
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
