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
import { layerColor } from "@/lib/palette"
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
  NearRecord,
  ProjectState,
  Entry,
  Row,
  Side,
  Summary,
  Table,
} from "@/lib/types"
import { AnnotationForm, type FormState } from "@/components/AnnotationForm"
import { CompareView } from "@/components/CompareView"
import { LocationField } from "@/components/LocationField"
import { MapLegend } from "@/components/MapLegend"
import {
  MapView,
  type MapHandle,
  type MapLayer,
  type MapSelection,
} from "@/components/MapView"
import { CaretDown, CaretRight, Copy, Warning } from "@/components/icons"
import { MapTools } from "@/components/MapTools"
import { RecordList } from "@/components/RecordList"
import { SettingsDialog } from "@/components/SettingsDialog"
import { Slot } from "@/components/Slot"
import { BarButton, PathStep, TitleBar } from "@/components/TitleBar"
import {
  Button,
  cn,
  Dialog,
  ErrorLine,
  inputClass,
  Kbd,
  Panel,
  PanelHeader,
  Toast,
  type ToastTone,
} from "@/components/ui"

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

const emptyLayer: LayerSettings = {
  name_column: "",
  id_column: "",
  info_columns: [],
  hidden_columns: [],
}
const emptyForm: FormState = { category: "", reference_label: "", notes: "" }

/*
  A pasted location this close to a record is that record: a coordinate copied
  from the layer's own attributes, or from another tool reading the same
  file, lands within millimetres of it.
*/
const EXACT_MATCH_METERS = 1

function isPointLayer(l: Layer): boolean {
  const t = l.geometry_type.toUpperCase()
  return t === "POINT" || t === "MULTIPOINT"
}

function geometryKind(l: Layer): MapLayer["kind"] {
  const t = l.geometry_type.toUpperCase()
  if (t.includes("POLYGON")) return "area"
  if (t.includes("LINE")) return "line"
  return "point"
}

// Layers up to this many features are sent to the map whole (see gpkg.GeoJSON).
const WHOLE_LAYER_FEATURES = 50_000
const NAME_GUESSES = ["name", "nome", "nm_mun", "label"]
const EMPTY_SUMMARIES = new Map<number, Summary>()

/**
 * Where the map reads a whole layer. A layer of records needs only its names,
 * for the hover label: its attributes are shown from the table once a record
 * is opened, and sending them all is 4.7 MB for the CNEFE schools.
 */
function layerURL(name: string, keep: string | null): string {
  const path = `/layer-geojson/${encodeURIComponent(name)}`
  return keep === null ? path : `${path}?keep=${encodeURIComponent(keep)}`
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

  /*
    The layers of the open register: the open layer, and every
    point layer whose identifier column has the same name (cnefe_id for both
    CNEFE layers). They are drawn by default, a press on one of their points
    opens that record, and a pasted location is looked up in them. Layers of
    another source, such as OpenStreetMap, are left out: "an OpenStreetMap
    school 30 m away" would tell the annotator what a hidden matched column
    holds.
  */
  const registerLayers = useMemo(() => {
    if (!layer) return []
    const id = ls.id_column
    return pointLayers
      .filter(
        (l) =>
          l.name === layer.name ||
          (id !== "" && settings.layers[l.name]?.id_column === id)
      )
      .map((l) => l.name)
  }, [layer, ls.id_column, pointLayers, settings.layers])
  const registerKey = registerLayers.join("\n")

  const [table, setTable] = useState<Table | null>(null)
  // Every layer read so far, kept so that going back to one is instant.
  const tables = useRef(new Map<string, Table>())
  const [summariesByLayer, setSummariesByLayer] = useState(
    new Map<string, Map<number, Summary>>()
  )
  const summaries = summariesByLayer.get(layer?.name ?? "") ?? EMPTY_SUMMARIES
  const updateSummary = (layerName: string, recordFid: number, r: Entry) =>
    setSummariesByLayer((all) => {
      const next = new Map(all)
      next.set(
        layerName,
        withSummary(all.get(layerName) ?? EMPTY_SUMMARIES, recordFid, r)
      )
      return next
    })
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<{ text: string; tone: ToastTone } | null>(null)
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
  // The layers drawn besides the open one; until chosen, the open register's.
  const [shownNames, setShownNames] = usePersisted<string[] | null>(key("drawn"), null)
  const drawnNames = shownNames ?? registerLayers
  const [contextMessage, setContextMessage] = useState("")

  // A location the reader pasted that is not a record, [lon, lat].
  const [pasted, setPasted] = useState<[number, number] | null>(null)
  const [locText, setLocText] = useState("")
  const [locError, setLocError] = useState("")
  const locInput = useRef<HTMLInputElement>(null)

  const [compare, setCompare] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exported, setExported] = useState<ExportResult | null>(null)
  const [relinkPath, setRelinkPath] = useState<string | null>(null)

  const mapRef = useRef<MapHandle>(null)
  const recordRequest = useRef(0)
  // A record to select once its layer has loaded, when a pasted location
  // opened a record of another layer.
  const pendingRecord = useRef<{ layer: string; fid: number } | null>(null)
  const lastIndex = useRef(0)

  const flash = (text: string, tone: ToastTone = "success", ms = 2200) => {
    setNotice({ text, tone })
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), ms)
  }

  // ---- the layer -------------------------------------------------------------

  useEffect(() => {
    if (!layer) return
    const cached = tables.current.get(layer.name)
    setLoadError("")
    if (cached) {
      setTable(cached)
      return
    }
    let cancelled = false
    setTable(null)
    api
      .loadLayer(layer.name)
      .then((t) => {
        tables.current.set(t.layer, t)
        if (!cancelled) setTable(t)
      })
      .catch((e) => !cancelled && setLoadError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [layer?.name])

  // Which records have an answer, for every point layer, so the map can ring them.
  useEffect(() => {
    let cancelled = false
    Promise.all(
      pointLayers.map((l) =>
        api
          .summaries(l.name)
          .then((list) => [l.name, new Map(list.map((x) => [x.fid, x]))] as const)
      )
    )
      .then((all) => !cancelled && setSummariesByLayer(new Map(all)))
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [pointLayers])

  // The other layers of the register are read in the background once the open
  // one is on screen, so that a record of theirs opens without waiting.
  useEffect(() => {
    if (!table) return
    let cancelled = false
    void (async () => {
      for (const name of registerLayers) {
        if (cancelled || tables.current.has(name)) continue
        try {
          tables.current.set(name, await api.loadLayer(name))
        } catch {
          // Read again, with its error shown, when it is opened.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [table, registerKey])

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
  const detailOf = (r: Row) => {
    const id = valueOf(r, ls.id_column)
    const parts = [id !== null ? String(id) : "", infoOf(r)].filter(Boolean)
    // The title is already "fid N" when the layer has no name column.
    if (parts.length === 0 && valueOf(r, ls.name_column) !== null)
      parts.push(`fid ${r.fid}`)
    return parts.join(" · ")
  }

  const visible = useMemo(
    () =>
      table
        ? visibleRows(
            table.rows,
            summaries,
            { search, status, order, sqlIds },
            searchCols,
            settings.seed
          )
        : [],
    [table, summaries, search, status, order, sqlIds, searchCols, settings.seed]
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
  const categorizedByLayer = useMemo(
    () =>
      Object.fromEntries(
        [...summariesByLayer].map(([name, m]) => [
          name,
          [...m.values()].filter((x) => x.category !== "").map((x) => x.fid),
        ])
      ),
    [summariesByLayer]
  )
  const mapSelection = useMemo<MapSelection | null>(
    () =>
      table && selected?.position
        ? { layer: table.layer, fid: selected.fid, position: selected.position }
        : null,
    [table, selected]
  )
  // A pasted location belongs to the record it was pasted for.
  useEffect(() => {
    setPasted(null)
    setLocText("")
    setLocError("")
  }, [table?.layer, fid])

  useEffect(() => {
    if (!table) return
    const pending = pendingRecord.current
    pendingRecord.current = null
    if (pending && pending.layer === table.layer && rowByFid.has(pending.fid)) {
      setFid(pending.fid)
      return
    }
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
    setSourceTab("map")
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
      })
      .catch((e) => setError(errorText(e)))
  }, [table, fid])

  const refreshRecord = async () => {
    if (!table || fid === null) return
    const r = await api.record(table.layer, fid)
    setRecord(r)
    updateSummary(table.layer, fid, r)
  }

  const save = async (): Promise<boolean> => {
    if (!table || fid === null || !dirty) return true
    setBusy(true)
    try {
      const r = await api.saveAnnotation({ layer: table.layer, fid, ...form })
      setRecord(r)
      setDirty(false)
      updateSummary(table.layer, fid, r)
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

  const changeLayer = async (name: string, select?: number) => {
    if (!(await save())) return
    pendingRecord.current = select === undefined ? null : { layer: name, fid: select }
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
  const drawnKey = drawnNames.join("\n")
  const mapLayers: MapLayer[] = useMemo(
    () =>
      project.layers.flatMap((l, i) => {
        if (l.problem) return []
        if (l.name !== layer?.name && !drawnNames.includes(l.name)) return []
        const s = settings.layers[l.name]
        const cols = l.columns.map((c) => c.name)
        const nameColumn =
          s?.name_column && !(s.hidden_columns ?? []).includes(s.name_column)
            ? s.name_column
            : (NAME_GUESSES.find((g) => cols.includes(g)) ?? "")
        return [
          {
            name: l.name,
            color: layerColor(i),
            kind: geometryKind(l),
            url:
              l.feature_count <= WHOLE_LAYER_FEATURES
                ? layerURL(l.name, registerLayers.includes(l.name) ? nameColumn : null)
                : null,
            records: registerLayers.includes(l.name),
            nameColumn,
          },
        ]
      }),
    [project.layers, layer?.name, drawnKey, registerKey, settings.layers]
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
        { label: `selected record, ${table.layer}`, kind: "crosshair" },
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
      for (const l of mapLayers)
        legend.push({ label: l.name, kind: l.kind, color: l.color })
      if (
        mapLayers.some(
          (l) => l.records && (categorizedByLayer[l.name]?.length ?? 0) > 0
        )
      )
        legend.push({ label: "has a category", kind: "categorized" })
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

  /** Opens a record, switching to its layer when it is another. */
  const openRecord = async (layerName: string, recordFid: number) => {
    if (table?.layer === layerName) await selectFid(recordFid)
    else await changeLayer(layerName, recordFid)
  }

  /*
    Going to a pasted location. A record of the open register within 1 m of it
    is the record the coordinate was copied from, and it is opened. Anywhere
    else the map flies there, marks the place, and a note gives the nearest
    record and the distance from the selected one.
  */
  const arrive = async (lon: number, lat: number, swapped: boolean) => {
    const prefix = swapped ? "Read as longitude, latitude. " : ""
    let near: NearRecord[] = []
    try {
      near = await api.nearestRecords(registerLayers, lon, lat, 1)
    } catch (e) {
      setError(errorText(e))
    }
    const n = near[0]
    if (n && n.meters <= EXACT_MATCH_METERS) {
      flash(`${prefix}${n.title} · ${n.layer}`, "info")
      if (n.layer === table?.layer && n.fid === fid) mapRef.current?.flyTo(lon, lat)
      else await openRecord(n.layer, n.fid)
      return
    }
    setPasted([lon, lat])
    mapRef.current?.flyTo(lon, lat)
    const parts = [`${prefix}No record at this location.`]
    if (n) parts.push(`Nearest: ${n.title} (${n.layer}), ${formatLength(n.meters)}.`)
    if (selected?.position)
      parts.push(
        `${formatLength(distanceMeters(lon, lat, selected.position[0], selected.position[1]))} from the selected record.`
      )
    flash(parts.join(" "), "info", 6000)
  }

  /** Reads a location and goes there; false when it cannot be read. */
  const goTo = (text: string): boolean => {
    const r = parseLocation(text, extent)
    if (!r.ok) {
      setLocError(r.reason)
      return false
    }
    setLocError("")
    setSourceTab("map")
    void arrive(r.lon, r.lat, r.swapped)
    return true
  }

  const copyPosition = (lon: number, lat: number) => {
    const text = plainPosition(lon, lat)
    void ClipboardSetText(text).then(() => flash(`Copied ${text}`))
  }

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

  const layersPanel = (
    <div className="flex flex-col py-1.5">
      <p className="px-3 pb-1.5 text-meta text-muted-foreground">
        Layers of the GeoPackage drawn on the map. Pressing a point of a layer marked
        “records” opens that record.
      </p>
      {project.layers.map((l, i) => {
        const isOpen = l.name === layer?.name
        const kind = geometryKind(l)
        const color = layerColor(i)
        return (
          <label
            key={l.name}
            className={cn(
              "flex h-7 shrink-0 items-center gap-2 px-3 text-label hover:bg-[rgb(var(--p-surface-raised)/0.6)]",
              l.problem && "opacity-50"
            )}
            title={l.problem || l.description}
          >
            <input
              type="checkbox"
              className="accent-primary"
              disabled={!!l.problem || isOpen}
              checked={isOpen || drawnNames.includes(l.name)}
              onChange={(e) =>
                setShownNames(
                  e.target.checked
                    ? [...drawnNames, l.name]
                    : drawnNames.filter((n) => n !== l.name)
                )
              }
            />
            <span
              className={cn(
                "shrink-0 border border-black/60",
                kind === "point"
                  ? "size-2.5 rounded-full"
                  : kind === "line"
                    ? "h-1 w-3"
                    : "h-2.5 w-3"
              )}
              style={{ background: color }}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-foreground">
              {l.name}
            </span>
            <span className="shrink-0 text-meta text-muted-foreground">
              {isOpen ? (
                "open"
              ) : registerLayers.includes(l.name) ? (
                "records"
              ) : (
                <>
                  <span className="telemetry">{formatCount(l.feature_count)}</span>{" "}
                  {kind === "point" ? "points" : kind === "line" ? "lines" : "areas"}
                </>
              )}
            </span>
          </label>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-app">
      <TitleBar
        path={[
          <PathStep key="project" title={info.source.path}>
            {info.name}
          </PathStep>,
          /*
            The layer is the place in the path, and choosing another is done on
            the step itself, as TERRA's steps open their own menus.
          */
          /*
            The name is drawn by the step and the system's own menu is opened
            by a select laid over it, unseen: a select sizes itself to its
            longest option, so drawn as itself it would leave a gap after a
            short name.
          */
          <label
            key="layer"
            title="Layer to annotate"
            className="app-no-drag relative flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-heading text-foreground focus-within:ring-1 focus-within:ring-ring hover:bg-hover"
          >
            <span className="min-w-0 truncate">{layer?.name ?? "no point layer"}</span>
            {layer && (
              <span className="telemetry shrink-0 text-label text-muted-foreground">
                {formatCount(layer.feature_count)}
              </span>
            )}
            <CaretDown className="size-3 shrink-0 text-muted-foreground" />
            <select
              aria-label="Layer to annotate"
              className="absolute inset-0 cursor-default opacity-0"
              value={layer?.name ?? ""}
              onChange={(e) => void changeLayer(e.target.value)}
            >
              {pointLayers.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name} ({formatCount(l.feature_count)})
                </option>
              ))}
            </select>
          </label>,
        ]}
      >
        {table && (
          <span className="mr-3 shrink-0 text-label text-muted-foreground">
            <span className="telemetry text-foreground">
              {formatCount(categorized.size)}
            </span>{" "}
            of <span className="telemetry">{formatCount(total)}</span> with a category
          </span>
        )}
        <BarButton onClick={() => setSettingsOpen(true)}>Settings</BarButton>
        <BarButton disabled={busy} onClick={() => void runExport()}>
          Export
        </BarButton>
        <BarButton onClick={() => void save().then((ok) => ok && onClose())}>
          Close project
        </BarButton>
      </TitleBar>

      {sourceWarning && (
        <div className="mx-2 mb-2 flex items-center gap-3 rounded-md border border-destructive-quiet/35 bg-destructive/15 px-3 py-2 text-label text-destructive-quiet">
          <Warning className="size-4 shrink-0" />
          <span className="flex-1 select-text">{sourceWarning}</span>
          {info.source_status === "changed" && (
            <Button size="dense" onClick={() => setRelinkPath(info.source.path)}>
              Accept this file
            </Button>
          )}
          <Button size="dense" onClick={() => void locateSource()}>
            Locate GeoPackage…
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        {/* record list */}
        <Panel className="w-[300px] shrink-0">
          <PanelHeader
            title="Records"
            detail={
              <>
                <span className="telemetry">{formatCount(visible.length)}</span> of{" "}
                <span className="telemetry">{formatCount(total)}</span> shown
              </>
            }
          />
          <div className="flex flex-col gap-2 border-b border-border p-2">
            <input
              className={inputClass}
              placeholder="Search names and attributes"
              aria-label="Search names and attributes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className={cn(inputClass, "min-w-0 flex-1")}
                aria-label="Records to show"
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
                aria-label="Order"
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
              </select>
            </div>
            <details className="group">
              <summary className="flex cursor-default list-none items-center gap-1.5 text-label text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                <CaretRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                SQL condition
                {sqlIds && (
                  <span className="text-accent-quiet">
                    applied,{" "}
                    <span className="telemetry">{formatCount(sqlIds.size)}</span>
                  </span>
                )}
              </summary>
              <div className="mt-1.5 flex flex-col gap-1.5">
                <textarea
                  className={cn(
                    inputClass,
                    "h-14 resize-none py-1 font-mono text-meta"
                  )}
                  aria-label="SQL condition"
                  placeholder="matched = 0 AND distance_to_road_km > 5"
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                />
                <div className="flex gap-1">
                  <Button
                    size="dense"
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
                    size="dense"
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
                  <p className="text-meta text-destructive-quiet select-text">
                    {sqlError}
                  </p>
                )}
              </div>
            </details>
          </div>
          {loadError ? (
            <div className="p-3">
              <ErrorLine text={loadError} />
            </div>
          ) : !table ? (
            <p className="p-3 text-read text-muted-foreground">Reading the layer…</p>
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
        </Panel>

        {/* the record */}
        <main className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex shrink-0 items-center gap-3 px-1">
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-display font-semibold tracking-wide select-text">
                {selected ? titleOf(selected) : "No record selected"}
              </h1>
              {selected && (
                <p className="truncate text-label text-muted-foreground select-text">
                  {detailOf(selected)}
                  {selected.position ? (
                    <>
                      {" · "}
                      <span className="telemetry">
                        {formatPosition(selected.position[0], selected.position[1])}
                      </span>
                    </>
                  ) : (
                    " · no position"
                  )}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="dense"
                disabled={!selected?.position}
                onClick={() => open(googleSatellite)}
              >
                Google Maps <Kbd>G</Kbd>
              </Button>
              <Button
                size="dense"
                disabled={!selected?.position}
                onClick={() => open(googlePin)}
              >
                Pin <Kbd>P</Kbd>
              </Button>
              <Button
                size="dense"
                disabled={!selected?.position}
                onClick={() => open(googleStreetView)}
              >
                Street View <Kbd>V</Kbd>
              </Button>
              <Button
                tone="ghost"
                size="dense"
                disabled={!selected?.position}
                onClick={() => {
                  if (!selected?.position) return
                  void ClipboardSetText(
                    plainPosition(selected.position[0], selected.position[1])
                  )
                  flash("Coordinates copied")
                }}
              >
                <Copy className="size-3.5" />
                Copy lat, lon
              </Button>
              <div className="mx-1 h-5 w-px bg-line/40" />
              <Button tone="ghost" size="dense" onClick={() => void go(-1)}>
                Previous <Kbd>⌥↑</Kbd>
              </Button>
              <Button tone="ghost" size="dense" onClick={() => void go(1)}>
                Next <Kbd>⌥↓</Kbd>
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-[3] gap-2">
            <Slot
              side="source"
              active={activeSide === "source"}
              onActivate={() => setActiveSide("source")}
              title="Layer"
              detail={<span className="font-mono">{table?.layer}</span>}
              tabs={
                <div className="flex shrink-0 items-center gap-1.5">
                  <div
                    role="radiogroup"
                    aria-label="What the layer half shows"
                    className="inline-flex rounded-full bg-app p-0.5"
                  >
                    {(["map", "image"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={sourceTab === t}
                        disabled={t === "image" && !record?.source_image}
                        onClick={() => setSourceTab(t)}
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-meta transition-colors disabled:opacity-40",
                          sourceTab === t
                            ? "bg-surface-raised text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {t === "map" ? "Live map" : "Screenshot"}
                      </button>
                    ))}
                  </div>
                  <span className="text-muted-foreground">
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
                  size="dense"
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
                  layers={mapLayers}
                  selection={mapSelection}
                  categorized={categorizedByLayer}
                  pasted={pasted}
                  basemap={basemap}
                  labels={labels}
                  onPick={(l, n) => void openRecord(l, n)}
                  onCopyPosition={copyPosition}
                  onMessage={setContextMessage}
                />
                <LocationField
                  inputRef={locInput}
                  text={locText}
                  onTextChange={(t) => {
                    setLocText(t)
                    setLocError("")
                  }}
                  onGo={goTo}
                  error={locError}
                />
                <MapLegend
                  layers={mapLayers}
                  activeLayer={table?.layer ?? ""}
                  pasted={pasted !== null}
                />
                {contextMessage && (
                  <div className="map-chrome absolute top-12 left-2 z-10 rounded-sm border border-[rgb(var(--p-line)/0.28)] px-2 py-1 text-label text-foreground">
                    {contextMessage}
                  </div>
                )}
                <MapTools
                  onZoomIn={() => mapRef.current?.zoomBy(1)}
                  onZoomOut={() => mapRef.current?.zoomBy(-1)}
                  basemap={basemap}
                  onBasemap={setBasemap}
                  labels={labels}
                  onLabels={setLabels}
                  layerCount={mapLayers.length}
                  layers={layersPanel}
                />
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
              title="Reference"
              detail="Google Maps or Street View"
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
            <Panel>
              <PanelHeader title="Answer" />
              <div className="flex min-h-0 flex-1 flex-col p-3">
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
            </Panel>
            <Panel>
              <PanelHeader
                title="Attributes"
                detail={
                  hidden.size > 0 ? `${hidden.size} hidden while annotating` : undefined
                }
              />
              <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-3 py-1 select-text">
                {selected && (
                  <table className="w-full text-label">
                    <tbody>
                      {columns.map((c, i) => {
                        if (hidden.has(c.name)) return null
                        const v = selected.values[i]
                        return (
                          <tr
                            key={c.name}
                            className="border-t border-hairline align-top first:border-t-0"
                          >
                            <td className="py-1 pr-2 font-mono text-meta text-muted-foreground">
                              {c.name}
                            </td>
                            <td
                              className={cn(
                                "py-1 [overflow-wrap:anywhere]",
                                typeof v === "number" && "telemetry"
                              )}
                            >
                              {formatValue(v)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Panel>
          </div>
        </main>
      </div>

      {(error || notice) && (
        <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2.5">
          {notice && (
            <div className="pointer-events-auto">
              <Toast tone={notice.tone} text={notice.text} />
            </div>
          )}
          {error && (
            <div className="pointer-events-auto">
              <Toast tone="error" text={error} onDismiss={() => setError("")} />
            </div>
          )}
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
          eyebrow="Export"
          title="Export written"
          onClose={() => setExported(null)}
          footer={
            <>
              <Button size="commit" onClick={() => void api.reveal(exported.dir)}>
                Show in Finder
              </Button>
              <Button tone="primary" size="commit" onClick={() => setExported(null)}>
                Done
              </Button>
            </>
          }
        >
          <p className="telemetry mb-3 text-meta break-all text-muted-foreground">
            {exported.dir}
          </p>
          <ul className="mb-3 flex flex-col gap-1 text-read">
            {exported.layers.map((l) => (
              <li key={l.layer}>
                <span className="font-mono font-medium">{l.layer}</span>:{" "}
                <span className="telemetry">{formatCount(l.records)}</span> records,{" "}
                <span className="telemetry">{formatCount(l.revisions)}</span> saved
                revisions
                {l.without_position > 0 &&
                  `, ${l.without_position} without a position left out of the GeoPackage`}
              </li>
            ))}
          </ul>
          <ul className="telemetry text-meta text-muted-foreground">
            {exported.files.map((f) => (
              <li key={f}>{f.split("/").pop()}</li>
            ))}
          </ul>
        </Dialog>
      )}

      {relinkPath && (
        <Dialog
          eyebrow="GeoPackage"
          title="Use a file with a different SHA-256?"
          tone="destructive"
          onClose={() => setRelinkPath(null)}
          footer={
            <>
              <Button size="commit" onClick={() => setRelinkPath(null)}>
                Cancel
              </Button>
              <Button
                tone="danger"
                size="commit"
                onClick={() => void relink(relinkPath, true)}
              >
                Use this file
              </Button>
            </>
          }
        >
          <p className="mb-2 text-read">
            <span className="telemetry break-all">{relinkPath}</span> is not the file
            this project was made on.
          </p>
          <p className="text-read text-muted-foreground">
            Answers are tied to feature ids. If the file was regenerated, an id may now
            name another record. The new hash is recorded and the old one kept in the
            project.
          </p>
        </Dialog>
      )}
    </div>
  )
}
