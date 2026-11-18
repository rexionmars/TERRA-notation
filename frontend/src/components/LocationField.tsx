import type { Ref } from "react"
import { cn, inputClass } from "@/components/ui"

/**
 * A field over the map that takes a location. Pasting into it goes there at
 * once; Enter goes to what was typed. There is nothing else to press.
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
    <div className="absolute top-2 left-2 z-10 flex w-[340px] max-w-[calc(100%-64px)] flex-col gap-1">
      <input
        ref={inputRef}
        className={cn(inputClass, "h-8 bg-bg/90 shadow-lg backdrop-blur-sm")}
        placeholder="Paste a location (lat, lon or a Maps link)  ·  L"
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
      {error && (
        <div className="w-fit rounded bg-black/85 px-2 py-1 text-[11px] text-danger select-text">
          {error}
        </div>
      )}
    </div>
  )
}
