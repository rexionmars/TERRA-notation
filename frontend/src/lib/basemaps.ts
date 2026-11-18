/*
  Basemaps for the map on the left. Each serves tiles with CORS headers, which
  a picture of the map needs: a canvas drawn from tiles without them cannot be
  read. Google's tiles are not among them, and its terms forbid using them in
  another application's map.
*/

export interface TileLevel {
  tiles: string
  /** the deepest zoom the server is asked for; deeper views enlarge it */
  maxzoom: number
}

export interface Basemap {
  id: string
  label: string
  attribution: string
  /** drawn bottom to top; a tile missing in an upper level shows the one below */
  levels: TileLevel[]
}

const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

export const BASEMAPS: Basemap[] = [
  {
    id: "esri_imagery",
    label: "Esri World Imagery",
    attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    /*
      Where Esri has no imagery at a zoom it answers with a grey "Map data not
      yet available" tile, and in the interior of Brazil the finest level often
      stops at 17 (measured at Humaitá, AM: zooms 18 and 19 are that tile). With
      blankTile=false a missing tile is a 404 instead, which draws nothing and
      lets the level below show through, enlarged.
    */
    levels: [
      { tiles: ESRI_IMAGERY, maxzoom: 15 },
      { tiles: ESRI_IMAGERY + "?blankTile=false", maxzoom: 17 },
      { tiles: ESRI_IMAGERY + "?blankTile=false", maxzoom: 19 },
    ],
  },
  {
    id: "esri_streets",
    label: "Esri World Street Map",
    attribution: "Esri, HERE, Garmin, USGS, NGA, and the GIS User Community",
    levels: [
      {
        tiles:
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        maxzoom: 19,
      },
    ],
  },
  {
    id: "s2cloudless_2025",
    label: "Sentinel-2 cloudless 2025 (EOX)",
    attribution:
      "Sentinel-2 cloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0",
    levels: [
      {
        tiles:
          "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg",
        maxzoom: 15,
      },
    ],
  },
]

export const LABELS_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"

/** The source and layer ids of one level of a basemap. */
export function levelId(basemap: Basemap, i: number): string {
  return `${basemap.id}:${i}`
}
