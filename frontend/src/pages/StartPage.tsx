import { useEffect, useState, type ReactNode } from "react"
import { api, errorText } from "@/lib/api"
import { formatCount, formatTime } from "@/lib/format"
import type { LayerSummary, ProjectState, RecentProject } from "@/lib/types"
import { TitleBar } from "@/components/TitleBar"
import { Button, cn, ErrorLine, inputClass } from "@/components/ui"

/*
  TERRA's settings card: one row per choice, what it is and what it does on
  the left and its control on the right, so the eye runs down one column of
  names and another of states.
*/
const CARD =
  "divide-y divide-[rgb(var(--p-line)/0.3)] rounded-md border border-[rgb(var(--p-line)/0.45)] bg-panel"

function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-read font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-0.5 text-label text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0 basis-56">{children}</div>
    </div>
  )
}

/** A file or folder chosen with the system's dialog: the button, then what was chosen. */
function Chosen({
  label,
  path,
  busy,
  onChoose,
}: {
  label: string
  path: string
  busy: boolean
  onChoose: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button disabled={busy} onClick={onChoose}>
        {label}
      </Button>
      <span
        className={cn(
          "min-w-0 truncate text-meta",
          path ? "telemetry text-foreground" : "text-muted-foreground"
        )}
        title={path}
      >
        {path ? baseName(path) : "none chosen"}
      </span>
    </div>
  )
}

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
    <div className="flex h-full flex-col bg-app">
      <TitleBar />
      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        <div className="mx-auto grid w-full max-w-[1040px] grid-cols-[1fr_1.2fr] gap-x-8 gap-y-6 pt-10">
          <header className="col-span-2">
            <p className="eyebrow">Annotation of GeoPackage points</p>
            <h1 className="mt-1.5 font-display text-hero font-semibold tracking-wide">
              Check each point against current imagery
            </h1>
            <p className="mt-3 max-w-[720px] text-read text-muted-foreground">
              For each point of a GeoPackage (a CNEFE school, a health facility), keep a
              screenshot of what the layer shows, a screenshot of what Google Maps shows
              at the same coordinates, and what is really there. The GeoPackage is only
              read; answers and screenshots go to a project folder.
            </p>
          </header>

          <section className="min-w-0">
            <div className="flex h-8 items-center justify-between gap-3">
              <h2 className="text-heading font-medium text-foreground">
                Open a project
              </h2>
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
            <div className={cn(CARD, "mt-3")}>
              {recent.length === 0 && (
                <p className="px-5 py-4 text-label text-muted-foreground">
                  No project opened yet. A project opened or created here is listed.
                </p>
              )}
              {recent.map((r) => (
                <button
                  key={r.dir}
                  type="button"
                  disabled={!r.exists || busy}
                  onClick={() => void open(r.dir)}
                  title={r.dir}
                  className="flex w-full flex-col items-start gap-0.5 px-5 py-3 text-left transition-colors first:rounded-t-md last:rounded-b-md hover:bg-hover disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span className="text-read font-medium text-foreground">
                    {r.name}
                  </span>
                  <span className="telemetry w-full truncate text-meta text-muted-foreground">
                    {r.dir}
                  </span>
                  <span
                    className={cn(
                      "text-meta",
                      r.exists ? "text-muted-foreground" : "text-destructive-quiet"
                    )}
                  >
                    {r.exists ? (
                      <>
                        opened{" "}
                        <span className="telemetry">{formatTime(r.opened_at)}</span>
                      </>
                    ) : (
                      "folder not found"
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="min-w-0">
            <div className="flex h-8 items-center">
              <h2 className="text-heading font-medium text-foreground">New project</h2>
            </div>
            <div className={cn(CARD, "mt-3")}>
              <Row
                title="GeoPackage to annotate"
                description="Only read, never written."
              >
                <Chosen
                  label="Choose .gpkg…"
                  path={source}
                  busy={busy}
                  onChoose={() => void chooseSource()}
                />
              </Row>
              {layers && (
                <div className="px-5 py-3">
                  <p className="mb-2 text-label text-muted-foreground">
                    {pointLayers.length} point{" "}
                    {pointLayers.length === 1 ? "layer" : "layers"} to annotate; the
                    others can be shown on the map for context.
                  </p>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-label">
                    {layers.map((l) => (
                      <li
                        key={l.name}
                        className={cn(
                          "truncate",
                          l.points && !l.problem
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                        title={l.problem || l.description}
                      >
                        <span className="font-mono">{l.name}</span>{" "}
                        <span className="text-meta text-muted-foreground">
                          {l.geometry_type.toLowerCase()},{" "}
                          <span className="telemetry">
                            {formatCount(l.feature_count)}
                          </span>
                          {l.problem ? ", cannot be read" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Row
                title="Project folder"
                description="Answers and screenshots are kept here."
              >
                <Chosen
                  label="Choose folder…"
                  path={dir}
                  busy={busy}
                  onChoose={() => void chooseDir()}
                />
              </Row>
              <Row title="Project name">
                <input
                  className={inputClass}
                  aria-label="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Row>
              <Row title="Annotator" description="Recorded with every answer.">
                <input
                  className={inputClass}
                  aria-label="Annotator"
                  value={annotator}
                  onChange={(e) => setAnnotator(e.target.value)}
                />
              </Row>
              <div className="flex justify-end px-5 py-4">
                <Button
                  tone="primary"
                  size="commit"
                  disabled={busy || !source || !dir || pointLayers.length === 0}
                  onClick={() => void create()}
                >
                  Create project
                </Button>
              </div>
            </div>
          </section>
          <div className="col-span-2">
            <ErrorLine text={error} onDismiss={() => setError("")} />
          </div>
        </div>
      </div>
    </div>
  )
}
