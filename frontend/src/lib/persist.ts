import { useState } from "react"

/*
  Choices of the view (basemap, zoom, last record) kept in localStorage, per
  machine. They are conveniences: storage that is unavailable or full only
  means the view starts from its defaults, so failures are not reported.
*/

export function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // see above
  }
}

export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readStored<T>(key) ?? initial)
  return [
    value,
    (v: T) => {
      setValue(v)
      writeStored(key, v)
    },
  ]
}
