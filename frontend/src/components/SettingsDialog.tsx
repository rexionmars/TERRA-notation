import { useState } from "react"
import { errorText } from "@/lib/api"
import { fold } from "@/lib/recordList"
import type { Category, Column, LayerSettings, Settings } from "@/lib/types"
import { Button, Dialog, ErrorLine, Field, inputClass } from "@/components/ui"

function categoryId(label: string, taken: Set<string>): string {
  let base = fold(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (!base) base = "category"
  if (!/^[a-z]/.test(base)) base = "c_" + base
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}

const emptyLayer: LayerSettings = {
  name_column: "",
  id_column: "",
  info_columns: [],
  hidden_columns: [],
}

/** The project's choices: annotator, categories, seed, and how a layer is shown. */
export function SettingsDialog({
  settings,
  layer,
  columns,
  onSave,
  onClose,
}: {
  settings: Settings
  layer: string
  columns: Column[]
  onSave: (s: Settings) => Promise<void>
  onClose: () => void
}) {
  const [s, setS] = useState<Settings>(() => structuredClone(settings))
  const [newLabel, setNewLabel] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const ls: LayerSettings = { ...emptyLayer, ...s.layers[layer] }

  const setLayer = (next: Partial<LayerSettings>) =>
    setS({ ...s, layers: { ...s.layers, [layer]: { ...ls, ...next } } })
  const setCategory = (i: number, next: Partial<Category>) =>
    setS({
      ...s,
      categories: s.categories.map((c, j) => (j === i ? { ...c, ...next } : c)),
    })
  const move = (i: number, d: number) => {
    const cats = [...s.categories]
    const j = i + d
    if (j < 0 || j >= cats.length) return
    ;[cats[i], cats[j]] = [cats[j], cats[i]]
    setS({ ...s, categories: cats })
  }
  const toggle = (list: string[] | null, name: string) => {
    const cur = list ?? []
    return cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]
  }

  const save = async () => {
    setBusy(true)
    setError("")
    try {
      await onSave(s)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const columnSelect = (value: string, onChange: (v: string) => void) => (
    <select
      className={inputClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">(none)</option>
      {columns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  )

  return (
    <Dialog
      title="Project settings"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={busy} onClick={() => void save()}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Annotator" hint="Recorded with every answer saved from now on.">
            <input
              className={inputClass}
              value={s.annotator}
              onChange={(e) => setS({ ...s, annotator: e.target.value })}
            />
          </Field>
          <Field
            label="Seed of the random order"
            hint="The same seed gives the same order of records on any machine."
          >
            <input
              className={inputClass}
              type="number"
              value={s.seed}
              onChange={(e) =>
                setS({ ...s, seed: Math.trunc(Number(e.target.value)) || 0 })
              }
            />
          </Field>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Categories</h3>
          <p className="text-[12px] text-muted">
            The answers to “what is at the point”. A label can change at any time; a
            category already used in a saved answer cannot be removed. The id is what
            the exports carry.
          </p>
          {s.categories.map((c, i) => (
            <div
              key={c.id}
              className="grid grid-cols-[110px_1fr_1.4fr_auto] items-center gap-2"
            >
              <code className="truncate text-[11px] text-muted" title={c.id}>
                {c.id}
              </code>
              <input
                className={inputClass}
                value={c.label}
                onChange={(e) => setCategory(i, { label: e.target.value })}
              />
              <input
                className={inputClass}
                value={c.description}
                placeholder="when to use it"
                onChange={(e) => setCategory(i, { description: e.target.value })}
              />
              <div className="flex gap-1">
                <Button
                  tone="ghost"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                >
                  ↑
                </Button>
                <Button
                  tone="ghost"
                  onClick={() => move(i, 1)}
                  disabled={i === s.categories.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </Button>
                <Button
                  tone="danger"
                  onClick={() =>
                    setS({ ...s, categories: s.categories.filter((_, j) => j !== i) })
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className={inputClass + " flex-1"}
              value={newLabel}
              placeholder="Label of a new category"
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <Button
              disabled={!newLabel.trim()}
              onClick={() => {
                const id = categoryId(newLabel, new Set(s.categories.map((c) => c.id)))
                setS({
                  ...s,
                  categories: [
                    ...s.categories,
                    { id, label: newLabel.trim(), description: "" },
                  ],
                })
                setNewLabel("")
              }}
            >
              Add category
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">Layer {layer}</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name column">
              {columnSelect(ls.name_column, (v) => setLayer({ name_column: v }))}
            </Field>
            <Field label="Identifier column">
              {columnSelect(ls.id_column, (v) => setLayer({ id_column: v }))}
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0.5 text-[12px]">
            <span className="text-[11px] font-medium text-muted uppercase">Column</span>
            <span className="text-[11px] font-medium text-muted uppercase">
              Shown under the name
            </span>
            <span className="text-[11px] font-medium text-muted uppercase">
              Hidden while annotating
            </span>
            {columns.map((c) => (
              <div key={c.name} className="contents">
                <span>
                  {c.name} <span className="text-muted">{c.type.toLowerCase()}</span>
                </span>
                <input
                  type="checkbox"
                  className="justify-self-center"
                  checked={(ls.info_columns ?? []).includes(c.name)}
                  onChange={() =>
                    setLayer({ info_columns: toggle(ls.info_columns, c.name) })
                  }
                />
                <input
                  type="checkbox"
                  className="justify-self-center"
                  checked={(ls.hidden_columns ?? []).includes(c.name)}
                  onChange={() =>
                    setLayer({ hidden_columns: toggle(ls.hidden_columns, c.name) })
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-[12px] text-muted">
            A hidden column is left out of the record header, the attribute table, the
            search and the picture of the map, so that the judgement is not made knowing
            it (for example, the road surface or a match with OpenStreetMap). It is
            still exported.
          </p>
        </section>
        <ErrorLine text={error} />
      </div>
    </Dialog>
  )
}
