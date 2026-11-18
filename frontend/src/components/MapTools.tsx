import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  LineBasePhoto,
  LineBaseStreets,
  LineImagery,
  LineLayers,
  LinePlaceNames,
  Minus,
  Plus,
  type Icon,
} from "@/components/icons"
import { cn } from "@/components/ui"
import { BASEMAPS } from "@/lib/basemaps"

/*
  The map's own controls, as TERRA draws them (components/globe/MapChrome.tsx
  there): bars of 2.125 rem squares in the map's material, a hairline between
  the buttons of a bar and around it, glyphs without words. The label is each
  button's title and accessible name rather than text on it, so the controls
  take as little of the imagery as they can.
*/

const BAR =
  "map-chrome pointer-events-auto flex flex-col overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)]"

const PANEL =
  "map-chrome pointer-events-auto absolute top-0 right-[calc(2.125rem+0.5rem)] z-20 overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)]"

const BASEMAP_ICONS: Record<string, Icon> = {
  esri_imagery: LineBasePhoto,
  esri_streets: LineBaseStreets,
  s2cloudless_2025: LineImagery,
}

function MapButton({
  label,
  active = false,
  onClick,
  children,
  expanded,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
  /** Set on a button that opens a panel, to say whether it is open. */
  expanded?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={expanded === undefined ? active : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "flex size-[2.125rem] items-center justify-center border-b border-[rgb(var(--p-line)/0.22)] transition-colors last:border-b-0",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
        active
          ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-primary"
          : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.92)] hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

/**
 * The column at the map's right edge: zoom, then what the map draws. The
 * basemap's button carries the current basemap's own glyph, so the column says
 * what it is set to; its list and the layers' panel open to the left, over the
 * map they belong to.
 */
export function MapTools({
  onZoomIn,
  onZoomOut,
  basemap,
  onBasemap,
  labels,
  onLabels,
  layerCount,
  layers,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  basemap: string
  onBasemap: (id: string) => void
  labels: boolean
  onLabels: (on: boolean) => void
  layerCount: number
  /** The layers' panel, drawn when its button is pressed. */
  layers: ReactNode
}) {
  const [open, setOpen] = useState<"basemap" | "layers" | null>(null)
  const host = useRef<HTMLDivElement>(null)

  /*
    Closed by a press anywhere else and by Escape. On pointerdown, so a press
    on the map both closes the panel and reaches the map.
  */
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null)
    }
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", key)
    }
  }, [open])

  const toggle = (which: "basemap" | "layers") =>
    setOpen((v) => (v === which ? null : which))
  const current = BASEMAPS.find((b) => b.id === basemap)
  const BaseIcon = BASEMAP_ICONS[basemap] ?? LineBasePhoto

  return (
    /*
      As tall as the map, so a panel can be as tall as the map too; it takes no
      presses itself, so the map under its empty part still does.
    */
    <div
      ref={host}
      className="pointer-events-none absolute inset-y-2 right-2 z-10 flex flex-col gap-2"
    >
      <div className={BAR}>
        <MapButton label="Zoom in" onClick={onZoomIn}>
          <Plus className="size-4" />
        </MapButton>
        <MapButton label="Zoom out" onClick={onZoomOut}>
          <Minus className="size-4" />
        </MapButton>
      </div>
      <div className={BAR}>
        <MapButton
          label={`Basemap: ${current?.label ?? basemap}`}
          active={open === "basemap"}
          expanded={open === "basemap"}
          onClick={() => toggle("basemap")}
        >
          <BaseIcon className="size-4" />
        </MapButton>
        <MapButton
          label={labels ? "Hide place names" : "Show place names"}
          active={labels}
          onClick={() => onLabels(!labels)}
        >
          <LinePlaceNames className="size-4" />
        </MapButton>
        <MapButton
          label={`Layers drawn (${layerCount})`}
          active={open === "layers"}
          expanded={open === "layers"}
          onClick={() => toggle("layers")}
        >
          <LineLayers className="size-4" />
        </MapButton>
      </div>

      {open === "basemap" && (
        <div role="menu" aria-label="Basemap" className={cn(PANEL, "w-60")}>
          {BASEMAPS.map((b) => {
            const Glyph = BASEMAP_ICONS[b.id] ?? LineBasePhoto
            const chosen = b.id === basemap
            return (
              <button
                key={b.id}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                onClick={() => {
                  onBasemap(b.id)
                  setOpen(null)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-label transition-colors",
                  chosen
                    ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-foreground"
                    : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.6)] hover:text-foreground"
                )}
              >
                <Glyph className={cn("size-4 shrink-0", chosen && "text-primary")} />
                {b.label}
              </button>
            )
          })}
        </div>
      )}
      {open === "layers" && (
        <div
          role="dialog"
          aria-label="Layers drawn"
          className={cn(PANEL, "panel-scroll max-h-full w-[22rem] overflow-y-auto")}
        >
          {layers}
        </div>
      )}
    </div>
  )
}
