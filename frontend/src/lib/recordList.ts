import type { Row, Summary } from "./types"

/*
  Which records the list shows, and in what order.

  The random order is a permutation of every feature id of the layer, drawn
  from the project's seed, and filters keep that order. So "the first 200 in
  random order with seed 48213" names the same records on any machine, and
  narrowing the list does not reshuffle it.
*/

export type StatusFilter =
  | "all"
  | "uncategorized"
  | "categorized"
  | "no_reference_image"
  | "sample"
  | "sample_open"
  | "sample_passed_over"
  | `category:${string}`

/**
 * "sample" is the order the layer's sample was drawn in, which for a sample
 * drawn here is the random order restricted to it, and for a second reading
 * the order its records were drawn in; with no sample it is feature id.
 */
export type ListOrder = "fid" | "random" | "sample"

export interface ListQuery {
  search: string
  status: StatusFilter
  order: ListOrder
  /** ids the SQL filter selected; null when no filter is applied */
  sqlIds: Set<number> | null
  /** the layer's sample, its ids in their order; null when it has none */
  sample: number[] | null
}

const hasCategory = (summaries: Map<number, Summary>, fid: number) =>
  (summaries.get(fid)?.category ?? "") !== ""

/**
 * The records of a sample without a category that come before its last
 * answer: passed over, where a gap can bias an estimate. Records after the
 * last answer are not reached yet. (exports.sampleStatus says the same.)
 */
export function passedOver(
  sample: number[],
  summaries: Map<number, Summary>
): Set<number> {
  let last = -1
  sample.forEach((fid, i) => {
    if (hasCategory(summaries, fid)) last = i
  })
  return new Set(sample.filter((fid, i) => i < last && !hasCategory(summaries, fid)))
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

interface SampleSets {
  members: Set<number>
  passed: Set<number>
}

function matchesStatus(
  fid: number,
  s: Summary | undefined,
  status: StatusFilter,
  sample: SampleSets
): boolean {
  const category = s?.category ?? ""
  switch (status) {
    case "all":
      return true
    case "sample":
      return sample.members.has(fid)
    case "sample_open":
      return sample.members.has(fid) && category === ""
    case "sample_passed_over":
      return sample.passed.has(fid)
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
  const sample: SampleSets = {
    members: new Set(query.sample ?? []),
    passed:
      query.status === "sample_passed_over"
        ? passedOver(query.sample ?? [], summaries)
        : new Set(),
  }
  const keep = rows.filter((r) => {
    if (query.sqlIds && !query.sqlIds.has(r.fid)) return false
    if (!matchesStatus(r.fid, summaries.get(r.fid), query.status, sample)) return false
    if (needle === "") return true
    if (String(r.fid) === needle) return true
    return searchColumns.some((i) => {
      const v = r.values[i]
      return v !== null && fold(String(v)).includes(needle)
    })
  })
  if (query.order === "fid" || (query.order === "sample" && !query.sample)) return keep
  if (query.order === "sample") {
    const place = new Map((query.sample ?? []).map((fid, i) => [fid, i]))
    const end = place.size
    return keep.sort(
      (a, b) => (place.get(a.fid) ?? end) - (place.get(b.fid) ?? end) || a.fid - b.fid
    )
  }
  const rank = new Map<number, number>()
  seededOrder(
    rows.map((r) => r.fid),
    seed
  ).forEach((fid, i) => rank.set(fid, i))
  return keep.sort((a, b) => (rank.get(a.fid) ?? 0) - (rank.get(b.fid) ?? 0))
}
