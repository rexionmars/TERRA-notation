import { useState } from "react"
import { api, errorText } from "@/lib/api"
import { formatCount, formatDuration, formatTime } from "@/lib/format"
import type { Allocation, Column, Sample, SampleDesign, SampleState } from "@/lib/types"
import { Warning } from "@/components/icons"
import { Button, cn, Dialog, ErrorLine, Field, inputClass } from "@/components/ui"

/** What a stratum value is called where the value is empty. */
function stratumName(v: string): string {
  return v === "" ? "(empty)" : v
}

function StrataTable({ sample }: { sample: Sample }) {
  if (sample.design.stratum_column === "") return null
  return (
    <table className="w-full text-label">
      <thead>
        <tr className="text-left text-meta text-muted-foreground">
          <th className="py-1 font-normal">{sample.design.stratum_column}</th>
          <th className="py-1 text-right font-normal">Records</th>
          <th className="py-1 text-right font-normal">Drawn</th>
        </tr>
      </thead>
      <tbody>
        {sample.strata.map((s) => (
          <tr key={s.value} className="border-t border-hairline">
            <td className="py-1 font-mono">{stratumName(s.value)}</td>
            <td className="telemetry py-1 text-right">{formatCount(s.population)}</td>
            <td className="telemetry py-1 text-right">{formatCount(s.drawn)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function describeDesign(s: Sample): string {
  const d = s.design
  if (d.kind === "second_reading")
    return `The ${formatCount(s.strata[0]?.drawn ?? 0)} records drawn for a second reading from the ${formatCount(s.population)} answered records of ${d.origin?.name ?? "the first project"}.`
  const pop = d.condition
    ? `the ${formatCount(s.population)} records where ${d.condition}`
    : `all ${formatCount(s.population)} records`
  if (d.stratum_column === "") return `A simple random sample of ${pop}.`
  const how =
    d.allocation === "equal"
      ? `up to ${formatCount(d.per_stratum)} from each value of ${d.stratum_column}`
      : `${formatCount(d.size)} shared in proportion to each value of ${d.stratum_column}`
  return `A sample of ${pop}, ${how}.`
}

/**
 * The layer's sample: what it is and how far the annotation has gone, or the
 * form that draws one. A drawn sample is fixed; drawing another replaces it
 * and keeps it in the project.
 */
export function SampleDialog({
  layer,
  columns,
  hidden,
  state,
  answered,
  passedOver,
  onDrawn,
  onShowSample,
  onClose,
}: {
  layer: string
  columns: Column[]
  /** columns hidden while annotating */
  hidden: Set<string>
  state: SampleState
  /** records of the sample with a category */
  answered: number
  passedOver: number
  onDrawn: (s: SampleState) => void
  onShowSample: () => void
  onClose: () => void
}) {
  const current = state.sample
  const [drawing, setDrawing] = useState(current === null)
  const [condition, setCondition] = useState("")
  const [stratum, setStratum] = useState("")
  const [allocation, setAllocation] = useState<Allocation>("equal")
  const [size, setSize] = useState(200)
  const [perStratum, setPerStratum] = useState(50)
  const [preview, setPreview] = useState<{ key: string; sample: Sample } | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const design: SampleDesign = {
    layer,
    kind: "sample",
    condition: condition.trim(),
    stratum_column: stratum,
    allocation: stratum === "" ? "" : allocation,
    size,
    per_stratum: perStratum,
  }
  const key = JSON.stringify(design)
  const shown = preview?.key === key ? preview.sample : null

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
  const total = shown?.strata.reduce((n, s) => n + s.drawn, 0) ?? 0
  const left = current ? state.fids.length - answered : 0
  const pace = state.pace

  if (!drawing && current) {
    return (
      <Dialog
        eyebrow="Sample"
        title={`Sample of ${layer}`}
        onClose={onClose}
        wide
        footer={
          <>
            {current.design.kind !== "second_reading" && (
              <Button size="commit" tone="ghost" onClick={() => setDrawing(true)}>
                Draw another sample…
              </Button>
            )}
            <Button size="commit" onClick={onShowSample}>
              Show it in the list
            </Button>
            <Button size="commit" tone="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-read">
          <p>{describeDesign(current)}</p>
          <p className="text-label text-muted-foreground">
            Drawn {formatTime(current.created_at)} with seed{" "}
            <span className="telemetry">{current.seed}</span>, in the list’s random
            order. It does not change, and the seed is fixed.
          </p>
          {current.answers_before > 0 && (
            <p className="flex items-start gap-2 text-label text-warning">
              <Warning className="mt-0.5 size-4 shrink-0" />
              {formatCount(current.answers_before)} records of the layer already had a
              category when this sample was drawn: those answers were seen before the
              design was fixed.
            </p>
          )}
          <StrataTable sample={current} />
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-label">
            <dt className="text-muted-foreground">Answered</dt>
            <dd>
              <span className="telemetry">{formatCount(answered)}</span> of{" "}
              <span className="telemetry">{formatCount(state.fids.length)}</span>
            </dd>
            <dt className="text-muted-foreground">Passed over</dt>
            <dd className={cn(passedOver > 0 && "text-warning")}>
              <span className="telemetry">{formatCount(passedOver)}</span>
              {passedOver > 0 &&
                " without a category, before the last answer; a gap there can bias the estimate"}
            </dd>
            <dt className="text-muted-foreground">Pace</dt>
            <dd>
              {pace.timed === 0 ? (
                "not measured yet: no first answer has an opening time"
              ) : (
                <>
                  median {formatDuration(pace.median_seconds)} from opening a record to
                  its first answer ({formatCount(pace.timed)}{" "}
                  {pace.timed === 1 ? "record" : "records"})
                  {left > 0 && (
                    <>
                      ; the <span className="telemetry">{formatCount(left)}</span> left
                      take about {formatDuration(left * pace.median_seconds)} at that
                      pace
                    </>
                  )}
                </>
              )}
            </dd>
          </dl>
        </div>
      </Dialog>
    )
  }

  const stratumHidden = stratum !== "" && hidden.has(stratum)
  return (
    <Dialog
      eyebrow="Sample"
      title={current ? `Replace the sample of ${layer}` : `Draw a sample of ${layer}`}
      tone={current ? "destructive" : "default"}
      onClose={onClose}
      wide
      footer={
        <>
          {current && (
            <Button size="commit" tone="ghost" onClick={() => setDrawing(false)}>
              Back
            </Button>
          )}
          <Button
            size="commit"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setPreview({ key, sample: await api.previewSample(design) })
              )
            }
          >
            Preview
          </Button>
          <Button
            size="commit"
            tone={current ? "danger" : "primary"}
            disabled={busy || !shown}
            title={shown ? "" : "Preview the sample first"}
            onClick={() =>
              void run(async () => {
                onDrawn(await api.drawSample(design, current !== null))
              })
            }
          >
            {current ? "Replace the sample" : "Draw and fix the sample"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-read text-muted-foreground">
          The sample is drawn in the list’s random order from the project’s seed and
          does not change afterwards. Drawing it before looking at the records makes the
          share of each category an estimate for the layer, with an interval, in the
          export.
          {current &&
            " The current sample stays in the project, marked as replaced, and the export lists both."}
        </p>
        <Field
          label="Population"
          hint="An SQL condition on the layer’s columns, or empty for every record."
        >
          <textarea
            className={cn(
              inputClass,
              "h-14 resize-none py-1 font-mono text-meta [font-variant-ligatures:none]"
            )}
            placeholder="distance_to_road_km <= 5"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Strata"
            hint="A column with few values (a road surface, a municipality); each value is drawn from apart."
          >
            <select
              className={inputClass}
              value={stratum}
              onChange={(e) => setStratum(e.target.value)}
            >
              <option value="">None: a simple random sample</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {stratum === "" ? (
            <Field label="Records to draw">
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
          ) : (
            <Field label="Records to draw">
              <div className="flex flex-col gap-1.5 text-label">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="accent-primary"
                    checked={allocation === "equal"}
                    onChange={() => setAllocation("equal")}
                  />
                  <input
                    className={cn(inputClass, "telemetry w-20")}
                    type="number"
                    min={1}
                    value={perStratum}
                    onChange={(e) =>
                      setPerStratum(Math.max(0, Math.trunc(Number(e.target.value))))
                    }
                  />
                  from each stratum, or all of a smaller one
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="accent-primary"
                    checked={allocation === "proportional"}
                    onChange={() => setAllocation("proportional")}
                  />
                  <input
                    className={cn(inputClass, "telemetry w-20")}
                    type="number"
                    min={1}
                    value={size}
                    onChange={(e) =>
                      setSize(Math.max(0, Math.trunc(Number(e.target.value))))
                    }
                  />
                  in all, shared in proportion to each stratum’s size
                </label>
              </div>
            </Field>
          )}
        </div>
        {stratum !== "" && !stratumHidden && (
          <p className="flex items-start gap-2 text-label text-warning">
            <Warning className="mt-0.5 size-4 shrink-0" />
            The annotator sees {stratum}. If the study compares its values, hide it in
            Settings so the answers are given without knowing it.
          </p>
        )}
        {shown && (
          <div className="rounded-md border border-border bg-sunk px-3 py-2">
            <p className="mb-1 text-read">
              <span className="telemetry">{formatCount(total)}</span> of{" "}
              <span className="telemetry">{formatCount(shown.population)}</span> records
              would be drawn, with seed <span className="telemetry">{shown.seed}</span>.
            </p>
            <StrataTable sample={shown} />
          </div>
        )}
        {error && <ErrorLine text={error} />}
      </div>
    </Dialog>
  )
}
