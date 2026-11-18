/*
  The icons, as TERRA draws them (frontend/src/components/icons.tsx and
  lineIcons.tsx in TERRA's repository), so a control here and its twin there
  look the same.

  Two kinds, as there. The filled glyphs are KDE's Breeze icons,
  LGPL-3.0-or-later, copied from TERRA's generated set; each names the Breeze
  file it came from. The line icons are TERRA's own drawings in Breeze's
  grammar: a 16-unit grid, one-unit strokes on half units (whole pixels at 1x),
  currentColor, round caps and joins. PlaceNames is drawn here in that grammar,
  since TERRA has no icon for the word.

  1em and currentColor, so a glyph follows the text it sits in until a class
  sizes it with size-* or colours it with text-*.

  THE MARKUP OBJECT IS MADE ONCE PER ICON. React 19 compares it by identity, and
  a new one on each render rewrites the svg's children. A render between a
  press and its release (pressing a map button also makes its half the active
  one) then removed the path the press began on, and the button never received
  the click.
*/
import type { ComponentType, SVGProps } from "react"

export type Icon = ComponentType<SVGProps<SVGSVGElement>>

function breeze(body: string): Icon {
  const html = { __html: body }
  return function BreezeIcon(props) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden="true"
        {...props}
        dangerouslySetInnerHTML={html}
      />
    )
  }
}

function line(body: string): Icon {
  const html = { __html: body }
  return function LineIcon(props) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        width="1em"
        height="1em"
        fill="none"
        aria-hidden="true"
        {...props}
        dangerouslySetInnerHTML={html}
      />
    )
  }
}

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"'

/** actions/16/go-previous */
export const CaretLeft = breeze(
  '<path d="M4.293 8l6 6 .707-.707L5.707 8 11 2.707 10.293 2l-6 6z"/>'
)

/** actions/16/go-next */
export const CaretRight = breeze(
  '<path d="M11.707 8l-6 6L5 13.293 10.293 8 5 2.707 5.707 2l6 6z"/>'
)

/** actions/16/go-down */
export const CaretDown = breeze(
  '<path d="M8 11.707l-6-6L2.707 5 8 10.293 13.293 5l.707.707-6 6z"/>'
)

/** actions/16/go-down, turned over. */
export const CaretUp = breeze(
  '<path transform="rotate(180 8 8)" d="M8 11.707l-6-6L2.707 5 8 10.293 13.293 5l.707.707-6 6z"/>'
)

/** actions/16/checkmark */
export const Check = breeze(
  '<path d="M 13.273438 3.5 L 5.6367188 11.060547 L 2.7265625 8.1796875 L 2 8.9003906 L 4.9082031 11.779297 L 5.6367188 12.5 L 6.7265625 11.419922 L 14 4.2207031 L 13.273438 3.5 z"/>'
)

/** actions/16/edit-copy */
export const Copy = breeze(
  '<path d="M 3 2 L 3 12 L 6 12 L 6 14 L 14 14 L 14 7 L 11 4 L 10 4 L 8 2 L 3 2 Z M 4 3 L 7 3 L 7 4 L 6 4 L 6 11 L 4 11 L 4 3 Z M 7 5 L 10 5 L 10 8 L 13 8 L 13 13 L 7 13 L 7 5 Z"/>'
)

/** actions/16/help-about */
export const Info = breeze(
  '<g fill-rule="evenodd"><path d="m8 2a6 6 0 0 0 -6 6 6 6 0 0 0 6 6 6 6 0 0 0 6-6 6 6 0 0 0 -6-6zm0 1a5 5 0 0 1 5 5 5 5 0 0 1 -5 5 5 5 0 0 1 -5-5 5 5 0 0 1 5-5z"/><path d="m7 4h2v2h-2z"/><path d="m7 7h2v5h-2z"/></g>'
)

/** actions/16/value-decrease */
export const Minus = breeze('<path d="M 3,7 3,9 13,9 13,7 3,7 Z"/>')

/** actions/16/list-add */
export const Plus = breeze(
  '<path d="M 7 3.0058594 L 7 8 L 2 8 L 2 8.9980469 L 7 8.9980469 L 7 14.007812 L 8 14.007812 L 8 8.9980469 L 13 8.9980469 L 13 8 L 8 8 L 8 3.0058594 L 7 3.0058594 z"/>'
)

/** status/16/dialog-warning */
export const Warning = breeze(
  '<mask id="breeze-cut-Warning"><path fill="#fff" d="M0 0h16v16H0z"/><path d="m7 6v4h2v-4zm0 5v2h2v-2z" fill="#000"/></mask><g mask="url(#breeze-cut-Warning)"><path d="m8.0065001 2.0000269a0.75001881 0.74999832 0 0 0-0.6772669 0.414749l-5.2501316 10.499976a0.75001881 0.74999832 0 0 0 0.6712668 1.085248h10.500264a0.75001881 0.74999832 0 0 0 0.671266-1.085248l-5.2501312-10.499976a0.75001881 0.74999832 0 0 0-0.6652667-0.414749z"/></g>'
)

/** actions/16/window-close */
export const X = breeze(
  '<g stroke-linecap="square"><path d="m4 4 8 8m-8 0 8-8"/><path d="M 4,3.1523438 3.1523438,4 7.1523437,8 3.1523438,12 4,12.847656 8,8.8476563 12,12.847656 12.847656,12 8.8476563,8 12.847656,4 12,3.1523438 8,7.1523437 Z"/></g>'
)

/** Three layers stacked: TERRA's Layers. */
export const LineLayers = line(
  `<path d="M8 2.5 L13.5 5.5 L8 8.5 L2.5 5.5 Z" ${STROKE}/><path d="M2.5 8.5 L8 11.5 L13.5 8.5" ${STROKE}/><path d="M2.5 11.5 L8 14.5 L13.5 11.5" ${STROKE}/>`
)

/** The globe the photograph is of: TERRA's "Base: photograph". */
export const LineBasePhoto = line(
  `<circle cx="8" cy="8" r="6" ${STROKE}/><ellipse cx="8" cy="8" rx="2.6" ry="6" ${STROKE}/><path d="M2 8 H14 M3.1 5 H12.9 M3.1 11 H12.9" ${STROKE}/>`
)

/** A road, its centre line dashed: TERRA's "Base: streets". */
export const LineBaseStreets = line(
  `<path d="M2.5 14.5 L6.5 1.5 M13.5 14.5 L9.5 1.5" ${STROKE}/><path d="M8 13.5 V2.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.4"/>`
)

/** A satellite, sending down: TERRA's Imagery. */
export const LineImagery = line(
  `<rect x="1.5" y="4.5" width="4" height="2.5" rx="0.4" ${STROKE}/><rect x="10.5" y="4.5" width="4" height="2.5" rx="0.4" ${STROKE}/><path d="M3.5 4.5 V7 M12.5 4.5 V7 M5.5 5.75 H6.5 M9.5 5.75 H10.5" ${STROKE}/><rect x="6.5" y="2.5" width="3" height="6" rx="0.75" ${STROKE}/><path d="M5.75 11.25 Q8 13 10.25 11.25 M4 13.25 Q8 16 12 13.25" ${STROKE}/>`
)

/** A capital A and two lines of text beside it: names written on the map. */
export const LinePlaceNames = line(
  `<path d="M2 13.5 L5.5 2.5 L9 13.5 M3.25 9.5 H7.75" ${STROKE}/><path d="M11 6.5 H14 M11 9.5 H14 M11 12.5 H13" ${STROKE}/>`
)
