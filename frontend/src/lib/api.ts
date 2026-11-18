/*
  The bound Go methods, typed with the shapes in types.ts. The casts are kept
  here, in one place, so no component handles the generated classes.
*/
import * as App from "../../wailsjs/go/main/App"
import type { annotation, main } from "../../wailsjs/go/models"
import type {
  BBox,
  ContextFeatures,
  Draft,
  ExportResult,
  HistoryEntry,
  Image,
  Imagery,
  ImagerySource,
  LayerSummary,
  NearRecord,
  NewProject,
  ProjectState,
  RecentProject,
  Entry,
  Settings,
  Side,
  Summary,
  Table,
} from "./types"

function as<T>(p: Promise<unknown>): Promise<T> {
  return p as Promise<T>
}

export const api = {
  recentProjects: () => as<RecentProject[]>(App.RecentProjects()),
  defaultAnnotator: () => App.DefaultAnnotator(),
  pickGeoPackage: () => App.PickGeoPackage(),
  pickFolder: (title: string) => App.PickFolder(title),
  inspectGeoPackage: (path: string) => as<LayerSummary[]>(App.InspectGeoPackage(path)),
  createProject: (req: NewProject) =>
    as<ProjectState>(App.CreateProject(req as main.NewProject)),
  openProject: (dir: string) => as<ProjectState>(App.OpenProject(dir)),
  currentProject: () => as<ProjectState>(App.CurrentProject()),
  closeProject: () => App.CloseProject(),
  relinkSource: (path: string, acceptChanged: boolean) =>
    as<ProjectState>(App.RelinkSource(path, acceptChanged)),
  updateSettings: (s: Settings) =>
    as<ProjectState>(App.UpdateSettings(s as unknown as annotation.Settings)),
  reveal: (path: string) => App.Reveal(path),

  loadLayer: (name: string) => as<Table>(App.LoadLayer(name)),
  filterLayer: (name: string, condition: string) =>
    as<number[]>(App.FilterLayer(name, condition)),
  nearestRecords: (layers: string[], lon: number, lat: number, limit: number) =>
    as<NearRecord[]>(App.NearestRecords(layers, lon, lat, limit)),
  contextFeatures: (name: string, bbox: BBox) =>
    as<ContextFeatures>(App.ContextFeatures(name, bbox)),

  summaries: (layer: string) => as<Summary[]>(App.Summaries(layer)),
  record: (layer: string, fid: number) => as<Entry>(App.Record(layer, fid)),
  history: (layer: string, fid: number) => as<HistoryEntry[]>(App.History(layer, fid)),
  saveAnnotation: (d: Draft) => as<Entry>(App.SaveAnnotation(d as annotation.Draft)),

  saveMapCapture: (
    layer: string,
    fid: number,
    dataURL: string,
    detail: string,
    imagery: Imagery
  ) =>
    as<Image>(
      App.SaveMapCapture(layer, fid, dataURL, detail, imagery as annotation.Imagery)
    ),
  esriImagery: (lon: number, lat: number) =>
    as<ImagerySource[]>(App.EsriImagery(lon, lat)),
  importImageFile: (layer: string, fid: number, side: Side, path: string) =>
    as<Image>(App.ImportImageFile(layer, fid, side, path)),
  pickImageFile: (layer: string, fid: number, side: Side) =>
    as<Image | null>(App.PickImageFile(layer, fid, side)),
  captureScreenRegion: (layer: string, fid: number, side: Side) =>
    as<Image | null>(App.CaptureScreenRegion(layer, fid, side)),
  pasteImage: (layer: string, fid: number, side: Side) =>
    as<Image>(App.PasteImage(layer, fid, side)),
  removeImage: (id: number) => App.RemoveImage(id),

  exportProject: () => as<ExportResult>(App.Export()),
}

/** The text of a failure, whatever shape it reached the page in. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e
  if (e instanceof Error) return e.message
  return String(e)
}

/** The URL the Go middleware serves a screenshot under. */
export function imageURL(img: Image): string {
  return "/project-images/" + img.path.split("/").map(encodeURIComponent).join("/")
}
