// HTML imprimible de los comprobantes de prueba, en rollo de 80mm.
//
// El cuerpo del ticket replica src/app/admin/comprobante-cc/[movementId]/page.tsx
// (el CSS esta COPIADO, no importado: esta etapa no toca el sistema). Lo unico
// nuevo es el bloque de identificacion: numero grande + codigo escaneable.

import bwipjs from "bwip-js/node";

// Tamanos impresos. Son los candidatos de la prueba de humo.
export const FORMATOS = {
  "qr-chico": { bcid: "qrcode", anchoMm: 15, etiqueta: "QR 15 mm" },
  "qr-grande": { bcid: "qrcode", anchoMm: 25, etiqueta: "QR 25 mm" },
  code128: { bcid: "code128", anchoMm: 64, altoMm: 12, etiqueta: "Code128 64 mm" },
};

async function imagenCodigo(texto, formato) {
  const f = FORMATOS[formato];
  // Escala alta y render "pixelated": Chrome la baja a la resolucion de la
  // comandera sin suavizar bordes, que es lo que arruina un codigo en termico.
  const opciones =
    f.bcid === "qrcode"
      ? { bcid: "qrcode", text: texto, scale: 8, eclevel: "M", paddingwidth: 4, paddingheight: 4 }
      : { bcid: "code128", text: texto, scale: 4, height: 12, paddingwidth: 10 };
  const png = await bwipjs.toBuffer(opciones);
  const alto = f.altoMm ? `height:${f.altoMm}mm;` : "";
  return `<img class="codigo" alt="${texto}" style="width:${f.anchoMm}mm;${alto}" src="data:image/png;base64,${png.toString("base64")}">`;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pesos = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

export function fechaHora(iso, zona) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export function fecha(iso, zona) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: zona, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

async function bloqueIdentificacion(c, formatos) {
  const imagenes = [];
  for (const f of formatos) imagenes.push(await imagenCodigo(c.codigo, f));
  return `
    <div class="ident">
      ${imagenes.join("\n")}
      <p class="nro-grande">${esc(c.numero_visible)}</p>
    </div>`;
}

/** Un comprobante de prueba. `c` es una fila del manifiesto. */
export async function htmlTicket(c, hotel, formatos) {
  return `
  <section class="thermal-page">
    <h1>${esc(hotel.nombre)}</h1>
    <p class="addr">${esc(hotel.direccion)}</p>
    <p class="prueba">*** COMPROBANTE DE PRUEBA ***</p>
    <hr />
    <h2>COMPROBANTE CTA. CTE.</h2>
    <p class="sub">CARGO A CUENTA CORRIENTE</p>
    ${await bloqueIdentificacion(c, formatos)}
    <p class="row"><span>Fecha:</span><span>${esc(fechaHora(c.created_at, hotel.zona))}</span></p>
    <hr />
    <p class="row"><span>Cliente:</span><span>${esc(c.cliente)}</span></p>
    ${c.documento ? `<p class="row"><span>DNI/CUIT:</span><span>${esc(c.documento)}</span></p>` : ""}
    ${c.habitacion ? `<p class="row"><span>Habitacion:</span><span>${esc(c.habitacion)}</span></p>` : ""}
    ${c.check_in ? `<p class="row"><span>Estadia:</span><span>${esc(fecha(c.check_in, hotel.zona))} → ${esc(fecha(c.check_out, hotel.zona))}</span></p>` : ""}
    <hr />
    <p class="total"><span>CARGADO A CUENTA</span><span>${esc(pesos(c.monto))}</span></p>
    <hr />
    <p class="note">El cliente reconoce adeudar el monto cargado a su cuenta corriente y se compromete a su pago.</p>
    <p class="footer">Firma: _____________________</p>
    <p class="footer">Aclaración: _____________________</p>
    <p class="footer muted">Conserve este comprobante.</p>
    <div class="thermal-feed"></div>
  </section>`;
}

/** Tickets de la prueba de humo: el mismo layout, un formato de codigo por ticket. */
export async function htmlMuestra(c, hotel, formato) {
  return `
  <section class="thermal-page">
    <h1>${esc(hotel.nombre)}</h1>
    <p class="prueba">*** MUESTRA ${esc(FORMATOS[formato].etiqueta)} ***</p>
    <hr />
    ${await bloqueIdentificacion(c, [formato])}
    <hr />
    <p class="note">Prueba de lectura. Cortar las muestras, ponerlas juntas en el vidrio
    separadas 1 cm, taparlas con la cartulina negra, escanear y correr:
    <br/>npm run procesar -- escaneo.pdf</p>
    <p class="footer">Firma: _____________________</p>
    <div class="thermal-feed"></div>
  </section>`;
}

// Corre en el navegador (se incrusta con toString). Imprime un trabajo por ticket,
// como el sistema real (un comprobante por ventana): es lo que hace que el driver de
// la comandera corte al final de cada uno.
//
// NO se fija el largo de la hoja. Se probo pedir el largo exacto con @page: guardando
// a PDF funciona, pero con la POS-80C Chrome usa el papel del driver y centra la
// pagina, dejando papel en blanco arriba y abajo. Con "80mm auto" (igual que el
// comprobante real) el ticket va arriba y el largo lo resuelve el driver.
/* global document, window */
function scriptImpresion() {
  const tickets = [...document.querySelectorAll(".thermal-page")];
  const info = document.getElementById("info");
  info.textContent = `${tickets.length} ticket(s)`;

  function imprimirUno(ticket) {
    return new Promise((listo) => {
      for (const t of tickets) t.style.display = t === ticket ? "" : "none";
      const fin = () => {
        window.removeEventListener("afterprint", fin);
        listo();
      };
      window.addEventListener("afterprint", fin);
      window.print();
    });
  }

  // Sin modo kiosco Chrome muestra el dialogo en cada ticket: alcanza con Enter.
  document.getElementById("deAUno").addEventListener("click", async () => {
    for (let i = 0; i < tickets.length; i++) {
      info.textContent = `Imprimiendo ${i + 1} de ${tickets.length}`;
      await imprimirUno(tickets[i]);
    }
    for (const t of tickets) t.style.display = "";
    info.textContent = `Listo: ${tickets.length} ticket(s)`;
  });
  document.getElementById("todos").addEventListener("click", () => window.print());
}
const SCRIPT_IMPRESION = `(${scriptImpresion.toString()})();`;

export function documento(titulo, secciones) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>
  /* Igual que el comprobante real (src/app/admin/comprobante-cc): el largo lo pone el driver. */
  @page { size: 80mm auto; margin: 0; }
  @media print {
    body { background: white !important; color: #000 !important; margin: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
  body { margin: 0; background: #eee; }
  .barra { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #222; font-family: Arial, sans-serif; }
  .barra button { font-size: 14px; font-weight: 700; padding: 8px 14px; border-radius: 6px; border: 0; cursor: pointer; }
  .barra .principal { background: #16a34a; color: white; }
  .barra span { color: #ddd; font-size: 13px; align-self: center; }
  .thermal-page { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; background: white; color: #000; width: 72mm; max-width: 72mm; margin: 0 auto; padding: 0 3mm; line-height: 1.2; word-break: break-word; box-sizing: border-box; }
  /* Cada ticket en su hoja, sin hoja en blanco al final. */
  .thermal-page + .thermal-page { break-before: page; page-break-before: always; }
  @media screen { .thermal-page { margin: 8mm auto; box-shadow: 0 0 4px #999; } }
  .thermal-feed { height: 2mm; }
  h1 { font-size: 15pt; font-weight: 900; margin: 0 0 2px; text-align: center; padding-top: 2mm; }
  .addr { font-size: 9pt; font-weight: 700; text-align: center; margin: 0 0 5px; }
  .prueba { font-size: 9pt; font-weight: 900; text-align: center; margin: 2px 0; letter-spacing: 1px; }
  h2 { font-size: 12.5pt; font-weight: 900; margin: 6px 0 2px; text-align: center; letter-spacing: 0.6px; }
  .sub { font-size: 10pt; font-weight: 800; text-align: center; margin: 0 0 6px; letter-spacing: 1.5px; }
  hr { border: none; border-top: 1.5px solid #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5pt; font-weight: 700; margin: 1.5px 0; }
  .row span:first-child { font-weight: 800; margin-right: 6px; }
  .row span:last-child { text-align: right; }
  .total { display: flex; justify-content: space-between; gap: 8px; font-size: 13pt; font-weight: 900; margin: 6px 0 4px; }
  .total span:last-child { white-space: nowrap; flex-shrink: 0; }
  .note { font-size: 9pt; font-weight: 700; margin: 6px 0; }
  .footer { font-size: 10pt; font-weight: 800; text-align: center; margin: 10px 0 0; }
  .footer.muted { margin-top: 4px; font-weight: 700; }
  .ident { text-align: center; margin: 4px 0 6px; }
  .codigo { display: block; margin: 2mm auto; image-rendering: pixelated; image-rendering: crisp-edges; }
  .nro-grande { font-size: 22pt; font-weight: 900; letter-spacing: 1px; margin: 1mm 0 0; font-family: "Courier New", monospace; }
</style>
</head>
<body>
<div class="barra no-print">
  <button class="principal" id="deAUno">Imprimir de a uno (la comandera corta cada ticket)</button>
  <button id="todos">Imprimir todos juntos</button>
  <span id="info"></span>
</div>
${secciones.join("\n")}
<script>${SCRIPT_IMPRESION}</script>
</body>
</html>`;
}
