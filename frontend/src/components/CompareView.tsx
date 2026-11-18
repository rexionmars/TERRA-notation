import { useEffect } from "react"
import { imageURL } from "@/lib/api"
import type { Image } from "@/lib/types"
import { BarButton, PathStep, TitleBar } from "@/components/TitleBar"
import { Kbd } from "@/components/ui"

/** Both screenshots side by side, as large as the window allows. */
export function CompareView({
  title,
  source,
  reference,
  onClose,
}: {
  title: string
  source: Image | null
  reference: Image | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const pane = (img: Image | null, label: string) => (
    <figure className="m-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-panel">
      <figcaption className="flex h-10 shrink-0 items-center border-b border-border px-3 font-display text-read font-semibold tracking-wide">
        {label}
      </figcaption>
      <div className="relative min-h-0 flex-1 bg-sunk">
        {img ? (
          <img
            src={imageURL(img)}
            alt={label}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-read text-muted-foreground">
            No screenshot
          </p>
        )}
      </div>
    </figure>
  )
  return (
    <div className="scrim-enter fixed inset-0 z-50 flex flex-col bg-app">
      <TitleBar
        path={[
          <PathStep key="compare">Compare</PathStep>,
          <PathStep key="record" current title={title}>
            {title}
          </PathStep>,
        ]}
      >
        <BarButton onClick={onClose}>
          Close <Kbd>Esc</Kbd>
        </BarButton>
      </TitleBar>
      <div className="flex min-h-0 flex-1 gap-2 p-2 pt-0">
        {pane(source, "Layer")}
        {pane(reference, "Reference map")}
      </div>
    </div>
  )
}
