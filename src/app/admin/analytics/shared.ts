// Re-exporta los helpers de rango/presets, movidos a src/lib/date-range.ts para que
// también los use el módulo de facturación. Se mantiene este archivo para no tocar
// los imports de las dos páginas del Tablero que ya apuntan acá.

export { DATE_KEY, formatKey, resolveRange, buildPresets } from "@/lib/date-range";
export type { RangePreset } from "@/lib/date-range";
