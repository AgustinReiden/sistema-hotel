"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileText, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import DateRangeFilter from "@/app/admin/DateRangeFilter";
import PaginationFooter from "@/app/admin/PaginationFooter";
import StickyActionBar from "@/app/admin/StickyActionBar";
import { usePagination } from "@/app/admin/usePagination";
import { cbteLetra, formatCbteNumero, isValidCuit } from "@/lib/arca/amounts";
import { buildBillingPresets } from "@/lib/date-range";
import { formatAmount } from "@/lib/format";
import {
  DETALLE_LINEA_MAX,
  DETALLE_NOTA_MAX,
  countSelectedOffPage,
  defaultStayDescription,
  sanitizeDetalleLine,
} from "@/lib/billing";
import type {
  CcAccountStayRow,
  CtaCteAccount,
  CtaCteClientKind,
  FiscalSettings,
  InvoiceReceptorPrefill,
  ReceptorCondicionCuit,
} from "@/lib/types";
import { emitConsolidatedInvoiceAction, loadCcAccountStaysAction } from "./actions";
import ConsolidadaConfirmModal, { type ConsolidadaDocumento } from "./ConsolidadaConfirmModal";

/** Lo de la configuración fiscal que dice el cuadro "Revisá antes de emitir". */
export type ConsolidadaFiscal = Pick<
  FiscalSettings,
  "environment" | "punto_venta" | "dias_vto_cuenta_corriente"
>;

type Props = {
  enabled: boolean;
  accounts: CtaCteAccount[];
  /** Datos de facturación por ficha, indexados `${kind}:${id}` (mig 81). */
  billingProfiles: Record<string, InvoiceReceptorPrefill>;
  /**
   * El cliente viene siempre de la URL: page.tsx manda a Control si falta. Si la URL
   * cambia de cliente sin salir de la página, Next cambia estas props sin desmontar.
   */
  preselectKind: CtaCteClientKind;
  preselectId: string;
  /** "Hoy" en zona del hotel, calculado en el servidor: base de los presets. */
  todayKey: string;
  /** null si no se pudo leer la configuración fiscal. */
  fiscal: ConsolidadaFiscal | null;
};

const CONDICION_IVA_LABEL: Record<ReceptorCondicionCuit, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "IVA Sujeto Exento",
};


function shortDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function openInvoicePrint(invoiceId: string) {
  if (typeof window === "undefined") return;
  window.open(`/admin/factura/${invoiceId}?autoprint=1`, `factura-${invoiceId}`, "width=420,height=720");
}

/** Etiqueta del comprobante que ya cubre una estadía. */
function coberturaLabel(r: CcAccountStayRow): string | null {
  if (r.estado === "facturado_externo") {
    return `Facturada afuera${r.external_ref ? `: ${r.external_ref}` : ""}`;
  }
  if (r.estado === "en_proceso") return "Factura en proceso";
  if (r.cbte_tipo !== null && r.cbte_nro !== null && r.pto_vta !== null) {
    const fecha = r.cbte_fch ? ` · ${shortDate(r.cbte_fch)}` : "";
    return `Factura ${cbteLetra(r.cbte_tipo)} ${formatCbteNumero(r.pto_vta, r.cbte_nro)}${fecha}`;
  }
  return r.facturable ? null : "Ya facturada";
}

const inputClass =
  "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all";

/**
 * Texto por defecto del concepto único (mig 102). Es lo que piden las empresas que
 * no quieren ver habitaciones ni fechas en la factura: una sola línea por el total.
 */
const CONCEPTO_UNICO_DEFAULT = "Alojamiento";

/** Pastilla del interruptor de forma del detalle, mismo estilo que los presets. */
function pillClass(activa: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
    activa
      ? "border-brand-600 bg-brand-600 text-white"
      : "border-slate-200 bg-white text-slate-600 hover:border-brand-400 hover:text-brand-700"
  }`;
}

/** Un dato del receptor que falta: `campo` va en la barra, `mensaje` en el toast. */
type FaltanteReceptor = { campo: string; mensaje: string };

/** ["CUIT", "domicilio"] → "CUIT y domicilio". */
function listarFaltantes(campos: string[]): string {
  if (campos.length <= 1) return campos[0] ?? "";
  return `${campos.slice(0, -1).join(", ")} y ${campos[campos.length - 1]}`;
}

export default function ConsolidadaClient({
  enabled,
  accounts,
  billingProfiles,
  preselectKind,
  preselectId,
  todayKey,
  fiscal,
}: Props) {
  // Sin selector: el cliente es el de la URL. Para elegir otro se vuelve a Control.
  const kind = preselectKind;
  const id = preselectId;
  const selectedKey = `${kind}:${id}`;
  const cuenta = accounts.find((a) => a.kind === kind && a.id === id) ?? null;
  const [rows, setRows] = useState<CcAccountStayRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // La última carga de la lista falló: la lista vacía no quiere decir que el cliente no
  // tenga estadías (después de una emisión incierta, eso se leería como "salió").
  const [errorCarga, setErrorCarga] = useState(false);
  // Después de una emisión con resultado incierto, la próxima carga que ande no tilda
  // nada (ver emitConfirmado): si la factura salió, lo que se tildaría es justo lo que
  // se había dejado afuera a propósito. Es un ref porque lo lee `loadRows` y no se pinta.
  const sinTildarEnLaProximaCarga = useRef(false);
  const [emitting, setEmitting] = useState(false);
  // La última emisión quedó sin respuesta: no se sabe si la factura salió. El toast se va
  // solo, y quien factura puede estar atendiendo a alguien; este aviso queda arriba de la
  // lista hasta la próxima emisión o hasta que lo cierren.
  const [emisionIncierta, setEmisionIncierta] = useState(false);
  // Cuadro "Revisá antes de emitir" abierto. El botón de la barra sólo lo abre: a ARCA
  // se va recién desde "Confirmar y emitir en ARCA".
  const [revisando, setRevisando] = useState(false);
  // Anti doble click de la emisión: el ref corta aunque el segundo click llegue antes
  // del render que deshabilita el botón.
  const emisionEnCurso = useRef(false);
  // La última carga de la lista que se pidió. Cambiar el período (una fecha tipeada pide
  // una carga por dígito), «Recargar» o la emisión arrancan otra sin esperar a la que
  // está en camino, y pueden contestar en cualquier orden. Vale sólo la última: una
  // respuesta vieja no pinta su lista ni apaga «Cargando…», porque eso habilitaba
  // «Revisar y emitir» con estadías de otro período mientras la última seguía en camino.
  // El número se sube antes de pedir nada, así una carga sabe si quedó vieja; la promesa
  // es la de la última, para que la vieja conteste lo mismo que ella.
  const numeroCarga = useRef(0);
  const ultimaCarga = useRef<Promise<boolean> | null>(null);

  // Rango del listado. Vacío = "Todo", que es el default a propósito: el caso
  // normal sigue siendo "facturame todo lo que debe", y un rango puesto de
  // arranque escondería deuda sin que nadie lo haya pedido.
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  // Estadías que tiene la cuenta entera, para poder decir "N de M". Se guarda de
  // la última carga sin rango; el servidor sólo devuelve lo filtrado.
  const [totalStays, setTotalStays] = useState<number | null>(null);
  // Qué se pinta en la lista: sólo lo que falta facturar (default, para no abrir
  // en un pozo de historial) o la cuenta entera. Es un filtro de PANTALLA, no va
  // al servidor: `rows` ya trae todo lo del rango elegido.
  const [estadoFiltro, setEstadoFiltro] = useState<"pendientes" | "todas">("pendientes");
  // Ancla del shift+click. Es un índice sobre la lista filtrada por estado
  // (`visible`), así que se invalida cada vez que esa lista cambia (otro cliente,
  // otro rango, otro filtro, recarga) o cuando la página se movió y el índice
  // guardado ya no cae en la página que se está viendo (ver handleRowClick).
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  const rangoActivo = range.from !== "" || range.to !== "";
  const presets = useMemo(() => buildBillingPresets(todayKey), [todayKey]);

  const isCompany = kind === "company";
  const profile = billingProfiles[selectedKey] ?? null;

  // Receptor: se precarga de la ficha y el admin puede corregirlo antes de emitir.
  const [razonSocial, setRazonSocial] = useState(profile?.razonSocial ?? "");
  const [cuit, setCuit] = useState(profile?.cuit ?? "");
  const [condicionIva, setCondicionIva] = useState<ReceptorCondicionCuit | "">(profile?.condicionIva ?? "");
  const [domicilio, setDomicilio] = useState(profile?.domicilio ?? "");

  // Detalle impreso: texto por estadía + nota al pie (mig 93). Los importes NO se
  // editan, salen del cargo de cuenta corriente.
  // Se guardan sólo los textos que el admin cambió; el resto se deriva en el
  // render. Así "restaurar" es vaciar el mapa y no hay estado que sincronizar
  // cada vez que cambia la selección.
  const [detalleOverrides, setDetalleOverrides] = useState<Record<string, string>>({});
  const [nota, setNota] = useState("");

  // Forma del detalle impreso (mig 102): detallado (default, lo de siempre) o una
  // sola línea por el total. El modo y su texto son dos estados de PANTALLA, pero al
  // servidor va una sola cosa: el texto, o nada. Así no se puede mandar "prendido y
  // vacío", que es el estado imposible que la columna única evita en la base.
  //
  // Se elige a mano en cada factura y NO se guarda en la ficha del cliente: una
  // preferencia vieja prendida sin que nadie la mire manda una factura colapsada sin
  // querer, y una factura emitida no se corrige, se anula con nota de crédito.
  const [conceptoUnicoModo, setConceptoUnicoModo] = useState(false);
  const [conceptoUnicoTexto, setConceptoUnicoTexto] = useState(CONCEPTO_UNICO_DEFAULT);

  const lineaDetalle = (r: CcAccountStayRow) =>
    detalleOverrides[r.reservation_id] ?? defaultStayDescription(r);

  /**
   * Carga la lista y devuelve si pudo. No tira nunca: si la acción no contesta (se
   * cortó la red, hubo un deploy con la pantalla abierta), la lista no puede quedar en
   * «Cargando…» con «Recargar» deshabilitado. La emisión con resultado incierto mira
   * lo que devuelve para no prometer una lista que no se cargó.
   *
   * Si mientras tanto se pidió otra carga, esta respuesta se descarta (ver ultimaCarga)
   * y lo que devuelve es lo de esa otra, que es la lista que va a quedar a la vista.
   */
  const loadRows = useCallback((): Promise<boolean> => {
    const numero = ++numeroCarga.current;
    const promesa = (async (): Promise<boolean> => {
      setLastClickedIndex(null);
      // La recarga vuelve a tildar todo lo pendiente (abajo): un cuadro de revisión
      // abierto pasaría a decir otra cosa que lo que se revisó. Se cierra.
      setRevisando(false);
      setLoading(true);
      setErrorCarga(false);
      let result: Awaited<ReturnType<typeof loadCcAccountStaysAction>>;
      try {
        // Los vacíos van como undefined, no como "": el filtro por período es
        // opcional en la RPC (mig 90) y sin rango devuelve la cuenta entera.
        result = await loadCcAccountStaysAction(
          kind,
          id,
          range.from || undefined,
          range.to || undefined
        );
      } catch {
        result = {
          success: false,
          error:
            "No pudimos cargar la lista. Revisá la conexión y volvé a intentar; si sigue sin cargar, recargá la página.",
        };
      }
      // Llegó tarde: después de esta se pidió otra, que es la que manda. Esta no toca
      // nada (ni «Cargando…», ni la lista, ni lo tildado, ni el aviso de emisión incierta)
      // y contesta lo que conteste la última.
      if (numero !== numeroCarga.current) return ultimaCarga.current ?? false;
      setLoading(false);
      // Se cierra también al terminar, no sólo al arrancar: la lista que sigue no es la
      // que se revisó.
      setRevisando(false);
      if (!result.success) {
        toast.error(result.error);
        setRows([]);
        setPicked(new Set());
        setErrorCarga(true);
        return false;
      }
      const data = result.data ?? [];
      setRows(data);
      // Sin rango, lo que vino ES la cuenta entera: es la única carga que puede
      // fijar el "de M" del contador.
      if (!range.from && !range.to) setTotalStays(data.length);
      // Por defecto se selecciona todo lo pendiente: el caso normal es
      // "facturame todo lo que debe". Salvo la primera carga que anda después de una
      // emisión incierta: ahí no se tilda nada y cada estadía se vuelve a elegir a mano.
      if (sinTildarEnLaProximaCarga.current) {
        sinTildarEnLaProximaCarga.current = false;
        setPicked(new Set());
      } else {
        setPicked(new Set(data.filter((r) => r.facturable).map((r) => r.reservation_id)));
      }
      return true;
    })();
    ultimaCarga.current = promesa;
    return promesa;
  }, [kind, id, range.from, range.to]);

  useEffect(() => {
    // La llamada va en una función anidada (no `loadRows` directo) porque
    // `loadRows` setea estado y el linter (react-hooks/set-state-in-effect)
    // marca cualquier setState alcanzable desde el efecto, aunque sea
    // post-await; este es el patrón recomendado por React para fetch-in-effect.
    async function run() {
      await loadRows();
    }
    void run();
  }, [loadRows]);

  // Si la URL cambia de cliente (Next no desmonta la página, le cambia las props),
  // se reinicia todo lo que era "de este cliente": los datos fiscales vuelven a los
  // de la ficha nueva (el valor inicial ya sale de `profile` arriba) y el rango
  // vuelve a "Todo".
  //
  // Se compara por `selectedKey` y NO por la identidad de `profile`: dos clientes
  // sin ficha de facturación resuelven los dos a null, así que mirando `profile`
  // el cambio pasaba desapercibido y los datos tipeados para el anterior quedaban
  // pegados en el formulario. En una pantalla que emite comprobantes reales eso
  // significa poder facturarle a uno con el CUIT del otro.
  //
  // El rango vuelve a "Todo" porque un período que tenía sentido para un cliente
  // mostraría al siguiente sin deuda; además es la única carga que puede fijar el
  // "de M" del contador.
  //
  // Se ajusta durante el render, no en un efecto, para no pintar primero los
  // datos del cliente anterior y recién después los nuevos.
  const [prevSelectedKey, setPrevSelectedKey] = useState(selectedKey);
  if (selectedKey !== prevSelectedKey) {
    setPrevSelectedKey(selectedKey);
    setRazonSocial(profile?.razonSocial ?? "");
    setCuit(profile?.cuit ?? "");
    setCondicionIva(profile?.condicionIva ?? "");
    setDomicilio(profile?.domicilio ?? "");
    setNota("");
    setRange({ from: "", to: "" });
    setTotalStays(null);
    // Vuelve a "Pendientes": es el default con el que se abre cualquier cuenta,
    // no una preferencia que se arrastra de un cliente al siguiente.
    setEstadoFiltro("pendientes");
    // La forma del detalle también vuelve al default: es una decisión por factura,
    // no una preferencia del cliente (mig 102).
    setConceptoUnicoModo(false);
    setConceptoUnicoTexto(CONCEPTO_UNICO_DEFAULT);
    // Un cuadro de revisión abierto era del cliente anterior, y el aviso de emisión
    // incierta habla de su lista.
    setRevisando(false);
    setEmisionIncierta(false);
  }

  const facturables = useMemo(() => rows.filter((r) => r.facturable), [rows]);

  // Lo que se pinta según el filtro de estado. "Pendientes" es exactamente
  // `facturables`: por eso "Seleccionar todo" y el indeterminate, que siguen
  // basándose en `facturables` más abajo, ya reflejan la lista filtrada sin
  // necesidad de otra cuenta aparte (ninguna fila no-facturable es tildable en
  // ningún filtro, así que el universo de lo seleccionable no cambia con esto).
  const visible = useMemo(
    () => (estadoFiltro === "pendientes" ? facturables : rows),
    [estadoFiltro, facturables, rows]
  );

  // Paginación en memoria sobre `visible`: `rows`/`facturables` siguen enteros
  // para el contador y la selección, esto sólo decide qué filas se pintan. La
  // huella junta cliente, rango y filtro de estado: cualquiera de los tres que
  // cambie vuelve a la página 1.
  const {
    rows: pagina,
    setPage,
    ...paginacion
  } = usePagination(visible, `${selectedKey}|${range.from}|${range.to}|${estadoFiltro}`);

  // Cambiar el filtro de estado reordena `visible` (otra lista, no sólo otra
  // página de la misma). El índice del ancla quedaría apuntando a una fila
  // distinta sin que nadie haya paginado, así que se invalida acá. Cliente y
  // rango ya lo hacen en `loadRows`, que corre antes de pintar la lista nueva.
  const [prevEstadoFiltro, setPrevEstadoFiltro] = useState(estadoFiltro);
  if (estadoFiltro !== prevEstadoFiltro) {
    setPrevEstadoFiltro(estadoFiltro);
    setLastClickedIndex(null);
  }

  // INVARIANTE que hace seguro al filtro por período: lo seleccionado se DERIVA
  // de `rows`, nunca se acumula aparte. Al angostar el rango, las estadías que
  // salen de la lista dejan de contar solas: no se puede emitir un comprobante
  // con algo que no está a la vista. Si esto pasara a ser un estado propio
  // (p. ej. "guardar la selección entre filtros"), se podría facturar a ciegas.
  //
  // Las líneas se muestran en el mismo orden en que se van a imprimir (la factura
  // ordena por fecha de entrada), no en el de la lista, que va del más reciente.
  const selectedRows = useMemo(
    () =>
      rows
        .filter((r) => picked.has(r.reservation_id))
        .slice()
        .sort((a, b) => a.fch_desde.localeCompare(b.fch_desde)),
    [rows, picked]
  );

  const total = selectedRows.reduce((sum, r) => sum + r.amount, 0);
  // La empresa siempre se factura con CUIT. Un huésped, sólo si su ficha tiene
  // condición IVA cargada (mig 81); si no, B con DNI, que es el default de siempre.
  const requiereCuit = isCompany || condicionIva !== "";
  const letra = !requiereCuit ? "B" : condicionIva === "exento" ? "B" : "A";

  // El período va de la primera entrada a la última salida, igual que el servidor
  // (LEAST/GREATEST), no del primer al último elemento de la lista.
  const periodo =
    selectedRows.length > 0
      ? {
          desde: selectedRows.reduce((min, r) => (r.fch_desde < min ? r.fch_desde : min), selectedRows[0].fch_desde),
          hasta: selectedRows.reduce((max, r) => (r.fch_hasta > max ? r.fch_hasta : max), selectedRows[0].fch_hasta),
        }
      : null;

  // Única fuente de verdad de "¿está completo el receptor?": la usan la barra
  // flotante (para deshabilitar el botón y decir qué falta ANTES de apretarlo) y
  // revisar() (para no mandarle a ARCA un comprobante incompleto). Si estuviera
  // duplicada, la barra podría habilitar algo que revisar() después rebota.
  const faltantesReceptor = useMemo<FaltanteReceptor[]>(() => {
    if (!requiereCuit) return [];
    const faltan: FaltanteReceptor[] = [];
    if (!condicionIva) {
      faltan.push({ campo: "condición IVA", mensaje: "Elegí la condición frente al IVA." });
    }
    if (!isValidCuit(cuit.replace(/\D/g, ""))) {
      // Vacío y mal cargado no son lo mismo: como el botón ahora queda
      // deshabilitado, el toast con el motivo no llega a dispararse nunca, así
      // que la distinción tiene que estar en la barra.
      faltan.push({
        campo: cuit.trim() === "" ? "CUIT" : "CUIT válido",
        mensaje: "El CUIT no es válido (11 dígitos con dígito verificador).",
      });
    }
    if (!razonSocial.trim()) {
      faltan.push({ campo: "razón social", mensaje: "Ingresá la razón social." });
    }
    if (!domicilio.trim()) {
      faltan.push({ campo: "domicilio", mensaje: "Ingresá el domicilio del receptor." });
    }
    return faltan;
  }, [requiereCuit, condicionIva, cuit, razonSocial, domicilio]);

  /**
   * Un solo camino para marcar/desmarcar: el onClick vive en el <li> y el
   * checkbox va controlado con un onChange no-op. Apretar Espacio con el checkbox
   * enfocado dispara un click que burbujea hasta el <li>, así que el teclado sigue
   * andando y no hay riesgo de doble toggle (con dos handlers, un click sobre el
   * checkbox contaría dos veces y la fila quedaría como estaba).
   */
  const handleRowClick = (localIndex: number, event: React.MouseEvent) => {
    // `localIndex` es la posición dentro de `pagina`; el ancla y el rango de
    // extensión se manejan en índices de `visible` (la lista filtrada entera),
    // así que se traduce con el offset de la página actual.
    const index = paginacion.firstIndex - 1 + localIndex;
    const row = visible[index];
    if (!row?.facturable) return;
    const shiftKey = event.shiftKey;
    // Sin esto, el shift+click deja al navegador pintando texto de punta a punta
    // (mismo tratamiento que en el Control de facturación).
    if (shiftKey) window.getSelection()?.removeAllRanges();
    const value = !picked.has(row.reservation_id);
    // Shift+click extiende desde el ancla: todas las FACTURABLES del tramo toman
    // el valor que acaba de tomar la fila clickeada. El ancla no se mueve, para
    // poder ir agrandando y achicando el mismo tramo. Pero sólo si el ancla sigue
    // cayendo en la página que se está viendo: si se paginó desde el último
    // click, el índice guardado ya no señala una fila visible y extender
    // tildaría estadías que nadie llegó a ver.
    const anchorEnPagina =
      lastClickedIndex !== null &&
      lastClickedIndex >= paginacion.firstIndex - 1 &&
      lastClickedIndex <= paginacion.lastIndex - 1;
    const extiende = shiftKey && anchorEnPagina;
    const desde = extiende ? Math.min(lastClickedIndex as number, index) : index;
    const hasta = extiende ? Math.max(lastClickedIndex as number, index) : index;

    setPicked((current) => {
      const next = new Set(current);
      for (let i = desde; i <= hasta; i++) {
        const r = visible[i];
        if (!r?.facturable) continue;
        if (value) next.add(r.reservation_id);
        else next.delete(r.reservation_id);
      }
      return next;
    });
    if (!extiende) setLastClickedIndex(index);
  };

  const toggleAll = () => {
    setPicked((current) =>
      current.size === facturables.length
        ? new Set()
        : new Set(facturables.map((r) => r.reservation_id))
    );
  };

  // `indeterminate` no es un atributo de HTML, sólo una propiedad del nodo: hay
  // que escribirla a mano. Es el estado "hay algo tildado, pero no todo".
  const todasRef = useRef<HTMLInputElement>(null);
  const todasTildadas = facturables.length > 0 && picked.size === facturables.length;
  useEffect(() => {
    if (todasRef.current) {
      todasRef.current.indeterminate = picked.size > 0 && picked.size < facturables.length;
    }
  }, [picked, facturables.length]);

  /**
   * Estadías tildadas que NO están en la página que se está viendo. A diferencia
   * del Control de facturación, acá no se excluyen de la emisión —`selectedRows`
   * ya sale de `rows` entero, no de la página— así que esto es puro aviso: sin él,
   * alguien puede apretar "Emitir" pensando que sólo van las 5 filas a la vista
   * cuando en realidad van 12, y una factura ya emitida no se corrige, se anula
   * con nota de crédito.
   */
  const fueraDePagina = useMemo(
    () => countSelectedOffPage(visible, pagina, picked),
    [visible, pagina, picked]
  );
  const avisoFueraDePagina =
    fueraDePagina > 0 ? (
      <span className="text-amber-700">
        Tenés {fueraDePagina} {fueraDePagina === 1 ? "estadía tildada" : "estadías tildadas"} en
        otras páginas: se incluyen igual en el total y en la factura.
      </span>
    ) : null;

  // La sección del receptor, para que "Completar" pueda traerla a la vista.
  const receptorRef = useRef<HTMLElement>(null);

  const restoreDetalle = () => {
    setDetalleOverrides({});
    setNota("");
    setConceptoUnicoTexto(CONCEPTO_UNICO_DEFAULT);
    toast.success("Detalle restaurado.");
  };

  // Nota y concepto tal como van a ARCA. Se calculan una vez para el cuadro y para
  // emitConfirmado(): lo que se lee en "Revisá antes de emitir" es lo que se manda.
  const notaLimpia = sanitizeDetalleLine(nota, DETALLE_NOTA_MAX);
  // Si el admin borró el texto, vale el default que muestra el placeholder: lo
  // mismo que ya hacen las líneas por estadía cuando quedan vacías. Mandar vacío
  // sería peor, porque en el servidor NULL significa "detallado" y el impreso
  // saldría distinto de lo que la pantalla venía mostrando.
  const conceptoUnicoLimpio = conceptoUnicoModo
    ? sanitizeDetalleLine(conceptoUnicoTexto) ?? CONCEPTO_UNICO_DEFAULT
    : null;
  // Líneas por estadía con un texto escrito a mano: salen impresas tal cual, así que el
  // cuadro no puede decir que llevan la habitación y las fechas. Una que quedó vacía no
  // cuenta: el servidor le pone el texto automático (mig 93).
  const lineasEditadas =
    conceptoUnicoLimpio !== null
      ? 0
      : selectedRows.filter((r) => {
          const texto = sanitizeDetalleLine(lineaDetalle(r));
          return texto !== null && texto !== sanitizeDetalleLine(defaultStayDescription(r));
        }).length;

  // Receptor que muestra el cuadro. Sin CUIT (huésped consumidor final) el servidor
  // factura con el nombre y el DNI de la ficha del huésped (mig 103). Para que eso sea
  // lo que de verdad sale, emitConfirmado() manda 'consumidor_final' explícito: si no,
  // la RPC cae en la condición de la ficha y, con la ficha en RI/monotributo/exento,
  // emitiría con CUIT aunque el cuadro diga DNI (decisión del 24/09, la misma regla que
  // la mig 112 en la factura de check-out: la ficha precarga, no decide el comprobante).
  const receptorNombre = requiereCuit ? razonSocial.trim() : cuenta?.name ?? "";
  const documento: ConsolidadaDocumento = requiereCuit
    ? { tipo: "CUIT", numero: cuit.replace(/\D/g, "") }
    : { tipo: "DNI", numero: cuenta?.document_id ?? null };
  const condicionIvaLabel = condicionIva ? CONDICION_IVA_LABEL[condicionIva] : "Consumidor Final";

  /**
   * El botón de la barra: valida y abre "Revisá antes de emitir". No manda nada a
   * ARCA. Se llama con `void revisar()` para que pueda volverse async sin tocar el
   * botón: la fase C de remitos (C2) va a consultar acá los remitos faltantes antes
   * de abrir el cuadro.
   */
  const revisar = () => {
    // Con la lista recargándose, la selección está por cambiar (la recarga vuelve a
    // tildar todo lo pendiente): no se revisa algo que no es lo que va a quedar.
    if (loading) return;
    if (selectedRows.length === 0) {
      toast.error("Seleccioná al menos una estadía.");
      return;
    }
    // Mismos faltantes que muestra la barra, en el mismo orden: con el botón
    // deshabilitado esto no debería dispararse nunca, pero se revalida igual
    // porque el estado pudo cambiar entre el render y el click.
    if (faltantesReceptor.length > 0) {
      toast.error(faltantesReceptor[0].mensaje);
      return;
    }
    setRevisando(true);
  };

  /** "Confirmar y emitir en ARCA": recién acá se emite, y una sola vez. */
  const emitConfirmado = async () => {
    if (emitting || emisionEnCurso.current) return;
    // Se revalida al emitir, como hace revisar() al abrir: el receptor pudo cambiar con el
    // cuadro abierto. Y lo vacío no llega vacío a ARCA: la RPC lo completa con la ficha
    // (mig 103), así que saldría otra letra, otro CUIT u otro nombre que los del cuadro.
    // Se cierra el cuadro para que se vea la barra con lo que falta.
    if (faltantesReceptor.length > 0) {
      toast.error(faltantesReceptor[0].mensaje);
      setRevisando(false);
      return;
    }
    emisionEnCurso.current = true;
    // El aviso de una emisión incierta anterior queda viejo: si esta también se corta,
    // vuelve a salir.
    setEmisionIncierta(false);

    setEmitting(true);
    let result: Awaited<ReturnType<typeof emitConsolidatedInvoiceAction>> | null = null;
    try {
      result = await emitConsolidatedInvoiceAction({
        kind,
        clientId: id,
        reservationIds: selectedRows.map((r) => r.reservation_id),
        // Una forma o la otra, nunca las dos: con un solo concepto, las líneas por
        // estadía no se imprimen, así que mandar sus textos sería guardar en el
        // comprobante algo que nadie eligió ni va a ver.
        ...(conceptoUnicoLimpio
          ? { conceptoUnico: conceptoUnicoLimpio }
          : {
              detalle: selectedRows.map((r) => ({
                reservationId: r.reservation_id,
                // Si quedó vacío, el servidor pone el texto automático.
                descripcion: sanitizeDetalleLine(lineaDetalle(r)) ?? "",
              })),
            }),
        ...(notaLimpia ? { nota: notaLimpia } : {}),
        // La condición viaja siempre explícita. Sin CUIT sólo puede ser un huésped (la
        // empresa siempre lo requiere) y va 'consumidor_final': omitida, la RPC toma la
        // de la ficha y emitiría Factura A con el CUIT de la ficha lo que el cuadro
        // mostró como B con DNI (decisión del 24/09, como la mig 112 en el check-out).
        ...(requiereCuit
          ? {
              cuit: cuit.replace(/\D/g, ""),
              condicionIva: condicionIva as ReceptorCondicionCuit,
              razonSocial: razonSocial.trim(),
              domicilio: domicilio.trim(),
            }
          : { condicionIva: "consumidor_final" as const }),
      });
    } catch {
      // La acción no llegó a contestar: se cortó la red, la función tardó de más o
      // hubo un deploy con la pantalla abierta. Queda `null`: no se sabe si salió.
    } finally {
      // Pase lo que pase, el cuadro no puede quedar trabado diciendo "no cierres
      // esta ventana".
      setEmitting(false);
      emisionEnCurso.current = false;
      setRevisando(false);
    }

    if (result === null) {
      // No se reintenta solo: si la factura salió, emitirla de nuevo sería la segunda.
      // La pregunta es qué salió, y se contesta con lo que queda en "Pendientes de
      // facturar": lo facturado o "en proceso" deja de ser facturable y desaparece de ahí
      // (en "Todas" podría quedar en otra página). Por eso se vuelve a ese filtro.
      setEstadoFiltro("pendientes");
      // La recarga vuelve a tildar todo lo pendiente: si la factura salió, lo que queda
      // tildado es justo lo que se había dejado afuera a propósito, con "Revisar y
      // emitir" listo. Después de un resultado incierto no queda nada tildado: ni
      // mientras recarga, ni si la recarga también falla (la red sigue cortada), ni en
      // la próxima carga que ande, sea esta o un «Recargar» de más tarde.
      setPicked(new Set());
      sinTildarEnLaProximaCarga.current = true;
      const recargada = await loadRows();
      // El aviso sale después de la recarga: sólo promete la lista si se pudo cargar.
      // El toast se va solo; el aviso fijo arriba de la lista queda (ver emisionIncierta).
      setEmisionIncierta(true);
      toast.error(
        recargada
          ? "No sabemos si la factura salió porque se cortó la comunicación. Te dejamos la lista en «Pendientes de facturar» y sin nada tildado. Si las estadías que ibas a facturar ya no están ahí, la factura se generó: no la emitas de nuevo y fijate en Facturación si quedó emitida, pendiente o rechazada. Si siguen ahí, volvé a tildarlas y emitila."
          : "No sabemos si la factura salió porque se cortó la comunicación, y tampoco pudimos volver a cargar la lista. No la emitas de nuevo todavía: cuando vuelva la conexión, cargá la lista otra vez y fijate en Facturación si salió antes de volver a emitir.",
        { duration: 15000 }
      );
      return;
    }

    if (!result.success) {
      toast.error(result.error);
      await loadRows();
      return;
    }

    const outcome = result.data;
    if (outcome?.status === "authorized" && outcome.invoiceId) {
      toast.success(`Factura ${letra} ${outcome.numero ?? ""} emitida (${outcome.count} estadías).`);
      openInvoicePrint(outcome.invoiceId);
    } else {
      toast.warning(outcome?.userMessage ?? "La factura quedó pendiente. Revisala en Facturación.");
    }
    await loadRows();
  };

  if (!enabled) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <p className="text-sm text-slate-500">
          La facturación electrónica no está habilitada. Activala en Ajustes → Facturación electrónica.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1) Cliente: de solo lectura. Se entra siempre con el cliente puesto (desde
          Control, Cuentas o la ficha); para facturarle a otro se vuelve a Control. */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
            Cliente de cuenta corriente
          </p>
          <p className="text-lg font-bold text-slate-800 break-words">{cuenta?.name ?? "—"}</p>
          {cuenta && (
            <p className="text-xs text-slate-500">
              {isCompany ? "Empresa" : "Huésped"} · saldo {formatAmount(cuenta.balance)}
            </p>
          )}
        </div>
        <Link
          href="/admin/fiscal/control"
          className="shrink-0 text-sm font-semibold text-brand-700 hover:underline"
        >
          Elegir otro cliente
        </Link>
      </section>

      {/* Emisión con resultado incierto: queda a la vista aunque el toast ya se haya ido.
          El texto sigue a la lista: si no se pudo cargar, no se promete nada sobre ella. */}
      {emisionIncierta && (
        <div
          role="alert"
          aria-label="No sabemos si la factura salió"
          className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-2xl p-4"
        >
          <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-semibold text-rose-800">
              {errorCarga
                ? "No sabemos si la última factura salió porque se cortó la comunicación, y tampoco pudimos volver a cargar la lista. No la emitas de nuevo todavía: cuando vuelva la conexión, cargá la lista otra vez y fijate en Facturación si salió antes de volver a emitir."
                : "No sabemos si la última factura salió porque se cortó la comunicación. Si las estadías que ibas a facturar ya no están en «Pendientes de facturar», la factura se generó: no la emitas de nuevo y fijate en Facturación si quedó emitida, pendiente o rechazada. Si siguen ahí, volvé a tildarlas y emitila."}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
              <Link href="/admin/fiscal" className="text-brand-700 hover:underline">
                Ir a Facturación
              </Link>
              <button
                type="button"
                onClick={() => setEmisionIncierta(false)}
                className="text-rose-700 underline hover:text-rose-900"
              >
                Cerrar el aviso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2) Estadías de la cuenta: pendientes y ya facturadas */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">Estadías de la cuenta</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Se factura el cargo a cuenta corriente de cada estadía, no el total de la reserva.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRows()}
            disabled={loading}
            className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors"
            title="Recargar"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* El filtro va afuera del if de carga: si se esconde cuando no hay
              resultados, no queda nada que explique por qué la lista está
              vacía ni cómo volver a "Todo". */}
          <div>
            <DateRangeFilter
              from={range.from}
              to={range.to}
              presets={presets}
              onChange={(from, to) => setRange({ from, to })}
              allowAll
            />
            <p
              className={`text-xs mt-2 ${rangoActivo ? "font-semibold text-amber-700" : "text-slate-400"}`}
            >
              Mostrando {rows.length} de {totalStays ?? rows.length} estadías de la cuenta
              {rangoActivo ? " (hay un período puesto)." : "."}
            </p>
          </div>

          {/* Filtro de estado: abre en "Pendientes" para no aterrizar en dos
              años de historial. Va afuera del if de carga por lo mismo que el
              de período: si se esconde con la lista vacía, no queda nada que
              explique el vacío ni cómo salir de él. */}
          {rows.length > 0 && (
            <div role="group" aria-label="Filtro por estado de facturación" className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={estadoFiltro === "pendientes"}
                onClick={() => setEstadoFiltro("pendientes")}
                className={pillClass(estadoFiltro === "pendientes")}
              >
                Pendientes de facturar
              </button>
              <button
                type="button"
                aria-pressed={estadoFiltro === "todas"}
                onClick={() => setEstadoFiltro("todas")}
                className={pillClass(estadoFiltro === "todas")}
              >
                Todas
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-4">Cargando…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              {rows.length === 0 ? (
                errorCarga ? (
                  <>
                    No pudimos cargar la lista. Revisá la conexión.{" "}
                    <button
                      type="button"
                      onClick={() => void loadRows()}
                      className="underline font-bold text-slate-600 hover:text-slate-800"
                    >
                      Volver a cargar la lista
                    </button>
                  </>
                ) : rangoActivo ? (
                  "No hay estadías en este período. Probá con «Todo» para ver la cuenta entera."
                ) : (
                  "Este cliente no tiene estadías cargadas a cuenta corriente."
                )
              ) : (
                <>
                  No hay estadías pendientes de facturar: las {rows.length} de esta cuenta ya
                  están cubiertas.{" "}
                  <button
                    type="button"
                    onClick={() => setEstadoFiltro("todas")}
                    className="underline font-bold text-slate-600 hover:text-slate-800"
                  >
                    Ver todas
                  </button>
                </>
              )}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                  <input
                    ref={todasRef}
                    type="checkbox"
                    // Nombre fijo: el texto visible alterna entre "Seleccionar"
                    // y "Deseleccionar", y un lector de pantalla ya anuncia el
                    // estado por `checked`/`indeterminate`.
                    aria-label="Seleccionar todas las estadías"
                    checked={todasTildadas}
                    onChange={toggleAll}
                    disabled={facturables.length === 0}
                    className="w-4 h-4 accent-emerald-600 disabled:cursor-not-allowed"
                  />
                  {todasTildadas ? "Deseleccionar todo" : "Seleccionar todo"}
                </label>
                <span className="text-xs text-slate-400">
                  {facturables.length} sin facturar · {rows.length - facturables.length} ya cubiertas
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {pagina.map((r, index) => {
                  const cobertura = coberturaLabel(r);
                  const tildada = picked.has(r.reservation_id);
                  return (
                    <li
                      key={r.reservation_id}
                      onClick={r.facturable ? (e) => handleRowClick(index, e) : undefined}
                      className={`py-2.5 px-2 -mx-2 rounded-lg flex items-center gap-3 transition-colors ${
                        r.facturable
                          ? `cursor-pointer ${tildada ? "bg-emerald-50" : "hover:bg-slate-50"}`
                          : "opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={tildada}
                        // No-op a propósito: el toggle lo hace el onClick del
                        // <li>, al que este click (o el Espacio del teclado)
                        // burbujea. Ver handleRowClick.
                        onChange={() => {}}
                        disabled={!r.facturable}
                        className="w-4 h-4 accent-emerald-600 shrink-0 disabled:cursor-not-allowed"
                        aria-label={`Incluir estadía de habitación ${r.room_number ?? "?"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          Hab. {r.room_number ?? "—"} · {shortDate(r.fch_desde)} → {shortDate(r.fch_hasta)}
                          {r.passenger ? ` · ${r.passenger}` : ""}
                        </p>
                        {r.facturable && r.mixed_payment && (
                          <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={11} className="shrink-0" />
                            Pago mixto: se factura sólo el cargo a cuenta ({formatAmount(r.amount)} de{" "}
                            {formatAmount(r.total_price)}).
                          </p>
                        )}
                        {cobertura && (
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">{cobertura}</p>
                        )}
                      </div>
                      <span className="text-sm font-bold text-slate-700 shrink-0">{formatAmount(r.amount)}</span>
                    </li>
                  );
                })}
              </ul>
              <PaginationFooter
                {...paginacion}
                noun="estadías"
                onPageChange={setPage}
                note={avisoFueraDePagina}
              />
            </>
          )}
        </div>
      </section>

      {/* 3) Detalle impreso (mig 93; la forma, mig 102) */}
      {selectedRows.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-800">Detalle del comprobante</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Es el texto que sale impreso. Los importes no se editan: salen del cargo a cuenta
                corriente. Una vez emitida, el detalle no se puede cambiar.
              </p>
            </div>
            <button
              type="button"
              onClick={restoreDetalle}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <RotateCcw size={13} /> Restaurar
            </button>
          </div>

          {/* Interruptor de forma (mig 102). El default es "Detallado": el modo de
              siempre. Cambiar de modo no borra nada, sólo cambia qué se muestra y
              qué se va a imprimir. */}
          <div>
            <div role="group" aria-label="Forma del detalle impreso" className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!conceptoUnicoModo}
                onClick={() => setConceptoUnicoModo(false)}
                className={pillClass(!conceptoUnicoModo)}
              >
                Detallado
              </button>
              <button
                type="button"
                aria-pressed={conceptoUnicoModo}
                onClick={() => setConceptoUnicoModo(true)}
                className={pillClass(conceptoUnicoModo)}
              >
                Un solo concepto
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              {conceptoUnicoModo
                ? "Sale UNA línea por el total: no figuran las habitaciones ni las fechas de cada estadía. El período sí, al pie."
                : "Sale una línea por estadía, con su habitación y sus fechas."}
            </p>
          </div>

          {conceptoUnicoModo ? (
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={conceptoUnicoTexto}
                maxLength={DETALLE_LINEA_MAX}
                onChange={(e) => setConceptoUnicoTexto(e.target.value)}
                // Si se borra, se imprime esto: mismo trato que las líneas por estadía.
                placeholder={CONCEPTO_UNICO_DEFAULT}
                className={`${inputClass} text-sm`}
                aria-label="Texto del concepto único"
              />
              <span className="text-sm font-bold text-slate-700 shrink-0 w-28 text-right">
                {formatAmount(total)}
              </span>
            </div>
          ) : (
            <ul className="space-y-2">
              {selectedRows.map((r) => (
                <li key={r.reservation_id} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={lineaDetalle(r)}
                    maxLength={DETALLE_LINEA_MAX}
                    onChange={(e) =>
                      setDetalleOverrides((current) => ({
                        ...current,
                        [r.reservation_id]: e.target.value,
                      }))
                    }
                    placeholder={defaultStayDescription(r)}
                    className={`${inputClass} text-sm`}
                    aria-label={`Descripción de la estadía de habitación ${r.room_number ?? "?"}`}
                  />
                  <span className="text-sm font-bold text-slate-700 shrink-0 w-28 text-right">
                    {formatAmount(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-nota">
              Nota al pie <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="cons-nota"
              type="text"
              value={nota}
              maxLength={DETALLE_NOTA_MAX}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej.: Orden de compra 4512"
              className={inputClass}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {nota.length}/{DETALLE_NOTA_MAX} caracteres.
            </p>
          </div>
        </section>
      )}

      {/* 4) Receptor + emisión */}
      {facturables.length > 0 && (
        <section
          ref={receptorRef}
          className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4"
        >
          <h3 className="text-base font-bold text-slate-800">Datos del receptor</h3>

          {!isCompany && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-iva-guest">
                Condición frente al IVA
              </label>
              <select
                id="cons-iva-guest"
                value={condicionIva}
                onChange={(e) => setCondicionIva(e.target.value as ReceptorCondicionCuit | "")}
                className={`${inputClass} md:w-1/2`}
              >
                <option value="">Consumidor final — Factura B con DNI</option>
                <option value="responsable_inscripto">Responsable Inscripto</option>
                <option value="monotributo">Monotributo</option>
                <option value="exento">IVA Sujeto Exento</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Sale precargada de la ficha del huésped. Si la cambiás acá, queda guardada.
              </p>
            </div>
          )}

          {requiereCuit ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-razon">
                  Razón social
                </label>
                <input
                  id="cons-razon"
                  type="text"
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-cuit">
                  CUIT
                </label>
                <input
                  id="cons-cuit"
                  type="text"
                  inputMode="numeric"
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="11 dígitos"
                  className={inputClass}
                />
              </div>
              {/* El huésped ya eligió su condición arriba; acá sólo va para empresas. */}
              {isCompany && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-iva">
                    Condición frente al IVA
                  </label>
                  <select
                    id="cons-iva"
                    value={condicionIva}
                    onChange={(e) => setCondicionIva(e.target.value as ReceptorCondicionCuit | "")}
                    className={inputClass}
                  >
                    <option value="">Elegí…</option>
                    <option value="responsable_inscripto">Responsable Inscripto</option>
                    <option value="monotributo">Monotributo</option>
                    <option value="exento">IVA Sujeto Exento</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-domicilio">
                  Domicilio
                </label>
                <input
                  id="cons-domicilio"
                  type="text"
                  value={domicilio}
                  onChange={(e) => setDomicilio(e.target.value)}
                  className={inputClass}
                />
              </div>
              <p className="md:col-span-2 text-[11px] text-slate-500">
                Se precargan de la ficha. Lo que completes acá queda guardado en la ficha.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Se emite <strong>Factura B</strong> con el DNI de la ficha del huésped. Si el DNI está
              mal, corregilo en Huéspedes antes de emitir.
            </p>
          )}
        </section>
      )}

      {/* 5) Barra flotante: con 20 estadías, el total y el botón quedaban al
          fondo de todo. Se muestra según la SELECCIÓN, no según `facturables`,
          porque lo que importa es qué se está por emitir. */}
      <StickyActionBar visible={selectedRows.length > 0}>
        <div
          role="region"
          aria-label="Resumen de la factura consolidada"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800">
              {selectedRows.length} estadía{selectedRows.length === 1 ? "" : "s"} · Total {formatAmount(total)}
            </p>
            <p className="text-xs text-slate-400">
              Factura {letra} · período{" "}
              {periodo ? `${shortDate(periodo.desde)} → ${shortDate(periodo.hasta)}` : "—"}
              {/* El botón de emitir está acá, así que la forma del impreso tiene que
                  verse acá: es lo último que se mira antes de apretar. */}
              {conceptoUnicoModo ? " · un solo concepto" : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* El botón ahora está siempre a la vista, así que la barra tiene que
                decir por qué no se puede emitir ANTES de apretarlo, no después
                con un toast. */}
            {faltantesReceptor.length > 0 && (
              <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                <AlertTriangle size={13} className="shrink-0" />
                Falta: {listarFaltantes(faltantesReceptor.map((f) => f.campo))}
                <button
                  type="button"
                  onClick={() =>
                    receptorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                  className="underline font-bold hover:text-amber-900"
                >
                  Completar
                </button>
              </p>
            )}
            {/* No emite: abre "Revisá antes de emitir". A ARCA se va desde el cuadro. */}
            <button
              type="button"
              onClick={() => void revisar()}
              disabled={
                emitting || loading || selectedRows.length === 0 || faltantesReceptor.length > 0
              }
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-2"
            >
              {emitting ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
              Revisar y emitir factura consolidada
            </button>
          </div>
        </div>
      </StickyActionBar>

      {revisando && selectedRows.length > 0 && (
        <ConsolidadaConfirmModal
          letra={letra}
          receptorNombre={receptorNombre}
          documento={documento}
          condicionIvaLabel={condicionIvaLabel}
          estadias={selectedRows.length}
          total={total}
          periodo={periodo}
          conceptoUnico={conceptoUnicoLimpio}
          lineasEditadas={lineasEditadas}
          nota={notaLimpia}
          fueraDePagina={fueraDePagina}
          // Sin la configuración fiscal a mano se asume producción: la banda roja
          // es la que no puede faltar si la factura es real.
          environment={fiscal?.environment ?? "produccion"}
          puntoVenta={fiscal?.punto_venta ?? null}
          diasVto={fiscal?.dias_vto_cuenta_corriente ?? 30}
          emitting={emitting}
          // Mismo criterio que el botón de la barra: con el receptor incompleto no se emite,
          // aunque haya quedado incompleto recién con el cuadro abierto.
          bloquearConfirmar={faltantesReceptor.length > 0}
          onConfirm={() => void emitConfirmado()}
          onCancel={() => setRevisando(false)}
        />
      )}
    </div>
  );
}
