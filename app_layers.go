package main

import (
	"fmt"
	"slices"

	"terra-notation/internal/gpkg"
)

// LoadLayer reads every feature of a layer.
func (a *App) LoadLayer(name string) (*gpkg.Table, error) {
	_, src, err := a.openSource()
	if err != nil {
		return nil, err
	}
	return src.Table(name)
}

// FilterLayer returns the ids an SQL condition on the layer's columns selects.
func (a *App) FilterLayer(name, condition string) ([]int64, error) {
	_, src, err := a.openSource()
	if err != nil {
		return nil, err
	}
	ids, err := src.FilterFIDs(name, condition)
	if ids == nil && err == nil {
		ids = []int64{}
	}
	return ids, err
}

// maxContextFeatures bounds one request for a context layer. The map asks
// again on every move, so a cut-off set fills in as the reader zooms in.
const maxContextFeatures = 4000

// ContextFeatures returns the features of a layer inside the map's view.
func (a *App) ContextFeatures(name string, bbox gpkg.BBox) (*gpkg.FeatureCollection, error) {
	_, src, err := a.openSource()
	if err != nil {
		return nil, err
	}
	return src.FeaturesIn(name, bbox, maxContextFeatures)
}

// NearRecord is a record near a location the reader pasted.
type NearRecord struct {
	Layer  string  `json:"layer"`
	FID    int64   `json:"fid"`
	Title  string  `json:"title"`
	Meters float64 `json:"meters"`
}

// maxNearRecords bounds one request; the page shows a handful.
const maxNearRecords = 20

// NearestRecords returns the records of the given point layers nearest to a
// location, nearest first, each named by its layer's name column unless that
// column is hidden while annotating.
func (a *App) NearestRecords(layers []string, lon, lat float64, limit int) ([]NearRecord, error) {
	p, src, err := a.openSource()
	if err != nil {
		return nil, err
	}
	settings, err := p.Settings()
	if err != nil {
		return nil, err
	}
	near, err := src.Nearest(layers, lon, lat, min(max(limit, 1), maxNearRecords))
	if err != nil {
		return nil, err
	}
	out := make([]NearRecord, 0, len(near))
	for _, n := range near {
		rec := NearRecord{Layer: n.Layer, FID: n.Row.FID, Title: fmt.Sprintf("fid %d", n.Row.FID), Meters: n.Meters}
		ls := settings.Layers[n.Layer]
		if l, err := src.Layer(n.Layer); err == nil && ls.NameColumn != "" && !slices.Contains(ls.HiddenColumns, ls.NameColumn) {
			for i, c := range l.Columns {
				if c.Name == ls.NameColumn && n.Row.Values[i] != nil {
					if t := valueText(n.Row.Values[i]); t != "" {
						rec.Title = t
					}
				}
			}
		}
		out = append(out, rec)
	}
	return out, nil
}
