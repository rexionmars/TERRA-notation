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
  notes: string
  annotator: string
  source_image_id: number | null
  reference_image_id: number | null
  saved_at: string
}

export interface Draft {
  layer: string
  fid: number
  category: string
  reference_label: string
  notes: string
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
