import { useEffect, useRef, useState } from "react"
import type { Category, Row, Summary } from "@/lib/types"
import { cn } from "@/components/ui"

const ROW_HEIGHT = 50
const OVERSCAN = 8

export interface RecordText {
  title: (r: Row) => string
  detail: (r: Row) => string
}

/** The records of the layer, drawn only where the list is scrolled to. */
export function RecordList({
  rows,
  selected,
  onSelect,
  summaries,
  categories,
  categoryColor,
  text,
}: {
  rows: Row[]
  selected: number | null
  onSelect: (fid: number) => void
  summaries: Map<number, Summary>
  categories: Category[]
  categoryColor: (id: string) => string
  text: RecordText
}) {
  const box = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the selected record in view when it changes from outside the list.
  useEffect(() => {
    const el = box.current
    if (!el || selected === null) return
    const i = rows.findIndex((r) => r.fid === selected)
    if (i < 0) return
    const top = i * ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight
  }, [selected, rows])

  const labels = new Map(categories.map((c) => [c.id, c.label]))
  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    rows.length,
    Math.ceil((scroll + height) / ROW_HEIGHT) + OVERSCAN
  )

  return (
    <div
      ref={box}
      className="relative min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
    >
      <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
        {rows.slice(first, last).map((r, k) => {
          const s = summaries.get(r.fid)
          const cat = s?.category ?? ""
          return (
            <button
              type="button"
              key={r.fid}
              onClick={() => onSelect(r.fid)}
              style={{ top: (first + k) * ROW_HEIGHT, height: ROW_HEIGHT }}
              className={cn(
                "absolute inset-x-0 flex flex-col justify-center gap-0.5 border-b border-line/60 px-3 text-left",
                r.fid === selected ? "bg-accent/15" : "hover:bg-hover"
              )}
            >
              <div className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{text.title(r)}</span>
                <span className="flex gap-0.5" aria-hidden>
                  <span
                    title={
                      s?.has_source_image
                        ? "layer screenshot kept"
                        : "no layer screenshot"
                    }
                    className={cn(
                      "h-2 w-2 rounded-[2px] border border-muted/70",
                      s?.has_source_image && "bg-muted"
                    )}
                  />
                  <span
                    title={
                      s?.has_reference_image
                        ? "reference screenshot kept"
                        : "no reference screenshot"
                    }
                    className={cn(
                      "h-2 w-2 rounded-[2px] border border-muted/70",
                      s?.has_reference_image && "bg-muted"
                    )}
                  />
                </span>
              </div>
              <div className="flex w-full items-center gap-2 text-[11px] text-muted">
                <span className="min-w-0 flex-1 truncate">{text.detail(r)}</span>
                {cat && (
                  <span
                    className="max-w-[45%] shrink-0 truncate rounded px-1.5 text-[10px] font-medium text-black"
                    style={{ background: categoryColor(cat) }}
                  >
                    {labels.get(cat) ?? cat}
                  </span>
                )}
                {!cat && s?.saved && (
                  <span className="shrink-0 text-[10px]">notes only</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {rows.length === 0 && (
        <p className="absolute inset-x-0 top-6 text-center text-muted">
          No record matches.
        </p>
      )}
    </div>
  )
}
