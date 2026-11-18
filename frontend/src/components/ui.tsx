import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react"

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ")
}

type Tone = "default" | "primary" | "danger" | "ghost"

const tones: Record<Tone, string> = {
  default: "bg-raised hover:bg-hover border-line",
  primary: "bg-accent/90 hover:bg-accent text-black border-transparent font-medium",
  danger: "bg-raised hover:bg-hover border-line text-danger",
  ghost: "bg-transparent hover:bg-hover border-transparent",
}

export function Button({
  tone = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-[12px] whitespace-nowrap",
        "disabled:cursor-default disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-accent",
        tones[tone],
        className
      )}
    />
  )
}

/** A key the reader can press, shown beside the action it triggers. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-bg px-1 font-sans text-[10px] text-muted">
      {children}
    </kbd>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

export const inputClass =
  "h-7 rounded border border-line bg-bg px-2 text-[12px] text-text outline-none " +
  "focus:border-accent placeholder:text-muted/70"

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          "flex max-h-[88vh] flex-col rounded-lg border border-line bg-panel shadow-2xl",
          wide ? "w-[880px]" : "w-[520px]"
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <Button tone="ghost" onClick={onClose} aria-label="Close">
            Close <Kbd>Esc</Kbd>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function ErrorLine({
  text,
  onDismiss,
}: {
  text: string
  onDismiss?: () => void
}) {
  if (!text) return null
  return (
    <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
      <span className="flex-1 select-text">{text}</span>
      {onDismiss && (
        <button
          type="button"
          className="text-muted hover:text-text"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
