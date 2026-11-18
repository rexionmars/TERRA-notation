/*
  Layer colours, given out in turn in the order the GeoPackage lists its
  layers, the way TERRA gives them out: the Okabe and Ito palette without
  black, which stays distinct for readers with colour-vision deficiency. The
  same file therefore shows the same colours in both applications.
*/
export const LAYER_COLORS = [
  "#E69F00",
  "#56B4E9",
  "#009E73",
  "#CC79A7",
  "#F0E442",
  "#D55E00",
  "#0072B2",
]

export function layerColor(indexInFile: number): string {
  return LAYER_COLORS[indexInFile % LAYER_COLORS.length]
}
