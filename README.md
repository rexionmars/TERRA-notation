# TERRA Point Check

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
wails build                  # build/bin/TERRA Point Check.app
wails dev                    # development, with the frontend reloading
open -a "build/bin/TERRA Point Check.app" --args /path/to/project-folder   # open a project directly
```

The application was called TERRA Notation until version 0.1.0. Project folders made under
that name open unchanged, and its list of recent projects carries over. macOS asks once
more for Screen Recording permission, since the permission belongs to the application's
identifier, which changed with the name and is now fixed in `build/darwin/Info.plist`.

## Working through a layer

1. **New project**: choose the `.gpkg`, a folder for the project, a name and the
   annotator's name. Every point layer can be annotated; the other layers (roads, the
   corridor, Indigenous lands, OpenStreetMap facilities) can be drawn on the map from its
   layers button.
2. Pick the layer in the bar at the top, where its name follows the project's
   (`schools_cnefe`, `health_cnefe`). The list on the left can be
   searched (accents ignored), filtered by category, by "without a reference screenshot", or
   by an SQL condition on the layer's own columns (`matched = 0 AND distance_to_road_km > 5`),
   and ordered by feature id or in a random order drawn from the project's seed.
3. **Draw a sample** (Sample, in the top bar) before looking at the records, when the shares
   of categories are to be estimates for the layer. Choose the population (every record, or
   an SQL condition), and either a number of records or a column to stratify by, with the
   same number from each stratum or a total shared in proportion to their sizes. Preview
   shows each stratum's size and what would be drawn; Draw fixes it. The sample is drawn in
   the list's random order and does not change afterwards; the seed is fixed with it.
   Drawing another replaces it and keeps the old one in the project. The bar then counts
   the answered records of the sample and the ones passed over (without a category, before
   the last answer), and the list filters to the sample, its records without a category,
   or those passed over. The Sample window gives the median time from opening a record to
   its first answer and what the rest takes at that pace. If the study compares the values
   of the stratum column, hide it in Settings first.
4. For each record:
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
     imagery or layers are loading. The column of buttons at the map's right edge zooms,
     chooses the basemap, shows place names, and adds other layers of the GeoPackage;
     OpenStreetMap layers are not drawn by default, since their points would tell the
     annotator what a hidden `matched` column holds. On Esri World Imagery the legend gives
     the date, sensor, resolution and provider of the imagery at the open record for the
     zoom in view (at Humaitá: 2025-04-14, WorldView-3, 0.31 m, Vantor), and a map capture
     carries them in its strip and in the project.
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
   - **1** to **9** choose the category; type what Google Maps shows at the point, the date
     of its imagery (Street View gives it as "Image capture"; when the reference shows none,
     tick "The reference shows no date"), and any notes. `14/03/2023` is read as
     `2023-03-14`.
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
  annotations.schema-<n>.sqlite   the project as it was before an upgrade from version n
  images/<layer>/<fid>/    source-<time>.png, reference-<time>.png
  exports/<date_time>/     one folder per export
```

A project made by an earlier version of the application is upgraded when it is opened,
after a copy of its database is kept beside it. The earlier version can still open that
copy; it refuses the upgraded file.

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
| `annotations_<layer>.csv` | one row per record with an answer or a screenshot: category and its label, first category, number of revisions, reference label, the date of the reference imagery and whether it was recorded, not shown or not recorded, the date and source of the Esri imagery in the map capture, notes, annotator, times, screenshot paths and SHA-256, the source file and its SHA-256, and every source attribute as `gpkg_<column>` |
| `history_<layer>.csv` | every saved revision, in order, with the moment the record was opened before it |
| `annotations.gpkg` | one point layer per annotated layer, `<layer>_annotations`, with the answer and the source attributes, for QGIS |
| `samples.csv`, `sample_strata.csv` | each sample's design (population, strata, allocation, seed, when it was drawn and replaced, answers that existed before it), and each stratum's size and the number drawn |
| `sample_<id>.csv` | the records of a sample in their order, with their stratum and status: answered, passed over, or not reached |
| `estimates_<layer>.csv` | the share of each category, with its 95 % interval and the method, for the population and each stratum of the layer's sample; without a sample, the shares of the answered records with no interval |
| `report.html` | the same shares as tables, with what the sample left unanswered and the median time per record; then each record with its two screenshots side by side, grouped by category |

## Network

The application sends requests only for basemap tiles, to Esri (World Imagery, World
Street Map, place names) and EOX (Sentinel-2 cloudless 2025), and, on World Imagery, for
the date of the imagery at the open record, to the Citations layer of the same Esri
service. A tile request carries the area in view; a date request carries the record's
coordinates. Google Maps is opened in the browser and never loaded inside the
application: Google's terms do not allow its tiles in another application's map, and the
browser shows its latest imagery and place labels anyway.

Where Esri has no imagery at a zoom it serves a grey "Map data not yet available" tile. In
the interior of Brazil its finest level often stops at 17 (measured at Humaitá, AM). The
map asks for missing tiles as errors instead and shows the finest level that exists,
enlarged.

## When something goes wrong

The page writes what fails (map and tile errors, a map that stays loading for more than
20 s, uncaught errors) to `~/Library/Logs/TERRA-Point-Check/page.log`, which Console.app also
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
