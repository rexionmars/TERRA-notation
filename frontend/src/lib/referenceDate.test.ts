import { describe, expect, it } from "vitest"
import { normalizeReferenceDate } from "./referenceDate"

describe("the date of the reference imagery", () => {
  it("keeps a year, a month or a day written in ISO order", () => {
    expect(normalizeReferenceDate("2023")).toBe("2023")
    expect(normalizeReferenceDate(" 2023-03 ")).toBe("2023-03")
    expect(normalizeReferenceDate("2023-03-14")).toBe("2023-03-14")
  })

  it("turns round a day-first date and a month-first month", () => {
    expect(normalizeReferenceDate("14/03/2023")).toBe("2023-03-14")
    expect(normalizeReferenceDate("3/2023")).toBe("2023-03")
  })

  it("refuses a date that does not exist or is not a date", () => {
    expect(normalizeReferenceDate("2023-13")).toBeNull()
    expect(normalizeReferenceDate("2023-02-30")).toBeNull()
    expect(normalizeReferenceDate("30/02/2023")).toBeNull()
    expect(normalizeReferenceDate("Mar 2023")).toBeNull()
  })

  it("reads an empty field as no date recorded", () => {
    expect(normalizeReferenceDate("  ")).toBe("")
  })
})
