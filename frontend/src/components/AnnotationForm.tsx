import { formatTime } from "@/lib/format"
import type { Category, HistoryEntry, Entry } from "@/lib/types"
import { Button, cn, Field, inputClass, Kbd } from "@/components/ui"

export interface FormState {
  category: string
  reference_label: string
  notes: string
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
  return (
    <div className="grid min-h-0 grid-cols-[minmax(240px,320px)_1fr] gap-4">
      <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          What is at the point
        </span>
        {categories.map((c, i) => {
          const on = form.category === c.id
          return (
            <button
              key={c.id}
              type="button"
              title={c.description}
              onClick={() => onChange({ ...form, category: on ? "" : c.id })}
              className={cn(
                "flex items-center gap-2 rounded border px-2 py-1.5 text-left",
                on ? "border-text bg-raised" : "border-line hover:bg-hover"
              )}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-black/50 text-[10px] font-bold text-black"
                style={{ background: categoryColor(c.id) }}
              >
                {on ? "✓" : ""}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", on && "font-semibold")}>
                {c.label}
              </span>
              {i < 9 && <Kbd>{i + 1}</Kbd>}
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
        <label className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
            Notes
          </span>
          <textarea
            className={cn(inputClass, "h-auto min-h-[64px] flex-1 resize-none py-1.5")}
            value={form.notes}
            placeholder="What you see, the date of the imagery if shown, distance to the real building…"
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
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
          <ol className="max-h-32 overflow-y-auto rounded border border-line bg-bg p-2 text-[11px]">
            {history.map((h) => (
              <li
                key={h.revision}
                className="border-b border-line/50 py-1 last:border-0"
              >
                <span className="text-muted">
                  {h.revision}. {formatTime(h.saved_at)}
                  {h.annotator ? `, ${h.annotator}` : ""}:
                </span>{" "}
                {h.category ? label(h.category) : "no category"}
                {h.reference_label && <> · map: {h.reference_label}</>}
                {h.notes && <> · {h.notes}</>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
