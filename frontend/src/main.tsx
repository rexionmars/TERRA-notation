import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "maplibre-gl/dist/maplibre-gl.css"
// Before any map is built; see the module.
import "./lib/maplibreWorker"
// Problems the page sees go to page.log from the start.
import "./lib/pageLog"
// TERRA's three faces, bundled; see the font block in index.css.
import "@fontsource-variable/inter/opsz.css"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource-variable/exo-2"
import "./index.css"
import App from "./App"

const root = document.getElementById("root")
if (!root) throw new Error("index.html has no #root element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
