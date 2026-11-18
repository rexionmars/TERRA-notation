# TERRA Notation

A desktop application for checking the points of a GeoPackage against current imagery,
one record at a time. It was written to check the schools and health facilities of the
CNEFE, the address register of the 2022 Brazilian census (IBGE), along the BR-230
(Transamazônica), where a point registered as a school can turn out, on current imagery,
to be a restaurant, an empty lot or an abandoned building. For each record it keeps

- a picture of what the layer says, at the point it says it (the map on the left,
  captured with the record's name, code, coordinates, basemap, date and a scale bar), or a
  screenshot of QGIS;
- a screenshot of what Google Maps or Street View shows at the same coordinates;
- what is really there, as one of the project's categories, the label Google Maps gives
  the place, and notes.

The GeoPackage is opened read-only and never written. Answers and screenshots go to a
project folder of their own.

Wails v2 (Go) with a React, TypeScript, Vite, Tailwind and MapLibre frontend, the same
stack as the TERRA desktop application. GeoPackages are read in Go with the pure-Go SQLite
driver; GDAL is not needed.

## Build and run

Go 1.26, Node 20.19 or later (Vite 7 needs it), and the Wails CLI v2.13.0
(`go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0`).

```sh
wails build                  # build/bin/TERRA Notation.app
wails dev                    # development, with the frontend reloading
open -a "build/bin/TERRA Notation.app" --args /path/to/project-folder   # open a project directly
```

## Working through a layer

1. **New project**: choose the `.gpkg`, a folder for the project, a name and the
   annotator's name. Every point layer can be annotated; the other layers (roads, the
   corridor, Indigenous lands, OpenStreetMap facilities) can be drawn on the map from the
   Layers menu.
2. Pick the layer at the top (`schools_cnefe`, `health_cnefe`). The list on the left can be
   searched (accents ignored), filtered by category, by "without a reference screenshot", or
   by an SQL condition on the layer's own columns (`matched = 0 AND distance_to_road_km > 5`),
   and ordered by feature id or in a random order drawn from the project's seed.
3. For each record:
   - **C** captures the map on the left. `G` opens Google Maps (satellite) at the
     coordinates, `P` drops a pin there, `V` opens Street View.
   - **R** hides the window so you can select a region of the screen (the browser with
     Google Maps); the selection becomes the screenshot of the active slot. `⌘V` pastes an
     image copied with `⌃⇧⌘4`; an image file can also be dropped on a slot. Click a slot to
     make it the active one.
   - **The map** draws every layer of the open register (the point layers whose
     identifier column has the same name: `schools_cnefe` and `health_cnefe` share
     `cnefe_id`), each in the colour TERRA gives it in the same file. Hovering a point
     names it and its layer; pressing it opens that record, switching layer if needed; a
     right-click copies "lat, lon" of the place under the pointer, ready to paste into
     Google Maps. The open record is the larger dot under the yellow crosshair, and a
     record with an answer has a white ring. A thin bar at the top of the map shows while
     imagery or layers are loading. Other layers of the GeoPackage are added from the
     Layers menu; OpenStreetMap layers are not drawn by default, since their points would
     tell the annotator what a hidden `matched` column holds.
   - **Paste a location** into the field over the map, or press `⌘V` anywhere outside a
     text field (`L` focuses the field). It reads `-7.546178, -63.067186` as Google Maps
     copies it, decimal commas (`-7,546178; -63,067186`), degrees, minutes and seconds
     (`7°32'46.2"S 63°04'01.9"W`) and Google Maps links. When a record of the register
     lies within 1 m, as when the coordinate was copied from TERRA or QGIS, that record
     opens. Anywhere else the map flies there, marks the place with a blue diamond, and a
     note gives the nearest record and the distance from the open one; the mark goes away
     with the next record. A pair given longitude first is turned round when only that
     order falls within the layer. A map capture with the diamond in view shows it, and
     its legend gives the distance from the record.
   - **1** to **9** choose the category; type what Google Maps shows at the point and any notes.
   - **⌘↵** saves and moves to the next record; **⌥↓ / ⌥↑** move without leaving the form
     (unsaved changes are saved first). **F** shows both screenshots full size; **M**
     switches the left slot between the live map and its screenshot.

The first time a region is captured, macOS asks for Screen Recording permission for the
application (System Settings, Privacy & Security, Screen Recording). Without it the
capture shows the desktop and no windows.

## What a project folder holds

```
project/
  annotations.sqlite       the project: settings, answers, history, screenshot index
  images/<layer>/<fid>/    source-<time>.png, reference-<time>.png
  exports/<date_time>/     one folder per export
```

- **The source file is pinned.** The project records the GeoPackage's path and SHA-256.
  When the file at that path changes or disappears, a banner says so, and the project can
  be pointed at the file again; a file with a different hash is accepted only on request,
  and the old hash is kept.
- **The first answer is kept.** Every save that changes something adds a row to
  `annotation_history`, which triggers make insert-only, and each record keeps
  `first_category`, the first category it was given. A judgement asked again until it
  gives another answer still shows the first one.
- **Screenshots are never overwritten.** A replaced or removed screenshot keeps its file
  and its row, marked with the time it stopped being current.
- **Blind annotation.** In Settings, any column of a layer can be hidden while annotating:
  it is left out of the header, the attribute table, the search and the map picture, so the
  judgement is not made knowing it (the road surface, say, when the study compares paved
  and unpaved stretches). It is still exported.
- **Categories** are the project's own. Six are offered (facility at the point, nearby but
  not at the point, other use, abandoned, nothing built, cannot tell); labels can be edited
  and categories added. A category already used in a saved answer cannot be removed.

## Exports

**Export** writes a new folder under `exports/` and shows it in the Finder:

| File | Contents |
|---|---|
| `annotations_<layer>.csv` | one row per record with an answer or a screenshot: category and its label, first category, number of revisions, reference label, notes, annotator, times, screenshot paths and SHA-256, the source file and its SHA-256, and every source attribute as `gpkg_<column>` |
| `history_<layer>.csv` | every saved revision, in order |
| `annotations.gpkg` | one point layer per annotated layer, `<layer>_annotations`, with the answer and the source attributes, for QGIS |
| `report.html` | each record with its two screenshots side by side, grouped by category, with counts |

## Network

The application sends requests only for basemap tiles, to Esri (World Imagery, World
Street Map, place names) and EOX (Sentinel-2 cloudless 2025); a tile request carries the
area in view. Google Maps is opened in the browser and never loaded inside the
application: Google's terms do not allow its tiles in another application's map, and the
browser shows its latest imagery and place labels anyway.

Where Esri has no imagery at a zoom it serves a grey "Map data not yet available" tile. In
the interior of Brazil its finest level often stops at 17 (measured at Humaitá, AM). The
map asks for missing tiles as errors instead and shows the finest level that exists,
enlarged.

## When something goes wrong

The page writes what fails (map and tile errors, a map that stays loading for more than
20 s, uncaught errors) to `~/Library/Logs/TERRA-Notation/page.log`, which Console.app also
lists. Send that file with a description of what was on screen.

## Limits

- Layers in a geographic system (EPSG:4326, SIRGAS 2000 EPSG:4674) or in Web Mercator are
  read. A layer in a projected system such as UTM is listed with the reason it cannot be
  read; save a copy in EPSG:4326 (`ogr2ogr -t_srs EPSG:4326`).
- Region capture and clipboard paste use macOS tools. On other systems a screenshot reaches
  a slot as a dropped or chosen file.
- One annotator per project at a time: the project is a single SQLite file.

## Repository layout

| Path | What it is |
|---|---|
| `*.go` at the root | the Wails application; `app_<subject>.go` holds the methods bound to the frontend |
| `internal/gpkg` | reads GeoPackages (GP header and WKB) and writes the exported one |
| `internal/annotation` | the project folder: settings, answers, history, screenshots |
| `internal/exports` | CSV, GeoPackage and HTML exports |
| `frontend/src/lib` | logic without React (list order, coordinates, formats, Google Maps links, the map picture), tested with Vitest |
| `frontend/src/components`, `pages` | the interface |
| `frontend/wailsjs` | bindings generated by `wails build` and `wails dev` from the bound Go methods |

## Checks

From the root:

```sh
gofmt -l .                # prints nothing
go vet ./...
go test -race ./...
```

From `frontend/`:

```sh
npm run check:format
npx tsc --noEmit
npm test
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the application reads the GeoPackage,
  keeps a project, draws and captures the map, and why each of those choices was made.
- [AGENTS.md](AGENTS.md): the rules for coding agents working in this repository.

## License

GNU General Public License, version 3. See [LICENSE](LICENSE).
