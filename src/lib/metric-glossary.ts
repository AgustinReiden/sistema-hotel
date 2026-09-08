// Glosario central de métricas del Tablero Gerencial. Un solo lugar donde vive el
// "qué es" y el "cómo se calcula" de cada KPI, para que los tooltips del tablero
// general y del de habitaciones no se desincronicen de la lógica de ./analytics.
//
// `what` = explicación en criollo (para qué sirve); `how` = fórmula en palabras.
// Mantener en sync con src/lib/analytics.ts si cambia un cálculo.

export type MetricInfo = { title: string; what: string; how: string };

export const METRIC_INFO = {
  // ── Tablero general: la plata del período ──
  closedSales: {
    title: "Venta cerrada del período",
    what: "Lo que facturaron las estadías que TERMINARON en el período (alojamiento + extras). Es la venta que ya está cerrada: no puede cambiar más.",
    how: "Suma del precio total de las reservas con check-out real dentro del período. Es la única cifra que cierra exacto contra cobrado + vale blanco + fiado + saldo.",
  },
  closedCollectedMoney: {
    title: "Cobrado en dinero",
    what: "De esa venta cerrada, cuánto entró en plata de verdad (efectivo, tarjetas, transferencia, Mercado Pago).",
    how: "Suma de los pagos de esas estadías, excluyendo vale blanco y los cargados como cuenta corriente (que son fiado, no cobranza).",
  },
  closedCredit: {
    title: "Fiado a cuenta corriente",
    what: "De esa venta cerrada, cuánto se fió a empresas o huéspedes con cuenta corriente. Es plata vendida que NO entró por caja y que hay que ir a cobrar después.",
    how: "Suma de los cargos a cuenta corriente generados por esas estadías al hacer el check-out.",
  },
  settlement: {
    title: "Cómo se cerró la venta",
    what: "La cuenta completa del período: toda venta cerrada terminó en una de cuatro cajas — cobrada en dinero, consumida con vale blanco, fiada a cuenta corriente, o todavía impaga.",
    how: "Venta cerrada = cobrado en dinero + vale blanco + fiado a cuenta corriente + saldo impago. Si no da exacto, el tablero avisa: hay datos inconsistentes.",
  },
  accountCollected: {
    title: "Cobranzas de cuenta corriente",
    what: "Plata que las empresas y huéspedes pagaron en el período para bajar su deuda de cuenta corriente. Corresponde a estadías viejas, por eso no está en la venta del período.",
    how: "Suma de los pagos a cuenta registrados dentro del período. No pasan por la caja ni por el arqueo.",
  },
  totalToCollect: {
    title: "Total a cobrar (hoy)",
    what: "Todo lo que te deben hoy, junto: saldos de reservas activas más deuda de cuenta corriente. Es una foto de hoy, no del período elegido.",
    how: "Saldo pendiente de reservas confirmadas o alojadas + saldo deudor de todas las cuentas corrientes.",
  },
  lodgingRevenue: {
    title: "Ingreso alojamiento (devengado)",
    what: "Lo que generaron las noches dormidas dentro del período, sin contar extras (minibar, daños, media estadía). Es devengado: cuenta la noche aunque el huésped siga alojado y todavía no haya pagado. Por eso NO coincide con la venta cerrada ni con la caja: es la base de ADR y RevPAR.",
    how: "Por cada reserva: (precio base − descuento) ÷ noches totales × las noches que caen dentro del período. Se suman todas.",
  },
  occupancyRate: {
    title: "Ocupación",
    what: "Qué tan lleno estuvo el hotel en el período. 100% = todas las habitaciones ocupadas todas las noches.",
    how: "Noches vendidas ÷ noches disponibles. Disponibles = habitaciones activas × días del período. Usa las fechas reales de entrada y salida.",
  },
  adr: {
    title: "ADR (tarifa media diaria)",
    what: "Precio promedio que efectivamente se cobró por noche vendida. Muestra si vendés caro o barato, sin que la ocupación lo tape.",
    how: "Ingreso de alojamiento ÷ noches vendidas.",
  },
  revpar: {
    title: "RevPAR (ingreso por habitación disponible)",
    what: "Cuánto rinde en promedio cada habitación del hotel, esté ocupada o no. Junta precio y ocupación en un solo número: el mejor termómetro del negocio.",
    how: "Ingreso de alojamiento ÷ noches disponibles. Equivale a ADR × ocupación.",
  },
  totalPaymentsIncome: {
    title: "Caja cobrada del período",
    what: "Todos los pagos registrados en el período, sin importar a qué reserva corresponden ni cuándo fue la estadía (incluye señas de estadías futuras y vale blanco). Es el movimiento de caja, no la venta.",
    how: "Suma de todos los pagos registrados con fecha dentro del período, en la zona horaria del hotel.",
  },
  totalPaymentsIncomeNoVale: {
    title: "Caja en dinero",
    what: "La caja del período dejando solo plata de verdad: sin vale blanco (consumo interno) y sin los pagos marcados como cuenta corriente (que son fiado).",
    how: "Suma de los pagos del período excluyendo los métodos Vale Blanco y Cuenta Corriente.",
  },
  guestNights: {
    title: "Pasajeros-noche",
    what: "Cuántas personas durmieron en el hotel en el período, contando cada noche. 2 personas × 3 noches = 6 pasajeros-noche.",
    how: "Por cada reserva no cancelada: pasajeros de la reserva × noches reales dentro del período. Se suman todas.",
  },
  avgGuestsPerNight: {
    title: "Promedio pax/noche",
    what: "Cuántas personas duermen en promedio por habitación ocupada. Cerca de 1 = viajan solos; cerca de 2+ = parejas y familias.",
    how: "Pasajeros-noche ÷ habitaciones-noche ocupadas (base física) del período.",
  },
  accountsReceivable: {
    title: "Por cobrar",
    what: "Plata pendiente de las reservas activas (confirmadas o con huésped alojado). Es una foto de hoy, no del período elegido.",
    how: "Por cada reserva activa: precio total − pagado. Se suman los saldos positivos.",
  },
  reservationsCreated: {
    title: "Reservas nuevas",
    what: "Reservas cargadas en el período, por fecha de alta (no de estadía). Mide la demanda que entró.",
    how: "Cantidad de reservas con fecha de creación dentro del período, en cualquier estado.",
  },
  cancellationRate: {
    title: "Tasa de cancelación",
    what: "De las reservas nuevas del período, qué proporción se canceló. Alta = problema de disponibilidad o de compromiso del huésped.",
    how: "Reservas canceladas ÷ reservas creadas en el período × 100.",
  },
  avgLengthOfStay: {
    title: "Estadía promedio (LOS)",
    what: "Cuántas noches se queda en promedio cada huésped. Estadías más largas = menos rotación, limpieza y trabajo de recepción.",
    how: "Promedio de noches de las estadías cuya entrada real cae dentro del período.",
  },
  avgLeadTimeDays: {
    title: "Anticipación (lead time)",
    what: "Con cuántos días de anticipación reservan, en promedio. Ayuda a anticipar la ocupación y a decidir promociones.",
    how: "Promedio de días entre la fecha de alta y la fecha de entrada, para las llegadas del período.",
  },
  currentAccountDebt: {
    title: "Deuda de cuenta corriente",
    what: "Total que las empresas y huéspedes con cuenta corriente (fiado) te deben hoy. No pasa por la caja.",
    how: "Por cada cuenta: cargos − pagos. Se suman los saldos deudores.",
  },
  cashDiscrepancy: {
    title: "Diferencias de arqueo",
    what: "Cuánto faltó o sobró al cerrar la caja en el período. Alto = errores de cobro o faltantes para revisar.",
    how: "Suma del valor absoluto de la diferencia (efectivo contado − esperado) de cada turno cerrado en el período.",
  },
  openAlerts: {
    title: "Alertas abiertas",
    what: "Incidencias operativas sin resolver (por ejemplo, una limpieza registrada sin check-out previo). Es histórico, no del período.",
    how: "Cantidad de alertas sin fecha de resolución.",
  },
  cleanings: {
    title: "Limpiezas del período",
    what: "Limpiezas registradas, clasificadas por tipo. Mide la carga de trabajo de housekeeping.",
    how: "Cantidad de registros de limpieza con fecha dentro del período, agrupados por categoría.",
  },
  dailyOccupancy: {
    title: "Ocupación por día",
    what: "Cómo varió la ocupación a lo largo del período. Sirve para ver picos y días flojos.",
    how: "Por cada día: habitaciones ocupadas ÷ habitaciones activas × 100. Usa las fechas reales de entrada y salida.",
  },
  dailyCash: {
    title: "Caja cobrada por día",
    what: "Cómo se repartieron los cobros día a día.",
    how: "Suma de los pagos de cada día, en la zona horaria del hotel.",
  },
  weekdaySeasonality: {
    title: "Estacionalidad semanal",
    what: "Qué días de la semana trabajás más. Responde '¿los fines de semana se repiten?' para planificar personal y precios.",
    how: "Se agrupan los días del período por día de la semana y se promedia la ocupación y la caja cobrada de cada uno.",
  },
  revenueByRoomType: {
    title: "Ingreso por tipo de habitación",
    what: "Qué tipo de habitación genera más ingreso de alojamiento en el período.",
    how: "Mismo cálculo que el ingreso de alojamiento, sumado por tipo de habitación.",
  },
  paymentMethods: {
    title: "Cobros por método de pago",
    what: "Con qué medios te pagan (efectivo, tarjetas, transferencia, etc.).",
    how: "Suma de los pagos del período agrupados por método.",
  },
  extraCharges: {
    title: "Ingresos extra",
    what: "Cargos por fuera del alojamiento: minibar, daños y media estadía.",
    how: "Suma de los recargos registrados en el período, agrupados por tipo.",
  },

  // ── Tablero por habitación ──
  roomOccupancy: {
    title: "Ocupación (habitación)",
    what: "Qué proporción de las noches del período estuvo ocupada esta habitación.",
    how: "Noches vendidas de la habitación ÷ días del período × 100.",
  },
  roomNights: {
    title: "Noches vendidas",
    what: "Cuántas noches se vendió esta habitación en el período.",
    how: "Suma de las noches de las estadías (fechas de tarifa) que caen dentro del período.",
  },
  roomRevenue: {
    title: "Ingreso alojamiento (habitación)",
    what: "Ingreso de alojamiento devengado que generó esta habitación, sin extras.",
    how: "(precio base − descuento) ÷ noches totales × noches en el período, sumado por habitación.",
  },
  roomAdr: {
    title: "ADR (habitación)",
    what: "Precio promedio por noche vendida de esta habitación.",
    how: "Ingreso de alojamiento de la habitación ÷ sus noches vendidas.",
  },
  roomRevpar: {
    title: "RevPAR (habitación)",
    what: "Cuánto rinde la habitación por noche disponible; junta precio y ocupación. Ideal para rankear qué habitaciones dejan más plata.",
    how: "Ingreso de alojamiento de la habitación ÷ días del período.",
  },
  roomReservations: {
    title: "Reservas",
    what: "Estadías que ocuparon esta habitación dentro del período (sin contar canceladas).",
    how: "Cantidad de reservas con noches dentro del período.",
  },
  roomCancellations: {
    title: "Cancelaciones",
    what: "Reservas de esta habitación que se cancelaron, dadas de alta en el período.",
    how: "Cantidad de reservas canceladas con fecha de alta dentro del período.",
  },
  roomCleanings: {
    title: "Limpiezas",
    what: "Veces que se limpió esta habitación en el período (carga de housekeeping).",
    how: "Cantidad de registros de limpieza de la habitación dentro del período.",
  },
} satisfies Record<string, MetricInfo>;

export type MetricKey = keyof typeof METRIC_INFO;
