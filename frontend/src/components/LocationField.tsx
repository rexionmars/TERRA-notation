import type { Ref } from "react"
import { Kbd } from "@/components/ui"

/**
 * A field over the map that takes a location. Pasting into it goes there at
 * once; Enter goes to what was typed. There is nothing else to press.
 *
 * In the map's material, which is drawn by the wrapper: a field carries a
 * transparent ground of its own.
 */
export function LocationField({
  inputRef,
  text,
  onTextChange,
  onGo,
  error,
}: {
  inputRef: Ref<HTMLInputElement>
  text: string
  onTextChange: (t: string) => void
  /** reads the text and goes there; false when it cannot be read */
  onGo: (t: string) => boolean
  error: string
}) {
  return (
    <div className="absolute top-2 left-2 z-10 flex w-[340px] max-w-[calc(100%-4rem)] flex-col gap-1">
      <div className="map-chrome flex h-[2.125rem] items-center gap-2 rounded-md border border-[rgb(var(--p-line)/0.28)] pr-2 shadow-[0_2px_8px_rgb(0_0_0/0.28)] focus-within:border-[rgb(var(--p-accent)/0.55)]">
        <input
          ref={inputRef}
          className="h-full min-w-0 flex-1 bg-transparent pl-2.5 text-label text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Paste a location (lat, lon or a Maps link)"
          aria-label="Location"
          value={text}
          spellCheck={false}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text")
            if (onGo(pasted)) {
              e.preventDefault()
              onTextChange(pasted.trim())
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onGo(text)
            if (e.key === "Escape") e.currentTarget.blur()
          }}
        />
        <span className="text-muted-foreground">
          <Kbd>L</Kbd>
        </span>
      </div>
      {error && (
        <div className="map-chrome w-fit rounded-sm border border-destructive-quiet/35 px-2 py-1 text-label text-destructive-quiet select-text">
          {error}
        </div>
      )}
    </div>
  )
}
