# Impresión automática en comandera térmica 80mm

El sistema emite dos tipos de tickets en formato 75mm (papel 80mm con 2.5mm de margen a cada lado), ambos con **original + duplicado** en una sola impresión:

- **Recibo de pago**: se dispara automáticamente después de cada pago en `PaymentModal`.
- **Rendición de turno**: desde `/admin/caja/rendiciones/[id]` → botón "Imprimir".

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

- **Tamaño personalizado**: 75 mm de ancho × "Recibo" (longitud variable).
- **Margen**: 0 o el mínimo que permita la impresora.
- **Corte automático**: activado entre páginas (esto es lo que corta el papel al terminar cada copia: original y duplicado).

En Epson TM-T20 el corte entre páginas se activa desde el Printer Properties del driver ESC/POS.

## 3. Definir la comandera como impresora por defecto de Chrome

Abrir Chrome con la impresora correcta seleccionada:

### Opción A — Chrome "Kiosk printing" (recomendado para el puesto de recepción)

Cerrá todas las ventanas de Chrome. Abrilo con estos flags:

```
chrome.exe --kiosk-printing --disable-print-preview https://hotel.com
```

O creá un acceso directo con esos parámetros. Con `--kiosk-printing` Chrome imprime inmediatamente a la impresora por defecto sin mostrar el diálogo.

En el sistema operativo, configurá la **comandera como impresora por defecto**:

```
Windows → Configuración → Dispositivos → Impresoras → Click derecho en la comandera → "Establecer como predeterminada".
```

### Opción B — Con diálogo (fallback mientras probás)

Sin los flags, cuando se dispara el `window.print()` Chrome muestra el diálogo estándar. El usuario solo tiene que apretar Enter. Útil para validar que el ticket se ve bien antes de pasar a modo kiosk.

## 4. Probar

1. Con la impresora prendida y cargada, ingresá como recepcionista.
2. Abrí la caja y cobrá un pago de prueba → debería abrirse una ventana chica e imprimir **2 tickets** (original + duplicado), cortando entre ambos.
3. Andá a `/admin/caja/rendiciones/<id>` y apretá "Imprimir" → debería salir el cierre de caja también en 2 copias.

## Tamaño del ticket

El CSS define:

```css
@page { size: 75mm auto; margin: 2mm; }
```

`auto` en la altura deja que la impresora corte cuando el contenido termina. Si la impresora ignora el tamaño de página del CSS y usa el tamaño configurado en el driver, asegurate de que **ambos coincidan en 75mm ancho**.

## Troubleshooting

- **El ticket sale en una hoja A4**: la impresora no respeta `@page`. Configurá el tamaño 75mm desde el driver de Windows.
- **Se imprime pero no corta entre original y duplicado**: activá "Paper cut between pages" en el driver.
- **No imprime, solo abre PDF**: Chrome está tratando a la impresora como "Guardar como PDF". Verificá que la comandera esté como default en Windows y arrancá Chrome con `--kiosk-printing`.
- **La fuente sale muy chica o muy grande**: ajustá los `font-size` en el CSS del archivo `src/app/admin/recibo/[paymentId]/page.tsx` y `src/app/admin/caja/rendiciones/[id]/page.tsx`.
