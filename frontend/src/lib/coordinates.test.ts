import { describe, expect, it } from "vitest"
import { distanceMeters, parseLocation, type Extent } from "./coordinates"

const at = (text: string, extent?: Extent) => {
  const r = parseLocation(text, extent)
  if (!r.ok) throw new Error(r.reason)
  return [Number(r.lat.toFixed(6)), Number(r.lon.toFixed(6)), r.swapped] as const
}

// The BR-230 corridor, roughly.
const corridor: Extent = { minLon: -65, minLat: -8.1, maxLon: -34.7, maxLat: -2.8 }

describe("parseLocation", () => {
  it("reads what Google Maps copies from its right-click menu", () => {
    expect(at("-7.546178, -63.067186")).toEqual([-7.546178, -63.067186, false])
  })
  it("reads decimal commas with a semicolon or a space between the numbers", () => {
    expect(at("-7,546178; -63,067186")).toEqual([-7.546178, -63.067186, false])
    expect(at("-7,546178 -63,067186")).toEqual([-7.546178, -63.067186, false])
  })
  it("reads degrees, minutes and seconds with hemispheres", () => {
    const [lat, lon] = at(`7°32'46.2"S 63°04'01.9"W`)
    expect(lat).toBeCloseTo(-7.546167, 5)
    expect(lon).toBeCloseTo(-63.067194, 5)
  })
  it("takes the axis from the hemisphere, whatever the order", () => {
    const [lat, lon] = at(`63°04'01.9"O 7°32'46.2"S`)
    expect(lat).toBeCloseTo(-7.546167, 5)
    expect(lon).toBeCloseTo(-63.067194, 5)
  })
  it("reads decimals with hemisphere letters", () => {
    expect(at("7.546178 S, 63.067186 W")).toEqual([-7.546178, -63.067186, false])
  })
  it("prefers the place's pin to the map centre in a Google Maps link", () => {
    const link =
      "https://www.google.com/maps/place/Escola/@-7.5400000,-63.0600000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-7.546178!4d-63.067186"
    expect(at(link)).toEqual([-7.546178, -63.067186, false])
  })
  it("reads the centre of a link without a pin, and a query parameter", () => {
    expect(at("https://www.google.com/maps/@-7.546178,-63.067186,18z")).toEqual([
      -7.546178,
      -63.067186,
      false,
    ])
    expect(
      at("https://www.google.com/maps/search/?api=1&query=-7.546178%2C-63.067186")
    ).toEqual([-7.546178, -63.067186, false])
  })
  it("reads the position as this application writes it", () => {
    expect(at("lat \u22127.546178, lon \u221263.067186 (WGS 84)")).toEqual([
      -7.546178,
      -63.067186,
      false,
    ])
  })
  it("swaps a longitude-first pair that falls inside the layer only when swapped", () => {
    expect(at("-63.067186, -7.546178", corridor)).toEqual([-7.546178, -63.067186, true])
    expect(at("-7.546178, -63.067186", corridor)).toEqual([
      -7.546178,
      -63.067186,
      false,
    ])
  })
  it("says why it cannot read the text", () => {
    const r = parseLocation("Escola Municipal")
    expect(r.ok).toBe(false)
    expect(parseLocation("-7.5, -63.0, 12").ok).toBe(false)
    expect(parseLocation("120, 200").ok).toBe(false)
  })
})

describe("distanceMeters", () => {
  it("gives about 111.2 km for one degree of latitude", () => {
    expect(distanceMeters(-63, -7, -63, -8)).toBeCloseTo(111195, -1)
  })
})
