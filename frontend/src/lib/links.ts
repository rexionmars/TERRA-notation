/*
  Links to Google Maps, built with the documented Maps URLs
  (https://developers.google.com/maps/documentation/urls/get-started), which
  need no key. They open in the browser: Google's terms do not allow its tiles
  inside another application's map, so the reference is read there and brought
  back as a screenshot.
*/

const coord = (n: number) => n.toFixed(6)

/** The satellite map centred on the point. */
export function googleSatellite(lon: number, lat: number, zoom = 19): string {
  return (
    "https://www.google.com/maps/@?api=1&map_action=map" +
    `&center=${coord(lat)},${coord(lon)}&zoom=${zoom}&basemap=satellite`
  )
}

/** A search for the coordinates, which drops a pin and lists what is there. */
export function googlePin(lon: number, lat: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${coord(lat)},${coord(lon)}`
}

/** Street View at the nearest panorama, when there is one. */
export function googleStreetView(lon: number, lat: number): string {
  return (
    "https://www.google.com/maps/@?api=1&map_action=pano" +
    `&viewpoint=${coord(lat)},${coord(lon)}`
  )
}
