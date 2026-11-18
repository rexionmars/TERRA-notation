import { useEffect } from "react"
import { imageURL } from "@/lib/api"
import type { Image } from "@/lib/types"
import { Button, Kbd } from "@/components/ui"

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
    <figure className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      <figcaption className="text-[12px] text-muted">{label}</figcaption>
      <div className="relative min-h-0 flex-1 bg-black">
        {img ? (
          <img
            src={imageURL(img)}
            alt={label}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-muted">
            no screenshot
          </p>
        )}
      </div>
    </figure>
  )
  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-2 bg-bg/97 p-4">
      <div className="flex items-center justify-between">
        <h2 className="truncate text-[14px] font-semibold">{title}</h2>
        <Button tone="ghost" onClick={onClose}>
          Close <Kbd>Esc</Kbd>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {pane(source, "Layer")}
        {pane(reference, "Reference map")}
      </div>
    </div>
  )
}
