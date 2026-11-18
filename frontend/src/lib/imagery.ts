import type { ImagerySource } from "./types"

/*
  Which of Esri's imagery sources the map is drawing at a zoom. Esri lists each
  source with the tile levels it is drawn at (256 px tiles). MapLibre counts
  zoom in 512 px tiles and rounds a raster source's level, so at map zoom z it
  asks for level round(z + 1). Past the finest level Esri has at the point the
  map enlarges that level (see basemaps.ts), so a level above every source's
  range is the finest source.
*/

/** The tile level MapLibre draws a 256 px raster source at, at a map zoom. */
export function tileLevel(zoom: number): number {
  return Math.round(zoom + 1)
}

/** The source drawn at a zoom; sources come finest first. */
export function sourceAt(sources: ImagerySource[], zoom: number): ImagerySource | null {
  const level = tileLevel(zoom)
  return (
    sources.find((s) => s.min_level <= level && level <= s.max_level) ??
    (sources.length > 0 && level > sources[0].max_level ? sources[0] : null)
  )
}

function metres(m: number): string {
  return m >= 1
    ? `${m.toLocaleString("en-US", { maximumFractionDigits: 1 })} m`
    : `${m} m`
}

/** "WV03, 0.31 m, Vantor": the sensor, its resolution and who provides it. */
export function describeSource(s: ImagerySource): string {
  return [
    s.sensor || s.product,
    s.resolution_m > 0 ? metres(s.resolution_m) : "",
    s.provider,
  ]
    .filter(Boolean)
    .join(", ")
}
