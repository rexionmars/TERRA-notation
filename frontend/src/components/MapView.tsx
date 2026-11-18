import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import * as maplibregl from "maplibre-gl"
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MLMap,
  MapGeoJSONFeature,
  SourceSpecification,
} from "maplibre-gl"
import type { FeatureCollection } from "geojson"
import { api, errorText } from "@/lib/api"
import { BASEMAPS, LABELS_TILES, levelId } from "@/lib/basemaps"
import { drawCrosshair, drawPastedMark } from "@/lib/capture"
import { formatValue } from "@/lib/format"
import { logProblem, logProblemNow } from "@/lib/pageLog"
import type { ColumnValue } from "@/lib/types"

/** A layer of the GeoPackage drawn on the map. */
export interface MapLayer {
  name: string
  color: string
  kind: "point" | "line" | "area"
  /** the URL the whole layer is read from; null for a layer read per view */
  url: string | null
  /** a press on one of its features opens that record */
  records: boolean
  /** the property that names a feature, for the hover label */
  nameColumn: string
}

export interface MapSelection {
  layer: string
  fid: number
  position: [number, number]
}

export interface MapCapture {
  canvas: HTMLCanvasElement
  /** the selected record's position in CSS pixels of the canvas */
  point: { x: number; y: number }
  /** the pasted location in CSS pixels, when it is in view */
  pasted: { x: number; y: number } | null
  zoom: number
}

export interface MapHandle {
  capture: () => Promise<MapCapture>
  /** moves to a location with a short flight, so the reader sees where it went */
  flyTo: (lon: number, lat: number) => void
  /** one level in or out, for the map's own buttons (MapTools) */
  zoomBy: (levels: number) => void
}

/*
  The zoom a record is shown at when the map is further out than a street.
  At 16, with 256 px tiles, MapLibre asks Esri for level 17, the finest level
  its imagery has at Humaitá, Apuí and the Miguel Gustavo agrovila (levels 18
  and 19 are missing there), so the picture is sharp rather than enlarged.
*/
const RECORD_ZOOM = 16
const STREET_ZOOM = 13
// Features within this many pixels of the pointer are under it, as in TERRA.
const HIT_PX = 5
const PICKED: ExpressionSpecification = ["boolean", ["feature-state", "picked"], false]
const DONE: ExpressionSpecification = [
  "boolean",
  ["feature-state", "categorized"],
  false,
]
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] }

const sourceId = (layer: string) => `lyr:${layer}`
const layerIds = (layer: string) => ({
  fill: `lyr:${layer}:fill`,
  casing: `lyr:${layer}:casing`,
  line: `lyr:${layer}:line`,
  dot: `lyr:${layer}:dot`,
})

function markElement(
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void
): HTMLCanvasElement {
  const size = 64
  const dpr = window.devicePixelRatio || 1
  const c = document.createElement("canvas")
  c.width = size * dpr
  c.height = size * dpr
  c.style.width = `${size}px`
  c.style.height = `${size}px`
  c.style.pointerEvents = "none"
  const ctx = c.getContext("2d")
  if (ctx) draw(ctx, (size / 2) * dpr, (size / 2) * dpr, dpr)
  return c
}

function idle(map: MLMap): Promise<void> {
  if (map.loaded() && map.areTilesLoaded()) return Promise.resolve()
  return new Promise((resolve) => map.once("idle", () => resolve()))
}

function popupContent(props: Record<string, unknown>, layer: string): HTMLElement {
  const el = document.createElement("div")
  el.className = "select-text"
  const title = document.createElement("div")
  title.className = "mb-1 font-mono text-meta text-accent-quiet"
  title.textContent = layer
  el.appendChild(title)
  let n = 0
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === "" || n >= 10) continue
    const line = document.createElement("div")
    const key = document.createElement("span")
    key.className = "text-muted-foreground"
    key.textContent = `${k} `
    line.append(key, formatValue(v as ColumnValue))
    el.appendChild(line)
    n++
  }
  return el
}

/** How many tiles of each source are in each state, for the page log. */
function tileStates(map: MLMap): string {
  try {
    // An internal of MapLibre 6, read only to explain a map that never settles.
    const managers =
      (
        map as unknown as {
          style?: {
            tileManagers?: Record<
              string,
              { _tiles?: Record<string, { state?: string }> }
            >
          }
        }
      ).style?.tileManagers ?? {}
    return Object.entries(managers)
      .map(([id, m]) => {
        const n: Record<string, number> = {}
        for (const t of Object.values(m._tiles ?? {}))
          n[t.state ?? "?"] = (n[t.state ?? "?"] ?? 0) + 1
        return `${id} ${JSON.stringify(n)}`
      })
      .join("; ")
  } catch {
    return "tile states unavailable"
  }
}

// A map still loading after this long is stuck, and the page log says how.
const STUCK_MS = 20_000

function absolute(url: string): string {
  // MapLibre fetches GeoJSON in a worker, where a relative URL has no base.
  return new URL(url, window.location.href).href
}

interface Hover {
  x: number
  y: number
  text: string
  color: string
  /** the label opens to the left, near the right edge */
  left: boolean
}

export function MapView({
  ref,
  layers,
  selection,
  categorized,
  pasted,
  basemap,
  labels,
  onPick,
  onCopyPosition,
  onMessage,
  onZoom,
}: {
  ref?: Ref<MapHandle>
  layers: MapLayer[]
  selection: MapSelection | null
  /** fids with a category, by layer name */
  categorized: Record<string, number[]>
  /** a pasted location, [lon, lat] */
  pasted: [number, number] | null
  basemap: string
  labels: boolean
  onPick: (layer: string, fid: number) => void
  onCopyPosition: (lon: number, lat: number) => void
  onMessage: (text: string) => void
  /** the zoom once a change of it ends, and when the map is ready */
  onZoom?: (zoom: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const pastedMarker = useRef<maplibregl.Marker | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  // Read by handlers bound once, when the map is made.
  const live = useRef({ layers, onPick, onCopyPosition, onMessage, onZoom })
  live.current = { layers, onPick, onCopyPosition, onMessage, onZoom }
  // Feature state written so far, so a change writes only the difference.
  const applied = useRef(new Map<string, Set<number>>())
  const picked = useRef<{ source: string; id: number } | null>(null)

  useEffect(() => {
    if (!container.current) return
    const sources: Record<string, SourceSpecification> = {}
    const styleLayers: LayerSpecification[] = []
    for (const b of BASEMAPS) {
      b.levels.forEach((level, i) => {
        const id = levelId(b, i)
        sources[id] = {
          type: "raster",
          tiles: [level.tiles],
          tileSize: 256,
          maxzoom: level.maxzoom,
          attribution: b.attribution,
        }
        styleLayers.push({
          id,
          type: "raster",
          source: id,
          layout: { visibility: "none" },
          // Tiles appear as they arrive instead of fading in over 300 ms.
          paint: { "raster-fade-duration": 0 },
        })
      })
    }
    sources.labels = {
      type: "raster",
      tiles: [LABELS_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri",
    }
    styleLayers.push({
      id: "labels",
      type: "raster",
      source: "labels",
      layout: { visibility: "none" },
      paint: { "raster-fade-duration": 0 },
    })

    const map = new maplibregl.Map({
      container: container.current,
      style: { version: 8, sources, layers: styleLayers },
      center: [-50, -6],
      zoom: 4,
      maxZoom: 21,
      fadeDuration: 0,
      /*
        Raster tiles are loaded as image elements rather than with fetch. A
        tile request MapLibre cancels (every flight and every quick move
        cancels many) frees its place among the 16 it runs at once only when
        the request settles; an image element is let go at once, whatever the
        network does. The cost is that an expired tile is not fetched again
        while the map stays open.
      */
      refreshExpiredTiles: false,
      // North stays up, so a picture needs no north arrow beyond "north up".
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      // Kept so the canvas can be read for a picture at any moment.
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      attributionControl: { compact: true },
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right")

    let loadingTimer = 0
    let stuckTimer = 0
    map.on("dataloading", () => {
      window.clearTimeout(loadingTimer)
      // Shown only when loading lasts, so a cached tile does not flash the bar.
      loadingTimer = window.setTimeout(() => setLoading(true), 120)
      if (!stuckTimer)
        stuckTimer = window.setTimeout(() => {
          const c = map.getCenter()
          logProblemNow(
            `map still loading after ${STUCK_MS / 1000} s at zoom ${map.getZoom().toFixed(1)}, ` +
              `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}: ${tileStates(map)} · ${navigator.userAgent}`
          )
        }, STUCK_MS)
    })
    map.on("idle", () => {
      window.clearTimeout(loadingTimer)
      window.clearTimeout(stuckTimer)
      stuckTimer = 0
      setLoading(false)
    })
    map.on("error", (e) => {
      const src = (e as unknown as { sourceId?: string }).sourceId ?? ""
      const text = errorText(e.error)
      // A missing imagery tile is expected (see basemaps.ts): logged, not shown.
      if (src === "labels" || BASEMAPS.some((b) => src.startsWith(`${b.id}:`))) {
        logProblem(`tile error, ${src}: ${text}`)
        return
      }
      logProblem(`map error, ${src || "map"}: ${text}`)
      live.current.onMessage(`Map: ${text}`)
    })

    const hitLayers = () =>
      live.current.layers.flatMap((l) => {
        const ids = layerIds(l.name)
        return [ids.dot, ids.line].filter((id) => map.getLayer(id))
      })
    const layerOf = (f: MapGeoJSONFeature) =>
      live.current.layers.find((l) => sourceId(l.name) === f.source)
    const featureAt = (p: { x: number; y: number }): MapGeoJSONFeature | null => {
      const ids = hitLayers()
      if (ids.length === 0) return null
      const found = map.queryRenderedFeatures(
        [
          [p.x - HIT_PX, p.y - HIT_PX],
          [p.x + HIT_PX, p.y + HIT_PX],
        ],
        { layers: ids }
      )
      // Records first, so a school is pressed rather than the road under it.
      return found.find((f) => layerOf(f)?.records) ?? found[0] ?? null
    }

    let frame = 0
    map.on("mousemove", (e) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const f = featureAt(e.point)
        const l = f && layerOf(f)
        map.getCanvas().style.cursor = f ? "pointer" : ""
        if (!f || !l) {
          setHover(null)
          return
        }
        const name = f.properties?.[l.nameColumn]
        const label =
          name !== undefined && name !== null && name !== ""
            ? String(name)
            : `fid ${f.id}`
        setHover({
          x: e.point.x,
          y: e.point.y,
          text: `${label} · ${l.name}`,
          color: l.color,
          left: e.point.x > map.getCanvas().clientWidth - 240,
        })
      })
    })
    map.on("mouseout", () => setHover(null))
    map.on("click", (e) => {
      const f = featureAt(e.point)
      const l = f && layerOf(f)
      if (!f || !l) return
      if (l.records && typeof f.id === "number") {
        live.current.onPick(l.name, f.id)
        return
      }
      new maplibregl.Popup({ closeButton: false, maxWidth: "320px" })
        .setLngLat(e.lngLat)
        .setDOMContent(popupContent(f.properties ?? {}, l.name))
        .addTo(map)
    })
    map.on("contextmenu", (e) => {
      e.preventDefault()
      live.current.onCopyPosition(e.lngLat.lng, e.lngLat.lat)
    })
    map.on("load", () => {
      setReady(true)
      live.current.onZoom?.(map.getZoom())
    })
    map.on("zoomend", () => live.current.onZoom?.(map.getZoom()))
    mapRef.current = map

    const resize = new ResizeObserver(() => map.resize())
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(loadingTimer)
      window.clearTimeout(stuckTimer)
      map.remove()
      mapRef.current = null
      applied.current.clear()
      picked.current = null
      setReady(false)
    }
  }, [])

  // Basemap and place names.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const b of BASEMAPS) {
      b.levels.forEach((_, i) =>
        map.setLayoutProperty(
          levelId(b, i),
          "visibility",
          b.id === basemap ? "visible" : "none"
        )
      )
    }
    map.setLayoutProperty("labels", "visibility", labels ? "visible" : "none")
  }, [basemap, labels, ready])

  // The GeoPackage's layers: added, removed and stacked to match the list.
  const layersKey = layers
    .map((l) => `${l.name}|${l.color}|${l.url}|${l.records}`)
    .join("\n")
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const wanted = new Set(layers.map((l) => sourceId(l.name)))
    for (const layer of map.getStyle().layers) {
      const src = "source" in layer ? String(layer.source) : ""
      if (src.startsWith("lyr:") && !wanted.has(src)) map.removeLayer(layer.id)
    }
    for (const id of Object.keys(map.getStyle().sources)) {
      if (id.startsWith("lyr:") && !wanted.has(id)) {
        map.removeSource(id)
        applied.current.delete(id)
        if (picked.current?.source === id) picked.current = null
      }
    }
    for (const l of layers) {
      const src = sourceId(l.name)
      const ids = layerIds(l.name)
      if (!map.getSource(src)) {
        map.addSource(src, { type: "geojson", data: l.url ? absolute(l.url) : EMPTY })
        applied.current.delete(src)
      }
      if (l.kind === "area" && !map.getLayer(ids.fill))
        map.addLayer({
          id: ids.fill,
          type: "fill",
          source: src,
          paint: { "fill-color": l.color, "fill-opacity": 0.12 },
        })
      if (l.kind !== "point" && !map.getLayer(ids.line)) {
        map.addLayer({
          id: ids.casing,
          type: "line",
          source: src,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#141414", "line-opacity": 0.6, "line-width": 3 },
        })
        map.addLayer({
          id: ids.line,
          type: "line",
          source: src,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": l.color, "line-width": l.kind === "line" ? 2 : 1.25 },
        })
      }
      if (l.kind === "point" && !map.getLayer(ids.dot))
        map.addLayer({
          id: ids.dot,
          type: "circle",
          source: src,
          paint: {
            "circle-color": l.color,
            "circle-radius": ["case", PICKED, 7, 4.5],
            "circle-stroke-color": ["case", DONE, "#ffffff", "#141414"],
            "circle-stroke-width": ["case", DONE, 2, 1],
          },
        })
    }
    // Areas at the bottom, then lines, then points; the record layers on top.
    const rank = (l: MapLayer) =>
      (l.kind === "area" ? 0 : l.kind === "line" ? 1 : 2) + (l.records ? 3 : 0)
    for (const l of [...layers].sort((a, b) => rank(a) - rank(b))) {
      const ids = layerIds(l.name)
      for (const id of [ids.fill, ids.casing, ids.line, ids.dot])
        if (map.getLayer(id)) map.moveLayer(id)
    }
  }, [layersKey, ready])

  // Layers too large to send whole are read for the area in view.
  const perViewKey = layers
    .filter((l) => l.url === null)
    .map((l) => l.name)
    .join("\n")
  useEffect(() => {
    const map = mapRef.current
    const names = perViewKey ? perViewKey.split("\n") : []
    if (!map || !ready || names.length === 0) return
    let timer = 0
    let cancelled = false
    const load = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        const b = map.getBounds()
        const bbox = {
          min_x: b.getWest(),
          min_y: b.getSouth(),
          max_x: b.getEast(),
          max_y: b.getNorth(),
        }
        setLoading(true)
        try {
          const results = await Promise.all(
            names.map((n) => api.contextFeatures(n, bbox))
          )
          if (cancelled) return
          const cut: string[] = []
          results.forEach((fc, i) => {
            const src = map.getSource(sourceId(names[i])) as GeoJSONSource | undefined
            if (src) void src.setData(fc)
            if (fc.truncated) cut.push(names[i])
          })
          live.current.onMessage(
            cut.length ? `Zoom in to see every feature of ${cut.join(", ")}.` : ""
          )
        } catch (e) {
          live.current.onMessage(errorText(e))
        } finally {
          if (!cancelled) setLoading(false)
        }
      }, 100)
    }
    load()
    map.on("moveend", load)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      map.off("moveend", load)
    }
  }, [perViewKey, ready])

  // Records with a category carry a white ring.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const l of layers) {
      if (!l.records) continue
      const src = sourceId(l.name)
      if (!map.getSource(src)) continue
      const want = new Set(categorized[l.name] ?? [])
      const had = applied.current.get(src) ?? new Set<number>()
      for (const id of had)
        if (!want.has(id))
          map.setFeatureState({ source: src, id }, { categorized: false })
      for (const id of want)
        if (!had.has(id))
          map.setFeatureState({ source: src, id }, { categorized: true })
      applied.current.set(src, want)
    }
  }, [categorized, layersKey, ready])

  // The selected record: a larger dot, the crosshair, and the map moved to it.
  const selectionKey = selection
    ? `${selection.layer}:${selection.fid}:${selection.position.join(",")}`
    : ""
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (picked.current && map.getSource(picked.current.source))
      map.setFeatureState(picked.current, { picked: false })
    picked.current = null
    marker.current?.remove()
    marker.current = null
    if (!selection) return
    const target = { source: sourceId(selection.layer), id: selection.fid }
    if (map.getSource(target.source)) {
      map.setFeatureState(target, { picked: true })
      picked.current = target
    }
    marker.current = new maplibregl.Marker({ element: markElement(drawCrosshair) })
      .setLngLat(selection.position)
      .addTo(map)
    const z = map.getZoom()
    map.jumpTo({ center: selection.position, zoom: z < STREET_ZOOM ? RECORD_ZOOM : z })
  }, [selectionKey, layersKey, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    pastedMarker.current?.remove()
    pastedMarker.current = null
    if (!pasted) return
    pastedMarker.current = new maplibregl.Marker({
      element: markElement(drawPastedMark),
    })
      .setLngLat(pasted)
      .addTo(map)
  }, [pasted, ready])

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (levels) => {
        const map = mapRef.current
        if (map) map.zoomTo(map.getZoom() + levels, { duration: 200 })
      },
      flyTo: (lon, lat) => {
        const map = mapRef.current
        if (!map) return
        const z = map.getZoom()
        map.flyTo({
          center: [lon, lat],
          zoom: z < STREET_ZOOM ? RECORD_ZOOM : z,
          duration: 800,
        })
      },
      capture: async () => {
        const map = mapRef.current
        if (!map) throw new Error("the map is not ready")
        if (!selection) throw new Error("no record is selected")
        await idle(map)
        const p = map.project(selection.position)
        const canvas = map.getCanvas()
        let pastedAt: MapCapture["pasted"] = null
        if (pasted) {
          const q = map.project(pasted)
          if (
            q.x >= 0 &&
            q.y >= 0 &&
            q.x <= canvas.clientWidth &&
            q.y <= canvas.clientHeight
          )
            pastedAt = { x: q.x, y: q.y }
        }
        return {
          canvas,
          point: { x: p.x, y: p.y },
          pasted: pastedAt,
          zoom: map.getZoom(),
        }
      },
    }),
    [selection, pasted]
  )

  return (
    <>
      {/* Positioned inline: MapLibre's stylesheet gives the container
          position: relative outside any cascade layer, which beats a Tailwind class. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/20">
          <div className="map-loading h-full w-1/3 bg-primary" />
        </div>
      )}
      {hover && (
        <div
          className="map-chrome pointer-events-none absolute z-20 max-w-[320px] truncate rounded-sm border border-[rgb(var(--p-line)/0.28)] px-2 py-0.5 text-label whitespace-nowrap text-foreground shadow-[0_2px_8px_rgb(0_0_0/0.28)]"
          style={
            hover.left
              ? { right: `calc(100% - ${hover.x - 12}px)`, top: hover.y + 12 }
              : { left: hover.x + 12, top: hover.y + 12 }
          }
        >
          <span
            className="mr-1.5 inline-block size-2 rounded-full border border-black/60 align-middle"
            style={{ background: hover.color }}
          />
          {hover.text}
        </div>
      )}
    </>
  )
}
