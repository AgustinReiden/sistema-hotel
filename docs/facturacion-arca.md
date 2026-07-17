# Facturación electrónica ARCA (Factura B)

La app emite Factura B a consumidor final por WSFEv1 al hacer el check-out
("¿Emitir factura? SÍ/NO"). Cliente propio contra ARCA (`src/lib/arca/`),
estado en las tablas `fiscal_settings` / `invoices` (migración 72).

## Arquitectura en una línea

Check-out → prompt SÍ/NO → `rpc_create_invoice_draft` (valida turno/DNI/exclusiones)
→ `emitInvoice` (WSAA + WSFEv1) → CAE → impresión térmica con QR en
`/admin/factura/[id]`. Si ARCA no responde, la factura queda **pendiente** en
`/admin/fiscal` y se reintenta — el check-out nunca se traba.

## Variables de entorno (server-only; Coolify y `.env.local`)

| Variable | Qué es |
|---|---|
| `ARCA_CERT_B64` | Certificado X.509 (PEM) **en base64** |
| `ARCA_KEY_B64` | Clave privada (PEM) **en base64** |
| `ARCA_INTERNAL_KEY` | Clave interna del server (≥32 chars aleatorios). Autoriza a ESTE server a finalizar facturas y manejar el ticket WSAA. Al guardar la config fiscal desde Ajustes, su hash se sincroniza solo en la DB. |

Para pasar un PEM a base64: `base64 -w0 archivo.pem` (Linux) o
`[Convert]::ToBase64String([IO.File]::ReadAllBytes("archivo.pem"))` (PowerShell).

**La misma `ARCA_INTERNAL_KEY` tiene que estar en cada ambiente que use la misma
DB** (si dev y prod comparten la DB de PROD, deben compartir la clave, porque en
la DB vive un solo hash).

## Trámite 1 — Certificado de HOMOLOGACIÓN (sandbox, gratis, ~10 min)

El sandbox de ARCA (`wswhomo.afip.gov.ar`) emite CAEs de prueba sin valor fiscal.

1. Generar clave privada y CSR (en cualquier máquina segura):
   ```bash
   openssl genrsa -out arca-homo.key 2048
   openssl req -new -key arca-homo.key -subj "/C=AR/O=Hotel El Refugio/CN=hotelsync-homo/serialNumber=CUIT 30XXXXXXXXX" -out arca-homo.csr
   ```
   (reemplazar el CUIT real, sin guiones)
2. En el portal de ARCA con clave fiscal (nivel 3): **Administrador de Relaciones
   de Clave Fiscal** → adherir el servicio **"WSASS – Autoservicio de Acceso a
   APIs de Homologación"**.
3. Entrar a WSASS → **Nuevo certificado** → pegar el contenido del `arca-homo.csr`
   → descargar el certificado (`.crt`/`.pem`).
4. En WSASS → **Autorizar servicio** → autorizar el DN del certificado al servicio
   **`wsfe`** (el propio CUIT como representado).
5. Cargar en el server: `ARCA_CERT_B64` (el .crt en base64) y `ARCA_KEY_B64`
   (el arca-homo.key en base64).
6. En la app: Ajustes → Facturación electrónica → completar CUIT/razón social/
   punto de venta (en homologación cualquier PV entre 1 y 99998 sirve, ej. `1`),
   ambiente **Homologación**, habilitar y **Guardar**.
7. Botón **"Probar conexión ARCA"**: los 4 checks en verde = listo para facturar
   de prueba.

## Trámite 2 — PRODUCCIÓN (cuando el sandbox esté validado y Pablo dé el OK)

1. **Administración de Certificados Digitales** (portal ARCA): nuevo alias con un
   CSR *distinto* (generar `arca-prod.key`/`.csr` como arriba).
2. **Administrador de Relaciones**: delegar el servicio "Facturación Electrónica"
   (wsfe) al certificado nuevo.
3. **Administración de Puntos de Venta y Domicilios**: alta del punto de venta
   nuevo, modalidad **"Factura Electrónica / Web Services (RECE)"**, exclusivo
   para la app.
4. Confirmar con el contador: alícuota del hospedaje (21%), leyendas de IIBB, y
   quién emite notas de crédito (v1: no las emite la app).
5. Cambiar en Coolify `ARCA_CERT_B64`/`ARCA_KEY_B64` por los de producción,
   y en Ajustes: ambiente **Producción** + punto de venta real + Guardar +
   Probar conexión. Emitir la primera factura real supervisada.

## Reglas de negocio v1

- Solo **Factura B** (cód. 06) a consumidor final con **DNI** (7-8 dígitos).
  DNI inválido → se bloquea con mensaje; se corrige el DNI en la reserva y se
  reintenta (el sistema re-lee el DNI al reintentar).
- **Excluidas**: reservas de empresa (Factura A la hace la oficina) y cierres a
  cuenta corriente (se factura al saldar).
- El playero factura solo check-outs de **su turno abierto**; después, solo admin.
- Se factura el `total_price` final (descuentos/extras/media estadía incluidos),
  IVA 21% incluido (neto = total/1.21). Concepto 2 (Servicios) con el período
  de la estadía.
- El impreso cumple RG 1415 (datos formales), **RG 4892** (QR) y **RG 5614 /
  Ley 27.743** (bloque "Régimen de Transparencia Fiscal al Consumidor" con IVA
  Contenido). En homologación lleva la banda "COMPROBANTE DE PRUEBA".

## Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| "El CEE ya posee un TA valido" | Se pidió un ticket WSAA teniendo uno vigente que no quedó guardado (p.ej. se borró la fila de `arca_ta`). Esperar a que venza (máx. 12 h) y reintentar. Prevención: el sistema persiste el TA antes de usarlo. |
| Error 10242 | Falta la condición de IVA del receptor (RG 5616). La app la manda siempre; si aparece, revisar que el server esté actualizado. |
| "Acceso denegado" en reintento | El hash de `ARCA_INTERNAL_KEY` no está sincronizado: guardar la config fiscal desde Ajustes (admin) lo re-sincroniza. |
| Factura "En verificación" que no avanza | Hubo timeout post-envío. El botón Reintentar consulta `FECompConsultar` y recupera el CAE si ARCA lo emitió (no duplica). |
| Certificado vencido | El health check muestra el vencimiento (~2 años). Generar CSR nuevo y repetir el trámite del certificado. |

## Checklist de pruebas en el sandbox (Fase 6 del plan)

1. Walk-in $121 → check-out → SÍ → CAE + ticket con QR escaneable + bloque RG 5614.
2. Reserva con descuento → neto/IVA correctos (verificar en ARCA con FECompConsultar).
3. Media estadía / extras → total facturado = total final.
4. DNI inválido → rechazo claro → corregir → reintentar → autorizada.
5. Bloquear `wswhomo.afip.gov.ar` en hosts → check-out no se traba → pendiente → reintentar OK.
6. Doble click en SÍ → un solo comprobante (correlatividad OK).
7. Cerrar la caja → el playero ya no puede facturar ese check-out; el admin sí.
8. "Probar conexión ARCA" todo en verde.
