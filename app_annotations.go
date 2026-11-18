package main

import (
	"fmt"
	"strconv"

	"terra-point-check/internal/annotation"
	"terra-point-check/internal/gpkg"
)

// Summaries lists the records of a layer that have an annotation or a
// screenshot.
func (a *App) Summaries(layer string) ([]annotation.Summary, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	s, err := p.Summaries(layer)
	if s == nil && err == nil {
		s = []annotation.Summary{}
	}
	return s, err
}

// Record returns what the project holds about one feature.
func (a *App) Record(layer string, fid int64) (*annotation.Entry, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	return p.Record(layer, fid)
}

// History lists the saved revisions of one feature.
func (a *App) History(layer string, fid int64) ([]annotation.HistoryEntry, error) {
	p, _, err := a.open()
	if err != nil {
		return nil, err
	}
	return p.History(layer, fid)
}

// SaveAnnotation stores the form. The record's id, name and position are
// read from the GeoPackage here rather than taken from the page, so the
// snapshot is the file's and not what the page happened to hold.
func (a *App) SaveAnnotation(d annotation.Draft) (*annotation.Entry, error) {
	p, src, err := a.openSource()
	if err != nil {
		return nil, err
	}
	snap, err := snapshot(p, src, d.Layer, d.FID)
	if err != nil {
		return nil, err
	}
	return p.Save(d, snap)
}

func snapshot(p *annotation.Project, src *gpkg.File, layer string, fid int64) (annotation.Snapshot, error) {
	var snap annotation.Snapshot
	l, err := src.Layer(layer)
	if err != nil {
		return snap, err
	}
	row, err := src.Feature(layer, fid)
	if err != nil {
		return snap, err
	}
	settings, err := p.Settings()
	if err != nil {
		return snap, err
	}
	ls := settings.Layers[layer]
	for i, c := range l.Columns {
		v := row.Values[i]
		if v == nil {
			continue
		}
		switch c.Name {
		case ls.NameColumn:
			snap.RecordName = valueText(v)
		case ls.IDColumn:
			snap.RecordID = valueText(v)
		}
	}
	if row.Position != nil {
		snap.Lon, snap.Lat = &row.Position[0], &row.Position[1]
	}
	return snap, nil
}

// valueText writes an attribute value as text. A float is written in full,
// since an id stored as REAL would otherwise come out in exponent form.
func valueText(v any) string {
	if f, ok := v.(float64); ok {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}
