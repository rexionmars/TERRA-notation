import type { ColumnValue } from "./types"

const MINUS = "\u2212"
// Thousands are grouped with a narrow no-break space, the SI convention,
// which no reader confuses with a decimal mark.
const GROUP = "\u202f"

/** A number with the typographic minus. */
export function formatNumber(n: number, decimals: number): string {
  return n.toFixed(decimals).replace("-", MINUS)
}

/** A count with its thousands grouped: 8 054. */
export function formatCount(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, GROUP)
}

/** A position as the interface writes it. */
export function formatPosition(lon: number, lat: number): string {
  return `lat ${formatNumber(lat, 6)}, lon ${formatNumber(lon, 6)}`
}

/** A position as Google Maps and most tools read it: "lat, lon", ASCII. */
export function plainPosition(lon: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
}

/** A stored time in local time, ISO order. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** An attribute value as a cell shows it. */
export function formatValue(v: ColumnValue): string {
  if (v === null) return "—"
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v).replace("-", MINUS)
    return String(Number(v.toPrecision(10))).replace("-", MINUS)
  }
  return v
}

/** A length in metres or kilometres with its SI symbol. */
export function formatLength(m: number): string {
  if (m >= 1000) return `${formatNumber(m / 1000, m % 1000 === 0 ? 0 : 1)} km`
  return `${formatNumber(m, 0)} m`
}
