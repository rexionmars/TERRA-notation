import type { Ref } from "react"
import { formatLength, formatPosition } from "@/lib/format"
import type { NearRecord } from "@/lib/types"
import { Button, cn, inputClass, Kbd } from "@/components/ui"

/**
 * Over the map: a field that takes a pasted location, and, once there is one,
 * the records of the layer nearest to it.
 */
export function LocationBox({
  inputRef,
  text,
  onTextChange,
  onGo,
  error,
  pasted,
  layer,
  nearest,
  selected,
  onPick,
  onShow,
  onClear,
}: {
  inputRef: Ref<HTMLInputElement>
  text: string
  onTextChange: (t: string) => void
  /** reads the text and goes there; false when it could not be read */
  onGo: (t: string) => boolean
  error: string
  pasted: [number, number] | null
  layer: string
  nearest: NearRecord[]
  selected: number | null
  onPick: (layer: string, fid: number) => void
  onShow: () => void
  onClear: () => void
}) {
  return (
    <div className="absolute top-2 left-2 z-10 flex w-[360px] max-w-[calc(100%-64px)] flex-col gap-1">
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          onGo(text)
        }}
      >
        <input
          ref={inputRef}
          className={cn(inputClass, "min-w-0 flex-1 bg-bg/90")}
          placeholder="Paste a location: -7.546178, -63.067186 or a Maps link"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={(e) => {
            const pastedText = e.clipboardData.getData("text")
            onTextChange(pastedText)
            if (onGo(pastedText)) e.preventDefault()
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur()
          }}
        />
        <Button type="submit" tone="default" className="bg-raised/95">
          Go <Kbd>L</Kbd>
        </Button>
      </form>
      {error && (
        <div className="rounded bg-black/85 px-2 py-1 text-[11px] text-danger select-text">
          {error}
        </div>
      )}
      {pasted && (
        <div className="rounded border border-line bg-panel/95 p-2 text-[12px] shadow-lg">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 border-2 border-[#56B4E9] outline outline-1 outline-black"
            />
            <span className="min-w-0 flex-1 truncate select-text">
              {formatPosition(pasted[0], pasted[1])}
            </span>
            <Button
              tone="ghost"
              onClick={onShow}
              title="Centre the map on the pasted location"
            >
              Show
            </Button>
            <Button tone="ghost" onClick={onClear}>
              Clear
            </Button>
          </div>
          <div className="mt-1.5 mb-0.5 text-[11px] text-muted">Nearest records</div>
          <ul className="flex flex-col">
            {nearest.map((n) => (
              <li key={`${n.layer}:${n.fid}`}>
                <button
                  type="button"
                  onClick={() => onPick(n.layer, n.fid)}
                  title={n.layer === layer ? undefined : `Opens layer ${n.layer}`}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-hover",
                    n.layer === layer && n.fid === selected && "bg-accent/15"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  {n.layer !== layer && (
                    <span className="shrink-0 rounded border border-line px-1 text-[10px] text-muted">
                      {n.layer}
                    </span>
                  )}
                  <span className="shrink-0 text-muted tabular-nums">
                    {formatLength(n.meters)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
