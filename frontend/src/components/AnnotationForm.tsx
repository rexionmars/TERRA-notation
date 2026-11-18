import { formatTime } from "@/lib/format"
import { normalizeReferenceDate, REFERENCE_DATE_NOT_SHOWN } from "@/lib/referenceDate"
import type { Category, HistoryEntry, Entry } from "@/lib/types"
import { Check } from "@/components/icons"
import { Button, cn, Field, inputClass, Kbd } from "@/components/ui"

export interface FormState {
  category: string
  reference_label: string
  /** as typed; normalised when the field is left and before a save */
  reference_date: string
  notes: string
}

function dateText(d: string): string {
  if (d === "") return "no date recorded"
  if (d === REFERENCE_DATE_NOT_SHOWN) return "no date shown"
  return d
}

/** The judgement about one record. */
export function AnnotationForm({
  categories,
  categoryColor,
  form,
  onChange,
  record,
  dirty,
  busy,
  onSave,
  onSaveAndNext,
  history,
  onToggleHistory,
}: {
  categories: Category[]
  categoryColor: (id: string) => string
  form: FormState
  onChange: (f: FormState) => void
  record: Entry | null
  dirty: boolean
  busy: boolean
  onSave: () => void
  onSaveAndNext: () => void
  history: HistoryEntry[] | null
  onToggleHistory: () => void
}) {
  const a = record?.annotation
  const label = (id: string) => categories.find((c) => c.id === id)?.label ?? id
  const notShown = form.reference_date === REFERENCE_DATE_NOT_SHOWN
  const dateInvalid = !notShown && normalizeReferenceDate(form.reference_date) === null
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,320px)_1fr] gap-4">
      <div
        role="radiogroup"
        aria-label="What is at the point"
        className="panel-scroll flex min-h-0 flex-col gap-0.5 overflow-y-auto"
      >
        <span className="mb-1 text-label text-muted-foreground">
          What is at the point
        </span>
        {categories.map((c, i) => {
          const on = form.category === c.id
          return (
            /*
              The chosen answer lights on the accent's plate, the surface
              TERRA keeps for a chosen value. The colour of each category is
              a swatch beside its name, never a ground for text.
            */
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={c.description}
              onClick={() => onChange({ ...form, category: on ? "" : c.id })}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 rounded-sm border px-2 text-left text-label transition-colors",
                on
                  ? "border-primary/55 bg-accent-dim text-foreground"
                  : "border-transparent text-foreground/90 hover:bg-hover hover:text-foreground"
              )}
            >
              <span
                className="flex size-3.5 shrink-0 items-center justify-center rounded-xs border border-black/50 text-black"
                style={{ background: categoryColor(c.id) }}
              >
                {on && <Check className="size-3" />}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")}>
                {c.label}
              </span>
              {i < 9 && (
                <span className="text-muted-foreground">
                  <Kbd>{i + 1}</Kbd>
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <Field
          label="What the reference map shows at the point"
          hint="The name or label Google Maps gives the place, as written there."
        >
          <input
            className={inputClass}
            value={form.reference_label}
            placeholder="e.g. Restaurante Sabor da Terra; or no label"
            onChange={(e) => onChange({ ...form, reference_label: e.target.value })}
          />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted-foreground">
            Date of the reference imagery
          </span>
          <div className="flex items-center gap-3">
            <input
              className={cn(
                inputClass,
                "telemetry w-36",
                dateInvalid && "border-warning"
              )}
              aria-label="Date of the reference imagery"
              aria-invalid={dateInvalid}
              disabled={notShown}
              value={notShown ? "" : form.reference_date}
              placeholder={notShown ? "not shown" : "2023-03-14"}
              onChange={(e) => onChange({ ...form, reference_date: e.target.value })}
              onBlur={() => {
                const d = normalizeReferenceDate(form.reference_date)
                if (d !== null && d !== form.reference_date)
                  onChange({ ...form, reference_date: d })
              }}
            />
            <label className="flex items-center gap-1.5 text-label text-foreground">
              <input
                type="checkbox"
                className="accent-primary"
                checked={notShown}
                onChange={(e) =>
                  onChange({
                    ...form,
                    reference_date: e.target.checked ? REFERENCE_DATE_NOT_SHOWN : "",
                  })
                }
              />
              The reference shows no date
            </label>
          </div>
          <span
            className={cn(
              "text-meta",
              dateInvalid ? "text-warning" : "text-muted-foreground"
            )}
          >
            {dateInvalid
              ? "Write it as 2023-03-14, 2023-03 or 2023 (14/03/2023 is turned round)."
              : "Street View gives “Image capture”; Google Earth gives the date at its foot."}
          </span>
        </div>
        <label className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-label text-muted-foreground">Notes</span>
          <textarea
            className={cn(inputClass, "h-auto min-h-[64px] flex-1 resize-none py-1.5")}
            value={form.notes}
            placeholder="What you see, the date of the imagery if shown, distance to the real building…"
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
          />
        </label>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-meta",
              dirty ? "text-warning" : "text-muted-foreground"
            )}
          >
            {dirty
              ? "Unsaved changes"
              : a
                ? `Saved ${formatTime(a.updated_at)}${a.annotator ? ` by ${a.annotator}` : ""}`
                : "Not saved"}
            {a && a.first_category && a.first_category !== a.category && (
              <> · first answer: {label(a.first_category)}</>
            )}
          </span>
          {record && record.revisions > 0 && (
            <Button tone="ghost" onClick={onToggleHistory}>
              {history ? "Hide history" : `History (${record.revisions})`}
            </Button>
          )}
          <Button disabled={busy} onClick={onSave}>
            Save <Kbd>⌘S</Kbd>
          </Button>
          <Button tone="primary" disabled={busy} onClick={onSaveAndNext}>
            Save and next <Kbd>⌘↵</Kbd>
          </Button>
        </div>
        {history && (
          <ol className="panel-scroll max-h-32 overflow-y-auto rounded-sm border border-border bg-sunk p-2 text-meta select-text">
            {history.map((h) => (
              <li
                key={h.revision}
                className="border-b border-hairline py-1 last:border-0"
              >
                <span className="text-muted-foreground">
                  {h.revision}.{" "}
                  <span className="telemetry">{formatTime(h.saved_at)}</span>
                  {h.annotator ? `, ${h.annotator}` : ""}:
                </span>{" "}
                {h.category ? label(h.category) : "no category"}
                {h.reference_label && <> · map: {h.reference_label}</>}
                {h.reference_date && <> · imagery: {dateText(h.reference_date)}</>}
                {h.notes && <> · {h.notes}</>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
