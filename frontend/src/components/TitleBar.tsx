import { Fragment, type ButtonHTMLAttributes, type ReactNode } from "react"
import { CaretRight } from "@/components/icons"
import { cn } from "@/components/ui"

/*
  The window's traffic lights. main.go hides the title bar on macOS, as TERRA
  does, and the lights are then drawn over the page: centred 16 pt down and
  ending 69 pt in, measured by TERRA on macOS 26. The bar is 32 pt, so they sit
  on its centre line, and the mark keeps a centimetre clear of them. Elsewhere
  the platform draws its own frame above the page.
*/
const RESERVES_TRAFFIC_LIGHTS = /Mac/i.test(navigator.platform)

/**
 * The bar across the top of the window: the mark, where the reader is as one
 * path from the application to the place, and what can be done there. It moves
 * the window, except where a control sits.
 */
export function TitleBar({
  path = [],
  children,
}: {
  /** The steps after the application's name; the last is where the reader is. */
  path?: ReactNode[]
  /** Controls at the right end. */
  children?: ReactNode
}) {
  return (
    <header
      className={cn(
        "app-draggable flex h-8 shrink-0 items-center gap-1 bg-app pr-2",
        RESERVES_TRAFFIC_LIGHTS ? "pl-[calc(4.3125rem+1cm)]" : "pl-3"
      )}
    >
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <img
          src="/terra-logo.png"
          alt=""
          draggable={false}
          className="size-6 shrink-0 object-contain"
        />
        <span className="font-display text-heading font-semibold tracking-[0.14em] whitespace-nowrap">
          TERRA <span className="text-muted-foreground">Notation</span>
        </span>
      </div>
      {path.map((step, i) => (
        <Fragment key={i}>
          <CaretRight className="size-3 shrink-0 text-muted-foreground" />
          {step}
        </Fragment>
      ))}
      <div className="min-w-4 flex-1 self-stretch" />
      {children}
    </header>
  )
}

/** A step of the path that names a place and does nothing when pressed. */
export function PathStep({
  current = false,
  title,
  children,
}: {
  current?: boolean
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={cn(
        "min-w-0 truncate px-1.5 text-heading",
        current ? "text-foreground" : "max-w-[16rem] text-muted-foreground"
      )}
    >
      {children}
    </span>
  )
}

/** A quiet control in the bar, at the height of a step of the path. */
export function BarButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "app-no-drag inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-label text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
        className
      )}
    />
  )
}
