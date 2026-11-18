import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import * as maplibregl from "maplibre-gl"
import type {
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MLMap,
  MapLayerMouseEvent,
  SourceSpecification,
} from "maplibre-gl"
import type { FeatureCollection } from "geojson"
import { api, errorText } from "@/lib/api"
import { BASEMAPS, LABELS_TILES, levelId } from "@/lib/basemaps"
import { drawCrosshair, drawPastedMark } from "@/lib/capture"
import { formatValue } from "@/lib/format"
import type { ColumnValue, Row } from "@/lib/types"

export interface ContextLayer {
  name: string
  color: string
}

export interface MapCapture {
  canvas: HTMLCanvasElement
  /** the record's position in CSS pixels of the canvas */
  point: { x: number; y: number }
  /** the pasted location in CSS pixels, when it is in view */
  pasted: { x: number; y: number } | null
  zoom: number
}

export interface MapHandle {
  capture: () => Promise<MapCapture>
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] }

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
  const title = document.createElement("div")
  title.style.fontWeight = "600"
  title.style.marginBottom = "4px"
  title.textContent = layer
  el.appendChild(title)
  let n = 0
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === "" || n >= 8) continue
    const line = document.createElement("div")
    line.textContent = `${k}: ${formatValue(v as ColumnValue)}`
    el.appendChild(line)
    n++
  }
  return el
}

export function MapView({
  ref,
  rows,
  saved,
  selected,
  onSelect,
  basemap,
  labels,
  context,
  zoom,
  onZoomChange,
  onContextMessage,
  pasted,
  pastedRequest,
}: {
  ref?: Ref<MapHandle>
  rows: Row[]
  saved: Set<number>
  selected: Row | null
  onSelect: (fid: number) => void
  basemap: string
  labels: boolean
  context: ContextLayer[]
  zoom: number
  onZoomChange: (z: number) => void
  onContextMessage: (text: string) => void
  /** a location the reader pasted, [lon, lat] */
  pasted: [number, number] | null
  /** changes each time the map should centre on the pasted location */
  pastedRequest: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const pastedMarker = useRef<maplibregl.Marker | null>(null)
  // Layer ids with a click handler; a handler outlives its layer, so one
  // removed and added again must not get a second.
  const clickBound = useRef(new Set<string>())
  const [ready, setReady] = useState(false)
  // Read inside map callbacks, which are bound once.
  const live = useRef({ onSelect, onZoomChange, onContextMessage, context, zoom })
  live.current = { onSelect, onZoomChange, onContextMessage, context, zoom }

  useEffect(() => {
    if (!container.current) return
    const sources: Record<string, SourceSpecification> = {}
    const layers: LayerSpecification[] = []
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
        layers.push({ id, type: "raster", source: id, layout: { visibility: "none" } })
      })
    }
    sources.labels = {
      type: "raster",
      tiles: [LABELS_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri",
    }
    layers.push({
      id: "labels",
      type: "raster",
      source: "labels",
      layout: { visibility: "none" },
    })

    const map = new maplibregl.Map({
      container: container.current,
      style: { version: 8, sources, layers },
      center: [-50, -6],
      zoom: 4,
      maxZoom: 21,
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
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    )
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left")

    map.on("load", () => {
      map.addSource("records", { type: "geojson", data: EMPTY })
      map.addLayer({
        id: "records",
        type: "circle",
        source: "records",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 12, 4, 17, 6],
          "circle-color": ["case", ["get", "saved"], "#000000", "#ffffff"],
          "circle-stroke-color": ["case", ["get", "saved"], "#ffffff", "#000000"],
          "circle-stroke-width": ["case", ["get", "saved"], 1.5, 1.2],
        },
      })
      map.on("click", "records", (e) => {
        const fid = e.features?.[0]?.properties?.fid
        if (typeof fid === "number") live.current.onSelect(fid)
      })
      map.on("mouseenter", "records", () => (map.getCanvas().style.cursor = "pointer"))
      map.on("mouseleave", "records", () => (map.getCanvas().style.cursor = ""))
      setReady(true)
    })
    map.on("zoomend", () => live.current.onZoomChange(map.getZoom()))
    mapRef.current = map

    const resize = new ResizeObserver(() => map.resize())
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Basemap and labels.
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

  // The layer's points; the selected one is drawn by the crosshair instead.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.position)
        .map((r) => ({
          type: "Feature",
          id: r.fid,
          geometry: { type: "Point", coordinates: r.position as [number, number] },
          properties: { fid: r.fid, saved: saved.has(r.fid) },
        })),
    }
    void (map.getSource("records") as GeoJSONSource).setData(data)
  }, [rows, saved, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setFilter("records", selected ? ["!=", ["get", "fid"], selected.fid] : null)
    marker.current?.remove()
    marker.current = null
    if (!selected?.position) return
    marker.current = new maplibregl.Marker({ element: markElement(drawCrosshair) })
      .setLngLat(selected.position)
      .addTo(map)
    map.jumpTo({ center: selected.position, zoom: live.current.zoom })
  }, [selected, ready])

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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !pasted || pastedRequest === 0) return
    map.jumpTo({ center: pasted, zoom: live.current.zoom })
    // Only a new request moves the map; a changed record must not pull it back.
  }, [pastedRequest, ready])

  // Context layers, read for the area in view each time the map stops moving.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const ids = new Set(context.map((c) => `ctx:${c.name}`))
    for (const layer of map.getStyle().layers) {
      if (
        layer.id.startsWith("ctx:") &&
        !ids.has(layer.id.replace(/:(fill|line|point)$/, ""))
      ) {
        map.removeLayer(layer.id)
      }
    }
    for (const id of Object.keys(map.getStyle().sources)) {
      if (id.startsWith("ctx:") && !ids.has(id)) map.removeSource(id)
    }
    for (const c of context) {
      const id = `ctx:${c.name}`
      if (map.getSource(id)) continue
      map.addSource(id, { type: "geojson", data: EMPTY })
      const isArea: FilterSpecification = [
        "in",
        ["geometry-type"],
        ["literal", ["Polygon", "MultiPolygon"]],
      ]
      const isLine: FilterSpecification = [
        "in",
        ["geometry-type"],
        ["literal", ["LineString", "MultiLineString"]],
      ]
      const isPoint: FilterSpecification = [
        "in",
        ["geometry-type"],
        ["literal", ["Point", "MultiPoint"]],
      ]
      map.addLayer(
        {
          id: `${id}:fill`,
          type: "fill",
          source: id,
          filter: isArea,
          paint: { "fill-color": c.color, "fill-opacity": 0.12 },
        },
        "records"
      )
      map.addLayer(
        {
          id: `${id}:line`,
          type: "line",
          source: id,
          filter: ["any", isArea, isLine],
          paint: { "line-color": c.color, "line-width": 2 },
        },
        "records"
      )
      map.addLayer(
        {
          id: `${id}:point`,
          type: "circle",
          source: id,
          filter: isPoint,
          paint: {
            "circle-radius": 5,
            "circle-color": c.color,
            "circle-stroke-color": "#000",
            "circle-stroke-width": 1,
          },
        },
        "records"
      )
      for (const kind of ["point", "line"]) {
        const layerId = `${id}:${kind}`
        if (clickBound.current.has(layerId)) continue
        clickBound.current.add(layerId)
        map.on("click", layerId, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          if (!f) return
          new maplibregl.Popup({ closeButton: false, maxWidth: "320px" })
            .setLngLat(e.lngLat)
            .setDOMContent(popupContent(f.properties ?? {}, c.name))
            .addTo(map)
        })
      }
    }

    let timer = 0
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
        const cut: string[] = []
        for (const c of live.current.context) {
          try {
            const fc = await api.contextFeatures(c.name, bbox)
            const src = map.getSource(`ctx:${c.name}`) as GeoJSONSource | undefined
            if (src) void src.setData(fc)
            if (fc.truncated) cut.push(c.name)
          } catch (e) {
            live.current.onContextMessage(`${c.name}: ${errorText(e)}`)
            return
          }
        }
        live.current.onContextMessage(
          cut.length ? `Zoom in to see every feature of ${cut.join(", ")}.` : ""
        )
      }, 200)
    }
    load()
    map.on("moveend", load)
    return () => {
      window.clearTimeout(timer)
      map.off("moveend", load)
    }
  }, [context, ready])

  useImperativeHandle(
    ref,
    () => ({
      capture: async () => {
        const map = mapRef.current
        if (!map) throw new Error("the map is not ready")
        if (!selected?.position)
          throw new Error("the record has no position to capture")
        await idle(map)
        const p = map.project(selected.position)
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
    [selected, pasted]
  )

  // Positioned inline: MapLibre's stylesheet gives the container
  // position: relative outside any cascade layer, which beats a Tailwind class.
  return <div ref={container} style={{ position: "absolute", inset: 0 }} />
}
