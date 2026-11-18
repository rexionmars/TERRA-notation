import type { Row, Summary } from "./types"

/*
  Which records the list shows, and in what order.

  The random order is a permutation of every feature id of the layer, drawn
  from the project's seed, and filters keep that order. So "the first 200 in
  random order with seed 48213" names the same records on any machine, and
  narrowing the list does not reshuffle it.
*/

export type StatusFilter =
  "all" | "uncategorized" | "categorized" | "no_reference_image" | `category:${string}`

export type ListOrder = "fid" | "random"

export interface ListQuery {
  search: string
  status: StatusFilter
  order: ListOrder
  /** ids the SQL filter selected; null when no filter is applied */
  sqlIds: Set<number> | null
}

/** mulberry32, a small seeded generator; enough to shuffle a list. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A Fisher–Yates permutation of the ids, sorted first so the input order does not matter. */
export function seededOrder(fids: number[], seed: number): number[] {
  const out = [...fids].sort((a, b) => a - b)
  const rand = seededRandom(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Lower case without accents, so "sao" finds "SÃO". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function matchesStatus(s: Summary | undefined, status: StatusFilter): boolean {
  const category = s?.category ?? ""
  switch (status) {
    case "all":
      return true
    case "uncategorized":
      return category === ""
    case "categorized":
      return category !== ""
    case "no_reference_image":
      return !s?.has_reference_image
    default:
      return category === status.slice("category:".length)
  }
}

/**
 * The rows the list shows. searchColumns are the indexes of the columns the
 * search reads; hidden columns are left out of it by the caller, or a search
 * would reveal them.
 */
export function visibleRows(
  rows: Row[],
  summaries: Map<number, Summary>,
  query: ListQuery,
  searchColumns: number[],
  seed: number
): Row[] {
  const needle = fold(query.search.trim())
  const keep = rows.filter((r) => {
    if (query.sqlIds && !query.sqlIds.has(r.fid)) return false
    if (!matchesStatus(summaries.get(r.fid), query.status)) return false
    if (needle === "") return true
    if (String(r.fid) === needle) return true
    return searchColumns.some((i) => {
      const v = r.values[i]
      return v !== null && fold(String(v)).includes(needle)
    })
  })
  if (query.order === "fid") return keep
  const rank = new Map<number, number>()
  seededOrder(
    rows.map((r) => r.fid),
    seed
  ).forEach((fid, i) => rank.set(fid, i))
  return keep.sort((a, b) => (rank.get(a.fid) ?? 0) - (rank.get(b.fid) ?? 0))
}
