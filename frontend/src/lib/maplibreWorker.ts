/**
 * Points MapLibre at its own web worker. Imported once, in main.tsx, before
 * any map is built. The same fix, and the account of the failure, is in the
 * TERRA desktop application (frontend/src/lib/maplibreWorker.ts).
 *
 * Without it every GeoJSON source stays loading forever and nothing says why.
 * MapLibre looks for its worker beside its own module, with
 * new URL("./maplibre-gl-worker.mjs", import.meta.url). Under Vite's dev server
 * that module is served from node_modules/.vite/deps, where the worker was
 * never copied, so the URL is a 404; in the packaged application the page is
 * served over wails://, which MapLibre does not take for a URL, and
 * new Worker("") loads the page itself. Raster tiles are read on the main
 * thread, so the imagery draws and the map looks alive while no point or line
 * ever appears, and a wait for the map to be idle never ends.
 *
 * `?worker&url` makes Vite bundle the worker with the module it imports and
 * return a URL that resolves both in development and in the build.
 */
import { setWorkerUrl } from "maplibre-gl"
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"

setWorkerUrl(maplibreWorkerUrl)
