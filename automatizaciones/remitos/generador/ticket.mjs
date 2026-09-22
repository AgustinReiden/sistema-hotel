// HTML imprimible de los comprobantes de prueba, en rollo de 80mm.
//
// El ticket es el diseño compacto del sistema (comun/ticket-compacto.mjs): los
// mismos estilos, el mismo tamaño de QR y el mismo dibujo del QR que imprime
// src/app/admin/comprobante-cc. Lo unico distinto es el prefijo del codigo: T-
// en las pruebas, R- en el sistema.

import QRCode from "qrcode";

import { CSS_TICKET_COMPACTO, OPCIONES_QR, QR_MM } from "../comun/ticket-compacto.mjs";

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

/** PNG del QR, con las mismas opciones que el sistema. */
export function pngQr(texto) {
  return QRCode.toBuffer(texto, OPCIONES_QR);
}

async function imagenQr(texto, lado) {
  // Render "pixelated" (en CSS_TICKET_COMPACTO): Chrome baja la imagen a la
  // resolucion de la comandera sin suavizar bordes, que es lo que arruina un
  // codigo en termico.
  const png = await pngQr(texto);
  return `<img class="qr" alt="${esc(texto)}" style="width:${lado}mm;height:${lado}mm" src="data:image/png;base64,${png.toString("base64")}">`;
}

/**
 * Un comprobante con el diseño compacto del sistema. `c` es una fila del manifiesto.
 * `leyenda` se agrega a la linea chica de arriba (ej. "MUESTRA 14 mm").
 */
export async function htmlTicket(c, hotel, { qrMm = QR_MM, leyenda = "" } = {}) {
  return `
  <section class="thermal-page compacto">
    <h1>${esc(hotel.nombre)}</h1>
    ${hotel.direccion ? `<p class="addr">${esc(hotel.direccion)}</p>` : ""}
    <p class="tipo">COMPROBANTE CTA. CTE.${leyenda ? ` · ${esc(leyenda)}` : ""}</p>
    <hr />
    <div class="ident">
      ${await imagenQr(c.codigo, qrMm)}
      <div>
        <p class="nro">${esc(c.numero_visible)}</p>
        <p class="fecha">${esc(fechaHora(c.created_at, hotel.zona))}</p>
      </div>
    </div>
    <hr />
    <p class="row"><span>Cliente:</span><span>${esc(c.cliente)}</span></p>
    ${c.documento ? `<p class="row"><span>DNI/CUIT:</span><span>${esc(c.documento)}</span></p>` : ""}
    ${c.habitacion ? `<p class="row"><span>Habitación:</span><span>${esc(c.habitacion)}</span></p>` : ""}
    ${c.check_in ? `<p class="row"><span>Estadía:</span><span>${esc(fecha(c.check_in, hotel.zona))} → ${esc(fecha(c.check_out, hotel.zona))}</span></p>` : ""}
    <p class="total"><span>CARGADO A CUENTA</span><span class="money">${esc(pesos(c.monto))}</span></p>
    <div class="firma"><span>Firma:</span><span class="linea"></span></div>
    <div class="aclaracion"><span>Aclaración:</span><span class="linea"></span></div>
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
  /* El ticket: el mismo CSS que el sistema. */
  ${CSS_TICKET_COMPACTO}
  /* Cada ticket en su hoja, sin hoja en blanco al final. */
  .thermal-page + .thermal-page { break-before: page; page-break-before: always; }
  /* Despues del ticket a proposito: en pantalla los separa (en papel no aplica). */
  @media screen { .thermal-page { margin: 8mm auto; box-shadow: 0 0 4px #999; } }
  .thermal-feed { height: 2mm; }
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
