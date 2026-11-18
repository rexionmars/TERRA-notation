import { formatLength, formatPosition, formatTime } from "./format"

/*
  The picture of the application's map that is kept as the layer-side
  screenshot. Under the map it carries a strip that makes the picture readable
  on its own, away from the application: which record, where, on what basemap,
  when, at what scale, and what each mark means. Every line of it comes from the
  record and the map's state, none is typed.
*/

const EARTH_CIRCUMFERENCE = 40075016.686
// MapLibre's tiles are 512 px at zoom 0.
const TILE_SIZE = 512

/** Metres per CSS pixel at a latitude and zoom in Web Mercator. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (
    (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom)
  )
}

/** The longest 1, 2 or 5 × 10ⁿ metres that fits in maxPx. */
export function scaleBar(mpp: number, maxPx: number): { meters: number; px: number } {
  const maxMeters = mpp * maxPx
  const pow = 10 ** Math.floor(Math.log10(maxMeters))
  const meters = [5, 2, 1].map((s) => s * pow).find((m) => m <= maxMeters) ?? pow
  return { meters, px: meters / mpp }
}

export interface LegendItem {
  label: string
  kind: "crosshair" | "pasted" | "categorized" | "line" | "point" | "area"
  color?: string
}

export interface CaptureCaption {
  title: string
  subtitle: string
  lon: number
  lat: number
  basemap: string
  zoom: number
  /** what the provider says of the imagery at the record, when it says anything */
  imagery?: string
  legend: LegendItem[]
}

const FONT = "Helvetica, Arial, sans-serif"
const YELLOW = "#F0E442"

/** The crosshair drawn on the live map and on the picture alike. */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number
) {
  const inner = 9 * s
  const outer = 26 * s
  const arms: [number, number, number, number][] = [
    [x - outer, y, x - inner, y],
    [x + inner, y, x + outer, y],
    [x, y - outer, x, y - inner],
    [x, y + inner, x, y + outer],
  ]
  ctx.lineCap = "round"
  for (const [w, color] of [
    [5 * s, "#000"],
    [2.5 * s, YELLOW],
  ] as const) {
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.beginPath()
    for (const [x1, y1, x2, y2] of arms) {
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
    }
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(x, y, 2.5 * s, 0, Math.PI * 2)
  ctx.fillStyle = YELLOW
  ctx.fill()
  ctx.lineWidth = 1.2 * s
  ctx.strokeStyle = "#000"
  ctx.stroke()
}

const BLUE = "#56B4E9"

/**
 * The mark of a pasted location: a diamond, so it differs from the record's
 * crosshair by shape as well as by colour.
 */
export function drawPastedMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number
) {
  const r = 11 * s
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.PI / 4)
  for (const [w, color] of [
    [5 * s, "#000"],
    [2.5 * s, BLUE],
  ] as const) {
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.strokeRect(
      -r / Math.SQRT2,
      -r / Math.SQRT2,
      (2 * r) / Math.SQRT2,
      (2 * r) / Math.SQRT2
    )
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(x, y, 2 * s, 0, Math.PI * 2)
  ctx.fillStyle = BLUE
  ctx.fill()
  ctx.lineWidth = 1 * s
  ctx.strokeStyle = "#000"
  ctx.stroke()
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + "…").width > width) t = t.slice(0, -1)
  return t + "…"
}

function drawLegendMark(
  ctx: CanvasRenderingContext2D,
  item: LegendItem,
  x: number,
  y: number,
  s: number
) {
  ctx.save()
  switch (item.kind) {
    case "crosshair":
      ctx.translate(x + 9 * s, y)
      ctx.scale(0.4, 0.4)
      drawCrosshair(ctx, 0, 0, s)
      break
    case "pasted":
      ctx.translate(x + 9 * s, y)
      ctx.scale(0.5, 0.5)
      drawPastedMark(ctx, 0, 0, s)
      break
    case "categorized":
      // The map's white ring, with a thin dark edge so it shows on the white strip.
      ctx.beginPath()
      ctx.arc(x + 9 * s, y, 4.5 * s, 0, Math.PI * 2)
      ctx.fillStyle = "#999"
      ctx.fill()
      ctx.strokeStyle = "#fff"
      ctx.lineWidth = 2 * s
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x + 9 * s, y, 5.8 * s, 0, Math.PI * 2)
      ctx.strokeStyle = "#141414"
      ctx.lineWidth = 0.8 * s
      ctx.stroke()
      break
    case "line":
      ctx.strokeStyle = item.color ?? "#000"
      ctx.lineWidth = 3 * s
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 18 * s, y)
      ctx.stroke()
      break
    case "point":
      ctx.beginPath()
      ctx.arc(x + 9 * s, y, 4.5 * s, 0, Math.PI * 2)
      ctx.fillStyle = item.color ?? "#000"
      ctx.fill()
      ctx.strokeStyle = "#000"
      ctx.lineWidth = 1 * s
      ctx.stroke()
      break
    case "area":
      ctx.fillStyle = (item.color ?? "#000") + "40"
      ctx.strokeStyle = item.color ?? "#000"
      ctx.lineWidth = 1.5 * s
      ctx.fillRect(x + 2 * s, y - 6 * s, 14 * s, 12 * s)
      ctx.strokeRect(x + 2 * s, y - 6 * s, 14 * s, 12 * s)
      break
  }
  ctx.restore()
}

/**
 * Compose the picture: the map canvas, the crosshair at the record, and the
 * caption strip. point is the record's position in CSS pixels of the map;
 * pasted, when given, is a pasted location in view, drawn as a diamond.
 */
export function composeCapture(
  map: HTMLCanvasElement,
  point: { x: number; y: number },
  caption: CaptureCaption,
  capturedAt: Date,
  pasted: { x: number; y: number } | null = null
): string {
  const s = map.width / map.clientWidth
  const stripH = Math.round(100 * s)
  const out = document.createElement("canvas")
  out.width = map.width
  out.height = map.height + stripH
  const ctx = out.getContext("2d")
  if (!ctx) throw new Error("the browser gave no 2D canvas to compose the picture")

  ctx.drawImage(map, 0, 0)
  if (pasted) drawPastedMark(ctx, pasted.x * s, pasted.y * s, s)
  drawCrosshair(ctx, point.x * s, point.y * s, s)

  // The strip is white with black text so the picture prints and reads in grey.
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, map.height, out.width, stripH)
  ctx.fillStyle = "#000"
  ctx.fillRect(0, map.height, out.width, Math.max(1, Math.round(s)))

  const pad = 12 * s
  const bar = scaleBar(metersPerPixel(caption.lat, caption.zoom), 140)
  const barW = bar.px * s
  const right = out.width - pad
  const textW = out.width - pad * 3 - Math.max(barW, 150 * s)
  let y = map.height + 20 * s

  ctx.textBaseline = "middle"
  ctx.fillStyle = "#000"
  ctx.font = `bold ${13 * s}px ${FONT}`
  ctx.fillText(fit(ctx, caption.title, textW), pad, y)
  y += 18 * s
  ctx.font = `${11 * s}px ${FONT}`
  ctx.fillStyle = "#222"
  ctx.fillText(fit(ctx, caption.subtitle, textW), pad, y)
  y += 15 * s
  // The capture time sits beside the position, the line least likely to be cut.
  const where =
    `${formatPosition(caption.lon, caption.lat)} (WGS 84)` +
    ` · captured ${formatTime(capturedAt.toISOString())}`
  ctx.fillText(fit(ctx, where, textW), pad, y)
  y += 15 * s
  const view =
    `${caption.basemap} · zoom ${caption.zoom.toFixed(1)} · north up` +
    (caption.imagery ? ` · ${caption.imagery}` : "")
  ctx.fillText(fit(ctx, view, textW), pad, y)
  y += 16 * s

  let x = pad
  ctx.font = `${10.5 * s}px ${FONT}`
  for (const item of caption.legend) {
    const w = 24 * s + ctx.measureText(item.label).width + 14 * s
    if (x + w > pad + textW) break
    drawLegendMark(ctx, item, x, y, s)
    ctx.fillStyle = "#222"
    ctx.fillText(item.label, x + 24 * s, y)
    x += w
  }

  // Scale bar, right-aligned, with its length above it.
  const by = map.height + stripH - 22 * s
  ctx.strokeStyle = "#000"
  ctx.lineWidth = 2 * s
  ctx.beginPath()
  ctx.moveTo(right - barW, by - 5 * s)
  ctx.lineTo(right - barW, by)
  ctx.lineTo(right, by)
  ctx.lineTo(right, by - 5 * s)
  ctx.stroke()
  ctx.font = `${11 * s}px ${FONT}`
  ctx.fillStyle = "#000"
  ctx.textAlign = "right"
  ctx.fillText(formatLength(bar.meters), right, by - 13 * s)
  ctx.textAlign = "left"

  return out.toDataURL("image/png")
}
