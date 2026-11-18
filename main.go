/*
Command TERRA-Point-Check checks the points of a GeoPackage against current
map imagery.

For each record (a school or a health facility in the CNEFE, for example) it
shows the point on a satellite basemap, opens the same coordinates in Google
Maps, keeps a screenshot of each side and a judgement of what is really at the
point. The GeoPackage is only read. The judgements, their history and the
screenshots live in a project folder of their own.
*/
package main

import (
	"embed"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:            "TERRA Point Check",
		Width:            1480,
		Height:           920,
		MinWidth:         1100,
		MinHeight:        700,
		BackgroundColour: &options.RGBA{R: 14, G: 14, B: 14, A: 1}, // the page's ground, --p-sunk
		/*
			TERRA_POINT_CHECK_START_HIDDEN=1 keeps the window off the screen. Under
			wails dev the page is also served at http://localhost:34115 with
			working bindings, so it can be driven from a headless browser while
			someone else is using the machine.
		*/
		StartHidden: os.Getenv("TERRA_POINT_CHECK_START_HIDDEN") == "1",
		AssetServer: &assetserver.Options{
			Assets: assets,
			/*
				Screenshots and whole layers are fetched over HTTP rather than
				returned by a bound method, which would carry them to the page as
				strings for the page to parse. Middleware rather than Handler: Handler is
				reached only when Assets misses, and a single-page build answers
				every unknown path with index.html.
			*/
			Middleware: func(next http.Handler) http.Handler {
				return app.imageMiddleware(app.layerMiddleware(next))
			},
		},
		/*
			A file dropped on the window reaches the page as its path. Only an
			element that declares --wails-drop-target receives one: the two
			screenshot slots.
		*/
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true},
		OnStartup:   app.startup,
		OnShutdown:  app.shutdown,
		Bind:        []interface{}{app},
		Mac: &mac.Options{
			/*
				Hidden, as TERRA's is, so the page draws the bar itself
				(frontend/src/components/TitleBar.tsx). Hidden rather than
				hidden-inset: without the toolbar the traffic lights are centred
				16 pt down, on the centre line of that 32 pt bar.
			*/
			TitleBar:   mac.TitleBarHidden(),
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "TERRA Point Check",
				Message: "Checks the points of a GeoPackage against current map imagery",
			},
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
