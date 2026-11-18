import { useEffect, useMemo, useRef, useState } from "react"
import {
  BrowserOpenURL,
  ClipboardGetText,
  ClipboardSetText,
  OnFileDrop,
  OnFileDropOff,
} from "../../wailsjs/runtime/runtime"
import { api, errorText, imageURL } from "@/lib/api"
import { BASEMAPS } from "@/lib/basemaps"
import { composeCapture, type LegendItem } from "@/lib/capture"
import { distanceMeters, parseLocation, type Extent } from "@/lib/coordinates"
import {
  formatCount,
  formatLength,
  formatPosition,
  formatValue,
  plainPosition,
} from "@/lib/format"
import { googlePin, googleSatellite, googleStreetView } from "@/lib/links"
import { readStored, usePersisted, writeStored } from "@/lib/persist"
import { visibleRows, type ListOrder, type StatusFilter } from "@/lib/recordList"
import type {
  ExportResult,
  HistoryEntry,
  Image,
  Layer,
  LayerSettings,
  ProjectState,
  Entry,
  Row,
  Side,
  Summary,
  Table,
} from "@/lib/types"
import { AnnotationForm, type FormState } from "@/components/AnnotationForm"
import { CompareView } from "@/components/CompareView"
import { LocationBox, type NearRecord } from "@/components/LocationBox"
import { MapView, type ContextLayer, type MapHandle } from "@/components/MapView"
import { RecordList } from "@/components/RecordList"
import { SettingsDialog } from "@/components/SettingsDialog"
import { Slot } from "@/components/Slot"
import { Button, cn, Dialog, ErrorLine, inputClass, Kbd } from "@/components/ui"

// Okabe and Ito, in the order the default categories take them.
const CATEGORY_COLORS = [
  "#009E73",
  "#56B4E9",
  "#E69F00",
  "#CC79A7",
  "#D55E00",
  "#999999",
  "#0072B2",
  "#F0E442",
]
const CONTEXT_COLORS = [
  "#56B4E9",
  "#E69F00",
  "#CC79A7",
  "#009E73",
  "#D55E00",
  "#0072B2",
]

const emptyLayer: LayerSettings = {
  name_column: "",
  id_column: "",
  info_columns: [],
  hidden_columns: [],
}
const emptyForm: FormState = { category: "", reference_label: "", notes: "" }

function isPointLayer(l: Layer): boolean {
  const t = l.geometry_type.toUpperCase()
  return t === "POINT" || t === "MULTIPOINT"
}

function legendKind(l: Layer | undefined): LegendItem["kind"] {
  const t = (l?.geometry_type ?? "").toUpperCase()
  if (t.includes("POLYGON")) return "area"
  if (t.includes("LINE")) return "line"
  return "point"
}

function isTyping(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
  )
}

function withSummary(m: Map<number, Summary>, fid: number, r: Entry) {
  const next = new Map(m)
  if (!r.annotation && !r.source_image && !r.reference_image) next.delete(fid)
  else
    next.set(fid, {
      fid,
      category: r.annotation?.category ?? "",
      saved: r.annotation !== null,
      has_source_image: r.source_image !== null,
      has_reference_image: r.reference_image !== null,
    })
  return next
}

export function AnnotatePage({
  project,
  onProjectChange,
  onClose,
}: {
  project: ProjectState
  onProjectChange: (p: ProjectState) => void
  onClose: () => void
}) {
  const { info } = project
  const settings = info.settings
  const key = (k: string) => `${info.dir}::${k}`

  const pointLayers = useMemo(
    () => project.layers.filter((l) => isPointLayer(l) && !l.problem),
    [project.layers]
  )
  const [layerName, setLayerName] = usePersisted(
    key("layer"),
    pointLayers[0]?.name ?? ""
  )
  const layer = pointLayers.find((l) => l.name === layerName) ?? pointLayers[0] ?? null
  const ls: LayerSettings = {
    ...emptyLayer,
    ...(layer ? settings.layers[layer.name] : {}),
  }

  const [table, setTable] = useState<Table | null>(null)
  const [summaries, setSummaries] = useState(new Map<number, Summary>())
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)

  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [order, setOrder] = usePersisted<ListOrder>(key("order"), "fid")
  const [sqlText, setSqlText] = useState("")
  const [sqlIds, setSqlIds] = useState<Set<number> | null>(null)
  const [sqlError, setSqlError] = useState("")

  const [fid, setFid] = useState<number | null>(null)
  const [record, setRecord] = useState<Entry | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [dirty, setDirty] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)

  const [sourceTab, setSourceTab] = useState<"map" | "image">("map")
  const [activeSide, setActiveSide] = useState<Side>("reference")
  const [basemap, setBasemap] = usePersisted("basemap", "esri_imagery")
  const [labels, setLabels] = usePersisted("labels", false)
  const [zoom, setZoom] = usePersisted("zoom", 18)
  const [contextNames, setContextNames] = usePersisted<string[]>(key("context"), [])
  const [contextMessage, setContextMessage] = useState("")

  // A location the reader pasted, [lon, lat], and the request to centre on it.
  const [pasted, setPasted] = useState<[number, number] | null>(null)
  const [pastedRequest, setPastedRequest] = useState(0)
  const [locText, setLocText] = useState("")
  const [locError, setLocError] = useState("")
  const locInput = useRef<HTMLInputElement>(null)

  const [compare, setCompare] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exported, setExported] = useState<ExportResult | null>(null)
  const [relinkPath, setRelinkPath] = useState<string | null>(null)

  const mapRef = useRef<MapHandle>(null)
  const recordRequest = useRef(0)
  const lastIndex = useRef(0)

  const flash = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice((n) => (n === text ? "" : n)), 1800)
  }

  // ---- the layer -------------------------------------------------------------

  useEffect(() => {
    if (!layer) return
    let cancelled = false
    setTable(null)
    setLoadError("")
    Promise.all([api.loadLayer(layer.name), api.summaries(layer.name)])
      .then(([t, s]) => {
        if (cancelled) return
        setSummaries(new Map(s.map((x) => [x.fid, x])))
        setTable(t)
      })
      .catch((e) => !cancelled && setLoadError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [layer?.name])

  const columns = table?.columns ?? []
  const colIdx = useMemo(() => new Map(columns.map((c, i) => [c.name, i])), [columns])
  // Keyed by content: the settings object is rebuilt on every render.
  const hiddenKey = JSON.stringify(ls.hidden_columns ?? [])
  const hidden = useMemo(
    () => new Set<string>(JSON.parse(hiddenKey) as string[]),
    [hiddenKey]
  )
  const searchCols = useMemo(
    () => columns.flatMap((c, i) => (hidden.has(c.name) ? [] : [i])),
    [columns, hidden]
  )
  const shown = (name: string) => name !== "" && colIdx.has(name) && !hidden.has(name)
  const valueOf = (r: Row, name: string) =>
    shown(name) ? (r.values[colIdx.get(name) as number] ?? null) : null
  const titleOf = (r: Row) => {
    const v = valueOf(r, ls.name_column)
    return v === null || v === "" ? `fid ${r.fid}` : String(v)
  }
  const infoOf = (r: Row) =>
    (ls.info_columns ?? [])
      .filter(shown)
      .map((c) => formatValue(valueOf(r, c)))
      .join(" · ")
  const distanceTo = (r: Row) =>
    pasted && r.position
      ? distanceMeters(pasted[0], pasted[1], r.position[0], r.position[1])
      : null
  const detailOf = (r: Row) => {
    const id = valueOf(r, ls.id_column)
    const parts = [id !== null ? String(id) : "", infoOf(r)].filter(Boolean)
    // The title is already "fid N" when the layer has no name column.
    if (parts.length === 0 && valueOf(r, ls.name_column) !== null)
      parts.push(`fid ${r.fid}`)
    const d = distanceTo(r)
    if (d !== null) parts.unshift(formatLength(d))
    return parts.join(" · ")
  }

  const visible = useMemo(
    () =>
      table
        ? visibleRows(
            table.rows,
            summaries,
            { search, status, order, sqlIds, near: pasted },
            searchCols,
            settings.seed
          )
        : [],
    [table, summaries, search, status, order, sqlIds, pasted, searchCols, settings.seed]
  )
  // The layer's extent, which tells a latitude-longitude pair from a reversed one.
  const extent = useMemo<Extent | null>(() => {
    const pos = (table?.rows ?? []).flatMap((r) => (r.position ? [r.position] : []))
    if (pos.length === 0) return null
    return {
      minLon: Math.min(...pos.map((p) => p[0])),
      minLat: Math.min(...pos.map((p) => p[1])),
      maxLon: Math.max(...pos.map((p) => p[0])),
      maxLat: Math.max(...pos.map((p) => p[1])),
    }
  }, [table])
  const rowByFid = useMemo(
    () => new Map(table?.rows.map((r) => [r.fid, r]) ?? []),
    [table]
  )
  const selected = fid === null ? null : (rowByFid.get(fid) ?? null)
  const categorized = useMemo(
    () =>
      new Set(
        [...summaries.values()].filter((s) => s.category !== "").map((s) => s.fid)
      ),
    [summaries]
  )

  useEffect(() => {
    if (!table) return
    const stored = readStored<number>(key(`fid:${table.layer}`))
    setFid(stored !== null && rowByFid.has(stored) ? stored : (visible[0]?.fid ?? null))
  }, [table])

  useEffect(() => {
    if (table && fid !== null) writeStored(key(`fid:${table.layer}`), fid)
    const i = visible.findIndex((r) => r.fid === fid)
    if (i >= 0) lastIndex.current = i
  }, [fid, visible])

  // ---- the record ------------------------------------------------------------

  useEffect(() => {
    setHistory(null)
    if (!table || fid === null) {
      setRecord(null)
      return
    }
    const n = ++recordRequest.current
    setRecord(null)
    setForm(emptyForm)
    setDirty(false)
    api
      .record(table.layer, fid)
      .then((r) => {
        if (n !== recordRequest.current) return
        setRecord(r)
        setForm({
          category: r.annotation?.category ?? "",
          reference_label: r.annotation?.reference_label ?? "",
          notes: r.annotation?.notes ?? "",
        })
        setSourceTab(r.source_image ? "image" : "map")
      })
      .catch((e) => setError(errorText(e)))
  }, [table, fid])

  const refreshRecord = async () => {
    if (!table || fid === null) return
    const r = await api.record(table.layer, fid)
    setRecord(r)
    setSummaries((m) => withSummary(m, fid, r))
  }

  const save = async (): Promise<boolean> => {
    if (!table || fid === null || !dirty) return true
    setBusy(true)
    try {
      const r = await api.saveAnnotation({ layer: table.layer, fid, ...form })
      setRecord(r)
      setDirty(false)
      setSummaries((m) => withSummary(m, fid, r))
      if (history) setHistory(await api.history(table.layer, fid))
      flash("Saved")
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const selectFid = async (next: number) => {
    if (next === fid) return
    if (await save()) setFid(next)
  }

  const go = async (delta: number) => {
    const list = visible
    if (!(await save())) return
    let i = list.findIndex((r) => r.fid === fid)
    if (i < 0) i = lastIndex.current - (delta > 0 ? 1 : 0)
    const next = list[Math.max(0, Math.min(list.length - 1, i + delta))]
    if (next && next.fid !== fid) setFid(next.fid)
  }

  const changeLayer = async (name: string) => {
    if (!(await save())) return
    setFid(null)
    setSqlIds(null)
    setSqlText("")
    setSqlError("")
    setLayerName(name)
  }

  const toggleHistory = async () => {
    if (history) return setHistory(null)
    if (!table || fid === null) return
    try {
      setHistory(await api.history(table.layer, fid))
    } catch (e) {
      setError(errorText(e))
    }
  }

  // ---- screenshots -----------------------------------------------------------

  const withImage = async (f: () => Promise<Image | null>, side: Side) => {
    if (!table || fid === null) return
    setBusy(true)
    setError("")
    try {
      const img = await f()
      if (img) {
        await refreshRecord()
        if (side === "source") setSourceTab("image")
        flash("Screenshot kept")
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const basemapLabel = BASEMAPS.find((b) => b.id === basemap)?.label ?? basemap
  const contextLayers: ContextLayer[] = useMemo(
    () =>
      contextNames
        .filter((n) => project.layers.some((l) => l.name === n && !l.problem))
        .map((name, i) => ({ name, color: CONTEXT_COLORS[i % CONTEXT_COLORS.length] })),
    [contextNames, project.layers]
  )

  const captureMap = () =>
    withImage(async () => {
      if (!table || fid === null || !selected?.position || !mapRef.current) return null
      const cap = await mapRef.current.capture()
      const id = valueOf(selected, ls.id_column)
      const subtitle = [
        `layer ${table.layer}`,
        `fid ${fid}`,
        id !== null ? `${ls.id_column} ${formatValue(id)}` : "",
        ...(ls.info_columns ?? [])
          .filter(shown)
          .map((c) => `${c}: ${formatValue(valueOf(selected, c))}`),
      ]
        .filter(Boolean)
        .join(" · ")
      const legend: LegendItem[] = [
        { label: "this record", kind: "crosshair" },
        { label: "other records of the layer", kind: "record" },
      ]
      if (cap.pasted && pasted) {
        const d = distanceMeters(
          pasted[0],
          pasted[1],
          selected.position[0],
          selected.position[1]
        )
        legend.push({
          label: `pasted location, ${formatLength(d)} from the record`,
          kind: "pasted",
        })
      }
      if (categorized.size > 0)
        legend.push({ label: "records with a category", kind: "saved" })
      for (const c of contextLayers) {
        legend.push({
          label: c.name,
          kind: legendKind(project.layers.find((l) => l.name === c.name)),
          color: c.color,
        })
      }
      const dataURL = composeCapture(
        cap.canvas,
        cap.point,
        {
          title: titleOf(selected),
          subtitle,
          lon: selected.position[0],
          lat: selected.position[1],
          basemap: basemapLabel,
          zoom: cap.zoom,
          legend,
        },
        new Date(),
        cap.pasted
      )
      return api.saveMapCapture(
        table.layer,
        fid,
        dataURL,
        `${basemapLabel}, zoom ${cap.zoom.toFixed(1)}`
      )
    }, "source")

  const region = (side: Side) =>
    withImage(async () => {
      if (!table || fid === null) return null
      return api.captureScreenRegion(table.layer, fid, side)
    }, side)
  const paste = (side: Side) =>
    withImage(async () => {
      if (!table || fid === null) return null
      return api.pasteImage(table.layer, fid, side)
    }, side)
  const pickFile = (side: Side) =>
    withImage(async () => {
      if (!table || fid === null) return null
      return api.pickImageFile(table.layer, fid, side)
    }, side)
  const removeImage = async (img: Image | null) => {
    if (!img) return
    try {
      await api.removeImage(img.id)
      await refreshRecord()
      if (img.side === "source") setSourceTab("map")
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Files dropped on a slot arrive as paths, through Wails.
  const dropRef = useRef<(side: Side, path: string) => void>(() => {})
  dropRef.current = (side, path) => {
    if (!table || fid === null) return
    const layerName = table.layer
    const at = fid
    void withImage(() => api.importImageFile(layerName, at, side, path), side)
  }
  useEffect(() => {
    OnFileDrop((x, y, paths) => {
      const side = document
        .elementFromPoint(x, y)
        ?.closest("[data-slot]")
        ?.getAttribute("data-slot")
      if ((side === "source" || side === "reference") && paths[0])
        dropRef.current(side, paths[0])
    }, true)
    return () => OnFileDropOff()
  }, [])

  // ---- links -----------------------------------------------------------------

  const open = (make: (lon: number, lat: number) => string) => {
    if (selected?.position)
      BrowserOpenURL(make(selected.position[0], selected.position[1]))
  }

  // ---- pasted location -------------------------------------------------------

  /** Reads a location and centres the map on it; false when it cannot be read. */
  const goTo = (text: string): boolean => {
    const r = parseLocation(text, extent)
    if (!r.ok) {
      setLocError(r.reason)
      return false
    }
    setLocError("")
    setPasted([r.lon, r.lat])
    setPastedRequest((n) => n + 1)
    setSourceTab("map")
    if (r.swapped) flash("Read as longitude, latitude")
    return true
  }

  const nearest: NearRecord[] = useMemo(() => {
    if (!pasted || !table) return []
    return table.rows
      .flatMap((r) =>
        r.position
          ? [
              {
                fid: r.fid,
                row: r,
                meters: distanceMeters(
                  pasted[0],
                  pasted[1],
                  r.position[0],
                  r.position[1]
                ),
              },
            ]
          : []
      )
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 5)
      .map((n) => ({ fid: n.fid, title: titleOf(n.row), meters: n.meters }))
  }, [pasted, table, hidden, ls.name_column])

  /*
    ⌘V outside a text field: a location on the clipboard moves the map there;
    anything else is taken as an image for the active slot.
  */
  const pasteOrGo = async () => {
    const text = await ClipboardGetText().catch(() => "")
    if (text && text.length < 2000) {
      const r = parseLocation(text, extent)
      if (r.ok) {
        setLocText(text.trim())
        goTo(text)
        return
      }
    }
    await paste(activeSide)
  }

  // ---- keyboard --------------------------------------------------------------

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e) => {
    if (compare || settingsOpen || exported || relinkPath) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && k === "s") {
      e.preventDefault()
      void save()
      return
    }
    if (mod && e.key === "Enter") {
      e.preventDefault()
      void go(1)
      return
    }
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault()
      void go(e.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (isTyping(e.target)) return
    if (mod && k === "v") {
      e.preventDefault()
      void pasteOrGo()
      return
    }
    if (mod || e.altKey) return
    if (/^[1-9]$/.test(e.key)) {
      const c = settings.categories[Number(e.key) - 1]
      if (c) {
        setForm({ ...form, category: form.category === c.id ? "" : c.id })
        setDirty(true)
      }
      return
    }
    const actions: Record<string, () => void> = {
      j: () => void go(1),
      k: () => void go(-1),
      c: () => void captureMap(),
      r: () => void region(activeSide),
      g: () => open(googleSatellite),
      p: () => open(googlePin),
      v: () => open(googleStreetView),
      f: () => setCompare(true),
      m: () => setSourceTab(sourceTab === "map" ? "image" : "map"),
      l: () => {
        setSourceTab("map")
        locInput.current?.focus()
        locInput.current?.select()
      },
    }
    const act = actions[k]
    if (act) {
      e.preventDefault()
      act()
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ---- project-level actions -------------------------------------------------

  const relink = async (path: string, accept: boolean) => {
    try {
      onProjectChange(await api.relinkSource(path, accept))
      setRelinkPath(null)
    } catch (e) {
      const text = errorText(e)
      if (!accept && text.includes("different SHA-256")) setRelinkPath(path)
      else setError(text)
    }
  }
  const locateSource = async () => {
    const path = await api.pickGeoPackage()
    if (path) await relink(path, false)
  }
  const runExport = async () => {
    if (!(await save())) return
    setBusy(true)
    try {
      setExported(await api.exportProject())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const categoryColor = (id: string) => {
    const i = settings.categories.findIndex((c) => c.id === id)
    return i < 0 ? "#777" : CATEGORY_COLORS[i % CATEGORY_COLORS.length]
  }
  const total = table?.rows.length ?? 0
  const sourceWarning =
    project.source_error ||
    (info.source_status === "changed"
      ? "The GeoPackage at the recorded path is not the file this project was made on (its SHA-256 differs). Feature ids may now point at other records."
      : info.source_status === "missing"
        ? "The GeoPackage is not at its recorded path."
        : "")

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{info.name}</span>
          <span className="truncate text-[11px] text-muted" title={info.source.path}>
            {info.source.path.split("/").pop()}
          </span>
        </div>
        <select
          className={inputClass}
          value={layer?.name ?? ""}
          onChange={(e) => void changeLayer(e.target.value)}
        >
          {pointLayers.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name} ({formatCount(l.feature_count)})
            </option>
          ))}
        </select>
        {table && (
          <span className="text-[12px] text-muted">
            {formatCount(categorized.size)} of {formatCount(total)} with a category
          </span>
        )}
        <div className="flex-1" />
        <select
          className={inputClass}
          value={basemap}
          onChange={(e) => setBasemap(e.target.value)}
          title="Basemap of the map on the left"
        >
          {BASEMAPS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[12px]">
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => setLabels(e.target.checked)}
          />
          Place names
        </label>
        <details className="relative">
          <summary className="flex h-7 cursor-default list-none items-center rounded border border-line bg-raised px-2.5 text-[12px] hover:bg-hover">
            Context layers{contextLayers.length ? ` (${contextLayers.length})` : ""}
          </summary>
          <div className="absolute right-0 z-40 mt-1 max-h-[60vh] w-[300px] overflow-y-auto rounded border border-line bg-panel p-2 shadow-xl">
            <p className="mb-1 text-[11px] text-muted">
              Other layers of the GeoPackage, drawn for the area in view.
            </p>
            {project.layers
              .filter((l) => l.name !== layer?.name)
              .map((l) => (
                <label
                  key={l.name}
                  className={cn(
                    "flex items-center gap-2 py-0.5 text-[12px]",
                    l.problem && "opacity-50"
                  )}
                  title={l.problem}
                >
                  <input
                    type="checkbox"
                    disabled={!!l.problem}
                    checked={contextNames.includes(l.name)}
                    onChange={(e) =>
                      setContextNames(
                        e.target.checked
                          ? [...contextNames, l.name]
                          : contextNames.filter((n) => n !== l.name)
                      )
                    }
                  />
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="text-muted">{l.geometry_type.toLowerCase()}</span>
                </label>
              ))}
          </div>
        </details>
        <Button onClick={() => setSettingsOpen(true)}>Settings</Button>
        <Button disabled={busy} onClick={() => void runExport()}>
          Export
        </Button>
        <Button tone="ghost" onClick={() => void save().then((ok) => ok && onClose())}>
          Close project
        </Button>
      </header>

      {sourceWarning && (
        <div className="flex items-center gap-3 border-b border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          <span className="flex-1 select-text">{sourceWarning}</span>
          {info.source_status === "changed" && (
            <Button onClick={() => setRelinkPath(info.source.path)}>
              Accept this file
            </Button>
          )}
          <Button onClick={() => void locateSource()}>Locate GeoPackage…</Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* record list */}
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
          <div className="flex flex-col gap-2 border-b border-line p-2">
            <input
              className={inputClass}
              placeholder="Search names and attributes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className={cn(inputClass, "min-w-0 flex-1")}
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
              >
                <option value="all">All records</option>
                <option value="uncategorized">Without a category</option>
                <option value="categorized">With a category</option>
                <option value="no_reference_image">
                  Without a reference screenshot
                </option>
                {settings.categories.map((c) => (
                  <option key={c.id} value={`category:${c.id}`}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                className={cn(inputClass, "w-[118px]")}
                value={order}
                onChange={(e) => setOrder(e.target.value as ListOrder)}
                title={
                  order === "random"
                    ? `Random order drawn from seed ${settings.seed}`
                    : ""
                }
              >
                <option value="fid">Feature id</option>
                <option value="random">Random ({settings.seed})</option>
                <option value="distance" disabled={!pasted}>
                  Distance to pasted location
                </option>
              </select>
            </div>
            <details>
              <summary className="cursor-default text-[11px] text-muted">
                SQL condition{sqlIds ? ` (applied, ${formatCount(sqlIds.size)})` : ""}
              </summary>
              <div className="mt-1 flex flex-col gap-1">
                <textarea
                  className={cn(
                    inputClass,
                    "h-14 resize-none py-1 font-mono text-[11px]"
                  )}
                  placeholder="matched = 0 AND distance_to_road_km > 5"
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                />
                <div className="flex gap-1">
                  <Button
                    disabled={!sqlText.trim() || !layer}
                    onClick={() => {
                      if (!layer) return
                      setSqlError("")
                      api
                        .filterLayer(layer.name, sqlText)
                        .then((ids) => setSqlIds(new Set(ids)))
                        .catch((e) => setSqlError(errorText(e)))
                    }}
                  >
                    Apply
                  </Button>
                  <Button
                    tone="ghost"
                    disabled={!sqlIds}
                    onClick={() => {
                      setSqlIds(null)
                      setSqlError("")
                    }}
                  >
                    Clear
                  </Button>
                </div>
                {sqlError && (
                  <p className="text-[11px] text-danger select-text">{sqlError}</p>
                )}
              </div>
            </details>
            <span className="text-[11px] text-muted">
              {formatCount(visible.length)} of {formatCount(total)} records shown
            </span>
          </div>
          {loadError ? (
            <div className="p-3">
              <ErrorLine text={loadError} />
            </div>
          ) : !table ? (
            <p className="p-3 text-muted">Reading the layer…</p>
          ) : (
            <RecordList
              rows={visible}
              selected={fid}
              onSelect={(n) => void selectFid(n)}
              summaries={summaries}
              categories={settings.categories}
              categoryColor={categoryColor}
              text={{ title: titleOf, detail: detailOf }}
            />
          )}
        </aside>

        {/* the record */}
        <main className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <div className="flex shrink-0 items-start gap-3 px-1">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[16px] font-semibold select-text">
                {selected ? titleOf(selected) : "No record selected"}
              </h1>
              {selected && (
                <p className="truncate text-[12px] text-muted select-text">
                  {detailOf(selected)}
                  {selected.position
                    ? ` · ${formatPosition(selected.position[0], selected.position[1])}`
                    : " · no position"}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                disabled={!selected?.position}
                onClick={() => open(googleSatellite)}
              >
                Google Maps <Kbd>G</Kbd>
              </Button>
              <Button disabled={!selected?.position} onClick={() => open(googlePin)}>
                Pin <Kbd>P</Kbd>
              </Button>
              <Button
                disabled={!selected?.position}
                onClick={() => open(googleStreetView)}
              >
                Street View <Kbd>V</Kbd>
              </Button>
              <Button
                tone="ghost"
                disabled={!selected?.position}
                onClick={() => {
                  if (!selected?.position) return
                  void ClipboardSetText(
                    plainPosition(selected.position[0], selected.position[1])
                  )
                  flash("Coordinates copied")
                }}
              >
                Copy lat, lon
              </Button>
              <div className="mx-1 h-5 w-px bg-line" />
              <Button tone="ghost" onClick={() => void go(-1)}>
                Previous <Kbd>⌥↑</Kbd>
              </Button>
              <Button tone="ghost" onClick={() => void go(1)}>
                Next <Kbd>⌥↓</Kbd>
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-[3] gap-2">
            <Slot
              side="source"
              active={activeSide === "source"}
              onActivate={() => setActiveSide("source")}
              title={
                <>
                  Layer <span className="font-normal text-muted">{table?.layer}</span>
                </>
              }
              tabs={
                <div className="flex rounded border border-line text-[11px]">
                  {(["map", "image"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={t === "image" && !record?.source_image}
                      onClick={() => setSourceTab(t)}
                      className={cn(
                        "px-2 py-0.5 disabled:opacity-40",
                        sourceTab === t ? "bg-raised text-text" : "text-muted"
                      )}
                    >
                      {t === "map" ? "Live map" : "Screenshot"}
                    </button>
                  ))}
                  <span className="px-1 py-0.5">
                    <Kbd>M</Kbd>
                  </span>
                </div>
              }
              image={record?.source_image ?? null}
              busy={busy}
              onRegion={() => void region("source")}
              onPaste={() => void paste("source")}
              onFile={() => void pickFile("source")}
              onRemove={() => void removeImage(record?.source_image ?? null)}
              onOpenImage={() => setCompare(true)}
              extraActions={
                <Button
                  tone="primary"
                  disabled={busy || !selected?.position}
                  onClick={() => void captureMap()}
                  title="Keep a picture of the map on the left, with the record, coordinates and scale"
                >
                  Capture map <Kbd>C</Kbd>
                </Button>
              }
            >
              <div
                className={cn("absolute inset-0", sourceTab !== "map" && "invisible")}
              >
                <MapView
                  ref={mapRef}
                  rows={table?.rows ?? []}
                  saved={categorized}
                  selected={selected}
                  onSelect={(n) => void selectFid(n)}
                  basemap={basemap}
                  labels={labels}
                  context={contextLayers}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  onContextMessage={setContextMessage}
                  pasted={pasted}
                  pastedRequest={pastedRequest}
                />
                <LocationBox
                  inputRef={locInput}
                  text={locText}
                  onTextChange={(t) => {
                    setLocText(t)
                    setLocError("")
                  }}
                  onGo={goTo}
                  error={locError}
                  pasted={pasted}
                  layer={table?.layer ?? ""}
                  nearest={nearest}
                  selected={fid}
                  onPick={(n) => void selectFid(n)}
                  onShow={() => setPastedRequest((n) => n + 1)}
                  onClear={() => {
                    setPasted(null)
                    setLocText("")
                    setLocError("")
                    if (order === "distance") setOrder("fid")
                  }}
                />
                {contextMessage && (
                  <div className="absolute bottom-8 left-2 rounded bg-black/70 px-2 py-1 text-[11px]">
                    {contextMessage}
                  </div>
                )}
              </div>
              {sourceTab === "image" && record?.source_image && (
                <button
                  type="button"
                  className="absolute inset-0 cursor-zoom-in"
                  onClick={() => setCompare(true)}
                >
                  <img
                    src={imageURL(record.source_image)}
                    alt="layer screenshot"
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                </button>
              )}
            </Slot>

            <Slot
              side="reference"
              active={activeSide === "reference"}
              onActivate={() => setActiveSide("reference")}
              title={
                <>
                  Reference{" "}
                  <span className="font-normal text-muted">
                    Google Maps or Street View
                  </span>
                </>
              }
              image={record?.reference_image ?? null}
              busy={busy}
              onRegion={() => void region("reference")}
              onPaste={() => void paste("reference")}
              onFile={() => void pickFile("reference")}
              onRemove={() => void removeImage(record?.reference_image ?? null)}
              onOpenImage={() => setCompare(true)}
            />
          </div>

          <div className="grid min-h-[230px] flex-[2] grid-cols-[1fr_300px] gap-2">
            <div className="flex min-h-0 flex-col rounded-md border border-line bg-panel p-3">
              <AnnotationForm
                categories={settings.categories}
                categoryColor={categoryColor}
                form={form}
                onChange={(f) => {
                  setForm(f)
                  setDirty(true)
                }}
                record={record}
                dirty={dirty}
                busy={busy || !selected}
                onSave={() => void save()}
                onSaveAndNext={() => void go(1)}
                history={history}
                onToggleHistory={() => void toggleHistory()}
              />
            </div>
            <div className="flex min-h-0 flex-col rounded-md border border-line bg-panel">
              <div className="border-b border-line px-3 py-2 text-[11px] font-medium tracking-wide text-muted uppercase">
                Attributes
                {hidden.size > 0 && (
                  <span className="ml-1 tracking-normal normal-case">
                    ({hidden.size} hidden while annotating)
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
                {selected && (
                  <table className="w-full text-[12px]">
                    <tbody>
                      {columns.map((c, i) =>
                        hidden.has(c.name) ? null : (
                          <tr
                            key={c.name}
                            className="border-b border-line/40 align-top"
                          >
                            <td className="py-0.5 pr-2 text-muted">{c.name}</td>
                            <td className="py-0.5 [overflow-wrap:anywhere] select-text">
                              {formatValue(selected.values[i])}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {(error || notice) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center">
          <div className="pointer-events-auto w-[640px] max-w-[90vw]">
            {error ? (
              <ErrorLine text={error} onDismiss={() => setError("")} />
            ) : (
              <div className="mx-auto w-fit rounded bg-raised px-3 py-1.5 text-[12px] shadow-lg">
                {notice}
              </div>
            )}
          </div>
        </div>
      )}

      {compare && selected && (
        <CompareView
          title={`${titleOf(selected)} · fid ${selected.fid}`}
          source={record?.source_image ?? null}
          reference={record?.reference_image ?? null}
          onClose={() => setCompare(false)}
        />
      )}

      {settingsOpen && layer && (
        <SettingsDialog
          settings={settings}
          layer={layer.name}
          columns={columns}
          onSave={async (s) => onProjectChange(await api.updateSettings(s))}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {exported && (
        <Dialog
          title="Export written"
          onClose={() => setExported(null)}
          footer={
            <>
              <Button onClick={() => void api.reveal(exported.dir)}>
                Show in Finder
              </Button>
              <Button tone="primary" onClick={() => setExported(null)}>
                Done
              </Button>
            </>
          }
        >
          <p className="mb-3 break-all text-muted select-text">{exported.dir}</p>
          <ul className="mb-3 flex flex-col gap-1">
            {exported.layers.map((l) => (
              <li key={l.layer}>
                <span className="font-medium">{l.layer}</span>: {formatCount(l.records)}{" "}
                records, {formatCount(l.revisions)} saved revisions
                {l.without_position > 0 &&
                  `, ${l.without_position} without a position left out of the GeoPackage`}
              </li>
            ))}
          </ul>
          <ul className="text-[12px] text-muted">
            {exported.files.map((f) => (
              <li key={f}>{f.split("/").pop()}</li>
            ))}
          </ul>
        </Dialog>
      )}

      {relinkPath && (
        <Dialog
          title="Use a GeoPackage with a different SHA-256?"
          onClose={() => setRelinkPath(null)}
          footer={
            <>
              <Button onClick={() => setRelinkPath(null)}>Cancel</Button>
              <Button tone="danger" onClick={() => void relink(relinkPath, true)}>
                Use this file
              </Button>
            </>
          }
        >
          <p className="mb-2">
            <span className="break-all select-text">{relinkPath}</span> is not the file
            this project was made on.
          </p>
          <p className="text-muted">
            Answers are tied to feature ids. If the file was regenerated, an id may now
            name another record. The new hash is recorded and the old one kept in the
            project.
          </p>
        </Dialog>
      )}
    </div>
  )
}
