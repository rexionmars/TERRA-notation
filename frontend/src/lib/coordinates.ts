/*
  Reading a location pasted by the reader, in the forms it is copied in:

  - "-7.546178, -63.067186", what Google Maps copies from its right-click menu;
  - decimal commas, "-7,546178; -63,067186" or "-7,546178 -63,067186";
  - degrees, minutes and seconds, 7°32'46.2"S 63°04'01.9"W, as Google Maps shows
    a dropped pin; hemispheres in English or Portuguese (N, S, E/L, W/O);
  - a Google Maps link: the place's own pin (!3d…!4d…), a q=, query=, center=
    or viewpoint= parameter, or the map centre after @;
  - this application's own "lat \u22127.546178, lon \u221263.067186 (WGS 84)".

  Numbers without hemispheres are latitude then longitude, Google's order. When
  that reading falls far from the layer and the other order falls inside it,
  the pair is read the other way round, and the result says so.
*/

export interface Extent {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export type ParsedLocation =
  | { ok: true; lon: number; lat: number; swapped: boolean }
  | { ok: false; reason: string }

/** Mean Earth radius (IUGG), in metres. */
const EARTH_RADIUS = 6371008.8

/** Great-circle distance in metres; within 0.5 % of the ellipsoid's. */
export function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

function normalize(text: string): string {
  return text
    .replace(/[\u2212–—]/g, "-")
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/''/g, '"')
    .replace(/º/g, "°")
    .trim()
}

const num = (s: string) => Number(s.replace(",", "."))

/** [lat, lon] from a Google Maps link, or null. */
function fromLink(text: string): [number, number] | null {
  let s = text
  try {
    s = decodeURIComponent(text)
  } catch {
    // a malformed escape: read the link as it is
  }
  const n = String.raw`(-?\d+(?:\.\d+)?)`
  const pin = s.match(new RegExp(String.raw`!3d${n}!4d${n}`))
  if (pin) return [Number(pin[1]), Number(pin[2])]
  const param = s.match(
    new RegExp(
      String.raw`[?&](?:q|query|center|ll|viewpoint|destination|daddr)=${n},\s*${n}`
    )
  )
  if (param) return [Number(param[1]), Number(param[2])]
  const at = s.match(new RegExp(String.raw`@${n},${n}`))
  if (at) return [Number(at[1]), Number(at[2])]
  return null
}

type Axis = "lat" | "lon" | null

interface Value {
  v: number
  axis: Axis
}

function hemisphere(letter: string | undefined, v: number): Value {
  switch (letter) {
    case "N":
      return { v: Math.abs(v), axis: "lat" }
    case "S":
      return { v: -Math.abs(v), axis: "lat" }
    case "E":
    case "L":
      return { v: Math.abs(v), axis: "lon" }
    case "W":
    case "O":
      return { v: -Math.abs(v), axis: "lon" }
    default:
      return { v, axis: null }
  }
}

const DMS =
  /(-)?(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*'\s*)?(?:(\d+(?:[.,]\d+)?)\s*"\s*)?([NSEWLO](?![A-Za-z]))?/g

const DECIMAL = /(-?\d+(?:[.,]\d+)?)\s*°?\s*([NSEWLO](?![A-Za-z]))?/g

function values(text: string): Value[] {
  if (text.includes("°")) {
    const out: Value[] = []
    for (const m of text.matchAll(DMS)) {
      const deg =
        num(m[2]) + (m[3] ? num(m[3]) / 60 : 0) + (m[4] ? num(m[4]) / 3600 : 0)
      out.push(hemisphere(m[5], m[1] ? -deg : deg))
    }
    return out
  }
  // Labels that carry numbers of their own, and a zoom such as "17z".
  const cleaned = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/WGS\s*84|SIRGAS\s*2000|EPSG:\d+/gi, " ")
    .replace(/\b\d+(?:\.\d+)?z\b/g, " ")
  const parts = cleaned.includes(";") ? cleaned.split(";") : [cleaned]
  const out: Value[] = []
  for (const part of parts) {
    for (const m of part.matchAll(DECIMAL)) out.push(hemisphere(m[2], num(m[1])))
  }
  return out
}

function inside(lon: number, lat: number, e: Extent, pad = 1): boolean {
  return (
    lon >= e.minLon - pad &&
    lon <= e.maxLon + pad &&
    lat >= e.minLat - pad &&
    lat <= e.maxLat + pad
  )
}

export function parseLocation(input: string, extent?: Extent | null): ParsedLocation {
  const text = normalize(input)
  if (!text) return { ok: false, reason: "Nothing to read." }

  let lat: number
  let lon: number
  let axisKnown = false
  const link = fromLink(text)
  if (link) {
    ;[lat, lon] = link
    axisKnown = true
  } else {
    const vals = values(text)
    if (vals.length !== 2) {
      return {
        ok: false,
        reason: `Expected two numbers, latitude and longitude; found ${vals.length}.`,
      }
    }
    const [a, b] = vals
    if (a.axis && b.axis && a.axis === b.axis) {
      return { ok: false, reason: "Both values carry a hemisphere of the same axis." }
    }
    if (a.axis === "lon" || b.axis === "lat") {
      lat = b.v
      lon = a.v
    } else {
      lat = a.v
      lon = b.v
    }
    axisKnown = a.axis !== null || b.axis !== null
  }

  let swapped = false
  if (!axisKnown) {
    const asGiven = Math.abs(lat) <= 90 && (!extent || inside(lon, lat, extent))
    const reversed = Math.abs(lon) <= 90 && (!extent || inside(lat, lon, extent))
    if (!asGiven && reversed) {
      ;[lat, lon] = [lon, lat]
      swapped = true
    }
  }
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return { ok: false, reason: "The numbers are not a latitude and a longitude." }
  }
  return { ok: true, lon, lat, swapped }
}
