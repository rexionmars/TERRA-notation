import { describe, expect, it } from "vitest"
import { metersPerPixel, scaleBar } from "./capture"
import {
  formatCount,
  formatDuration,
  formatLength,
  formatNumber,
  formatValue,
} from "./format"
import { googlePin, googleSatellite } from "./links"
import {
  fold,
  passedOver,
  seededOrder,
  visibleRows,
  type ListQuery,
} from "./recordList"
import type { Row, Summary } from "./types"

describe("format", () => {
  it("writes negative numbers with the typographic minus", () => {
    expect(formatNumber(-7.5509, 3)).toBe("\u22127.551")
  })
  it("gives a duration in seconds, minutes or hours", () => {
    expect(formatDuration(48)).toBe("48 s")
    expect(formatDuration(600)).toBe("10 min")
    expect(formatDuration(4.5 * 3600)).toBe("4.5 h")
  })
  it("groups thousands with a narrow no-break space", () => {
    expect(formatCount(8054)).toBe("8\u202f054")
    expect(formatCount(185994)).toBe("185\u202f994")
    expect(formatCount(12)).toBe("12")
  })
  it("writes lengths with their SI symbol", () => {
    expect(formatLength(50)).toBe("50 m")
    expect(formatLength(2000)).toBe("2 km")
  })
  it("shows booleans and missing values as words and a dash", () => {
    expect(formatValue(true)).toBe("yes")
    expect(formatValue(null)).toBe("—")
  })
})

describe("links", () => {
  it("puts latitude before longitude, as Google Maps reads them", () => {
    expect(googlePin(-63.071535, -7.550917)).toContain("query=-7.550917,-63.071535")
    expect(googleSatellite(-63.071535, -7.550917)).toContain(
      "center=-7.550917,-63.071535"
    )
  })
})

describe("scale", () => {
  it("gives about 0.296 m per pixel at zoom 18 at 7.55 degrees south", () => {
    expect(metersPerPixel(-7.55, 18)).toBeCloseTo(0.296, 3)
  })
  it("picks a 1, 2 or 5 length that fits", () => {
    const b = scaleBar(0.3, 140)
    expect(b.meters).toBe(20)
    expect(b.px).toBeCloseTo(66.67, 1)
  })
})

describe("record list", () => {
  const rows: Row[] = [1, 2, 3, 4, 5].map((fid) => ({
    fid,
    position: [0, 0],
    values: [fid === 3 ? "ESCOLA SÃO JOÃO" : `ESCOLA ${fid}`],
  }))
  const summaries = new Map<number, Summary>([
    [
      2,
      {
        fid: 2,
        category: "present",
        saved: true,
        has_source_image: false,
        has_reference_image: true,
      },
    ],
  ])
  const q = (over: Partial<ListQuery>): ListQuery => ({
    search: "",
    status: "all",
    order: "fid",
    sqlIds: null,
    sample: null,
    ...over,
  })

  it("folds accents so a search without them finds names with them", () => {
    expect(fold("SÃO JOÃO")).toBe("sao joao")
    expect(
      visibleRows(rows, summaries, q({ search: "sao" }), [0], 1).map((r) => r.fid)
    ).toEqual([3])
  })
  it("filters by status", () => {
    expect(
      visibleRows(rows, summaries, q({ status: "uncategorized" }), [0], 1).map(
        (r) => r.fid
      )
    ).toEqual([1, 3, 4, 5])
    expect(
      visibleRows(rows, summaries, q({ status: "category:present" }), [0], 1).map(
        (r) => r.fid
      )
    ).toEqual([2])
  })
  it("shows the sample, its records without a category, and those passed over", () => {
    const sample = [4, 2, 1]
    const ids = (status: ListQuery["status"]) =>
      visibleRows(rows, summaries, q({ status, sample }), [0], 1).map((r) => r.fid)
    expect(ids("sample")).toEqual([1, 2, 4])
    expect(ids("sample_open")).toEqual([1, 4])
    // 4 comes before 2, the last answer of the sample; 1 is not reached yet.
    expect(ids("sample_passed_over")).toEqual([4])
    expect([...passedOver(sample, summaries)]).toEqual([4])
  })
  it("orders the sample as it was drawn, the rest after it by feature id", () => {
    const ids = visibleRows(
      rows,
      summaries,
      q({ order: "sample", sample: [4, 2, 1] }),
      [0],
      1
    ).map((r) => r.fid)
    expect(ids).toEqual([4, 2, 1, 3, 5])
  })
  it("keeps the random order when the list is narrowed", () => {
    const all = visibleRows(rows, summaries, q({ order: "random" }), [0], 48213).map(
      (r) => r.fid
    )
    const some = visibleRows(
      rows,
      summaries,
      q({ order: "random", sqlIds: new Set([1, 4, 5]) }),
      [0],
      48213
    ).map((r) => r.fid)
    expect(some).toEqual(all.filter((f) => [1, 4, 5].includes(f)))
  })
  it("draws the same permutation from the same seed whatever the input order", () => {
    expect(seededOrder([5, 3, 1, 4, 2], 7)).toEqual(seededOrder([1, 2, 3, 4, 5], 7))
    expect(seededOrder([1, 2, 3, 4, 5], 7)).not.toEqual(seededOrder([1, 2, 3, 4, 5], 8))
  })
  it("gives the order the Go side draws samples in", () => {
    // The same vectors guard annotation.SeededOrder (sample_test.go).
    const ids = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(seededOrder(ids, 48213)).toEqual([
      1, 20, 16, 9, 12, 10, 6, 8, 3, 4, 13, 5, 18, 17, 14, 19, 2, 11, 15, 7,
    ])
    expect(seededOrder([5, 3, 100, 42, 8, 1], 7)).toEqual([42, 3, 5, 8, 100, 1])
    expect(seededOrder([10, 20, 30, 40], 0)).toEqual([40, 30, 10, 20])
  })
})
