/*
Command TERRA-Notation annotates the points of a GeoPackage against current
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
		Title:            "TERRA Notation",
		Width:            1480,
		Height:           920,
		MinWidth:         1100,
		MinHeight:        700,
		BackgroundColour: &options.RGBA{R: 17, G: 17, B: 19, A: 1},
		/*
			TERRA_NOTATION_START_HIDDEN=1 keeps the window off the screen. Under
			wails dev the page is also served at http://localhost:34115 with
			working bindings, so it can be driven from a headless browser while
			someone else is using the machine.
		*/
		StartHidden: os.Getenv("TERRA_NOTATION_START_HIDDEN") == "1",
		AssetServer: &assetserver.Options{
			Assets: assets,
			/*
				Screenshots are fetched over HTTP from the project folder rather
				than returned by a bound method, which would carry them to the
				page as base64 strings. Middleware rather than Handler: Handler is
				reached only when Assets misses, and a single-page build answers
				every unknown path with index.html.
			*/
			Middleware: app.imageMiddleware,
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
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "TERRA Notation",
				Message: "Annotation of GeoPackage points against current map imagery",
			},
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
