import { useEffect, useState } from "react"
import { api, errorText } from "@/lib/api"
import { formatCount, formatTime } from "@/lib/format"
import type { LayerSummary, ProjectState, RecentProject } from "@/lib/types"
import { Button, ErrorLine, Field, inputClass } from "@/components/ui"

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

export function StartPage({ onOpen }: { onOpen: (p: ProjectState) => void }) {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const [source, setSource] = useState("")
  const [layers, setLayers] = useState<LayerSummary[] | null>(null)
  const [dir, setDir] = useState("")
  const [name, setName] = useState("")
  const [annotator, setAnnotator] = useState("")

  useEffect(() => {
    void api.recentProjects().then(setRecent)
    void api.defaultAnnotator().then(setAnnotator)
  }, [])

  const run = async (f: () => Promise<void>) => {
    setError("")
    setBusy(true)
    try {
      await f()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const open = (folder: string) =>
    run(async () => {
      onOpen(await api.openProject(folder))
    })

  const chooseSource = () =>
    run(async () => {
      const path = await api.pickGeoPackage()
      if (!path) return
      setLayers(null)
      setSource(path)
      setLayers(await api.inspectGeoPackage(path))
    })

  const chooseDir = () =>
    run(async () => {
      const folder = await api.pickFolder(
        "Choose or create an empty folder for the project"
      )
      if (!folder) return
      setDir(folder)
      if (!name) setName(baseName(folder))
    })

  const create = () =>
    run(async () => {
      onOpen(await api.createProject({ dir, name, source_path: source, annotator }))
    })

  const pointLayers = layers?.filter((l) => l.points && !l.problem) ?? []

  return (
    <div className="flex h-full items-start justify-center overflow-auto p-10">
      <div className="grid w-full max-w-[1040px] grid-cols-[1fr_1.2fr] gap-8">
        <header className="col-span-2">
          <h1 className="text-[22px] font-semibold">TERRA Notation</h1>
          <p className="mt-1 max-w-[720px] text-muted">
            Check each point of a GeoPackage (a CNEFE school, a health facility) against
            current imagery: keep a screenshot of what the layer shows, a screenshot of
            what Google Maps shows at the same coordinates, and what is really there.
            The GeoPackage is only read; answers and screenshots go to a project folder.
          </p>
        </header>

        <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Open a project</h2>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const folder = await api.pickFolder("Choose a project folder")
                  if (folder) onOpen(await api.openProject(folder))
                })
              }
            >
              Choose folder…
            </Button>
          </div>
          {recent.length === 0 && <p className="text-muted">No project opened yet.</p>}
          <ul className="flex flex-col gap-1">
            {recent.map((r) => (
              <li key={r.dir}>
                <button
                  type="button"
                  disabled={!r.exists || busy}
                  onClick={() => void open(r.dir)}
                  className="flex w-full flex-col items-start rounded px-3 py-2 text-left hover:bg-hover disabled:opacity-50"
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="w-full truncate text-[11px] text-muted">
                    {r.dir}
                  </span>
                  <span className="text-[11px] text-muted">
                    {r.exists
                      ? `opened ${formatTime(r.opened_at)}`
                      : "folder not found"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5">
          <h2 className="text-[15px] font-semibold">New project</h2>
          <Field label="GeoPackage to annotate">
            <div className="flex items-center gap-2">
              <Button disabled={busy} onClick={() => void chooseSource()}>
                Choose .gpkg…
              </Button>
              <span className="min-w-0 truncate text-muted" title={source}>
                {source || "none chosen"}
              </span>
            </div>
          </Field>
          {layers && (
            <div className="rounded border border-line bg-bg p-3 text-[12px]">
              <p className="mb-2 text-muted">
                {pointLayers.length} point{" "}
                {pointLayers.length === 1 ? "layer" : "layers"} to annotate; the others
                can be shown on the map for context.
              </p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {layers.map((l) => (
                  <li
                    key={l.name}
                    className={l.points && !l.problem ? "" : "text-muted"}
                    title={l.problem || l.description}
                  >
                    {l.name}{" "}
                    <span className="text-muted">
                      {l.geometry_type.toLowerCase()}, {formatCount(l.feature_count)}
                      {l.problem ? ", cannot be read" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label="Project folder" hint="Answers and screenshots are kept here.">
            <div className="flex items-center gap-2">
              <Button disabled={busy} onClick={() => void chooseDir()}>
                Choose folder…
              </Button>
              <span className="min-w-0 truncate text-muted" title={dir}>
                {dir || "none chosen"}
              </span>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Annotator" hint="Recorded with every answer.">
              <input
                className={inputClass}
                value={annotator}
                onChange={(e) => setAnnotator(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              tone="primary"
              disabled={busy || !source || !dir || pointLayers.length === 0}
              onClick={() => void create()}
            >
              Create project
            </Button>
          </div>
        </section>
        <div className="col-span-2">
          <ErrorLine text={error} onDismiss={() => setError("")} />
        </div>
      </div>
    </div>
  )
}
