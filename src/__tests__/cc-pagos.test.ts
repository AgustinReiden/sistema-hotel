import { describe, expect, it } from "vitest";

import {
  estaPagada,
  estadoPago,
  facturaExcedente,
  imputacionExcedente,
  imputadoTotal,
  netoRecibido,
  problemasDelPago,
  repartirMasViejoPrimero,
  resumenPago,
  retencionExcedente,
  retencionesTotal,
  sinImputar,
  aImputacionDestino,
  claveDeuda,
  type DeudaAImputar,
  type ImputacionEnPantalla,
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

describe("el resumen en vivo del modal de cobro", () => {
  // Es el número que la gente se equivoca, y por eso está arriba del botón y no en
  // el recibo: con retenciones, lo que cancela de deuda y lo que entra a la cuenta
  // bancaria NO son lo mismo.
  it("separa lo que cancela de lo que entra", () => {
    const resumen = resumenPago({
      amount: 100000,
      retencionGanancias: 2000,
      retencionIibb: 1500,
    });

    expect(resumen.cancela).toBe(100000);
    expect(resumen.retenciones).toBe(3500);
    expect(resumen.entran).toBe(96500);
    // La identidad que sostiene toda la migración 109, escrita como identidad.
    expect(resumen.entran + resumen.retenciones).toBe(resumen.cancela);
  });

  it("sin retenciones, cancela y entra lo mismo", () => {
    // El caso normal: la enorme mayoría de los cobros no retiene nada, y ahí el
    // resumen no puede sembrar la duda de que falte plata.
    const resumen = resumenPago({ amount: 50000 });
    expect(resumen.cancela).toBe(50000);
    expect(resumen.entran).toBe(50000);
    expect(resumen.retenciones).toBe(0);
  });

  it("una retención que se come el pago entero deja en cero lo que entra, no en negativo", () => {
    const resumen = resumenPago({ amount: 8000, retencionGanancias: 8000 });
    expect(resumen.entran).toBe(0);
    expect(resumen.cancela).toBe(8000);
  });

  it("dice cuánto se aplicó a facturas y cuánto queda a cuenta", () => {
    // Imputar de menos es legítimo: el cliente adelanta plata y la factura sale
    // después. El resumen tiene que decirlo, no esconderlo.
    const resumen = resumenPago({ amount: 100000, retencionGanancias: 3000 }, [
      { amount: 60000 },
    ]);
    expect(resumen.imputado).toBe(60000);
    expect(resumen.sinImputar).toBe(40000);
    // Lo imputado se mide contra lo que CANCELA (100.000), no contra lo que entró
    // (97.000): la retención cancela factura igual que el efectivo.
    expect(resumen.sinImputar).toBe(resumen.cancela - resumen.imputado);
  });

  it("no arrastra el error de coma flotante", () => {
    const resumen = resumenPago({ amount: 1000, retencionGanancias: 0.1, retencionIibb: 0.2 });
    expect(resumen.retenciones).toBe(0.3);
    expect(resumen.entran).toBe(999.7);
  });
});

describe("aplicar a lo más viejo primero", () => {
  // El caso normal de una empresa que transfiere: paga lo que debe y nadie quiere
  // cargar seis renglones a mano.
  const facturas: DeudaAImputar[] = [
    { destino: "factura", id: "nueva", fecha: "2026-09-01", numero: 30, saldo: 50000 },
    { destino: "factura", id: "vieja", fecha: "2026-07-01", numero: 10, saldo: 40000 },
    { destino: "factura", id: "media", fecha: "2026-08-01", numero: 20, saldo: 30000 },
  ];

  it("salda la más vieja antes de tocar la siguiente", () => {
    const reparto = repartirMasViejoPrimero(100000, facturas);

    expect(reparto).toEqual([
      { destino: "factura", id: "vieja", amount: 40000 },
      { destino: "factura", id: "media", amount: 30000 },
      { destino: "factura", id: "nueva", amount: 30000 },
    ]);
  });

  it("el orden lo decide el reparto, no cómo venía la lista", () => {
    // Si dependiera del orden de entrada, un cambio de ordenamiento en la pantalla
    // cambiaría en silencio a qué factura se imputa la plata.
    const alReves = [...facturas].reverse();
    expect(repartirMasViejoPrimero(100000, alReves)).toEqual(
      repartirMasViejoPrimero(100000, facturas)
    );
  });

  it("nunca le imputa a una factura más que su saldo", () => {
    // Es el techo que la RPC valida con la fila lockeada (P0038): lo que sale de acá
    // tiene que pasarlo por construcción.
    const reparto = repartirMasViejoPrimero(1000000, facturas);
    for (const imputacion of reparto) {
      const factura = facturas.find((f) => f.id === imputacion.id);
      expect(imputacion.amount).toBeLessThanOrEqual(factura!.saldo);
    }
    // Y el sobrante NO se fuerza a ninguna: queda a cuenta.
    expect(imputadoTotal(reparto)).toBe(120000);
  });

  it("un monto que no alcanza deja la última factura a medias y no toca las de atrás", () => {
    const reparto = repartirMasViejoPrimero(55000, facturas);
    expect(reparto).toEqual([
      { destino: "factura", id: "vieja", amount: 40000 },
      { destino: "factura", id: "media", amount: 15000 },
    ]);
    expect(imputacionExcedente({ amount: 55000 }, reparto)).toBe(0);
  });

  it("las facturas sin fecha van al final, no primero", () => {
    // Una factura sin CAE no tiene lugar en la fila de antigüedad: ponerla primera
    // haría que el reparto empiece por lo que todavía no es exigible.
    const conHuerfana: DeudaAImputar[] = [
      { destino: "factura", id: "sin-fecha", fecha: null, numero: null, saldo: 10000 },
      { destino: "factura", id: "vieja", fecha: "2026-07-01", numero: 10, saldo: 10000 },
    ];
    expect(repartirMasViejoPrimero(15000, conHuerfana)[0].id).toBe("vieja");
  });

  it("no reparte nada con monto cero, y no revienta", () => {
    expect(repartirMasViejoPrimero(0, facturas)).toEqual([]);
    expect(repartirMasViejoPrimero(10000, [])).toEqual([]);
  });

  it("saltea las facturas ya saldadas en vez de imputarles cero", () => {
    const conSaldada: DeudaAImputar[] = [
      { destino: "factura", id: "saldada", fecha: "2026-06-01", numero: 5, saldo: 0 },
      { destino: "factura", id: "vieja", fecha: "2026-07-01", numero: 10, saldo: 40000 },
    ];
    expect(repartirMasViejoPrimero(40000, conSaldada)).toEqual([
      { destino: "factura", id: "vieja", amount: 40000 },
    ]);
  });
});

describe("lo que la pantalla NO deja mandar", () => {
  // Los mensajes dicen qué corregir y con cuánto: el que carga el pago tiene la
  // transferencia a la vista y necesita saber qué número mover.
  const factura = (amount: number, saldo = 30000): ImputacionEnPantalla => ({
    destino: "factura",
    id: "f1",
    etiqueta: "Factura B 00008-00000042",
    saldo,
    amount,
  });

  it("una imputación que se pasa del saldo de la factura", () => {
    const problemas = problemasDelPago({ amount: 100000, imputaciones: [factura(40000)] });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("Factura B 00008-00000042");
    // Dice cuánto falta, cuánto se imputó y cuánto sobra: los tres números que hacen
    // falta para corregirlo sin volver a la calculadora.
    expect(problemas[0]).toContain("$30.000,00");
    expect(problemas[0]).toContain("$40.000,00");
    expect(problemas[0]).toContain("$10.000,00");
  });

  it("imputar exactamente el saldo sí entra", () => {
    // El caso límite tiene que pasar: si no, una factura nunca se podría cerrar.
    expect(problemasDelPago({ amount: 30000, imputaciones: [factura(30000)] })).toEqual([]);
  });

  it("una imputación que se pasa del monto del pago", () => {
    const problemas = problemasDelPago({
      amount: 50000,
      imputaciones: [
        { destino: "factura", id: "a", etiqueta: "Factura B 1", saldo: 40000, amount: 40000 },
        { destino: "factura", id: "b", etiqueta: "Factura B 2", saldo: 40000, amount: 20000 },
      ],
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("$10.000,00");
  });

  it("retenciones que se pasan del monto: el monto YA las incluye", () => {
    const problemas = problemasDelPago({
      amount: 10000,
      retencionGanancias: 9000,
      retencionIibb: 2000,
      imputaciones: [],
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("se pasan");
    // Y propone el monto que haría entrar la retención, en vez de sólo rechazar.
    expect(problemas[0]).toContain("$11.000,00");
  });

  it("junta TODOS los problemas de una vez, no el primero", () => {
    // Corregir uno y descubrir el otro al reintentar es el ida y vuelta que esta
    // pantalla viene a sacar.
    const problemas = problemasDelPago({
      amount: 10000,
      retencionGanancias: 20000,
      imputaciones: [factura(50000)],
    });
    expect(problemas.length).toBeGreaterThan(1);
  });

  it("un pago sin imputar a nada es válido: es lo que se hace hoy", () => {
    // La regresión que no se puede permitir. El pago a cuenta sin factura existía
    // antes de la migración 109 y tiene que seguir andando.
    expect(problemasDelPago({ amount: 100000, imputaciones: [] })).toEqual([]);
  });

  it("un monto vacío o en cero se explica, no se manda", () => {
    expect(problemasDelPago({ amount: 0, imputaciones: [] })[0]).toContain("monto");
    expect(problemasDelPago({ amount: Number.NaN, imputaciones: [] })[0]).toContain("monto");
  });

  it("una factura tildada sin importe pide el importe o que la destilden", () => {
    const problemas = problemasDelPago({ amount: 100000, imputaciones: [factura(0)] });
    expect(problemas[0]).toContain("destilda");
  });
});

describe("estado de cobro de una estadía", () => {
  // La pastilla de la pantalla. Es OTRA pregunta que la de facturación: la factura
  // sale en el momento y la transferencia llega a los treinta días.
  it("sin factura no hay nada que cobrar", () => {
    expect(
      estadoPago({ facturada: false, externa: false, impTotal: null, imputado: null })
    ).toBe("sin_facturar");
  });

  it("facturada y sin un peso imputado es impaga", () => {
    expect(
      estadoPago({ facturada: true, externa: false, impTotal: 100000, imputado: 0 })
    ).toBe("impaga");
  });

  it("cobrada a medias es parcial, y no se redondea a pagada", () => {
    expect(
      estadoPago({ facturada: true, externa: false, impTotal: 100000, imputado: 40000 })
    ).toBe("parcial");
    // Un centavo de menos sigue siendo parcial: sin epsilon, igual que el SQL.
    expect(
      estadoPago({ facturada: true, externa: false, impTotal: 100000, imputado: 99999.99 })
    ).toBe("parcial");
  });

  it("cuando lo imputado alcanza el total, está pagada", () => {
    expect(
      estadoPago({ facturada: true, externa: false, impTotal: 100000, imputado: 100000 })
    ).toBe("pagada");
  });

  it("facturada afuera no se mide: no hay comprobante nuestro que cobrar", () => {
    expect(
      estadoPago({ facturada: true, externa: true, impTotal: null, imputado: null })
    ).toBe("facturado_externo");
  });

  it("una factura en trámite (sin CAE todavía) es impaga, no 'sin facturar'", () => {
    // Decir "sin facturar" ahí mandaría a alguien a facturarla de nuevo.
    expect(
      estadoPago({ facturada: true, externa: false, impTotal: null, imputado: null })
    ).toBe("impaga");
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

describe("la plata también se puede apuntar a una estadía sin facturar (mig 114)", () => {
  // Lo que la mig 109 no podía registrar: el cliente que transfiere en agosto por las
  // noches de julio, cuya factura sale recién a fin de mes.

  it("una estadía se reparte igual que una factura: es una fecha y un saldo", () => {
    const deudas: DeudaAImputar[] = [
      { destino: "factura", id: "f-agosto", fecha: "2026-08-10", numero: 20, saldo: 30000 },
      { destino: "estadia", id: "cargo-julio", fecha: "2026-07-15", numero: null, saldo: 50000 },
    ];

    // Decisión de Agustín: una sola fila de antigüedad. La estadía de julio es más
    // vieja que la factura de agosto, aunque todavía no tenga papel.
    expect(repartirMasViejoPrimero(60000, deudas)).toEqual([
      { destino: "estadia", id: "cargo-julio", amount: 50000 },
      { destino: "factura", id: "f-agosto", amount: 10000 },
    ]);
  });

  it("dentro del mismo día va primero la que ya tiene comprobante", () => {
    // Empate de fechas: la emitida es exigible hoy, la estadía todavía no.
    const mismoDia: DeudaAImputar[] = [
      { destino: "estadia", id: "cargo", fecha: "2026-07-15", numero: null, saldo: 10000 },
      { destino: "factura", id: "f", fecha: "2026-07-15", numero: 7, saldo: 10000 },
    ];
    expect(repartirMasViejoPrimero(10000, mismoDia)[0].id).toBe("f");
  });

  it("el orden no depende de cómo venía la lista, tampoco mezclando los dos tipos", () => {
    const deudas: DeudaAImputar[] = [
      { destino: "estadia", id: "e1", fecha: "2026-07-01", numero: null, saldo: 10000 },
      { destino: "factura", id: "f1", fecha: "2026-08-01", numero: 3, saldo: 10000 },
      { destino: "estadia", id: "e2", fecha: "2026-06-01", numero: null, saldo: 10000 },
    ];
    expect(repartirMasViejoPrimero(25000, [...deudas].reverse())).toEqual(
      repartirMasViejoPrimero(25000, deudas)
    );
  });

  it("nunca le imputa a una estadía más que su saldo: es el techo P0043", () => {
    // El equivalente del techo por factura (P0038), medido contra el cargo.
    const deudas: DeudaAImputar[] = [
      { destino: "estadia", id: "cargo", fecha: "2026-07-01", numero: null, saldo: 20000 },
    ];
    const reparto = repartirMasViejoPrimero(500000, deudas);
    expect(reparto).toEqual([{ destino: "estadia", id: "cargo", amount: 20000 }]);
    // El sobrante NO se le fuerza: queda a cuenta, que es un pago legítimo.
    expect(sinImputar({ amount: 500000 }, reparto)).toBe(480000);
  });

  it("el techo de una estadía ya cobrada a medias cuenta lo que otros pagos le pusieron", () => {
    // Mismo cálculo que el de una factura: la estadía debe 30.000 y ya tiene 12.000.
    expect(facturaExcedente({ impTotal: 30000, imputado: 12000 }, 18000)).toBe(0);
    expect(facturaExcedente({ impTotal: 30000, imputado: 12000 }, 18001)).toBe(1);
  });

  it("los avisos de la pantalla nombran la estadía, no 'la factura'", () => {
    const problemas = problemasDelPago({
      amount: 100000,
      imputaciones: [
        {
          destino: "estadia",
          id: "cargo",
          etiqueta: "Estadía Hab. 3 · 10/07 al 12/07",
          saldo: 30000,
          amount: 45000,
        },
      ],
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("Estadía Hab. 3");
    expect(problemas[0]).toContain("$15.000,00");
  });

  it("cada destino viaja con su clave y nunca con las dos", () => {
    // Es la forma que valida `app_validar_forma_imputaciones`: una factura O una
    // estadía. Mandar las dos, o ninguna, lo rechaza la RPC.
    expect(aImputacionDestino({ destino: "factura", id: "f1", amount: 100 })).toEqual({
      invoiceId: "f1",
      amount: 100,
    });
    expect(aImputacionDestino({ destino: "estadia", id: "c1", amount: 100 })).toEqual({
      cargoMovimientoId: "c1",
      amount: 100,
    });
  });

  it("la clave de pantalla lleva el destino adentro", () => {
    // Si fuera sólo el id, una factura y un cargo con el mismo id compartirían el
    // estado de tildado.
    expect(claveDeuda("factura", "x")).not.toBe(claveDeuda("estadia", "x"));
  });
});

describe("cuando la estadía se factura, la plata se muda sola (mig 114)", () => {
  // La mudanza la hace el trigger, no esto. Lo que se fija acá es que la aritmética
  // de TypeScript lea el resultado igual que la base: la línea vieja queda revertida
  // y por eso deja de sumar, y la nueva ocupa su lugar.

  it("mudar no cambia cuánto tiene imputado el pago", () => {
    const antes = [{ amount: 30000 }];
    const despues = [{ amount: 30000, revertida: true }, { amount: 30000 }];
    expect(imputadoTotal(despues)).toBe(imputadoTotal(antes));
    expect(sinImputar({ amount: 50000 }, despues)).toBe(20000);
  });

  it("la estadía deja de tener plata y la factura pasa a tenerla", () => {
    // Las dos mitades del mismo movimiento: si sólo se escribiera una, el mismo peso
    // aparecería dos veces (o ninguna).
    const enLaEstadia = [{ amount: 30000, revertida: true }];
    const enLaFactura = [{ amount: 30000 }];
    expect(imputadoTotal(enLaEstadia)).toBe(0);
    expect(estaPagada({ impTotal: 30000, imputado: imputadoTotal(enLaFactura) })).toBe(true);
  });

  it("si no entraba todo, lo que sobró vuelve a quedar a cuenta", () => {
    // El caso raro que el trigger resuelve recortando en vez de abortar: la factura
    // salió por menos de lo que la estadía tenía apuntado. Una emisión no se cae por
    // una cuestión de imputación.
    const pago = { amount: 30000 };
    const despues = [{ amount: 30000, revertida: true }, { amount: 25000 }];
    expect(imputadoTotal(despues)).toBe(25000);
    expect(sinImputar(pago, despues)).toBe(5000);
    expect(imputacionExcedente(pago, despues)).toBe(0);
  });
});
