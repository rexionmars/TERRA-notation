package main

import (
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
