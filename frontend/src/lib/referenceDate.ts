/*
  The date of the imagery a reference screenshot shows, as the reference map
  gives it. Street View writes "Image capture: Mar 2023", Google Earth a full
  date; Google Maps' satellite view often gives none, which is recorded as
  "not shown" and is not the same as a date left blank.
*/

/** Mirrors annotation.ReferenceDateNotShown. */
export const REFERENCE_DATE_NOT_SHOWN = "not shown"

function exists(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/**
 * The date in the stored form (YYYY, YYYY-MM or YYYY-MM-DD), or null when the
 * text is not a date. Day-first Brazilian forms (14/03/2023, 03/2023) are
 * turned round.
 */
export function normalizeReferenceDate(text: string): string | null {
  const t = text.trim()
  if (t === "") return ""
  let m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(t)
  if (m) {
    const [, y, mo, d] = m
    if (mo === undefined) return y
    if (Number(mo) < 1 || Number(mo) > 12) return null
    if (d === undefined) return `${y}-${mo}`
    return exists(Number(y), Number(mo), Number(d)) ? t : null
  }
  m = /^(\d{1,2})\/(\d{4})$/.exec(t)
  if (m) {
    const mo = Number(m[1])
    return mo >= 1 && mo <= 12 ? `${m[2]}-${String(mo).padStart(2, "0")}` : null
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return exists(y, mo, d)
      ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      : null
  }
  return null
}
