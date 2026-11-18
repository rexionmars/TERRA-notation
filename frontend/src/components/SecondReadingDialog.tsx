import { useEffect, useState } from "react"
import { api, errorText } from "@/lib/api"
import { formatCount, formatNumber, formatTime } from "@/lib/format"
import type {
  AgreementResult,
  Origin,
  SecondReadingMade,
  SecondReadingSource,
} from "@/lib/types"
import { Button, cn, Dialog, ErrorLine, Field, inputClass } from "@/components/ui"

function percent(f: number): string {
  return `${formatNumber(f * 100, 1)} %`
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

/**
 * Reading records again: making a project for a second reading of this one,
 * and comparing this one with a second reading made from it. In a second
 * reading project it says which project it reads again.
 */
export function SecondReadingDialog({
  projectName,
  annotator,
  layer,
  origin,
  onClose,
}: {
  projectName: string
  annotator: string
  layer: string
  /** set when the open project is itself a second reading */
  origin: Origin | null
  onClose: () => void
}) {
  const [source, setSource] = useState<SecondReadingSource | null>(null)
  const [size, setSize] = useState(50)
  const [reader, setReader] = useState("")
  const [name, setName] = useState(`${projectName}, second reading`)
  const [parent, setParent] = useState("")
  const [made, setMade] = useState<SecondReadingMade | null>(null)
  const [agreement, setAgreement] = useState<AgreementResult | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (origin) return
    api
      .secondReadingSource(layer)
      .then((s) => {
        setSource(s)
        setSize((n) => Math.min(n, Math.max(1, s.records)))
      })
      .catch((e) => setError(errorText(e)))
  }, [layer, origin])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await f()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const folder = parent ? `${parent}/${name.trim().replace(/[/:]/g, "-")}` : ""

  if (origin) {
    return (
      <Dialog
        eyebrow="Second reading"
        title="This project is a second reading"
        onClose={onClose}
        footer={
          <Button tone="primary" size="commit" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-3 text-read">
          <p>
            It reads again records of <span className="font-medium">{origin.name}</span>
            , first answered by {origin.annotator || "an unnamed annotator"}. Its
            records are its sample: work through them with “In the sample”, without
            looking at the first project’s answers.
          </p>
          <p className="text-label text-muted-foreground">
            The two are compared from the first project, with Second reading → Compare.
            The first project is in{" "}
            <span className="telemetry break-all">{origin.dir}</span>, created{" "}
            {formatTime(origin.created_at)}.
          </p>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      eyebrow="Second reading"
      title="Read records again"
      onClose={onClose}
      wide
      footer={
        <Button tone="primary" size="commit" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="text-read text-muted-foreground">
          How much do the answers depend on who gives them, or when? A second reading is
          a project of its own with records already answered here, drawn at random and
          without their answers, for another person, or for {annotator || "you"} some
          weeks later. The comparison reads both first answers.
        </p>

        <section className="flex flex-col gap-3">
          <h3 className="text-heading font-medium">Make a second reading of {layer}</h3>
          <p className="text-label text-muted-foreground">
            {source === null
              ? "Counting the records…"
              : source.records === 0
                ? source.from_sample
                  ? "No record of the sample has a category yet."
                  : "No record of the layer has a category yet."
                : `It is drawn from the ${formatCount(source.records)} records ${
                    source.from_sample ? "of the sample" : "of the layer"
                  } with a category, in the seed’s order.`}
          </p>
          <div className="grid grid-cols-[8rem_1fr_1fr] gap-4">
            <Field label="Records">
              <input
                className={cn(inputClass, "telemetry")}
                type="number"
                min={1}
                value={size}
                onChange={(e) =>
                  setSize(Math.max(0, Math.trunc(Number(e.target.value))))
                }
              />
            </Field>
            <Field
              label="Who reads them"
              hint="Recorded with every answer of the reading."
            >
              <input
                className={inputClass}
                value={reader}
                placeholder="name"
                onChange={(e) => setReader(e.target.value)}
              />
            </Field>
            <Field label="Project name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="dense"
              onClick={() =>
                void run(async () => {
                  const d = await api.pickFolder("Choose where the second reading goes")
                  if (d) setParent(d)
                })
              }
            >
              Choose where it goes…
            </Button>
            <span className="telemetry min-w-0 flex-1 truncate text-meta text-muted-foreground">
              {folder || "no folder chosen"}
            </span>
            <Button
              tone="primary"
              size="dense"
              disabled={
                busy || !folder || !reader.trim() || !source?.records || size < 1
              }
              onClick={() =>
                void run(async () =>
                  setMade(
                    await api.createSecondReading({
                      dir: folder,
                      name: name.trim(),
                      annotator: reader.trim(),
                      layer,
                      size,
                    })
                  )
                )
              }
            >
              Make the project
            </Button>
          </div>
          {made && (
            <p className="text-label text-success">
              Made “{made.name}” with {formatCount(made.records)} records in{" "}
              <span className="telemetry break-all">{made.dir}</span>. It is in the list
              of recent projects; on another computer, its GeoPackage may need locating
              once.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3 border-t border-hairline pt-5">
          <h3 className="text-heading font-medium">Compare with a second reading</h3>
          <p className="text-label text-muted-foreground">
            Choose the folder of a second reading made from this project. The comparison
            is written to a new folder of exports and the second reading is only read.
          </p>
          <div>
            <Button
              size="dense"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await api.compareSecondReading()
                  if (r) setAgreement(r)
                })
              }
            >
              Choose its folder and compare…
            </Button>
          </div>
          {agreement && (
            <div className="rounded-md border border-border bg-sunk px-3 py-2 text-read">
              <p className="mb-1 text-label text-muted-foreground">
                {agreement.second} · written to{" "}
                <span className="telemetry">{basename(agreement.dir)}</span>
              </p>
              {agreement.layers.map((l) => (
                <p key={l.layer}>
                  <span className="font-mono">{l.layer}</span>:{" "}
                  {l.pairs === 0 ? (
                    "no record has a first answer in both readings yet"
                  ) : (
                    <>
                      the same first answer for{" "}
                      <span className="telemetry">{formatCount(l.agreeing)}</span> of{" "}
                      <span className="telemetry">{formatCount(l.pairs)}</span> records,{" "}
                      {percent(l.share)} (95 % interval {percent(l.low)} to{" "}
                      {percent(l.high)})
                    </>
                  )}
                  {l.records > l.pairs &&
                    `; ${formatCount(l.records - l.pairs)} without an answer on one side`}
                </p>
              ))}
            </div>
          )}
        </section>
        {error && <ErrorLine text={error} />}
      </div>
    </Dialog>
  )
}
