import type { CSSProperties, ReactNode } from "react"
import { imageURL } from "@/lib/api"
import { formatTime } from "@/lib/format"
import type { Image, Side } from "@/lib/types"
import { Button, cn, Kbd, PanelHeader } from "@/components/ui"

const origins: Record<string, string> = {
  app_map: "map in this application",
  screen_region: "screen region",
  clipboard: "clipboard",
  file: "file",
}

// Wails delivers a dropped file only to an element that declares this.
const dropTarget = { "--wails-drop-target": "drop" } as CSSProperties

/**
 * One half of the comparison: a screenshot, or what stands in for it. The
 * active one, which a paste and a region capture go to, is ringed in the
 * accent, the colour of the active state.
 */
export function Slot({
  side,
  title,
  detail,
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
  title: string
  detail?: ReactNode
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
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-panel transition-colors",
        active ? "border-primary/60" : "border-border"
      )}
    >
      <PanelHeader title={title} detail={detail}>
        {tabs}
        {active && (
          <span
            className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground"
            title="Paste and region capture go here"
          >
            receives <Kbd>⌘V</Kbd>
          </span>
        )}
      </PanelHeader>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-sunk">
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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center">
              <p className="text-title font-medium text-foreground">
                No screenshot yet
              </p>
              <p className="max-w-[340px] text-read text-muted-foreground">
                Capture a region of the screen, paste one copied with <Kbd>⌃⇧⌘4</Kbd>,
                or drop an image file here.
              </p>
            </div>
          ))}
      </div>
      <footer className="flex h-11 shrink-0 items-center gap-1.5 border-t border-border px-2">
        {extraActions}
        <Button
          size="dense"
          disabled={busy}
          onClick={onRegion}
          title="Hide this window and select a region of the screen"
        >
          Capture region <Kbd>R</Kbd>
        </Button>
        <Button size="dense" disabled={busy} onClick={onPaste}>
          Paste
        </Button>
        <Button size="dense" disabled={busy} onClick={onFile}>
          File…
        </Button>
        <div className="flex-1" />
        {image && (
          <>
            <span
              className="truncate text-meta text-muted-foreground"
              title={`SHA-256 ${image.sha256}`}
            >
              {origins[image.origin] ?? image.origin},{" "}
              <span className="telemetry">{formatTime(image.captured_at)}</span>
            </span>
            <Button
              tone="ghost"
              size="dense"
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
