package main

import (
	"context"
	"net/http"
	"time"

	"terra-point-check/internal/imagery"
)

// imageryClient answers within 15 s or not at all: the date is shown beside
// the map, and a query that hangs must not hold a capture.
var imageryClient = &http.Client{Timeout: 15 * time.Second}

// EsriImagery lists the sources of Esri's World Imagery drawn at a point,
// with their dates, finest levels first.
func (a *App) EsriImagery(lon, lat float64) ([]imagery.Source, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return imagery.At(ctx, imageryClient, imagery.CitationsURL, lon, lat)
}
