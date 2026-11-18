import { describe, expect, it } from "vitest"
import { metersPerPixel, scaleBar } from "./capture"
import { formatCount, formatLength, formatNumber, formatValue } from "./format"
import { googlePin, googleSatellite } from "./links"
import { fold, seededOrder, visibleRows, type ListQuery } from "./recordList"
import type { Row, Summary } from "./types"

describe("format", () => {
  it("writes negative numbers with the typographic minus", () => {
    expect(formatNumber(-7.5509, 3)).toBe("\u22127.551")
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
    near: null,
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
  it("orders by distance to a pasted point, and by id without one", () => {
    const placed: Row[] = [
      { fid: 1, position: [-63.0, -7.0], values: ["far"] },
      { fid: 2, position: [-63.0, -7.5001], values: ["near"] },
      { fid: 3, position: null, values: ["no position"] },
      { fid: 4, position: [-63.01, -7.5], values: ["middle"] },
    ]
    expect(
      visibleRows(
        placed,
        summaries,
        q({ order: "distance", near: [-63.0, -7.5] }),
        [0],
        1
      ).map((r) => r.fid)
    ).toEqual([2, 4, 1, 3])
    expect(
      visibleRows(placed, summaries, q({ order: "distance" }), [0], 1).map((r) => r.fid)
    ).toEqual([1, 2, 3, 4])
  })
  it("draws the same permutation from the same seed whatever the input order", () => {
    expect(seededOrder([5, 3, 1, 4, 2], 7)).toEqual(seededOrder([1, 2, 3, 4, 5], 7))
    expect(seededOrder([1, 2, 3, 4, 5], 7)).not.toEqual(seededOrder([1, 2, 3, 4, 5], 8))
  })
})
