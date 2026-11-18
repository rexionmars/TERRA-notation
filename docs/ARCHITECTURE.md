# Architecture

TERRA Notation is a local desktop application. A Wails v2 binary hosts a React page in the
system web view; the page calls Go methods through generated bindings. There is no server,
and the only network traffic is basemap tiles.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Page: React 19, TypeScript, MapLibre GL 6 (frontend/)            │
│ record list · live map · two screenshot slots · form · settings  │
└───────────────┬───────────────────────────────┬──────────────────┘
                │ bound methods (JSON)          │ GET /project-images/…
┌───────────────▼───────────────────────────────▼──────────────────┐
│ Go shell: main.go, app*.go                                       │
│  internal/gpkg        the source GeoPackage, opened read-only    │
│  internal/annotation  the project folder: answers and screenshots│
│  internal/exports     CSV, GeoPackage and HTML exports           │
│  capture_darwin.go    screencapture -i, clipboard via osascript  │
└──────────────────────────────────────────────────────────────────┘
        tiles: Esri, EOX (from the page)   Google Maps: the browser
```

## The source GeoPackage

`internal/gpkg` reads a GeoPackage with `modernc.org/sqlite`, the pure-Go SQLite driver
the TERRA desktop application uses, so the binary needs neither cgo SQLite nor GDAL.

- **Read-only.** The file is opened with the URI `file:…?mode=ro`. A test checks that a
  write fails. Answers never go into the source file, which is often a generated result
  that its own repository forbids editing by hand.
- **Layers** come from `gpkg_contents` joined with `gpkg_geometry_columns` and
  `gpkg_spatial_ref_sys`. Each layer needs an `INTEGER PRIMARY KEY`, because answers are
  tied to feature ids. A layer that cannot be read is still listed, with the reason in
  `Layer.Problem`.
- **Geometry** is the GP header of OGC 12-128r19, section 2.1.3 (magic, flags, SRS id,
  optional envelope), followed by ISO WKB. `geometry.go` decodes every simple feature
  type in either byte order, accepts the EWKB Z/M/SRID flags some writers use, drops Z and
  M, and reads NaN coordinates as an empty point. Counts are checked against the bytes
  left before anything is allocated, so a corrupt blob fails instead of exhausting memory.
- **Coordinate systems.** Geographic systems are read as longitude and latitude without a
  datum shift. Between SIRGAS 2000 and WGS 84 the difference in Brazil is under a metre,
  below the precision of a CNEFE coordinate. Web Mercator is converted. Anything else,
  such as UTM, is refused with the `ogr2ogr` command that converts it.
- **Loading.** A point layer is sent to the page whole: 8 054 schools are read in about
  45 ms and cross as 2.2 MB of JSON. Layers past 500 000 features are refused. Context
  layers (roads, the corridor, Indigenous lands) are read only for the area in view,
  through the layer's R-tree when it has one, at most 4 000 features per request.
- **Nearest records.** `Nearest` reads a box around a point from each named layer, through
  the R-tree, and doubles the box (from 0.005° up to 2°) until the last record it returns
  is nearer than anything outside the box can be. On the CNEFE corridor file the six
  records nearest to a school, across schools and health facilities, come back in about
  1 ms.
- **SQL filter.** The list can be narrowed by a condition on the layer's own columns. It
  runs as `SELECT fid FROM layer WHERE <condition>` on the read-only connection, and a
  condition containing `;` is refused.

## The project folder

`internal/annotation` keeps one folder per project:

```text
annotations.sqlite
images/<layer>/<fid>/source-<UTC time>.png, reference-<UTC time>.png
exports/<local date_time>/
```

`annotations.sqlite` has four tables:

| Table | Holds |
|---|---|
| `project` | key-value rows: schema version, name, creation time, the source file (path, SHA-256, size) and the settings as JSON |
| `annotation` | the current answer per `(layer, fid)`: category, `first_category`, reference label, notes, annotator, times, revision, and a snapshot of the record's id, name and position read from the GeoPackage at save time |
| `annotation_history` | one row per saved revision, with the screenshots current at that moment; triggers abort any `UPDATE` or `DELETE` |
| `image` | one row per screenshot: path, SHA-256, size in bytes and pixels, origin (map, screen region, clipboard, file), capture time, and `removed_at` once it is no longer current |

Rules the code keeps:

- **A save that changes nothing adds nothing.** Any other save adds a history row and
  increments the revision. `first_category` is the first non-empty category ever saved,
  and it is never overwritten.
- **The snapshot comes from the file, not the page.** `SaveAnnotation` reads the record's
  id, name and position from the GeoPackage in Go, so an answer stays readable if the
  source later moves or changes.
- **Screenshots are never overwritten or deleted.** Files are created with `O_EXCL` under
  a name that holds the capture time in milliseconds. Replacing or removing a screenshot
  only sets `removed_at`.
- **The source is pinned by hash.** On open, the file at the recorded path is hashed
  again. A different hash or a missing file is shown in a banner. Relinking to a file with
  a different hash needs an explicit confirmation, and the previous source record is kept
  under a `source_before_<time>` key.
- **Categories in use cannot be removed.** A category that any current answer or history
  row uses can be relabelled but not deleted, since those answers would lose their meaning.
- **One connection.** The database is opened with `SetMaxOpenConns(1)`, because one person
  writes and SQLite serialises writers anyway. A transaction therefore holds the only
  connection, and code inside one must not call a method that opens another query.

Screenshots reach the page through a Wails asset-server middleware under
`/project-images/`, not through a bound method, which would carry them as base64 strings.
It is middleware, not `Handler`, because the single-page build answers every unknown path
with `index.html` before a `Handler` would be asked. `ImageFile` refuses any path outside
`images/`.

## The page

State lives in `pages/AnnotatePage.tsx`. Logic that does not need React is in `lib/` and
tested with Vitest.

- **Record list** (`lib/recordList.ts`). Search ignores accents and case and reads only the
  columns that are not hidden. The random order is a Fisher–Yates permutation of every
  feature id of the layer, sorted first and drawn with mulberry32 from the project's seed,
  so a filter narrows the order without reshuffling it, and the same seed gives the same
  order on any machine. The distance order measures from a pasted location.
- **Hidden columns** are left out of the header, the list, the attribute table, the search
  and the map picture. They remain in the GeoPackage and in every export.
- **Map** (`components/MapView.tsx`). MapLibre with rotation and pitch disabled, so north
  is always up. The canvas keeps its drawing buffer (`preserveDrawingBuffer`), so it can
  be read for a picture at any moment. The record is marked by a crosshair drawn on a
  canvas; the other records of the layer are circles, white when they have no category and
  black when they have one.
- **Basemaps** (`lib/basemaps.ts`) all serve CORS headers, without which the canvas could
  not be read. Where Esri World Imagery has no imagery at a zoom, it answers with a grey
  "Map data not yet available" tile. At Humaitá (AM) its finest level is 17, and levels 18
  and 19 are that grey tile. Esri is therefore drawn as three stacked sources: level 15
  plain, then levels up to 17 and up to 19 with `blankTile=false`, which turns a missing
  tile into a 404 and lets the level below show through, enlarged.
- **Map picture** (`lib/capture.ts`). The map canvas is copied and, under it, a white strip
  is drawn: the record's name; its layer, fid, id and information columns; its position;
  the basemap, zoom, "north up" and capture time; a legend with the marks in view; and a
  scale bar of 1, 2 or 5 × 10ⁿ metres, computed from the zoom and the latitude for 512 px
  tiles. Every line comes from the record and the map state; none is typed. The strip is
  white with black text, so the picture prints and reads in grey.
- **Pasted location** (`lib/coordinates.ts`). The parser reads Google Maps' "lat, lon",
  decimal commas, degrees, minutes and seconds with English or Portuguese hemispheres, and
  Google Maps links, preferring the place's pin (`!3d…!4d…`) to the map centre (`@…`).
  Numbers without hemispheres are latitude first. When that reading falls outside the
  layer's extent (padded by 1°) and the reversed one falls inside, the pair is reversed and
  the page says so. Distances are great-circle distances on the IUGG mean radius, within
  0.5 % of the ellipsoid's.
- **The record at a pasted location.** The nearest records are looked up in Go across the
  open layer and every point layer whose identifier column has the same name, that is,
  the same register: `schools_cnefe` and `health_cnefe` share `cnefe_id`. A record within
  1 m is the record the coordinate was copied from, and it is opened, switching layer when
  it is in another; the switch waits for the layer to load through a pending selection.
  Layers of another source are not searched. An OpenStreetMap school listed 30 m away
  would tell the annotator what a hidden `matched` column holds.
- **Keyboard.** One `keydown` listener reads the latest handlers through a ref. `⌘V`
  outside a text field reads the clipboard text first: coordinates move the map, and
  anything else is taken as an image for the active slot.

## Screenshots of other windows

On macOS, `CaptureScreenRegion` hides the window, waits 250 ms for it to leave the screen,
and runs `/usr/sbin/screencapture -i -x -o`. Escape cancels without writing a file.
`PasteImage` asks AppleScript for the clipboard as `«class PNGf»`, which converts the PNG
or TIFF that a screenshot or a browser leaves there. On other systems both report that a
file must be dropped or chosen instead.

Google Maps is opened in the browser through its documented Maps URLs, which need no key.
Its tiles are never loaded inside the application: Google's terms do not allow them in
another application's map.

## Exports

`internal/exports` writes a new folder for every export, so an earlier export that a result
was computed from is never overwritten:

- **`annotations_<layer>.csv`:** one row per record with an answer or a current screenshot,
  with the source attributes as `gpkg_<column>`.
- **`history_<layer>.csv`:** every revision, in the order saved.
- **`annotations.gpkg`:** one `<layer>_annotations` point layer per annotated layer. It
  carries the GeoPackage metadata tables the standard requires, and GDAL opens it.
  Source columns whose names collide with the answer's fields are written as
  `gpkg_<column>`.
- **`report.html`:** every record grouped by category, with its two screenshots side by
  side. Image paths are relative to the export folder, so the page keeps working as long
  as the project folder is moved whole.

## Cross-language contracts

- **Go and TypeScript.** `frontend/src/lib/types.ts` mirrors, by hand, the JSON tags of the
  Go structs the bound methods return, and `lib/api.ts` is the only module that casts the
  generated bindings to those types. A change to a JSON tag changes both sides in the same
  commit; nothing checks the two against each other automatically yet.
- **Names the generator cannot take.** Wails emits one TypeScript namespace per Go
  package, and each Go type becomes a class in it. That is why the export package is
  `exports` (`export` is a reserved word in TypeScript), and why the per-record type is
  `annotation.Entry`: a class named `Record` would shadow TypeScript's own `Record<K, V>`
  inside the generated namespace.
- **MapLibre's stylesheet.** It is not in a cascade layer, and Tailwind 4's utilities are,
  so MapLibre's `.maplibregl-map { position: relative }` beats a Tailwind `absolute`. The
  map container is positioned with an inline style for that reason.
