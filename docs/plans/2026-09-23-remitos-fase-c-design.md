# Remitos firmados: fase C (vencidos, aviso en la consolidada y paquete)

Fecha: 2026-09-23
Estado: aprobado por Agustín (brainstorming del 2026-09-23).
Antecedentes: [integración con el sistema](2026-09-22-remitos-integracion-design.md) (fases A y
B, mig 116) y el [plan de reorden de UX](2026-09-23-reorden-ux-plan.md) (#135), con el que esto
tiene que convivir.

## 1. Qué problema resuelve

Hoy un remito perdido se descubre recién al armar la consolidada, un mes después, cuando el
papel ya no aparece y el empleado no se acuerda. La fase C adelanta ese momento a las 48 horas
del check-out, avisa otra vez al facturar y arma el PDF que se le manda a la empresa.

Son tres piezas:

1. **Vencidos:** un remito que a las 48 h del check-out no está firmado se ve como vencido
   en el panel de remitos.
2. **Aviso en la consolidada:** antes de emitir, el sistema dice qué remitos faltan. Se
   puede emitir igual, con un motivo que queda guardado.
3. **Paquete:** un PDF con los remitos firmados de una factura, en el orden de la factura.

**Qué no hace:** no manda mensajes, no bloquea nada y no toca la recepción. No manda el
paquete a la empresa: lo descarga el admin.

## 2. Decisiones de Agustín

| Pregunta | Decisión |
|---|---|
| ¿Quién ve la alerta? | Solo el admin. La recepción no hace el control. |
| ¿Qué cuenta como "está bien"? | Solo **firmado**. Todo lo demás, a las 48 h, vence (sin escanear, evaluando, a revisar, sin firma). "Sin remito", que ya pide nota, cuenta como resuelto. |
| ¿Desde cuándo? | Los cargos creados desde el **2026-09-24** (hora del hotel). |
| ¿Dónde? | En la pestaña Remitos firmados. Sin aviso en Hoy. |
| ¿Qué pasa al emitir con faltantes? | Avisa y deja seguir con un motivo obligatorio, que queda guardado. |
| ¿Qué lleva el paquete? | Solo los remitos firmados, uno por página, en el orden de la factura. Sin carátula ni factura. |
| ¿Quién arma el paquete? | n8n, con el worker. El sistema del hotel sigue sin llaves de Google. |

## 3. C1 · Vencidos

**Regla.** Un remito está vencido si cumple las tres:
- es un cargo creado desde `alertar_desde` (2026-09-24, en la zona del hotel);
- pasaron `horas_vencimiento` (48) desde su creación, que es el check-out (en PROD el cargo
  se crea en el mismo instante: diferencia 0 en los 160 cargos);
- su estado no es `firmado` ni `sin_remito`.

Las horas se cuentan corridas. Los dos valores viven en `remitos_ajustes` y se editan desde
*Ajustes* del panel, junto al umbral de la IA.

`alertar_desde` es independiente de `controlar_desde` (161). `controlar_desde` dice qué
remitos entran al panel; `alertar_desde` dice cuáles pueden vencer.

**En el panel (`/admin/remitos`, solo admin)**
- **Sección "Vencidos"** arriba de todo. Como las piezas a revisar, no depende del mes
  elegido. Cada renglón: número, cliente, habitación, hace cuánto salió y el motivo
  (*sin escanear · evaluando · a revisar · sin firma*), con las acciones de siempre ("Ver",
  Firmado, Sin firma, Sin remito con nota, Volver a revisar).
- **Semáforo del mes:** suma "N vencidos".
- **Numerito del menú:** remitos `a_revisar` o vencidos, contados una sola vez, más las piezas
  sin resolver. Sale de la función de datos del layout; el componente del menú no se toca.
- **Línea "Para revisar"** de F1-2 (plan de UX): tiene que decir lo mismo que el numerito,
  con los vencidos a la vista ("Para revisar: 2 remitos, 3 vencidos y 1 pieza"). Regla de
  F1-2: lo que dice el menú es lo que se ve al abrir.

## 4. C2 · Aviso en la consolidada

**Qué remitos mira.** Los del cargo de cada estadía tildada (`CcAccountStayRow.movimiento_id`),
con el alcance del panel: `remito_numero >= controlar_desde` o con al menos un escaneo. Los
remitos viejos sin QR no cuentan. Es faltante todo lo que no esté `firmado` ni `sin_remito`,
**sin** esperar las 48 h: al facturar, lo que no está firmado falta.

**Dónde.** Dentro del cuadro "Revisá antes de emitir" que agrega F0-1 del plan de UX
(`ConsolidadaConfirmModal`). Si hay faltantes:
- *"Faltan 2 remitos firmados: R-000163 (sin escanear) · R-000170 (sin firma)"*;
- un campo **"Motivo para emitir igual"**, obligatorio: sin motivo, "Confirmar y emitir en
  ARCA" queda deshabilitado.

Sin faltantes, el cuadro queda como lo deja F0-1.

**En el servidor.** `emitConsolidatedInvoiceAction` recibe el motivo y vuelve a buscar los
faltantes. Si hay y no vino motivo, no crea nada y devuelve el error con la lista. Si hay y
vino motivo:
1. crea el borrador (`rpc_create_consolidated_invoice_draft`, sin cambios);
2. guarda la constancia (factura, remitos faltantes con su estado, motivo, usuario, fecha);
3. recién ahí emite en ARCA.

Si el paso 2 falla, **no emite**: la factura queda pendiente, igual que cuando ARCA falla
hoy, y se reintenta o se descarta desde donde ya se hace. Una emitida no se puede deshacer; una
pendiente sí.

**Depende de F0-1** (carril K del plan de UX): el aviso va dentro de su cuadro.

## 5. C3 · Paquete

**Dónde.** Sección **"Paquetes por factura"** en la pestaña Remitos firmados, con el mismo
filtro de cliente. Lista las consolidadas del cliente autorizadas y no anuladas. Cada renglón:
- número y fecha de la factura;
- "44 de 47 firmados";
- la constancia, si se emitió con faltantes ("Emitida sin 3 remitos — motivo: … — Agustín, 30/09");
- el paquete: **Armar paquete** → *Armando…* → **Descargar** (abre el PDF en Drive), o el error.

**Qué lleva.** Los remitos firmados de la factura, en el orden de sus estadías en el
impreso. De cada uno, el escaneo vigente (`remito_control.escaneo_id`, el que abre "Ver").

**Cómo se arma.**
1. "Armar paquete" guarda un pedido con la lista exacta de escaneos, en orden, y la huella
   (`hash_sha256`) de cada uno.
2. El workflow nuevo **Remitos - Paquetes** corre cada minuto. Toma el pedido más viejo y lo
   marca "armando".
3. Baja cada escaneo de Drive y compara su sha256 con la huella del pedido.
4. El worker une los PDF (función nueva `/unir`).
5. n8n sube el resultado a `Remitos/<Cliente>/Paquetes/` con el número de factura en el
   nombre, y le avisa a la base con el id y el link del archivo.

**Cuando algo falla**
- **Un archivo falta o cambió:** el pedido queda en error con el remito y el motivo
  ("R-000170: el archivo de Drive no está o cambió"). **Nunca sale un paquete a medias.**
- **Pedido trabado:** si está "armando" hace más de 30 minutos, se puede volver a pedir.
- **Un remito se firma después:** el renglón dice "hay 1 remito firmado nuevo" y ofrece
  **Volver a armar**. Se arma entero de nuevo; el anterior queda en Drive con `_v2`, `_v3`…
  en el nombre del nuevo.
- **Worker o Drive caídos:** error en el pedido y en *Errores* de la planilla; se vuelve a pedir.

## 6. La base: migración 124

Las 118-123 las reserva el plan de UX. En PROD la última aplicada es la 117.

Una sola migración para las tres piezas, aplicada una vez con OK de Agustín, **antes del
deploy de C1**. No toca tablas existentes fuera de las de remitos.

- **`remitos_ajustes`:** columnas `horas_vencimiento INT NOT NULL DEFAULT 48` (entre 1 y 720)
  y `alertar_desde DATE NOT NULL DEFAULT '2026-09-24'`.
- **`remito_constancias_factura`** (nueva, cerrada como las de la 116): factura
  (`invoice_id`, única), `faltantes JSONB` (número, movimiento y estado de cada uno), motivo
  (no vacío), usuario y fecha.
- **`remito_paquetes`** (nueva, cerrada): factura, `version`, `estado` (`pedido`, `armando`,
  `listo`, `error`), `escaneos JSONB` (en orden, con número, `drive_file_id` y huella),
  `total_estadias`, `drive_file_id`, `drive_link`, `error`, quién lo pidió y las fechas.
- **Panel (authenticated + `app_is_admin()`):** listar vencidos, faltantes de una lista de
  movimientos, guardar la constancia, pedir un paquete, listar las consolidadas de un cliente
  con sus remitos, constancia y último paquete. La salud del panel suma los vencidos.
- **n8n (anon + clave `x-remitos-clave`):** tomar un pedido de paquete, marcarlo listo,
  marcarlo con error.
- **Funciones que ya existen:** `rpc_remitos_salud` se reescribe partiendo de
  `pg_get_functiondef` en PROD (regla de deriva del plan de UX). `rpc_remitos_guardar_ajustes`
  cambia de firma: se borra la de dos parámetros y se crea la de cuatro, con sus permisos.
- **Permisos como en la 116:** en PROD toda función nueva nace con EXECUTE para
  `authenticated`, así que cada grupo se cierra y se abre solo para su rol.

## 7. Orden de los PR

| PR | Qué | Depende de |
|---|---|---|
| **C1 · Vencidos** | Mig 124 (entera), sección Vencidos, semáforo, numerito, línea "Para revisar", ajustes. | Mig 124 aplicada con OK. |
| **C2 · Aviso en la consolidada** | Control en el servidor, constancia, aviso y motivo en el cuadro de F0-1. | C1 y **F0-1** mergeados. |
| **C3 · Paquetes** | `/unir` en el worker, workflow *Remitos - Paquetes*, sección del panel. | C1. Agustín importa el workflow nuevo. |

C1 y C3 solo tocan la pestaña de remitos, el worker y n8n. C2 toca `fiscal/consolidada/*`
después de F0-1. Los conflictos con el reorden de UX se resuelven al mergear.

**Estilo (plan de UX, F5):** letra de 12 px como mínimo, texto `slate-500` o más oscuro,
color principal `brand-700`. Tests con Testing Library buscando por texto o `aria-label`.

## 8. Pruebas

- **Reglas puras (Vitest):** qué vence y qué no (47 h vs 49 h, firmado, sin remito, antes de
  `alertar_desde`), qué es faltante al facturar, el conteo del numerito sin doble conteo.
- **Servidor:** la acción de la consolidada rechaza sin motivo cuando hay faltantes, guarda la
  constancia antes de emitir y no emite si la constancia falla.
- **Paquete:** el orden sale del impreso; con una huella distinta, el pedido termina en error
  y no se sube nada; `/unir` devuelve un PDF con tantas páginas como entraron.
- **Workflow:** la estructura del *Remitos - Paquetes* (credenciales, llamadas a la base,
  bucle sin `.first()` de nodos del bucle), como los tests de la 116.
- **Migración:** prueba en seco contra PROD antes de aplicarla, como la 116.
- **En PROD, sin facturar:** el aviso se prueba abriendo "Revisá antes de emitir" de un
  cliente con faltantes y apretando "Volver". El paquete, con una consolidada ya emitida.
