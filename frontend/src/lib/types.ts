/*
  The JSON shapes the Go side returns, written by hand from the json tags in
  internal/gpkg, internal/annotation, internal/exports and the root package.
  The generated classes in wailsjs/go/models.ts carry the same fields, but type
  attribute values as `any`; these say what they are.
*/
import type { FeatureCollection } from "geojson"

export type ColumnValue = string | number | boolean | null

export interface Column {
  name: string
  type: string
}

export interface Layer {
  name: string
  title: string
  description: string
  geometry_column: string
  geometry_type: string
  srs: string
  primary_key: string
  columns: Column[]
  feature_count: number
  spatial_index: boolean
  problem: string
}

export interface LayerSummary extends Layer {
  points: boolean
}

export interface Row {
  fid: number
  /** [longitude, latitude]; null when the geometry is empty */
  position: [number, number] | null
  values: ColumnValue[]
}

export interface Table {
  layer: string
  columns: Column[]
  rows: Row[]
}

export interface BBox {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

export interface ContextFeatures extends FeatureCollection {
  truncated: boolean
}

export interface Category {
  id: string
  label: string
  description: string
}

export interface LayerSettings {
  name_column: string
  id_column: string
  info_columns: string[] | null
  hidden_columns: string[] | null
}

export interface Settings {
  annotator: string
  categories: Category[]
  layers: Record<string, LayerSettings>
  seed: number
}

export interface Source {
  path: string
  sha256: string
  bytes: number
}

export type SourceStatus = "same" | "changed" | "missing"

export interface ProjectInfo {
  dir: string
  name: string
  created_at: string
  source: Source
  source_status: SourceStatus
  current_sha256: string
  settings: Settings
  /** layers with a current sample */
  sampled_layers: string[] | null
}

export interface ProjectState {
  info: ProjectInfo
  layers: Layer[]
  source_error: string
}

export type Side = "source" | "reference"

export interface Image {
  id: number
  layer: string
  fid: number
  side: Side
  /** relative to the project folder, with forward slashes */
  path: string
  sha256: string
  bytes: number
  width: number | null
  height: number | null
  origin: string
  detail: string
  captured_at: string
  /** YYYY-MM-DD of the basemap imagery in a map capture; "" otherwise */
  imagery_date: string
  imagery_source: string
}

/** What a map capture records of the imagery at the record. */
export interface Imagery {
  date: string
  source: string
}

/** One source of Esri's World Imagery at a point (internal/imagery). */
export interface ImagerySource {
  /** YYYY-MM-DD; "" when Esri gives none */
  date: string
  sensor: string
  product: string
  provider: string
  resolution_m: number
  accuracy_m: number
  min_level: number
  max_level: number
}

export interface Annotation {
  layer: string
  fid: number
  record_id: string
  record_name: string
  lon: number | null
  lat: number | null
  category: string
  first_category: string
  reference_label: string
  /** YYYY, YYYY-MM or YYYY-MM-DD; "not shown"; "" when not recorded */
  reference_date: string
  notes: string
  annotator: string
  created_at: string
  updated_at: string
  revision: number
}

export interface Entry {
  annotation: Annotation | null
  source_image: Image | null
  reference_image: Image | null
  revisions: number
}

export interface Summary {
  fid: number
  category: string
  saved: boolean
  has_source_image: boolean
  has_reference_image: boolean
}

export interface HistoryEntry {
  revision: number
  category: string
  reference_label: string
  reference_date: string
  notes: string
  annotator: string
  source_image_id: number | null
  reference_image_id: number | null
  /** when the record was opened before this save; null before it was kept */
  opened_at: string | null
  saved_at: string
}

export interface Draft {
  layer: string
  fid: number
  category: string
  reference_label: string
  reference_date: string
  notes: string
  /** RFC 3339 */
  opened_at: string
}

export interface NearRecord {
  layer: string
  fid: number
  title: string
  meters: number
}

export interface RecentProject {
  dir: string
  name: string
  opened_at: string
  exists: boolean
}

export interface NewProject {
  dir: string
  name: string
  source_path: string
  annotator: string
}

export interface ExportResult {
  dir: string
  files: string[]
  layers: {
    layer: string
    records: number
    revisions: number
    without_position: number
  }[]
}

export type Allocation = "equal" | "proportional"

/** The project a second reading was made from. */
export interface Origin {
  dir: string
  name: string
  created_at: string
  annotator: string
  sample_id: number | null
}

export interface SampleDesign {
  layer: string
  kind: "sample" | "second_reading" | ""
  /** SQL condition on the layer's columns; "" for every record */
  condition: string
  /** "" for a simple sample */
  stratum_column: string
  allocation: Allocation | ""
  size: number
  per_stratum: number
  origin?: Origin | null
}

export interface Stratum {
  /** the column's value as text; "" for an empty value */
  value: string
  population: number
  drawn: number
}

export interface Sample {
  id: number
  design: SampleDesign
  seed: number
  population: number
  strata: Stratum[]
  created_at: string
  answers_before: number
  superseded_at: string | null
}

export interface Pace {
  timed: number
  median_seconds: number
}

export interface SampleState {
  sample: Sample | null
  /** the sample's records in their order */
  fids: number[]
  pace: Pace
}
