package main

import (
	"fmt"

	"terra-point-check/internal/annotation"
	"terra-point-check/internal/gpkg"
)

// SampleState is a layer's current sample as the page shows it. The page
// gets the strata's counts but not each record's stratum, so a stratum column
// hidden while annotating is not handed to it record by record.
type SampleState struct {
	// Sample is nil when the layer has none.
	Sample *annotation.Sample `json:"sample"`
	// FIDs are the sample's records in their order.
	FIDs []int64         `json:"fids"`
	Pace annotation.Pace `json:"pace"`
}

// population reads every feature id of the layer, for the order, and the
// records the condition keeps, each with its stratum.
func population(src *gpkg.File, d annotation.SampleDesign) ([]int64, []annotation.Member, error) {
	t, err := src.Table(d.Layer)
	if err != nil {
		return nil, nil, err
	}
	col := -1
	if d.StratumColumn != "" {
		for i, c := range t.Columns {
			if c.Name == d.StratumColumn {
				col = i
			}
		}
		if col < 0 {
			return nil, nil, fmt.Errorf("layer %s has no column %s", d.Layer, d.StratumColumn)
		}
	}
	var keep map[int64]bool
	if d.Condition != "" {
		ids, err := src.FilterFIDs(d.Layer, d.Condition)
		if err != nil {
			return nil, nil, err
		}
		keep = make(map[int64]bool, len(ids))
		for _, id := range ids {
			keep[id] = true
		}
	}
	fids := make([]int64, 0, len(t.Rows))
	var pop []annotation.Member
	for _, r := range t.Rows {
		fids = append(fids, r.FID)
		if keep != nil && !keep[r.FID] {
			continue
		}
		m := annotation.Member{FID: r.FID}
		if col >= 0 && r.Values[col] != nil {
			m.Stratum = valueText(r.Values[col])
		}
		pop = append(pop, m)
	}
	return fids, pop, nil
}

// PreviewSample says what a design would draw: the population and, for each
// stratum, its size and the number drawn. Nothing is kept.
func (a *App) PreviewSample(d annotation.SampleDesign) (*annotation.Sample, error) {
	p, src, err := a.openSource()
	if err != nil {
		return nil, err
	}
	fids, pop, err := population(src, d)
	if err != nil {
		return nil, err
	}
	return p.PreviewSample(d, fids, pop)
}

// DrawSample draws a sample of a layer and fixes it in the project. replace
// must be true to replace the layer's current sample, which is kept.
func (a *App) DrawSample(d annotation.SampleDesign, replace bool) (*SampleState, error) {
	p, src, err := a.openSource()
	if err != nil {
		return nil, err
	}
	d.Kind = annotation.KindSample
	d.Origin = nil
	fids, pop, err := population(src, d)
	if err != nil {
		return nil, err
	}
	if _, err := p.DrawSample(d, fids, pop, replace); err != nil {
		return nil, err
	}
	return a.CurrentSample(d.Layer)
}

// CurrentSample is a layer's current sample, its records in order and the
// pace of annotation on the layer.
func (a *App) CurrentSample(layer string) (*SampleState, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	st := &SampleState{FIDs: []int64{}}
	if st.Pace, err = p.LayerPace(layer); err != nil {
		return nil, err
	}
	if st.Sample, err = p.CurrentSample(layer); err != nil || st.Sample == nil {
		return st, err
	}
	recs, err := p.SampleRecords(st.Sample.ID)
	if err != nil {
		return nil, err
	}
	for _, r := range recs {
		st.FIDs = append(st.FIDs, r.FID)
	}
	return st, nil
}
