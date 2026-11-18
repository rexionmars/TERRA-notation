import { describe, expect, it } from "vitest"
import { describeSource, sourceAt, tileLevel } from "./imagery"
import type { ImagerySource } from "./types"

// What Esri gave at Humaitá, AM, finest first.
const humaita: ImagerySource[] = [
  {
    date: "2025-04-14",
    sensor: "WV03",
    product: "Vivid",
    provider: "Vantor",
    resolution_m: 0.31,
    accuracy_m: 5,
    min_level: 12,
    max_level: 17,
  },
  {
    date: "",
    sensor: "TerraColor NextGen",
    product: "TerraColor NextGen",
    provider: "Earthstar Geographics",
    resolution_m: 15,
    accuracy_m: 12,
    min_level: 0,
    max_level: 11,
  },
]

describe("the imagery the map draws", () => {
  it("counts levels of 256 px tiles, one above MapLibre's zoom, rounded", () => {
    expect(tileLevel(16)).toBe(17)
    expect(tileLevel(10.4)).toBe(11)
    expect(tileLevel(10.6)).toBe(12)
  })

  it("is the source whose levels hold the zoom", () => {
    expect(sourceAt(humaita, 16)?.date).toBe("2025-04-14")
    expect(sourceAt(humaita, 9)?.sensor).toBe("TerraColor NextGen")
  })

  it("is the finest source past its last level, where the map enlarges it", () => {
    expect(sourceAt(humaita, 18.5)?.date).toBe("2025-04-14")
  })

  it("is unknown when Esri listed nothing", () => {
    expect(sourceAt([], 16)).toBeNull()
  })

  it("is described by sensor, resolution and provider", () => {
    expect(describeSource(humaita[0])).toBe("WV03, 0.31 m, Vantor")
    expect(describeSource(humaita[1])).toBe(
      "TerraColor NextGen, 15 m, Earthstar Geographics"
    )
  })
})
