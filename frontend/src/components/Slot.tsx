import type { CSSProperties, ReactNode } from "react"
import { imageURL } from "@/lib/api"
import { formatTime } from "@/lib/format"
import type { Image, Side } from "@/lib/types"
import { Button, cn, Kbd } from "@/components/ui"

const origins: Record<string, string> = {
  app_map: "map in this application",
  screen_region: "screen region",
  clipboard: "clipboard",
  file: "file",
}

// Wails delivers a dropped file only to an element that declares this.
const dropTarget = { "--wails-drop-target": "drop" } as CSSProperties

/** One half of the comparison: a screenshot, or what stands in for it. */
export function Slot({
  side,
  title,
  active,
  onActivate,
  image,
  tabs,
  children,
  busy,
  onRegion,
  onPaste,
  onFile,
  onRemove,
  onOpenImage,
  extraActions,
}: {
  side: Side
  title: ReactNode
  active: boolean
  onActivate: () => void
  image: Image | null
  tabs?: ReactNode
  /** what fills the slot; the screenshot when absent */
  children?: ReactNode
  busy: boolean
  onRegion: () => void
  onPaste: () => void
  onFile: () => void
  onRemove: () => void
  onOpenImage: () => void
  extraActions?: ReactNode
}) {
  return (
    <section
      data-slot={side}
      style={dropTarget}
      onMouseDown={onActivate}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col rounded-md border bg-panel",
        active ? "border-accent/70" : "border-line"
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="min-w-0 flex-1 truncate font-medium">{title}</div>
        {tabs}
        {active && (
          <span
            className="text-[11px] text-muted"
            title="Paste and region capture go here"
          >
            receives <Kbd>⌘V</Kbd>
          </span>
        )}
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {children ??
          (image ? (
            <button
              type="button"
              className="absolute inset-0 cursor-zoom-in"
              onClick={onOpenImage}
              title="Compare both screenshots full size"
            >
              <img
                src={imageURL(image)}
                alt={`screenshot, ${side}`}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </button>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <p>No screenshot yet.</p>
              <p className="max-w-[340px] text-[12px]">
                Capture a region of the screen, paste one copied with <Kbd>⌃⇧⌘4</Kbd>,
                or drop an image file here.
              </p>
            </div>
          ))}
      </div>
      <footer className="flex h-10 shrink-0 items-center gap-1.5 border-t border-line px-2">
        {extraActions}
        <Button
          disabled={busy}
          onClick={onRegion}
          title="Hide this window and select a region of the screen"
        >
          Capture region <Kbd>R</Kbd>
        </Button>
        <Button disabled={busy} onClick={onPaste}>
          Paste
        </Button>
        <Button disabled={busy} onClick={onFile}>
          File…
        </Button>
        <div className="flex-1" />
        {image && (
          <>
            <span
              className="truncate text-[11px] text-muted"
              title={`SHA-256 ${image.sha256}`}
            >
              {origins[image.origin] ?? image.origin}, {formatTime(image.captured_at)}
            </span>
            <Button
              tone="ghost"
              disabled={busy}
              onClick={onRemove}
              title="The file stays in the project folder"
            >
              Remove
            </Button>
          </>
        )}
      </footer>
    </section>
  )
}
