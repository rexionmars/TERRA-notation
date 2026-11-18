import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react"
import { Check, Info, Warning, X } from "@/components/icons"

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ")
}

/*
  TERRA's button primitives (components/ui/buttons.ts there). One focus ring
  and one disabled convention across the set, so two buttons in a row never
  differ. A filled accent takes the ink (6.52); a whole-button hover fade is
  not used, because it takes the label under 4.5.
*/
const FOCUS = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
const DISABLED = "disabled:opacity-60"

type Tone = "default" | "primary" | "danger" | "ghost"
type Size = "default" | "dense" | "commit"

const tones: Record<Tone, string> = {
  default:
    "border border-line/40 bg-control text-muted-foreground hover:bg-hover hover:text-foreground",
  primary: "bg-primary font-semibold text-primary-foreground",
  danger: "bg-destructive font-semibold text-destructive-foreground",
  ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
}

/*
  32 px, the height of a field, so a button beside one lines up; 28 px for a
  band that repeats, such as a panel's foot; 36 px for the one action that
  commits a dialog.
*/
const sizes: Record<Size, string> = {
  default: "h-8 gap-1.5 px-3 text-body",
  dense: "h-7 gap-1 px-2 text-meta",
  commit: "h-9 gap-1.5 px-4 text-emphasis",
}

export function Button({
  tone = "default",
  size = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: Size }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm whitespace-nowrap transition-colors",
        DISABLED,
        FOCUS,
        sizes[size],
        tones[tone],
        className
      )}
    />
  )
}

/** A 28 px square holding one glyph, which names itself in its title. */
export function IconButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
        DISABLED,
        FOCUS,
        className
      )}
    />
  )
}

/**
 * A key the reader can press, shown beside the action it triggers. Drawn in the
 * colour of the text around it, so it reads on a quiet button and on the
 * accent's fill alike.
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 shrink-0 items-center rounded-xs border border-current/30 px-1 font-mono text-micro font-normal tracking-normal normal-case">
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
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-meta text-muted-foreground">{hint}</span>}
    </label>
  )
}

export const inputClass = "field-input"

/** A surface on the window's ground: the panel body, its border, the container radius. */
export function Panel({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-panel",
        className
      )}
    >
      {children}
    </section>
  )
}

/**
 * A panel's header: what it is in the face of the mark, what it holds beside
 * it in the muted tone, and its controls at the right.
 */
export function PanelHeader({
  title,
  detail,
  children,
}: {
  title: ReactNode
  detail?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h2 className="shrink-0 font-display text-read font-semibold tracking-wide text-foreground">
          {title}
        </h2>
        {detail && (
          <span className="min-w-0 truncate text-label text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
      {children}
    </header>
  )
}

/**
 * The dialog, as TERRA's ModalShell and ModalHeader draw it: a scrim, a plate at
 * the container radius, and a header with an eyebrow over the title and the
 * way out. Escape and a press on the scrim close it.
 */
export function Dialog({
  eyebrow,
  title,
  onClose,
  children,
  footer,
  wide,
  tone = "default",
}: {
  eyebrow: string
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  tone?: "default" | "destructive"
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
      className="scrim-enter app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "plate-enter flex max-h-[88vh] flex-col overflow-hidden rounded-md border border-border bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.55)]",
          wide ? "w-[880px]" : "w-[520px]"
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p
              className={cn(
                "font-mono text-meta",
                tone === "destructive" ? "text-destructive-quiet" : "text-accent-quiet"
              )}
            >
              {eyebrow}
            </p>
            <h2 className="mt-0.5 truncate font-display text-heading font-semibold tracking-wide">
              {title}
            </h2>
          </div>
          <IconButton label="Close (Esc)" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="panel-scroll min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
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
    <div className="flex items-start gap-2 rounded-sm border border-destructive-quiet/35 bg-destructive/15 px-3 py-2 text-label text-destructive-quiet">
      <Warning className="mt-px size-3.5 shrink-0" />
      <span className="flex-1 select-text">{text}</span>
      {onDismiss && (
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      )}
    </div>
  )
}

export type ToastTone = "success" | "info" | "error"

/**
 * A message in TERRA's toast: a dark plate lit from its left by its status,
 * with the status mark in a halo. An error stays until it is dismissed.
 */
export function Toast({
  tone,
  text,
  onDismiss,
}: {
  tone: ToastTone
  text: string
  onDismiss?: () => void
}) {
  const Mark = tone === "success" ? Check : tone === "error" ? Warning : Info
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "toast group",
        tone === "success" && "toast-success",
        tone === "error" && "toast-error"
      )}
    >
      <span className="toast-mark">
        <Mark className="size-4" />
      </span>
      <p className="flex min-h-8 flex-1 items-center text-label break-words select-text">
        {text}
      </p>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
          className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}
