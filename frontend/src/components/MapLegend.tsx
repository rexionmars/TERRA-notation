import type { MapLayer } from "@/components/MapView"

/**
 * What each mark on the map means, in its corner, on a plate of the map's
 * material. The marks keep their own colours: they answer to the data, not to
 * the interface.
 */
export function MapLegend({
  layers,
  activeLayer,
  pasted,
}: {
  layers: MapLayer[]
  activeLayer: string
  pasted: boolean
}) {
  return (
    <div className="map-chrome pointer-events-none absolute bottom-8 left-2 z-10 flex max-w-[60%] flex-col gap-0.5 rounded-md border border-[rgb(var(--p-line)/0.28)] px-2.5 py-2 text-meta text-foreground shadow-[0_2px_8px_rgb(0_0_0/0.28)]">
      {layers.map((l) => (
        <div key={l.name} className="flex items-center gap-1.5">
          {l.kind === "point" ? (
            <span
              className="size-2.5 shrink-0 rounded-full border border-black/70"
              style={{ background: l.color }}
            />
          ) : l.kind === "line" ? (
            <span className="h-0.5 w-3 shrink-0" style={{ background: l.color }} />
          ) : (
            <span
              className="h-2.5 w-3 shrink-0 border"
              style={{ borderColor: l.color, background: `${l.color}33` }}
            />
          )}
          <span className="truncate font-mono">
            {l.name}
            {l.name === activeLayer && (
              <span className="text-muted-foreground"> · open</span>
            )}
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1.5 border-t border-hairline pt-1.5">
        <span className="text-label leading-none text-mark">✛</span>
        <span>selected record</span>
        <span className="ml-2 size-2.5 shrink-0 rounded-full border-2 border-white bg-white/40" />
        <span>has a category</span>
        {pasted && (
          <>
            <span className="ml-2 inline-block size-2 shrink-0 rotate-45 border-2 border-[#56B4E9]" />
            <span>pasted location</span>
          </>
        )}
      </div>
    </div>
  )
}
