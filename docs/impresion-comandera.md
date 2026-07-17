# Impresión automática en comandera térmica 80mm

El sistema emite tickets en papel **rollo 80mm** (el contenido se dibuja a 72mm, con 3mm de margen a cada lado vía `.thermal-page`):

- **Recibo de pago**: se dispara automáticamente después de cada pago en `PaymentModal`. El **original y el duplicado se imprimen como dos trabajos de impresión separados** (primero el original y, encadenado, el duplicado), para que la comandera **guillotine entre ambos** sin dejar una hoja en blanco.
- **Rendición de turno**: desde `/admin/caja/rendiciones/[id]` → botón "Imprimir". Imprime original + duplicado en una sola pasada (corte al final).
- **Comprobante de Cta. Corriente**: copia única.

Para que la comandera imprima directo sin abrir PDF ni diálogo hay tres cosas que configurar.

## 1. Instalar el driver de la impresora

Depende del modelo (Epson TM-T20, Bixolon SRP, Xprinter XP-80C, etc.). Descargá el driver oficial del fabricante o configuralo como "Generic / Text Only" para tickets mínimos.

En Windows:

```
Panel de control → Dispositivos e impresoras → Agregar impresora → USB.
```

Probá imprimir una página de prueba desde Windows antes de seguir.

## 2. Configurar el tamaño de papel en la impresora

En `Propiedades de la impresora → Preferencias`:

- **Tamaño de papel**: rollo **80 mm** de ancho × "Recibo" (longitud variable / continuo). **No** dejarlo en A4 ni Carta: esa es la causa más común de que salga una hoja entera en blanco.
- **Margen**: 0 o el mínimo que permita la impresora.
- **Corte automático**: activado **al final de cada documento** (end of document / cut after job). Como el recibo imprime el original y el duplicado como dos trabajos separados, este ajuste es el que hace que corte **entre** original y duplicado.

En Epson TM-T20 el corte se activa desde el Printer Properties del driver ESC/POS ("Auto Cut" → "After each page/document").

## 3. Definir la comandera como impresora por defecto de Chrome

Abrir Chrome con la impresora correcta seleccionada:

### Opción A — Chrome "Kiosk printing" (recomendado para el puesto de recepción)

Cerrá todas las ventanas de Chrome. Abrilo con estos flags:

```
chrome.exe --kiosk-printing --disable-print-preview https://hotel.com
```

O creá un acceso directo con esos parámetros. Con `--kiosk-printing` Chrome imprime inmediatamente a la impresora por defecto sin mostrar el diálogo. El recibo dispara dos impresiones seguidas (original y duplicado); en modo kiosk salen sin intervención.

En el sistema operativo, configurá la **comandera como impresora por defecto**:

```
Windows → Configuración → Dispositivos → Impresoras → Click derecho en la comandera → "Establecer como predeterminada".
```

### Opción B — Con diálogo (fallback mientras probás)

Sin los flags, cuando se dispara el `window.print()` Chrome muestra el diálogo estándar. El usuario solo tiene que apretar Enter (una vez por copia). Útil para validar que el ticket se ve bien antes de pasar a modo kiosk.

## 4. Probar

1. Con la impresora prendida y cargada, ingresá como recepcionista.
2. Abrí la caja y cobrá un pago de prueba → debería abrirse una ventana chica e imprimir el **original**, cortar, imprimir el **duplicado**, cortar, y cerrarse sola.
3. Andá a `/admin/caja/rendiciones/<id>` y apretá "Imprimir" → debería salir el cierre de caja en 2 copias.

## Tamaño del ticket

El CSS define (en `src/app/admin/recibo/[paymentId]/page.tsx` y en las otras plantillas térmicas):

```css
@page { size: 80mm auto; margin: 0; }
```

`auto` en la altura deja que la impresora corte cuando el contenido termina (no fuerza una hoja fija). Si la impresora ignora el tamaño de página del CSS y usa el tamaño configurado en el driver, asegurate de que **ambos coincidan en 80mm de ancho**.

## Troubleshooting

- **El ticket sale en una hoja A4 / mucho papel en blanco**: la impresora no respeta `@page`. Configurá el papel a rollo **80mm** desde el driver de Windows (causa #1 del papel en blanco).
- **Se imprime pero no corta entre original y duplicado**: activá el **corte automático al final del documento** en el driver. Cada copia del recibo es un trabajo separado, así que con ese ajuste corta entre ambas.
- **No imprime, solo abre PDF**: Chrome está tratando a la impresora como "Guardar como PDF". Verificá que la comandera esté como default en Windows y arrancá Chrome con `--kiosk-printing`.
- **La fuente sale muy chica o muy grande**: ajustá los `font-size` en el CSS de `src/app/admin/recibo/[paymentId]/page.tsx` y `src/app/admin/caja/rendiciones/[id]/page.tsx`.
