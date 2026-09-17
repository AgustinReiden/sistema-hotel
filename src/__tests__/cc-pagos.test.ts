import { describe, expect, it } from "vitest";

import {
  estaPagada,
  facturaExcedente,
  imputacionExcedente,
  imputadoTotal,
  netoRecibido,
  retencionExcedente,
  retencionesTotal,
  sinImputar,
} from "@/lib/cc-pagos";

/**
 * Espejo de los CHECK de `cuenta_corriente_movimientos` y de las guardas de
 * `rpc_register_account_payment` (mig 109). La autoridad es el SQL; estos tests fijan
 * que la copia de TypeScript no pueda separarse de él sin que algo se ponga rojo.
 */

describe("el monto de un pago es el neto MÁS las retenciones", () => {
  // La invariante central de la migración 109, y la que alguien va a querer dar
  // vuelta: si el neto se calculara sumando en vez de restando, o si `amount` pasara
  // a ser sólo el efectivo, el cliente quedaría debiendo para siempre la plata que
  // le retuvo a ARCA en nombre del hotel.
  it("descompone un pago con las dos retenciones", () => {
    const pago = { amount: 100000, retencionGanancias: 2000, retencionIibb: 1500 };

    expect(retencionesTotal(pago)).toBe(3500);
    expect(netoRecibido(pago)).toBe(96500);
    // La identidad, escrita como identidad: neto + retenciones = lo que cancela.
    expect(netoRecibido(pago) + retencionesTotal(pago)).toBe(pago.amount);
  });

  it("sin retenciones, el neto es el monto entero", () => {
    // El caso normal: la enorme mayoría de los clientes no retiene nada.
    expect(netoRecibido({ amount: 50000 })).toBe(50000);
    expect(netoRecibido({ amount: 50000, retencionGanancias: 0, retencionIibb: 0 })).toBe(50000);
    expect(retencionesTotal({})).toBe(0);
  });

  it("un pago absorbido entero por la retención deja neto 0, y es válido", () => {
    // Pasa de verdad con saldos chicos: el cálculo de la retención se come el pago.
    // Por eso el CHECK es <= y no <: neto 0 es un asiento legítimo, no un error.
    const pago = { amount: 8000, retencionGanancias: 8000, retencionIibb: 0 };
    expect(netoRecibido(pago)).toBe(0);
    expect(retencionExcedente(pago)).toBe(0);
  });

  it("trata null y undefined como cero, no como NaN", () => {
    // Las columnas llegan de Postgres y el front puede no mandar el campo. Un NaN
    // acá se imprimiría en el recibo.
    expect(netoRecibido({ amount: 10000, retencionGanancias: null, retencionIibb: undefined })).toBe(10000);
  });

  it("no arrastra el error de coma flotante", () => {
    // 0.1 + 0.2 y amigos: el recibo tiene que decir 999,7 y no 999,7000000000001.
    const pago = { amount: 1000.0, retencionGanancias: 0.1, retencionIibb: 0.2 };
    expect(retencionesTotal(pago)).toBe(0.3);
    expect(netoRecibido(pago)).toBe(999.7);
  });
});

describe("las retenciones no pueden superar el monto", () => {
  // Espejo del CHECK `cc_mov_retenciones_no_superan_amount`. Son una PARTE del monto,
  // no algo que se le suma.
  it("avisa cuánto se pasan", () => {
    expect(retencionExcedente({ amount: 10000, retencionGanancias: 9000, retencionIibb: 2000 })).toBe(1000);
  });

  it("justo iguales entran", () => {
    expect(retencionExcedente({ amount: 10000, retencionGanancias: 6000, retencionIibb: 4000 })).toBe(0);
  });
});

describe("imputación parcial", () => {
  it("un pago puede quedar imputado a medias, y eso no es un error", () => {
    // El cliente transfiere $100.000 y sólo quiere aplicar $60.000 a una factura: el
    // resto queda a cuenta, esperando la factura del mes que viene.
    const pago = { amount: 100000 };
    const imputaciones = [{ amount: 60000 }];

    expect(imputadoTotal(imputaciones)).toBe(60000);
    expect(sinImputar(pago, imputaciones)).toBe(40000);
    expect(imputacionExcedente(pago, imputaciones)).toBe(0);
  });

  it("una factura cobrada a medias sigue impaga", () => {
    // Es el caso que decide el `cobro_estado` de rpc_list_cc_account_stays: pagada
    // sólo cuando lo imputado ALCANZA el total. 40.000 de 100.000 es impaga.
    expect(estaPagada({ impTotal: 100000, imputado: 40000 })).toBe(false);
  });

  it("dos pagos parciales que suman el total la dejan pagada", () => {
    const primero = 40000;
    const segundo = 60000;
    expect(estaPagada({ impTotal: 100000, imputado: primero + segundo })).toBe(true);
  });

  it("un centavo de menos NO es pagada", () => {
    // Sin epsilon a propósito: los importes son decimales exactos y el techo por
    // factura acota la suma en imp_total, así que la igualdad se alcanza de verdad.
    // Un epsilon acá haría que un faltante se lea como cobrado.
    expect(estaPagada({ impTotal: 100000, imputado: 99999.99 })).toBe(false);
    expect(estaPagada({ impTotal: 100000, imputado: 100000 })).toBe(true);
  });

  it("un pago que cubre varias facturas reparte contra el mismo monto", () => {
    // Una empresa salda tres consolidadas con una transferencia.
    const pago = { amount: 250000 };
    const imputaciones = [{ amount: 100000 }, { amount: 90000 }, { amount: 60000 }];
    expect(imputadoTotal(imputaciones)).toBe(250000);
    expect(sinImputar(pago, imputaciones)).toBe(0);
    expect(imputacionExcedente(pago, imputaciones)).toBe(0);
  });

  it("la imputación se mide contra lo que cancela, no contra el neto recibido", () => {
    // La razón de ser de la migración: si se midiera contra el neto, un pago con
    // retenciones no podría cancelar la factura entera y quedaría un saldo fantasma.
    // Cancela $100.000 aunque a la caja hayan entrado $96.500.
    const pago = { amount: 100000, retencionGanancias: 2000, retencionIibb: 1500 };
    const imputaciones = [{ amount: 100000 }];

    expect(netoRecibido(pago)).toBe(96500);
    expect(imputacionExcedente(pago, imputaciones)).toBe(0);
    expect(estaPagada({ impTotal: 100000, imputado: imputadoTotal(imputaciones) })).toBe(true);
  });
});

describe("no se puede imputar de más", () => {
  // Dos techos distintos, y hacen falta los dos: uno lo chequea la RPC contra el
  // monto del pago (P0035) y el otro contra el total de la factura, con la fila
  // lockeada (P0038).
  it("ni más que el monto del pago", () => {
    const pago = { amount: 100000 };
    expect(imputacionExcedente(pago, [{ amount: 60000 }, { amount: 50000 }])).toBe(10000);
  });

  it("ni más que el total de la factura, contando lo que ya tiene imputado", () => {
    // La factura es de $100.000 y ya cobró $70.000: entran $30.000, no $40.000.
    expect(facturaExcedente({ impTotal: 100000, imputado: 70000 }, 30000)).toBe(0);
    expect(facturaExcedente({ impTotal: 100000, imputado: 70000 }, 40000)).toBe(10000);
  });

  it("imputar exactamente el total sí se permite", () => {
    // El caso límite tiene que entrar: si no, una factura nunca se podría cerrar.
    expect(imputacionExcedente({ amount: 100000 }, [{ amount: 100000 }])).toBe(0);
    expect(facturaExcedente({ impTotal: 100000, imputado: 0 }, 100000)).toBe(0);
  });

  it("una factura ya saldada no admite un peso más", () => {
    expect(facturaExcedente({ impTotal: 100000, imputado: 100000 }, 1)).toBe(1);
  });
});

describe("una imputación desimputada deja de contar (mig 111)", () => {
  // La regla que sostiene toda la mig 111: si lo desimputado siguiera sumando,
  // revertir no liberaría un peso y el pago no se podría aplicar a la factura de
  // reemplazo — que es justo el bug que la migración cierra.
  it("no suma al total imputado", () => {
    const imputaciones = [{ amount: 60000 }, { amount: 40000, revertida: true }];
    expect(imputadoTotal(imputaciones)).toBe(60000);
  });

  it("devuelve monto disponible al pago", () => {
    const pago = { amount: 100000 };
    // Con las dos vivas el pago estaba consumido entero.
    expect(sinImputar(pago, [{ amount: 60000 }, { amount: 40000 }])).toBe(0);
    // Al soltar una, esos $40.000 vuelven a quedar para imputar.
    expect(sinImputar(pago, [{ amount: 60000 }, { amount: 40000, revertida: true }])).toBe(40000);
  });

  it("libera el techo del pago, así se puede volver a imputar", () => {
    const pago = { amount: 100000 };
    // Sin soltar la primera, agregar $40.000 se pasaba.
    expect(imputacionExcedente(pago, [{ amount: 100000 }, { amount: 40000 }])).toBe(40000);
    // Soltándola, entra.
    expect(
      imputacionExcedente(pago, [{ amount: 100000, revertida: true }, { amount: 40000 }])
    ).toBe(0);
  });

  it("una factura desimputada por completo vuelve a quedar impaga", () => {
    const imputaciones = [{ amount: 100000, revertida: true }];
    expect(estaPagada({ impTotal: 100000, imputado: imputadoTotal(imputaciones) })).toBe(false);
  });

  it("revertida ausente o false significa viva", () => {
    // La pantalla arma las líneas nuevas sin el campo: no puede cambiar el resultado.
    expect(imputadoTotal([{ amount: 500 }, { amount: 500, revertida: false }])).toBe(1000);
  });
});
