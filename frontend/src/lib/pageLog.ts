/*
  Problems the page sees, written by Go to page.log (app_pagelog.go). In the
  packaged application the web view's console is out of reach, so this file is
  what tells why a map stayed black. Repeated messages are counted and written
  once per interval, so a failing tile server does not flood the file.
*/
import { LogPageProblem } from "../../wailsjs/go/main/App"

const FLUSH_MS = 10_000
const counts = new Map<string, number>()
let timer = 0

function flush() {
  timer = 0
  for (const [text, n] of counts) {
    void LogPageProblem(n > 1 ? `${text} (×${n})` : text).catch(() => {})
  }
  counts.clear()
}

/** Records a problem; identical ones within ten seconds are counted together. */
export function logProblem(text: string) {
  counts.set(text, (counts.get(text) ?? 0) + 1)
  if (!timer) timer = window.setTimeout(flush, FLUSH_MS)
}

/** Sends the problems held back at once, for one that explains a failure now. */
export function logProblemNow(text: string) {
  logProblem(text)
  window.clearTimeout(timer)
  flush()
}

window.addEventListener("error", (e) => {
  logProblem(`page error: ${e.message} at ${e.filename}:${e.lineno}`)
})
window.addEventListener("unhandledrejection", (e) => {
  const r: unknown = e.reason
  logProblem(`unhandled rejection: ${r instanceof Error ? r.message : String(r)}`)
})
