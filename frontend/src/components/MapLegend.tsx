import type { MapLayer } from "@/components/MapView"

/** What each mark on the map means, in its corner. */
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
    <div className="pointer-events-none absolute bottom-8 left-2 z-10 flex max-w-[60%] flex-col gap-0.5 rounded bg-black/70 px-2 py-1.5 text-[10.5px] text-white">
      {layers.map((l) => (
        <div key={l.name} className="flex items-center gap-1.5">
          {l.kind === "point" ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/70"
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
          <span className="truncate">
            {l.name}
            {l.name === activeLayer && <span className="text-white/60"> · open</span>}
          </span>
        </div>
      ))}
      <div className="mt-0.5 flex items-center gap-1.5 border-t border-white/15 pt-1">
        <span className="text-[12px] leading-none text-mark">✛</span>
        <span>selected record</span>
        <span className="ml-2 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white bg-white/40" />
        <span>has a category</span>
        {pasted && (
          <>
            <span className="ml-2 inline-block h-2 w-2 shrink-0 rotate-45 border-2 border-[#56B4E9]" />
            <span>pasted location</span>
          </>
        )}
      </div>
    </div>
  )
}
